<?php

namespace App\Http\Controllers;

use App\Models\Character;
use App\Models\CharacterVersion;
use App\Models\CharacterSpritePack;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\URL;
use ZipArchive;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * 2.5D card characters (kind = 'card'): ready-made PNG cards from the karakter/ folder — one body per pose, one head per
 * expression, mouth shapes a/i/u/e/o and an eyelid overlay, described by character.json. Importing copies the files into
 * storage, so a version never changes when the folder is edited; "refresh" makes a new version from the folder.
 */
class CardCharacterController extends Controller
{
    private const DIR = 'cards';

    private function karakterDir(): string
    {
        return base_path('..'.DIRECTORY_SEPARATOR.'karakter');
    }

    public function index(Request $request): JsonResponse
    {
        $rows = Character::where('user_id', $request->user()->id)->where('kind', 'card')->orderByDesc('updated_at')->get();

        return response()->json(['data' => $rows->map(fn ($c) => $this->summary($c))]);
    }

    /** Folders under karakter/ with a usable character.json, and which of them this user already imported. */
    public function available(Request $request): JsonResponse
    {
        $imported = Character::where('user_id', $request->user()->id)->where('kind', 'card')->with('versions')->get()
            ->flatMap(fn ($c) => $c->versions->map(fn ($v) => [$v->config['source'] ?? null, $c->id]))
            ->filter(fn ($x) => $x[0])->mapWithKeys(fn ($x) => [$x[0] => $x[1]]);
        $out = [];
        foreach (glob($this->karakterDir().DIRECTORY_SEPARATOR.'*', GLOB_ONLYDIR) ?: [] as $dir) {
            $slug = basename($dir);
            if (str_starts_with($slug, '_')) {
                continue;
            }
            $spec = $this->readSpec($slug);
            if (is_string($spec)) {
                $out[] = ['slug' => $slug, 'name' => ucfirst($slug), 'ok' => false, 'problem' => $spec, 'imported_id' => null];

                continue;
            }
            $out[] = ['slug' => $slug, 'name' => ucfirst($spec['meta']['name'] ?? $slug), 'ok' => true, 'problem' => null,
                'style' => $spec['meta']['style'] ?? null, 'poses' => array_keys($spec['files']['body']), 'expressions' => array_keys($spec['files']['head']),
                'imported_id' => $imported[$slug] ?? null];
        }

        return response()->json(['data' => $out]);
    }

    public function import(Request $request): JsonResponse
    {
        $data = $request->validate(['slug' => ['required', 'string', 'max:64', 'regex:/^[a-z0-9][a-z0-9_-]*$/i'], 'name' => 'nullable|string|max:120']);
        $spec = $this->readSpec($data['slug']);
        if (is_string($spec)) {
            return response()->json(['message' => $spec, 'errors' => ['slug' => [$spec]]], 422);
        }
        $c = DB::transaction(function () use ($request, $data, $spec) {
            $c = Character::create(['user_id' => $request->user()->id, 'kind' => 'card', 'name' => ($data['name'] ?? null) ?: ucfirst($spec['meta']['name'] ?? $data['slug']), 'method' => 'rig']);
            $this->addVersion($c, $data['slug'], $spec, 'Impor dari folder karakter/'.$data['slug']);

            return $c;
        });

        return response()->json(['data' => $this->detail($c->fresh())], 201);
    }

    /**
     * Export the selected immutable card version as an editable ZIP package.
     * The archive contains character.json plus every source PNG; it never mutates the source character.
     */
    public function exportPackage(Request $request, Character $character)
    {
        $this->own($request, $character);
        abort_unless(class_exists(ZipArchive::class), 501, 'Ekstensi PHP ZipArchive belum tersedia di server.');
        $version = $character->versions()->where('number', $request->integer('version') ?: $character->current_version)->firstOrFail();
        $config = $version->config;
        abort_unless(($config['type'] ?? null) === 'card' && ! empty($config['dir']) && is_array($config['files'] ?? null), 422);

        $files = $config['files'];
        $manifest = [
            'format' => 'animasi2d.character-card-package',
            'format_version' => 1,
            'character' => ['name' => $character->name, 'source_id' => $character->id, 'source_version' => $version->number],
            'meta' => $config['meta'],
            'files' => $files,
            'instructions' => [
                'Edit sprite-sheet/sprite-sheet-01.png and any additional sprite-sheet pages in Google Flow; keep the 4x4 grid, transparent background, and cell boundaries unchanged.',
                'Each 1024x1024 cell is a complete character composite for one body pose and head expression; sprite-sheet-index.json and each page JSON map cells back to pose/expression IDs.',
                'Keep the original assets/ PNGs in the ZIP. They preserve the modular card rig; edited sprite sheets are imported as full-character sprite packs on the new character.',
                'Import this ZIP as a new character; the original character and its versions remain unchanged.',
            ],
        ];

        $tmp = tempnam(sys_get_temp_dir(), 'animasi2d-character-');
        if ($tmp === false) {
            abort(500, 'Tidak dapat menyiapkan file export.');
        }
        $zip = new ZipArchive();
        if ($zip->open($tmp, ZipArchive::OVERWRITE) !== true) {
            @unlink($tmp);
            abort(500, 'Tidak dapat membuat paket ZIP.');
        }

        try {
            $zip->addFromString('character.json', json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            // Google Flow editing sheet: every body-pose × head-expression combination is
            // rendered as a complete, transparent 1024px frame. 16 frames per 4096px page.
            $spritePages = $this->buildCharacterSpriteSheets($config['dir'], $config['meta'], $files);
            $pageIndex = ['format' => 'animasi2d.character-card-sprite-sheet-index', 'format_version' => 1,
                'character' => ['name' => $character->name, 'source_id' => $character->id, 'source_version' => $version->number],
                'frame' => ['width' => 1024, 'height' => 1024], 'columns' => 4, 'rows' => 4,
                'pages' => array_map(fn ($p) => ['image' => $p['image'], 'manifest' => $p['manifest'], 'frame_count' => count($p['frames'])], $spritePages)];
            $zip->addFromString('sprite-sheet-index.json', json_encode($pageIndex, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
            $zip->addFromString('GOOGLE-FLOW-PROMPT.txt', implode("\n", [
                'Edit this complete character sprite sheet consistently across every cell.',
                'Preserve the exact 4-column × 4-row grid, every 1024×1024 cell boundary, the original 4096×4096 canvas size, and each character position/scale.',
                'Keep one complete full-body character inside each character cell. Some cells on the last page(s) may contain isolated mouth/blink overlays; preserve those as separate transparent overlay artwork.',
                'Do not merge, move, reorder, crop, add, or remove cells.',
                'Preserve the character identity: face, hairstyle, skin tone, body proportions, silhouette, and recognizable details.',
                'Apply the requested outfit/style change consistently to every pose and expression in all pages.',
                'Keep the background transparent. Do not add labels, captions, borders, shadows outside the character, or decorative elements.',
                'Return each edited page as a PNG with exactly the same dimensions. Do not change the grid layout.',
                '',
                'After editing, replace only the PNG files in sprite-sheet/ and keep all JSON manifests and assets/ files unchanged.',
            ]));
            foreach ($spritePages as $page) {
                $zip->addFromString('sprite-sheet/'.$page['image'], $page['png']);
                $zip->addFromString('sprite-sheet/'.$page['manifest'], json_encode($page['json'], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
            }

            $names = [...array_values($files['body'] ?? []), ...array_values($files['head'] ?? []), ...array_values($files['mouth'] ?? []), ...(! empty($files['blink']) ? [$files['blink']] : [])];
            foreach (array_unique($names) as $name) {
                abort_unless(is_string($name) && preg_match('/^[a-z0-9_-]+\.png$/i', $name), 422, 'Nama file aset karakter tidak valid.');
                $assetPath = $config['dir'].'/'.$name;
                abort_unless(Storage::disk('local')->exists($assetPath), 404, 'Aset karakter tidak ditemukan: '.$name);
                $zip->addFromString('assets/'.$name, Storage::disk('local')->get($assetPath));
            }
            if (! empty($version->thumbnail_path) && Storage::disk('local')->exists($version->thumbnail_path)) {
                $zip->addFromString('preview.png', Storage::disk('local')->get($version->thumbnail_path));
            }
        } catch (\Throwable $e) {
            $zip->close();
            @unlink($tmp);
            throw $e;
        }
        $zip->close();

        return response()->download($tmp, Str::slug($character->name ?: 'character').'-v'.$version->number.'.zip', [
            'Content-Type' => 'application/zip',
            'Cache-Control' => 'private, no-store',
        ])->deleteFileAfterSend(true);
    }

    /**
     * Import an exported/edited card package as a completely new character.
     * ZIP entries are read by exact allow-listed names; the archive is never extracted.
     */
    public function importPackage(Request $request): JsonResponse
    {
        $data = $request->validate([
            'file' => 'required|file|mimes:zip|max:51200',
            'name' => 'nullable|string|max:120',
        ]);
        abort_unless(class_exists(ZipArchive::class), 501, 'Ekstensi PHP ZipArchive belum tersedia di server.');

        $zip = new ZipArchive();
        if ($zip->open($data['file']->getRealPath()) !== true) {
            return response()->json(['message' => 'File ZIP tidak dapat dibuka.'], 422);
        }

        try {
            $manifestText = $zip->getFromName('character.json');
            if (! is_string($manifestText) || strlen($manifestText) > 1048576) {
                return response()->json(['message' => 'Paket harus memiliki character.json maksimal 1 MB.'], 422);
            }
            $manifest = json_decode($manifestText, true);
            if (! is_array($manifest) || ($manifest['format'] ?? null) !== 'animasi2d.character-card-package' || ($manifest['format_version'] ?? null) !== 1) {
                return response()->json(['message' => 'Format paket karakter tidak dikenal atau versinya tidak didukung.'], 422);
            }
            $meta = $manifest['meta'] ?? null;
            $files = $manifest['files'] ?? null;
            if (! is_array($meta) || ! is_array($files)
                || ! is_array($meta['body'] ?? null) || ! is_array($meta['head'] ?? null)
                || ! is_array($meta['body']['poses'] ?? null) || ! is_array($meta['head']['expressions'] ?? null)
                || ! is_array($files['body'] ?? null) || ! is_array($files['head'] ?? null)
                || $files['body'] === [] || $files['head'] === []
                || ! is_array($meta['body']['canvas'] ?? null) || count($meta['body']['canvas']) !== 2
                || ! is_array($meta['head']['canvas'] ?? null) || count($meta['head']['canvas']) !== 2
                || ! is_array($meta['head']['paste_on_body'] ?? null) || count($meta['head']['paste_on_body']) !== 2
                || ! is_numeric($meta['body']['feet_y'] ?? null) || ! is_numeric($meta['body']['center_x'] ?? null)
                || ! is_array($files['mouth'] ?? []) || (isset($files['blink']) && $files['blink'] !== null && ! is_string($files['blink']))) {
                return response()->json(['message' => 'Metadata paket tidak lengkap atau strukturnya tidak valid. Body, head, canvas, dan file pose wajib tersedia.'], 422);
            }
            if (array_keys($files['body']) !== array_values($meta['body']['poses']) || array_keys($files['head']) !== array_values($meta['head']['expressions'])) {
                return response()->json(['message' => 'Daftar pose/ekspresi pada metadata tidak cocok dengan file gambar.'], 422);
            }
            if (count($files['body']) > 80 || count($files['head']) > 80 || count($files['mouth'] ?? []) > 40
                || (! empty($files['mouth']) && ! is_array($meta['mouth']['shapes'] ?? null))
                || (! empty($files['mouth']) && array_keys($files['mouth']) !== array_values($meta['mouth']['shapes']))) {
                return response()->json(['message' => 'Jumlah aset atau pemetaan pose, ekspresi, dan mulut dalam paket tidak valid.'], 422);
            }

            $names = [...array_values($files['body']), ...array_values($files['head']), ...array_values($files['mouth'] ?? []), ...(! empty($files['blink']) ? [$files['blink']] : [])];
            $names = array_values(array_unique($names));
            if (count($names) < 2 || count($names) > 200) {
                return response()->json(['message' => 'Jumlah file gambar dalam paket tidak valid.'], 422);
            }
            $assets = [];
            $totalBytes = 0;
            foreach ($names as $name) {
                if (! is_string($name) || ! preg_match('/^[a-z0-9_-]+\.png$/i', $name)) {
                    return response()->json(['message' => 'Nama file PNG dalam manifest tidak valid.'], 422);
                }
                $entry = 'assets/'.$name;
                $stat = $zip->statName($entry);
                if (! is_array($stat) || ($stat['size'] ?? 0) < 8 || ($stat['size'] ?? 0) > 10485760) {
                    return response()->json(['message' => 'File '.$name.' tidak ada atau ukurannya tidak valid.'], 422);
                }
                $totalBytes += (int) $stat['size'];
                if ($totalBytes > 52428800) {
                    return response()->json(['message' => 'Total ukuran aset ZIP melebihi 50 MB.'], 422);
                }
                $bytes = $zip->getFromName($entry);
                $image = is_string($bytes) ? @getimagesizefromstring($bytes) : false;
                if (! is_string($bytes) || ! $image || ($image['mime'] ?? null) !== 'image/png') {
                    return response()->json(['message' => 'Aset '.$name.' harus berupa PNG valid.'], 422);
                }
                $assets[$name] = $bytes;
            }

            // Optional edited sprite-sheet pages are imported as full-character sprite packs.
            // Read exact allow-listed ZIP entries; never extract the archive.
            $spritePages = [];
            $indexText = $zip->getFromName('sprite-sheet-index.json');
            if (is_string($indexText)) {
                if (strlen($indexText) > 1048576) {
                    return response()->json(['message' => 'Index sprite sheet melebihi 1 MB.'], 422);
                }
                $index = json_decode($indexText, true);
                if (! is_array($index) || ($index['format'] ?? null) !== 'animasi2d.character-card-sprite-sheet-index'
                    || ($index['format_version'] ?? null) !== 1 || ! is_array($index['pages'] ?? null)
                    || count($index['pages']) > 100) {
                    return response()->json(['message' => 'Index sprite sheet tidak valid.'], 422);
                }
                foreach ($index['pages'] as $page) {
                    $imageName = $page['image'] ?? '';
                    $manifestName = $page['manifest'] ?? '';
                    if (! is_string($imageName) || ! preg_match('/^sprite-sheet-\\d{2,3}\\.png$/', $imageName)
                        || ! is_string($manifestName) || ! preg_match('/^sprite-sheet-\\d{2,3}\\.json$/', $manifestName)) {
                        return response()->json(['message' => 'Nama file pada index sprite sheet tidak valid.'], 422);
                    }
                    $imageEntry = 'sprite-sheet/'.$imageName;
                    $manifestEntry = 'sprite-sheet/'.$manifestName;
                    $imageStat = $zip->statName($imageEntry);
                    $manifestText = $zip->getFromName($manifestEntry);
                    $sheetBytes = $zip->getFromName($imageEntry);
                    if (! is_array($imageStat) || ($imageStat['size'] ?? 0) > 52428800 || ! is_string($sheetBytes)
                        || ! is_string($manifestText) || strlen($manifestText) > 200000) {
                        return response()->json(['message' => 'File sprite sheet atau manifest tidak lengkap/terlalu besar.'], 422);
                    }
                    $sheetInfo = @getimagesizefromstring($sheetBytes);
                    $sheetJson = json_decode($manifestText, true);
                    if (! $sheetInfo || ($sheetInfo['mime'] ?? null) !== 'image/png' || $sheetInfo[0] !== 4096 || $sheetInfo[1] !== 4096
                        || strlen($sheetBytes) < 26 || ord($sheetBytes[25]) !== 6
                        || ! is_array($sheetJson) || ($sheetJson['format'] ?? null) !== 'animasi2d.character-sprite-atlas'
                        || ($sheetJson['format_version'] ?? null) !== 1
                        || ($sheetJson['frame']['width'] ?? null) !== 1024 || ($sheetJson['frame']['height'] ?? null) !== 1024
                        || ($sheetJson['atlas']['width'] ?? null) !== 4096 || ($sheetJson['atlas']['height'] ?? null) !== 4096
                        || ($sheetJson['atlas']['columns'] ?? null) !== 4 || ($sheetJson['atlas']['rows'] ?? null) !== 4
                        || ! is_array($sheetJson['animations'] ?? null) || empty($sheetJson['animations'])) {
                        return response()->json(['message' => 'Sprite sheet harus PNG RGBA 4096×4096 dengan manifest atlas 4×4 yang valid.'], 422);
                    }
                    $count = 0;
                    foreach ($sheetJson['animations'] as $animation) {
                        if (! is_array($animation) || ! is_array($animation['frames'] ?? null) || ! is_numeric($animation['fps'] ?? null)
                            || (int) $animation['fps'] < 1 || (int) $animation['fps'] > 60) {
                            return response()->json(['message' => 'Definisi animasi sprite sheet tidak valid.'], 422);
                        }
                        foreach ($animation['frames'] as $frame) {
                            $count++;
                            if (! is_array($frame) || ($frame['width'] ?? null) !== 1024 || ($frame['height'] ?? null) !== 1024
                                || ! is_numeric($frame['x'] ?? null) || ! is_numeric($frame['y'] ?? null)
                                || (int) $frame['x'] < 0 || (int) $frame['y'] < 0
                                || (int) $frame['x'] + 1024 > 4096 || (int) $frame['y'] + 1024 > 4096 || empty($frame['id'])) {
                                return response()->json(['message' => 'Koordinat frame pada sprite sheet tidak valid.'], 422);
                            }
                        }
                    }
                    if ($count < 1 || $count > 16) {
                        return response()->json(['message' => 'Setiap halaman sprite sheet harus berisi 1–16 frame.'], 422);
                    }
                    $spritePages[] = ['image' => $imageName, 'bytes' => $sheetBytes, 'manifest' => $sheetJson, 'frame_count' => $count];
                }
            }

            $safeFiles = [
                'body' => $files['body'],
                'head' => $files['head'],
                'mouth' => $files['mouth'] ?? [],
                'blink' => $files['blink'] ?? null,
            ];
            $characterName = ($data['name'] ?? '') ?: (($manifest['character']['name'] ?? $meta['name'] ?? 'Karakter').' (impor)');
            $character = DB::transaction(function () use ($request, $characterName, $meta, $safeFiles, $assets, $spritePages) {
                $c = Character::create(['user_id' => $request->user()->id, 'kind' => 'card', 'name' => $characterName, 'method' => 'rig']);
                $dir = self::DIR.'/'.Str::uuid();
                foreach ($assets as $filename => $bytes) {
                    Storage::disk('local')->put($dir.'/'.$filename, $bytes);
                }
                $spec = ['meta' => $meta, 'files' => $safeFiles];
                $thumb = $this->thumbnail(Storage::disk('local')->path($dir), $spec);
                if ($thumb) {
                    Storage::disk('local')->put($dir.'/_thumb.png', $thumb);
                }
                $config = ['type' => 'card', 'schema_version' => 1, 'source' => 'package-import', 'dir' => $dir, 'meta' => $meta, 'files' => $safeFiles];
                CharacterVersion::create([
                    'character_id' => $c->id, 'number' => 1, 'config' => $config,
                    'thumbnail_path' => $thumb ? $dir.'/_thumb.png' : null,
                    'note' => 'Karakter baru dari paket ZIP yang diimpor',
                ]);
                $c->update(['current_version' => 1]);

                foreach ($spritePages as $page) {
                    $sha = hash('sha256', $page['bytes']);
                    $sheetPath = 'character-sprite-packs/'.$c->id.'/'.$sha.'.png';
                    Storage::disk('local')->put($sheetPath, $page['bytes']);
                    $sheetManifest = $page['manifest'];
                    $sheetManifest['character'] = ['id' => $c->id, 'name' => $c->name, 'version' => 1];
                    $sheetManifest['verification'] = 'unverified-google-flow-edit';
                    CharacterSpritePack::create([
                        'user_id' => $request->user()->id, 'character_id' => $c->id, 'character_version' => 1,
                        'name' => pathinfo($page['image'], PATHINFO_FILENAME), 'outfit_id' => 'base',
                        'outfit_name' => 'Pakaian dasar (Google Flow)', 'outfit_type' => 'base',
                        'disk' => 'local', 'path' => $sheetPath, 'mime' => 'image/png',
                        'image_width' => 4096, 'image_height' => 4096, 'frame_width' => 1024, 'frame_height' => 1024,
                        'columns' => 4, 'rows' => 4, 'frame_count' => $page['frame_count'],
                        'fps' => 1, 'facing' => $sheetManifest['facing'] ?? 'front',
                        'manifest' => $sheetManifest, 'sha256' => $sha, 'status' => 'pending_review',
                    ]);
                }

                return $c;
            });

            return response()->json(['data' => $this->detail($character->fresh())], 201);
        } finally {
            $zip->close();
        }
    }

    /** New version from the folder the character was imported from (after the PNGs were redrawn). */
    public function refresh(Request $request, Character $character): JsonResponse
    {
        $this->own($request, $character);
        $cur = $character->versions()->where('number', $character->current_version)->firstOrFail();
        $slug = $cur->config['source'] ?? '';
        if ($slug === 'package-import') {
            return response()->json(['message' => 'Karakter ini berasal dari paket ZIP dan tidak memiliki folder sumber. Ekspor paket, edit aset, lalu impor sebagai karakter baru.'], 422);
        }
        $spec = $this->readSpec($slug);
        if (is_string($spec)) {
            return response()->json(['message' => $spec, 'errors' => ['slug' => [$spec]]], 422);
        }
        DB::transaction(fn () => $this->addVersion($character, $slug, $spec, 'Diperbarui dari folder karakter/'.$slug));

        return response()->json(['data' => $this->detail($character->fresh())], 201);
    }

    public function show(Request $request, Character $character): JsonResponse
    {
        $this->own($request, $character);

        return response()->json(['data' => $this->detail($character, $request->integer('version') ?: null)]);
    }

    public function rename(Request $request, Character $character): JsonResponse
    {
        $this->own($request, $character);
        $character->update($request->validate(['name' => 'required|string|max:120']));

        return response()->json(['data' => $this->summary($character->fresh())]);
    }

    public function destroy(Request $request, Character $character): JsonResponse
    {
        $this->own($request, $character);
        $dirs = $character->versions->map(fn ($v) => $v->config['dir'] ?? null)->filter()->unique();
        $character->delete();
        // the files of a version are shared by duplicates; remove a folder only when no version anywhere still points to it
        foreach ($dirs as $dir) {
            if (! CharacterVersion::where('config->dir', $dir)->exists()) {
                Storage::disk('local')->deleteDirectory($dir);
            }
        }

        return response()->json(['ok' => true]);
    }

    public function duplicate(Request $request, Character $character): JsonResponse
    {
        $this->own($request, $character);
        $src = $character->versions()->where('number', $character->current_version)->firstOrFail();
        $copy = DB::transaction(function () use ($request, $character, $src) {
            $c = Character::create(['user_id' => $character->user_id, 'kind' => 'card', 'name' => ($request->input('name') ?: $character->name.' (salinan)'), 'method' => 'rig']);
            CharacterVersion::create(['character_id' => $c->id, 'number' => 1, 'config' => $src->config, 'thumbnail_path' => $src->thumbnail_path, 'note' => 'Salinan dari "'.$character->name.'" v'.$src->number]);
            $c->update(['current_version' => 1]);

            return $c;
        });

        return response()->json(['data' => $this->detail($copy->fresh())], 201);
    }

    /** Signed: lets <img> / canvas load a card PNG without an Authorization header. */
    public function file(CharacterVersion $version, string $name): StreamedResponse
    {
        $dir = $version->config['dir'] ?? null;
        $clean = basename($name);
        abort_unless($dir && ($version->config['type'] ?? null) === 'card' && preg_match('/^[a-z0-9_-]+\.png$/i', $clean), 404);
        $path = $dir.'/'.$clean;
        abort_unless(Storage::disk('local')->exists($path), 404);

        return Storage::disk('local')->response($path, null, ['Content-Type' => 'image/png', 'Cache-Control' => 'private, max-age=86400'], 'inline');
    }

    // ---------------------------------------------------------------------------------------------

    /**
     * Reads karakter/<slug>/character.json and resolves every file it names.
     *
     * @return array{meta: array, files: array{body: array<string,string>, head: array<string,string>, mouth: array<string,string>, blink: ?string}}|string
     *                                                                                                                                              the spec, or why the folder can't be used
     */
    private function readSpec(string $slug): array|string
    {
        if (! preg_match('/^[a-z0-9][a-z0-9_-]*$/i', $slug)) {
            return 'Nama folder karakter tidak valid.';
        }
        $dir = $this->karakterDir().DIRECTORY_SEPARATOR.$slug;
        $json = $dir.DIRECTORY_SEPARATOR.'character.json';
        if (! is_file($json)) {
            return "Folder karakter/$slug tidak punya character.json.";
        }
        $meta = json_decode((string) file_get_contents($json), true);
        if (! is_array($meta) || empty($meta['body']['poses']) || empty($meta['head']['expressions'])) {
            return "character.json di karakter/$slug tidak lengkap (perlu body.poses dan head.expressions).";
        }
        $resolve = function (?string $pattern, string $token, array $ids) use ($dir, $slug): array|string {
            $out = [];
            foreach ($ids as $id) {
                $f = str_replace($token, (string) $id, (string) $pattern);
                if (! preg_match('/^[a-z0-9_-]+\.png$/i', $f) || ! is_file($dir.DIRECTORY_SEPARATOR.$f)) {
                    return "File $f tidak ada di karakter/$slug.";
                }
                $out[(string) $id] = $f;
            }

            return $out;
        };
        $body = $resolve($meta['body']['file'] ?? null, '<pose>', $meta['body']['poses']);
        if (is_string($body)) {
            return $body;
        }
        $head = $resolve($meta['head']['file'] ?? null, '<ekspresi>', $meta['head']['expressions']);
        if (is_string($head)) {
            return $head;
        }
        $mouth = [];
        if (! empty($meta['mouth']['shapes'])) {
            $mouth = $resolve($meta['mouth']['file'] ?? null, '<bentuk>', $meta['mouth']['shapes']);
            if (is_string($mouth)) {
                return $mouth;
            }
        }
        $blink = $meta['blink']['file'] ?? null;
        if ($blink && (! preg_match('/^[a-z0-9_-]+\.png$/i', $blink) || ! is_file($dir.DIRECTORY_SEPARATOR.$blink))) {
            $blink = null;
        }

        // Optional static sitting-pose references are versioned with the card assets.
        // They are previews only; they do not enter the active body-pose rig.
        $sittingReferences = [];
        $catalogPath = $dir.DIRECTORY_SEPARATOR.'poses'.DIRECTORY_SEPARATOR.'sitting'.DIRECTORY_SEPARATOR.'pose_catalog.json';
        $manifestPath = $dir.DIRECTORY_SEPARATOR.'poses'.DIRECTORY_SEPARATOR.'sitting'.DIRECTORY_SEPARATOR.'pose_manifest.json';
        if (is_file($catalogPath) && is_file($manifestPath)) {
            $catalog = json_decode((string) file_get_contents($catalogPath), true);
            $manifest = json_decode((string) file_get_contents($manifestPath), true);
            if (is_array($catalog) && is_array($catalog['pose_families'] ?? null) && is_array($manifest) && is_array($manifest['poses'] ?? null)) {
                $families = [];
                foreach ($catalog['pose_families'] as $family) {
                    if (! is_array($family) || ! preg_match('/^[a-z0-9_-]+$/', (string) ($family['id'] ?? ''))
                        || ! is_string($family['label'] ?? null) || ! is_string($family['default_reference'] ?? null)
                        || ! is_array($family['alternatives'] ?? null)) {
                        continue;
                    }
                    $families[] = ['id' => $family['id'], 'label' => $family['label'], 'default_reference' => $family['default_reference'],
                        'alternatives' => array_values(array_filter($family['alternatives'], fn ($id) => is_string($id) && preg_match('/^[a-z0-9_-]+$/', $id))),
                        'requires_prop' => is_string($family['requires_prop'] ?? null) ? $family['requires_prop'] : null];
                }
                foreach ($manifest['poses'] as $pose) {
                    $id = $pose['id'] ?? null;
                    $relative = $pose['file'] ?? null;
                    if (! is_string($id) || ! preg_match('/^[a-z0-9_-]+$/', $id) || ! is_string($relative)
                        || ! preg_match('#^references/[a-z0-9_-]+\.png$#i', $relative)) {
                        continue;
                    }
                    $sourceFile = $dir.DIRECTORY_SEPARATOR.'poses'.DIRECTORY_SEPARATOR.'sitting'.DIRECTORY_SEPARATOR.str_replace('/', DIRECTORY_SEPARATOR, $relative);
                    if (is_file($sourceFile)) {
                        $sittingReferences[$id] = ['source' => $sourceFile, 'stored' => 'sitting_'.$id.'.png'];
                    }
                }
                $availableIds = array_keys($sittingReferences);
                $meta['pose_families'] = array_values(array_filter($families, function ($family) use ($availableIds) {
                    return in_array($family['default_reference'], $availableIds, true)
                        && count(array_diff($family['alternatives'], $availableIds)) === 0;
                }));
                $referenceIds = [];
                foreach ($meta['pose_families'] as $family) {
                    $referenceIds[] = $family['default_reference'];
                    array_push($referenceIds, ...$family['alternatives']);
                }
                $sittingReferences = array_intersect_key($sittingReferences, array_flip(array_unique($referenceIds)));
            }
        }

        return ['meta' => $meta, 'files' => ['body' => $body, 'head' => $head, 'mouth' => $mouth, 'blink' => $blink],
            'sitting_references' => $sittingReferences];
    }

    private function addVersion(Character $c, string $slug, array $spec, string $note): CharacterVersion
    {
        $src = $this->karakterDir().DIRECTORY_SEPARATOR.$slug;
        $dir = self::DIR.'/'.Str::uuid();
        $disk = Storage::disk('local');
        $names = [...array_values($spec['files']['body']), ...array_values($spec['files']['head']), ...array_values($spec['files']['mouth']), ...($spec['files']['blink'] ? [$spec['files']['blink']] : [])];
        foreach (array_unique($names) as $f) {
            $disk->put($dir.'/'.$f, (string) file_get_contents($src.DIRECTORY_SEPARATOR.$f));
        }
        $sittingFiles = [];
        foreach (($spec['sitting_references'] ?? []) as $id => $reference) {
            $disk->put($dir.'/'.$reference['stored'], (string) file_get_contents($reference['source']));
            $sittingFiles[$id] = $reference['stored'];
        }
        $thumb = $this->thumbnail($disk->path($dir), $spec);
        if ($thumb) {
            $disk->put($dir.'/_thumb.png', $thumb);
        }
        $n = (int) $c->versions()->max('number') + 1;
        $config = ['type' => 'card', 'schema_version' => 1, 'source' => $slug, 'dir' => $dir, 'meta' => $spec['meta'], 'files' => $spec['files'],
            'sitting_references' => $sittingFiles];
        $v = CharacterVersion::create(['character_id' => $c->id, 'number' => $n, 'config' => $config, 'thumbnail_path' => $thumb ? $dir.'/_thumb.png' : null, 'note' => $note]);
        $c->update(['current_version' => $n]);

        return $v;
    }

    /**
     * Builds Google Flow-ready composite sprite sheets: one complete character per cell,
     * covering every body pose × head expression combination. Original modular PNGs remain
     * in the ZIP as the editable source and for exact re-import.
     *
     * @return array<int, array{image:string,manifest:string,png:string,json:array,frames:array}>
     */
    private function buildCharacterSpriteSheets(string $dir, array $meta, array $files): array
    {
        if (! function_exists('imagecreatefromstring') || ! function_exists('imagecreatetruecolor')) {
            abort(501, 'Ekstensi PHP GD diperlukan untuk membuat sprite sheet karakter.');
        }

        $disk = Storage::disk('local');
        $bodyPoses = $files['body'] ?? [];
        $expressions = $files['head'] ?? [];
        $combinations = [];
        foreach ($bodyPoses as $pose => $bodyName) {
            foreach ($expressions as $expression => $headName) {
                $combinations[] = ['kind' => 'character', 'pose' => (string) $pose, 'expression' => (string) $expression, 'body' => $bodyName, 'head' => $headName];
            }
        }
        foreach (($files['mouth'] ?? []) as $shape => $mouthName) {
            $combinations[] = ['kind' => 'mouth', 'shape' => (string) $shape, 'overlay' => $mouthName];
        }
        if (! empty($files['blink'])) {
            $combinations[] = ['kind' => 'blink', 'overlay' => $files['blink']];
        }
        abort_if($combinations === [], 422, 'Karakter tidak memiliki aset untuk diekspor.');

        $pages = [];
        foreach (array_chunk($combinations, 16) as $pageIndex => $items) {
            $atlas = imagecreatetruecolor(4096, 4096);
            imagealphablending($atlas, false);
            imagesavealpha($atlas, true);
            imagefill($atlas, 0, 0, imagecolorallocatealpha($atlas, 0, 0, 0, 127));
            $frames = [];
            $characterFrames = [];
            $overlayFrames = [];
            $sourceMap = [];
            foreach ($items as $i => $item) {
                $cell = imagecreatetruecolor(1024, 1024);
                imagealphablending($cell, false);
                imagesavealpha($cell, true);
                imagefill($cell, 0, 0, imagecolorallocatealpha($cell, 0, 0, 0, 127));
                imagealphablending($cell, true);

                if (($item['kind'] ?? 'character') !== 'character') {
                    $overlay = @imagecreatefromstring($disk->get($dir.'/'.$item['overlay']));
                    abort_unless($overlay, 422, 'PNG overlay mulut/kedip tidak dapat dibaca untuk sprite sheet.');
                    $ow = imagesx($overlay); $oh = imagesy($overlay);
                    $scale = min(512 / max(1, $ow), 512 / max(1, $oh));
                    $dw = max(1, (int) round($ow * $scale));
                    $dh = max(1, (int) round($oh * $scale));
                    imagecopyresampled($cell, $overlay, (int) floor((1024 - $dw) / 2), (int) floor((1024 - $dh) / 2), 0, 0, $dw, $dh, $ow, $oh);
                    imagedestroy($overlay);
                } else {
                    $body = @imagecreatefromstring($disk->get($dir.'/'.$item['body']));
                    $head = @imagecreatefromstring($disk->get($dir.'/'.$item['head']));
                    abort_unless($body && $head, 422, 'PNG body/head tidak dapat dibaca untuk sprite sheet.');
                    $bw = imagesx($body); $bh = imagesy($body);
                    $hw = imagesx($head); $hh = imagesy($head);
                    $scale = min(512 / max(1, $bw), 1024 / max(1, $bh));
                    $dw = max(1, (int) round($bw * $scale));
                    $dh = max(1, (int) round($bh * $scale));
                    $dx = (int) floor((1024 - $dw) / 2);
                    $dy = 1024 - $dh;
                    imagecopyresampled($cell, $body, $dx, $dy, 0, 0, $dw, $dh, $bw, $bh);

                    [$headX, $headY] = $meta['head']['paste_on_body'] ?? [0, 0];
                    $headX += (int) ($meta['body']['head_dx'][$item['pose']] ?? 0);
                    $hx = $dx + (int) round($headX * $scale);
                    $hy = $dy + (int) round($headY * $scale);
                    imagecopyresampled($cell, $head, $hx, $hy, 0, 0,
                        max(1, (int) round($hw * $scale)), max(1, (int) round($hh * $scale)), $hw, $hh);
                    imagedestroy($body); imagedestroy($head);
                }

                $col = $i % 4; $row = intdiv($i, 4);
                imagecopy($atlas, $cell, $col * 1024, $row * 1024, 0, 0, 1024, 1024);
                if (($item['kind'] ?? 'character') === 'character') {
                    $id = Str::slug($item['pose'].'-'.$item['expression'], '_');
                    $sourceMap[$id] = ['type' => 'character', 'pose' => $item['pose'], 'expression' => $item['expression']];
                } elseif ($item['kind'] === 'mouth') {
                    $id = Str::slug('mouth-'.$item['shape'], '_');
                    $sourceMap[$id] = ['type' => 'mouth', 'shape' => $item['shape']];
                } else {
                    $id = 'blink_overlay';
                    $sourceMap[$id] = ['type' => 'blink'];
                }
                $frame = ['id' => $id, 'x' => $col * 1024, 'y' => $row * 1024, 'width' => 1024, 'height' => 1024];
                $frames[] = $frame;
                if (($item['kind'] ?? 'character') === 'character') $characterFrames[] = $frame;
                else $overlayFrames[] = $frame;
                imagedestroy($cell);
            }
            ob_start();
            imagepng($atlas, null, 6);
            $png = (string) ob_get_clean();
            imagedestroy($atlas);

            $number = $pageIndex + 1;
            $imageName = sprintf('sprite-sheet-%02d.png', $number);
            $manifestName = sprintf('sprite-sheet-%02d.json', $number);
            $json = [
                'format' => 'animasi2d.character-sprite-atlas', 'format_version' => 1,
                'character' => ['name' => $meta['name'] ?? 'Character'],
                'frame' => ['width' => 1024, 'height' => 1024, 'pivot' => ['x' => 512, 'y' => 1024]],
                'atlas' => ['width' => 4096, 'height' => 4096, 'columns' => 4, 'rows' => 4],
                'facing' => 'front',
                'animations' => array_filter([
                    'character_variants' => $characterFrames ? ['fps' => 1, 'loop' => false, 'frames' => $characterFrames] : null,
                    'facial_overlays' => $overlayFrames ? ['fps' => 1, 'loop' => false, 'frames' => $overlayFrames] : null,
                ]),
                'outfit' => ['id' => 'base', 'name' => 'Pakaian dasar', 'type' => 'base'],
                'source_map' => $sourceMap,
            ];
            $pages[] = ['image' => $imageName, 'manifest' => $manifestName, 'png' => $png, 'json' => $json, 'frames' => $frames];
        }

        return $pages;
    }

    /** Body (first pose) with the neutral head pasted on, the way character.json places it; cropped to the figure. */
    private function thumbnail(string $absDir, array $spec): ?string
    {
        if (! function_exists('imagecreatefrompng')) {
            return null;
        }
        $meta = $spec['meta'];
        $pose = array_key_first($spec['files']['body']);
        $expr = array_key_exists('netral', $spec['files']['head']) ? 'netral' : array_key_first($spec['files']['head']);
        $body = @imagecreatefrompng($absDir.DIRECTORY_SEPARATOR.$spec['files']['body'][$pose]);
        $head = @imagecreatefrompng($absDir.DIRECTORY_SEPARATOR.$spec['files']['head'][$expr]);
        if (! $body || ! $head) {
            return null;
        }
        imagealphablending($body, true);
        imagesavealpha($body, true);
        [$px, $py] = $meta['head']['paste_on_body'] ?? [0, 0];
        $dx = (int) ($meta['body']['head_dx'][$pose] ?? 0);
        imagecopy($body, $head, (int) $px + $dx, (int) $py, 0, 0, imagesx($head), imagesy($head));
        $w = imagesx($body);
        $h = imagesy($body);
        $tw = 300;
        $th = (int) round($h * $tw / $w);
        $out = imagecreatetruecolor($tw, $th);
        imagealphablending($out, false);
        imagesavealpha($out, true);
        imagefill($out, 0, 0, imagecolorallocatealpha($out, 0, 0, 0, 127));
        imagecopyresampled($out, $body, 0, 0, 0, 0, $tw, $th, $w, $h);
        ob_start();
        imagepng($out);

        return (string) ob_get_clean();
    }

    private function fileUrl(CharacterVersion $v, string $name): string
    {
        return URL::temporarySignedRoute('cards.file', \App\Models\Asset::urlExpiry(), ['version' => $v->id, 'name' => $name], absolute: false);
    }

    private function summary(Character $c): array
    {
        $v = $c->versions()->where('number', $c->current_version)->first();

        return ['id' => $c->id, 'kind' => 'card', 'name' => $c->name, 'current_version' => $c->current_version, 'updated_at' => $c->updated_at,
            'source' => $v?->config['source'] ?? null,
            'thumbnail' => $v?->thumbnail_path ? URL::temporarySignedRoute('builder.thumbnail', \App\Models\Asset::urlExpiry(), ['version' => $v->id], absolute: false) : null];
    }

    private function detail(Character $c, ?int $number = null): array
    {
        $versions = $c->versions()->get();
        $v = $versions->firstWhere('number', $number ?? $c->current_version) ?? $versions->first();
        $urls = null;
        if ($v) {
            $f = $v->config['files'];
            $map = fn (array $xs) => array_map(fn ($name) => $this->fileUrl($v, $name), $xs);
            $urls = ['body' => $map($f['body']), 'head' => $map($f['head']), 'mouth' => $map($f['mouth'] ?? []), 'blink' => ! empty($f['blink']) ? $this->fileUrl($v, $f['blink']) : null];
            $sittingReferenceUrls = array_map(fn ($filename) => $this->fileUrl($v, $filename), $v->config['sitting_references'] ?? []);
        }

        return $this->summary($c) + [
            'versions' => $versions->map(fn ($x) => ['number' => $x->number, 'note' => $x->note, 'created_at' => $x->created_at,
                'thumbnail' => $x->thumbnail_path ? URL::temporarySignedRoute('builder.thumbnail', \App\Models\Asset::urlExpiry(), ['version' => $x->id], absolute: false) : null]),
            'viewing' => $v?->number,
            'meta' => $v?->config['meta'],
            'urls' => $urls,
            'sitting_reference_urls' => $sittingReferenceUrls ?? [],
        ];
    }

    private function own(Request $request, Character $c): void
    {
        abort_unless($c->user_id === $request->user()->id && $c->kind === 'card', 404);
    }
}

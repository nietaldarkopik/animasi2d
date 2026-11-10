<?php

namespace App\Http\Controllers;

use App\Models\Character;
use App\Models\CharacterVersion;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\URL;
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

    /** New version from the folder the character was imported from (after the PNGs were redrawn). */
    public function refresh(Request $request, Character $character): JsonResponse
    {
        $this->own($request, $character);
        $cur = $character->versions()->where('number', $character->current_version)->firstOrFail();
        $slug = $cur->config['source'] ?? '';
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

        return ['meta' => $meta, 'files' => ['body' => $body, 'head' => $head, 'mouth' => $mouth, 'blink' => $blink]];
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
        $thumb = $this->thumbnail($disk->path($dir), $spec);
        if ($thumb) {
            $disk->put($dir.'/_thumb.png', $thumb);
        }
        $n = (int) $c->versions()->max('number') + 1;
        $config = ['type' => 'card', 'schema_version' => 1, 'source' => $slug, 'dir' => $dir, 'meta' => $spec['meta'], 'files' => $spec['files']];
        $v = CharacterVersion::create(['character_id' => $c->id, 'number' => $n, 'config' => $config, 'thumbnail_path' => $thumb ? $dir.'/_thumb.png' : null, 'note' => $note]);
        $c->update(['current_version' => $n]);

        return $v;
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
        }

        return $this->summary($c) + [
            'versions' => $versions->map(fn ($x) => ['number' => $x->number, 'note' => $x->note, 'created_at' => $x->created_at,
                'thumbnail' => $x->thumbnail_path ? URL::temporarySignedRoute('builder.thumbnail', \App\Models\Asset::urlExpiry(), ['version' => $x->id], absolute: false) : null]),
            'viewing' => $v?->number,
            'meta' => $v?->config['meta'],
            'urls' => $urls,
        ];
    }

    private function own(Request $request, Character $c): void
    {
        abort_unless($c->user_id === $request->user()->id && $c->kind === 'card', 404);
    }
}

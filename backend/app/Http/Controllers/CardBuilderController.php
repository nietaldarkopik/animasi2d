<?php

namespace App\Http\Controllers;

use App\Models\Character;
use App\Services\CardBuilder\CardBuilderException;
use App\Services\CardBuilder\CardBuilderRunner;
use Illuminate\Contracts\Cache\LockTimeoutException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\URL;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

/**
 * Card Builder for 2.5D card characters (web front of tools/card_builder):
 *  - existing characters: motion packs (prompts for Flow, sheet upload, import), duplicate with recolor;
 *  - new characters from Flow sheets, built in a draft folder (karakter/_draf/<slug>) and moved to karakter/<slug> when finished.
 * The work is done by the Python tool; this controller checks ownership and file names, locks per folder, and hands out signed preview URLs.
 */
class CardBuilderController extends Controller
{
    private const SLUG = '/^[a-z0-9][a-z0-9_-]*$/i';

    public function __construct(private CardBuilderRunner $runner, private CardCharacterController $cards) {}

    // ------------------------------------------------------------------------------------------ plumbing

    /** Folder name of the character an owned card was imported from. */
    private function slugOf(Request $request, Character $c): string
    {
        abort_unless($c->user_id === $request->user()->id && $c->kind === 'card', 404);
        $cur = $c->versions()->where('number', $c->current_version)->first();
        $slug = (string) ($cur?->config['source'] ?? '');
        abort_unless(preg_match(self::SLUG, $slug) === 1, 404);

        return $slug;
    }

    private function fail(string $message, int $status = 422): JsonResponse
    {
        return response()->json(['message' => $message, 'errors' => ['card_builder' => [$message]]], $status);
    }

    /** Runs `$fn` and turns tool refusals into 422 and tool problems into 500, with the message. */
    private function respond(callable $fn, int $status = 200): JsonResponse
    {
        @set_time_limit(300);
        try {
            return response()->json(['data' => $fn()], $status);
        } catch (CardBuilderException $e) {
            return $this->fail($e->getMessage(), $e->user ? 422 : 500);
        } catch (LockTimeoutException) {
            return $this->fail('Karakter ini sedang diproses; coba lagi sebentar lagi.', 423);
        }
    }

    /** One tool call at a time per folder. */
    private function run(string $slug, string $op, array $args = []): array
    {
        return Cache::lock('card-builder:'.$slug, 300)->block(15, fn () => $this->runner->run($op, ['slug' => $slug] + $args));
    }

    private function previewUrl(string $kind, string $slug, string $name): ?string
    {
        $dir = $kind === 'd' ? $this->runner->root().DIRECTORY_SEPARATOR.'_draf'.DIRECTORY_SEPARATOR.$slug : $this->runner->root().DIRECTORY_SEPARATOR.$slug;
        $path = $dir.DIRECTORY_SEPARATOR.(str_starts_with($name, '_cek_') ? '_mentah'.DIRECTORY_SEPARATOR : '').$name;

        return is_file($path)
            ? URL::temporarySignedRoute('card-builder.preview', now()->addHours(2), ['kind' => $kind, 'slug' => $slug, 'name' => $name, 'v' => filemtime($path)], absolute: false)
            : null;
    }

    /** Replaces preview file names by {name, url}; a draft also gets the urls of the images the calibration step draws on. */
    private function withUrls(array $data, string $kind, string $slug): array
    {
        $map = fn (array $names) => array_values(array_filter(array_map(fn ($n) => ['name' => $n, 'url' => $this->previewUrl($kind, $slug, $n)], $names), fn ($x) => $x['url']));
        $assets = fn () => array_filter([
            'head' => $this->previewUrl($kind, $slug, $slug.'_kepala_netral.png'), 'body' => $this->previewUrl($kind, $slug, $slug.'_badan_diam.png'),
            'mouth' => $this->previewUrl($kind, $slug, $slug.'_mulut_a.png'), 'blink' => $this->previewUrl($kind, $slug, $slug.'_kelopak.png'),
        ]);
        if (isset($data['previews'])) {
            $data['previews'] = $map($data['previews']);
        }
        if (isset($data['state']['previews'])) {
            $data['state']['previews'] = $map($data['state']['previews']);
        }
        if ($kind === 'd') {
            $data['assets'] = (object) $assets();
            if (isset($data['state'])) {
                $data['state']['assets'] = (object) $assets();
            }
        }

        return $data;
    }

    /** Saves an uploaded sheet as _mentah/<file named by the manifest>. */
    private function storeSheet(Request $request, string $folder, string $manifestName, string $sheetId): array
    {
        $request->validate(['file' => 'required|file|max:30720']);
        $upload = $request->file('file');
        if (@getimagesize($upload->getRealPath()) === false) {
            return ['error' => 'Berkas ini bukan gambar yang bisa dibaca. Unggah PNG atau JPG hasil Flow.'];
        }
        $manifestFile = $folder.DIRECTORY_SEPARATOR.'_mentah'.DIRECTORY_SEPARATOR.$manifestName;
        if (! is_file($manifestFile)) {
            return ['error' => 'Buat prompt dulu (manifes lembar belum ada).'];
        }
        $manifest = json_decode((string) file_get_contents($manifestFile), true);
        $sheet = collect($manifest['sheets'] ?? [])->firstWhere('id', $sheetId);
        abort_unless($sheet && preg_match('/^[a-z0-9_-]+\.png$/i', (string) ($sheet['file'] ?? '')), 404);
        File::put($folder.DIRECTORY_SEPARATOR.'_mentah'.DIRECTORY_SEPARATOR.$sheet['file'], (string) file_get_contents($upload->getRealPath()));

        return ['file' => $sheet['file'], 'size' => $upload->getSize()];
    }

    private function folder(string $slug): string
    {
        return $this->runner->root().DIRECTORY_SEPARATOR.$slug;
    }

    private function draftFolder(string $slug): string
    {
        return $this->runner->root().DIRECTORY_SEPARATOR.'_draf'.DIRECTORY_SEPARATOR.$slug;
    }

    /** A draft belongs to the user who started it (owner.json). */
    private function ownDraft(Request $request, string $slug): void
    {
        abort_unless(preg_match(self::SLUG, $slug) === 1, 404);
        $owner = json_decode((string) @file_get_contents($this->draftFolder($slug).DIRECTORY_SEPARATOR.'owner.json'), true);
        abort_unless(is_array($owner) && ($owner['user_id'] ?? null) === $request->user()->id, 404);
    }

    // ------------------------------------------------------------------------------------------ existing characters

    public function status(Request $request, Character $character): JsonResponse
    {
        $slug = $this->slugOf($request, $character);

        return $this->respond(fn () => $this->run($slug, 'status'));
    }

    public function setAppearance(Request $request, Character $character): JsonResponse
    {
        $slug = $this->slugOf($request, $character);
        $data = $request->validate(['appearance' => 'required|string|max:1500']);

        return $this->respond(fn () => $this->run($slug, 'set_appearance', ['appearance' => $data['appearance']]));
    }

    public function prompts(Request $request, Character $character): JsonResponse
    {
        $slug = $this->slugOf($request, $character);
        $data = $request->validate(['pack' => 'required|in:dialog,duduk,aksi,jalan', 'required_only' => 'sometimes|boolean']);

        return $this->respond(fn () => $this->run($slug, 'prompts', ['pack' => $data['pack'], 'required_only' => (bool) ($data['required_only'] ?? false)]));
    }

    public function upload(Request $request, Character $character, string $pack, string $sheet): JsonResponse
    {
        $slug = $this->slugOf($request, $character);
        abort_unless(in_array($pack, ['dialog', 'duduk', 'aksi', 'jalan'], true) && preg_match('/^[a-z0-9_]+$/', $sheet) === 1, 404);
        $out = Cache::lock('card-builder:'.$slug, 60)->block(15, fn () => $this->storeSheet($request, $this->folder($slug), "manifest_$pack.json", $sheet));

        return isset($out['error']) ? $this->fail($out['error']) : response()->json(['data' => $out]);
    }

    public function import(Request $request, Character $character): JsonResponse
    {
        $slug = $this->slugOf($request, $character);
        $data = $request->validate([
            'pack' => 'required|in:dialog,duduk,aksi,jalan', 'overwrite' => 'sometimes|boolean', 'equal' => 'sometimes|boolean', 'fit' => 'sometimes|boolean', 'dry_run' => 'sometimes|boolean',
            'scales' => 'sometimes|array|max:12', 'scales.*' => 'numeric|between:0.15,6',
        ]);

        return $this->respond(fn () => $this->withUrls($this->run($slug, 'import', $data), 'c', $slug));
    }

    public function mouthAt(Request $request, Character $character): JsonResponse
    {
        $slug = $this->slugOf($request, $character);
        $data = $request->validate(['view' => 'required|in:34,sisi', 'x' => 'required|integer|between:-200,600', 'y' => 'required|integer|between:-200,700']);

        return $this->respond(fn () => $this->run($slug, 'mouth_at', $data));
    }

    /** Where the head sits on one pack body (sitting, 3/4, side, running) and how far it is tilted around the neck. */
    public function headAt(Request $request, Character $character): JsonResponse
    {
        $slug = $this->slugOf($request, $character);
        $data = $request->validate([
            'slot' => ['required', 'string', 'max:40', 'regex:/^[a-z0-9_]+$/'],
            'x' => 'required|integer|between:-300,900', 'y' => 'required|integer|between:-300,1500', 'rot' => 'sometimes|numeric|between:-35,35',
        ]);

        return $this->respond(fn () => $this->run($slug, 'head_adjust', $data));
    }

    public function colors(Request $request, Character $character): JsonResponse
    {
        $slug = $this->slugOf($request, $character);

        return $this->respond(fn () => $this->run($slug, 'colors'));
    }

    /** Preview a recolored duplicate (nothing is saved), or save it as karakter/<as> and import it as a new character. */
    public function recolor(Request $request, Character $character): JsonResponse
    {
        $slug = $this->slugOf($request, $character);
        $data = $request->validate([
            'as' => ['required', 'string', 'max:64', 'regex:'.self::SLUG], 'name' => 'nullable|string|max:120', 'preview' => 'sometimes|boolean',
            'maps' => 'required|array|min:1|max:12', 'maps.*' => ['string', 'max:300', 'regex:/^#?[0-9a-fA-F]{3,6}>#?[0-9a-fA-F]{3,6}(;[a-z]+=[A-Za-z0-9_.,#\\/-]+)*$/'],
            'groups' => 'sometimes|array|max:4', 'groups.*' => 'in:body,head,mouth,blink',
        ]);
        if ($data['preview'] ?? false) {
            return $this->respond(fn () => $this->run($slug, 'recolor', $data));
        }

        return $this->respond(function () use ($request, $slug, $data) {
            $res = $this->run($slug, 'recolor', $data);
            $c = $this->cards->importFolder($request->user(), $res['slug'], $data['name'] ?? null);
            if (is_string($c)) {
                throw new CardBuilderException($c);
            }

            return ['character' => $this->cards->present($c), 'validation' => $res['validation']];
        }, 201);
    }

    // ------------------------------------------------------------------------------------------ new characters (drafts)

    public function draftStart(Request $request): JsonResponse
    {
        $data = $request->validate([
            'slug' => ['required', 'string', 'max:64', 'regex:'.self::SLUG], 'name' => 'nullable|string|max:120', 'appearance' => 'required|string|max:1500', 'style' => 'nullable|string|max:200',
        ]);
        $ownerFile = $this->draftFolder($data['slug']).DIRECTORY_SEPARATOR.'owner.json';
        if (is_file($ownerFile)) {
            $owner = json_decode((string) file_get_contents($ownerFile), true);
            if (($owner['user_id'] ?? null) !== $request->user()->id) {
                return $this->fail('Nama ini sedang dipakai draf orang lain; pilih nama lain.', 409);
            }
        }

        return $this->respond(function () use ($request, $data, $ownerFile) {
            $out = $this->run($data['slug'], 'new_start', $data);
            File::put($ownerFile, json_encode(['user_id' => $request->user()->id, 'created' => now()->toIso8601String()]));

            return $this->withUrls($out, 'd', $data['slug']);
        }, 201);
    }

    public function draftShow(Request $request, string $slug): JsonResponse
    {
        $this->ownDraft($request, $slug);

        return $this->respond(fn () => $this->withUrls($this->run($slug, 'new_state'), 'd', $slug));
    }

    public function draftUpload(Request $request, string $slug, string $sheet): JsonResponse
    {
        $this->ownDraft($request, $slug);
        abort_unless(preg_match('/^[a-z0-9_]+$/', $sheet) === 1, 404);
        $out = Cache::lock('card-builder:'.$slug, 60)->block(15, fn () => $this->storeSheet($request, $this->draftFolder($slug), 'manifest_dasar.json', $sheet));

        return isset($out['error']) ? $this->fail($out['error']) : response()->json(['data' => $out]);
    }

    public function draftImport(Request $request, string $slug): JsonResponse
    {
        $this->ownDraft($request, $slug);
        $data = $request->validate([
            'fit' => 'sometimes|boolean', 'equal' => 'sometimes|boolean', 'calib' => 'sometimes|array',
            'calib.chin_y' => 'sometimes|integer|between:0,500', 'calib.mouth' => 'sometimes|array|size:2', 'calib.mouth.*' => 'integer|between:0,500',
            'calib.eyes' => 'sometimes|array|size:2', 'calib.eyes.*' => 'array|size:2', 'calib.eyes.*.*' => 'integer|between:0,500',
            'calib.mouth_scale' => 'sometimes|numeric|between:0.3,3', 'calib.lid_scale' => 'sometimes|numeric|between:0.3,3',
            'calib.head_dx' => 'sometimes|integer|between:-80,80', 'calib.head_dy' => 'sometimes|integer|between:-80,80', 'calib.head_rot' => 'sometimes|numeric|between:-25,25',
        ]);

        return $this->respond(fn () => $this->withUrls($this->run($slug, 'new_import', $data), 'd', $slug));
    }

    /**
     * Copies the finished draft to karakter/<slug> and imports it as a card character. The draft and its raw sheets stay, so a revision
     * (recalibrate, re-run) needs no new upload; `update` then replaces only the base images of the existing character and adds a version.
     */
    public function draftFinish(Request $request, string $slug): JsonResponse
    {
        $this->ownDraft($request, $slug);
        $data = $request->validate(['name' => 'nullable|string|max:120', 'update' => 'sometimes|boolean']);

        if ($data['update'] ?? false) {
            $card = Character::where('user_id', $request->user()->id)->where('kind', 'card')->with('versions')->get()
                ->first(fn ($c) => ($c->versions->firstWhere('number', $c->current_version)?->config['source'] ?? null) === $slug);
            abort_unless($card, 404);
            $res = $this->respond(fn () => $this->run($slug, 'new_finish', ['update' => true]));
            if ($res->getStatusCode() >= 400) {
                return $res;
            }

            return $this->cards->refresh($request, $card);
        }

        return $this->respond(function () use ($request, $slug, $data) {
            $this->run($slug, 'new_finish');
            $c = $this->cards->importFolder($request->user(), $slug, $data['name'] ?? null);
            if (is_string($c)) {
                throw new CardBuilderException($c);
            }

            return $this->cards->present($c);
        }, 201);
    }

    public function draftDiscard(Request $request, string $slug): JsonResponse
    {
        $this->ownDraft($request, $slug);

        return $this->respond(fn () => $this->run($slug, 'new_discard'));
    }

    // ------------------------------------------------------------------------------------------ previews

    /** Signed: an <img> can load a preview without an Authorization header. */
    public function preview(string $kind, string $slug, string $name): BinaryFileResponse
    {
        abort_unless(in_array($kind, ['c', 'd'], true) && preg_match(self::SLUG, $slug) === 1 && preg_match('/^[a-z0-9_-]+\.png$/i', $name) === 1, 404);
        $base = $kind === 'd' ? $this->draftFolder($slug) : $this->folder($slug);
        $path = str_starts_with($name, '_cek_') ? $base.DIRECTORY_SEPARATOR.'_mentah'.DIRECTORY_SEPARATOR.$name : $base.DIRECTORY_SEPARATOR.$name;
        abort_unless($kind === 'd' || str_starts_with($name, '_cek_'), 404);   // finished characters expose only their check images here
        abort_unless(is_file($path), 404);

        return response()->file($path, ['Content-Type' => 'image/png', 'Cache-Control' => 'private, max-age=3600']);
    }
}

<?php

namespace App\Http\Controllers;

use App\Models\AssetCategory;
use App\Models\Character;
use App\Models\CharacterVersion;
use App\Models\LibraryAsset;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\Facades\Validator;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Character Builder characters. Every save creates a NEW immutable version whose config pins each part to a library
 * asset id + content hash, so a film that used version N never changes when the character or the library is edited.
 */
class BuilderCharacterController extends Controller
{
    public const SCHEMA = 1;

    public const PALETTE = ['skin', 'hair', 'top', 'bottom', 'hijab', 'tie', 'eye', 'shoe', 'accent'];

    public function index(Request $request): JsonResponse
    {
        $rows = Character::where('user_id', $request->user()->id)->where('kind', 'builder')->orderByDesc('updated_at')->get();

        return response()->json(['data' => $rows->map(fn ($c) => $this->summary($c))]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate(['name' => 'required|string|max:120']);
        $config = $this->validatedConfig($request);
        if ($config instanceof JsonResponse) {
            return $config;
        }

        $c = DB::transaction(function () use ($request, $data, $config) {
            $c = Character::create(['user_id' => $request->user()->id, 'kind' => 'builder', 'name' => $data['name'], 'method' => 'rig']);
            $this->addVersion($c, $config, $request);

            return $c;
        });

        return response()->json(['data' => $this->detail($c->fresh())], 201);
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

    public function addNewVersion(Request $request, Character $character): JsonResponse
    {
        $this->own($request, $character);
        $config = $this->validatedConfig($request);
        if ($config instanceof JsonResponse) {
            return $config;
        }
        DB::transaction(fn () => $this->addVersion($character, $config, $request));

        return response()->json(['data' => $this->detail($character->fresh())], 201);
    }

    public function duplicate(Request $request, Character $character): JsonResponse
    {
        $this->own($request, $character);
        $src = $character->versions()->where('number', $character->current_version)->firstOrFail();
        $copy = DB::transaction(function () use ($request, $character, $src) {
            $c = Character::create(['user_id' => $character->user_id, 'kind' => 'builder', 'name' => ($request->input('name') ?: $character->name.' (salinan)'), 'method' => 'rig']);
            $v = CharacterVersion::create(['character_id' => $c->id, 'number' => 1, 'config' => $src->config, 'note' => 'Salinan dari "'.$character->name.'" v'.$src->number]);
            if ($src->thumbnail_path && Storage::disk('local')->exists($src->thumbnail_path)) {
                $path = 'characters/'.$c->id.'/v1.png';
                Storage::disk('local')->copy($src->thumbnail_path, $path);
                $v->update(['thumbnail_path' => $path]);
            }
            DB::table('character_version_assets')->insert(array_map(fn ($id) => ['character_version_id' => $v->id, 'library_asset_id' => $id], $this->assetIds($src->config)));
            $c->update(['current_version' => 1]);

            return $c;
        });

        return response()->json(['data' => $this->detail($copy->fresh())], 201);
    }

    public function destroy(Request $request, Character $character): JsonResponse
    {
        $this->own($request, $character);
        foreach ($character->versions as $v) {
            $v->thumbnail_path && Storage::disk('local')->delete($v->thumbnail_path);
        }
        $character->delete(); // versions + pivot rows cascade

        return response()->json(['ok' => true]);
    }

    public function thumbnail(CharacterVersion $version): StreamedResponse
    {
        abort_unless($version->thumbnail_path && Storage::disk('local')->exists($version->thumbnail_path), 404);

        return Storage::disk('local')->response($version->thumbnail_path, null, ['Content-Type' => 'image/png', 'Cache-Control' => 'private, max-age=3600'], 'inline');
    }

    // ---------------------------------------------------------------------------------------------

    /** @return array|JsonResponse normalised config (hashes filled from the server's copy of each asset) */
    private function validatedConfig(Request $request): array|JsonResponse
    {
        $raw = $request->input('config');
        $cfg = is_string($raw) ? json_decode($raw, true) : $raw;
        if (! is_array($cfg)) {
            return response()->json(['message' => 'Konfigurasi karakter tidak valid.', 'errors' => ['config' => ['Konfigurasi harus JSON.']]], 422);
        }
        $request->validate(['thumbnail' => 'nullable|file|mimetypes:image/png|max:2048', 'note' => 'nullable|string|max:200']);

        $slots = AssetCategory::where('kind', 'part')->pluck('slug')->all();
        $v = Validator::make($cfg, [
            'schema_version' => 'required|in:'.self::SCHEMA,
            'view' => 'required|in:half,full',
            'palette' => 'required|array',
            ...collect(self::PALETTE)->mapWithKeys(fn ($k) => ["palette.$k" => ['required', 'regex:/^#[0-9a-fA-F]{6}$/']])->all(),
            'parts' => 'present|array|max:20',
            'parts.*.assetId' => 'required|integer',
            'parts.*.dx' => 'nullable|numeric|between:-400,400',
            'parts.*.dy' => 'nullable|numeric|between:-800,800',
            'parts.*.scale' => 'nullable|numeric|between:0.2,4',
            'parts.*.tint' => ['nullable', 'regex:/^#[0-9a-fA-F]{6}$/'],   // recolouring of raster parts
            'parts.*.tintAmount' => 'nullable|numeric|between:0,1',
            'parts.*.brightness' => 'nullable|numeric|between:0.4,2.5',
            'parts.*.rot' => 'nullable|numeric|between:-720,720',   // rotation in degrees
            'parts.*.z' => 'nullable|numeric|between:-5,30',        // stacking override
            'parts.*.split' => 'nullable|numeric|between:150,600',  // y of the split line (part behind the clothes below it)
            'expressions' => 'nullable|array|max:12',
            'expressions.*.id' => 'required|string|max:40|regex:/^[a-z0-9_-]+$/',
            'expressions.*.name' => 'required|string|max:30',
            'expressions.*.parts' => 'required|array|max:3',
            'expressions.*.parts.*.assetId' => 'required|integer',
            'expressions.*.parts.*.dx' => 'nullable|numeric|between:-400,400',
            'expressions.*.parts.*.dy' => 'nullable|numeric|between:-800,800',
            'expressions.*.parts.*.scale' => 'nullable|numeric|between:0.2,4',
            'expressions.*.parts.*.rot' => 'nullable|numeric|between:-720,720',
            'expressions.*.parts.*.tint' => ['nullable', 'regex:/^#[0-9a-fA-F]{6}$/'],
            'expressions.*.parts.*.tintAmount' => 'nullable|numeric|between:0,1',
            'expressions.*.parts.*.brightness' => 'nullable|numeric|between:0.4,2.5',
        ]);
        if ($v->fails()) {
            return response()->json(['message' => $v->errors()->first(), 'errors' => $v->errors()], 422);
        }

        $out = ['schema_version' => self::SCHEMA, 'view' => $cfg['view'], 'palette' => array_intersect_key($cfg['palette'], array_flip(self::PALETTE)), 'parts' => []];
        foreach ($cfg['parts'] as $slot => $part) {
            if (! in_array($slot, $slots, true)) {
                return response()->json(['message' => "Slot tidak dikenal: $slot", 'errors' => ['parts' => ["Slot tidak dikenal: $slot"]]], 422);
            }
            $asset = LibraryAsset::visibleTo($request->user()->id)->with('category')->find($part['assetId']);
            if (! $asset || $asset->status !== 'approved' || $asset->category->slug !== $slot) {
                return response()->json(['message' => "Aset untuk slot \"$slot\" tidak ditemukan, belum disetujui, atau salah kategori.", 'errors' => ['parts' => ["Aset slot $slot tidak valid."]]], 422);
            }
            $out['parts'][$slot] = $this->normPart($part, $asset);
        }

        // saved expressions: named sets of eyes / brows / mouth variants (the rig made from this version can swap between them)
        $out['expressions'] = [];
        $seen = [];
        foreach ($cfg['expressions'] ?? [] as $expr) {
            if (isset($seen[$expr['id']])) {
                return response()->json(['message' => 'Id ekspresi ganda: '.$expr['id'], 'errors' => ['expressions' => ['Id ekspresi ganda.']]], 422);
            }
            $seen[$expr['id']] = true;
            $parts = [];
            foreach ($expr['parts'] as $slot => $part) {
                if (! in_array($slot, ['eyes', 'brows', 'mouth'], true)) {
                    return response()->json(['message' => "Ekspresi hanya boleh mengubah mata, alis, atau mulut ($slot).", 'errors' => ['expressions' => ["Slot ekspresi tidak valid: $slot"]]], 422);
                }
                $asset = LibraryAsset::visibleTo($request->user()->id)->with('category')->find($part['assetId']);
                if (! $asset || $asset->status !== 'approved' || $asset->category->slug !== $slot) {
                    return response()->json(['message' => "Aset ekspresi untuk \"$slot\" tidak valid.", 'errors' => ['expressions' => ["Aset ekspresi $slot tidak valid."]]], 422);
                }
                $parts[$slot] = $this->normPart($part, $asset);
            }
            $out['expressions'][] = ['id' => $expr['id'], 'name' => $expr['name'], 'parts' => $parts];
        }
        if ($out['expressions'] === []) {
            unset($out['expressions']);
        }

        return $out;
    }

    private function normPart(array $part, LibraryAsset $asset): array
    {
        return ['assetId' => $asset->id, 'hash' => $asset->hash, 'dx' => (float) ($part['dx'] ?? 0), 'dy' => (float) ($part['dy'] ?? 0), 'scale' => (float) ($part['scale'] ?? 1)]
            + (isset($part['z']) ? ['z' => round((float) $part['z'], 3)] : [])
            + (isset($part['rot']) && abs((float) $part['rot']) > 0.01 ? ['rot' => round((float) $part['rot'], 2)] : [])
            + (isset($part['split']) ? ['split' => round((float) $part['split'], 1)] : [])
            + (isset($part['tint']) ? ['tint' => strtolower($part['tint']), 'tintAmount' => round((float) ($part['tintAmount'] ?? 1), 3)] : [])
            + (isset($part['brightness']) && abs((float) $part['brightness'] - 1) > 0.005 ? ['brightness' => round((float) $part['brightness'], 3)] : []);
    }

    private function addVersion(Character $c, array $config, Request $request): CharacterVersion
    {
        $n = (int) $c->versions()->max('number') + 1;
        $thumb = null;
        if ($request->hasFile('thumbnail')) {
            $thumb = $request->file('thumbnail')->storeAs('characters/'.$c->id, 'v'.$n.'.png', 'local');
        }
        $v = CharacterVersion::create(['character_id' => $c->id, 'number' => $n, 'config' => $config, 'thumbnail_path' => $thumb, 'note' => $request->input('note')]);
        DB::table('character_version_assets')->insert(array_map(fn ($id) => ['character_version_id' => $v->id, 'library_asset_id' => $id], $this->assetIds($config)));
        $c->update(['current_version' => $n]);

        return $v;
    }

    private function assetIds(array $config): array
    {
        $ids = array_column($config['parts'], 'assetId');
        foreach ($config['expressions'] ?? [] as $expr) {
            array_push($ids, ...array_column($expr['parts'], 'assetId'));
        }

        return array_values(array_unique($ids));
    }

    private function summary(Character $c): array
    {
        $v = $c->versions()->where('number', $c->current_version)->first();

        return ['id' => $c->id, 'name' => $c->name, 'current_version' => $c->current_version, 'updated_at' => $c->updated_at,
            'thumbnail' => $v?->thumbnail_path ? URL::temporarySignedRoute('builder.thumbnail', now()->addHours(12), ['version' => $v->id], absolute: false) : null];
    }

    private function detail(Character $c, ?int $number = null): array
    {
        $versions = $c->versions()->get();
        $v = $versions->firstWhere('number', $number ?? $c->current_version) ?? $versions->first();
        $ids = $v ? $this->assetIds($v->config) : [];

        return $this->summary($c) + [
            'versions' => $versions->map(fn ($x) => ['number' => $x->number, 'note' => $x->note, 'created_at' => $x->created_at,
                'thumbnail' => $x->thumbnail_path ? URL::temporarySignedRoute('builder.thumbnail', now()->addHours(12), ['version' => $x->id], absolute: false) : null]),
            'config' => $v?->config,
            'viewing' => $v?->number,
            // archived assets are included on purpose: old versions must keep rendering
            'assets' => LibraryAsset::with('category')->whereIn('id', $ids)->get()->mapWithKeys(fn ($a) => [$a->id => $a->present()]),
        ];
    }

    private function own(Request $request, Character $c): void
    {
        abort_unless($c->user_id === $request->user()->id && $c->kind === 'builder', 404);
    }
}

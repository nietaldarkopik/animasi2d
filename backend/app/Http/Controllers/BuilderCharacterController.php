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
    /** joints of a character's skeleton (frontend builder/charRig.ts JOINTS) */
    private const JOINTS = ['neck', 'shoulder_l', 'elbow_l', 'wrist_l', 'shoulder_r', 'elbow_r', 'wrist_r', 'hip', 'hip_l', 'knee_l', 'ankle_l', 'hip_r', 'knee_r', 'ankle_r'];

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
        $config = $this->validatedConfig($request, $character);
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
    /**
     * An asset a part may use: anything visible in the library, plus assets that were archived (replaced by a newer copy) but are still
     * used by an earlier version of THIS character, so a character can keep being edited after the library moved on.
     */
    private function usableAsset(Request $request, ?Character $character, mixed $id): ?LibraryAsset
    {
        $asset = LibraryAsset::visibleTo($request->user()->id)->with('category')->find($id);
        if (! $asset && $character && is_numeric($id)) {
            $old = LibraryAsset::with('category')->whereNotNull('archived_at')->find($id);
            if ($old && ($old->user_id === null || $old->user_id === $request->user()->id)
                && DB::table('character_version_assets')->join('character_versions', 'character_versions.id', '=', 'character_version_assets.character_version_id')
                    ->where('character_versions.character_id', $character->id)->where('character_version_assets.library_asset_id', $old->id)->exists()) {
                return $old;
            }
        }

        return $asset;
    }

    private function validatedConfig(Request $request, ?Character $character = null): array|JsonResponse
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
            'facing' => 'nullable|in:front,right,left,back',
            'template' => ['nullable', 'regex:/^[a-z0-9_-]+$/'], // design template (character family / art-style preset); default anime-v1
            'headFit' => 'nullable|array',                          // head fitted to a body kit: scale + neck point -> kit joint
            'headFit.s' => 'required_with:headFit|numeric|between:0.3,1.5',
            'headFit.nx' => 'required_with:headFit|numeric|between:-400,800',
            'headFit.ny' => 'required_with:headFit|numeric|between:-400,1200',
            'headFit.jx' => 'required_with:headFit|numeric|between:-400,800',
            'headFit.jy' => 'required_with:headFit|numeric|between:-400,1200',
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
            'parts.*.zv' => 'nullable|array',
            'parts.*.zv.*' => 'nullable|numeric|between:-5,30',  // stacking override per direction (front/right/left/back)
            'parts.*.split' => 'nullable|numeric|between:150,600',  // y of the split line (part behind the clothes below it)
            'expressions' => 'nullable|array|max:12',
            'expressions.*.id' => 'required|string|max:40|regex:/^[a-z0-9_-]+$/',
            'expressions.*.name' => 'required|string|max:30',
            'expressions.*.parts' => 'required|array|max:3',
            'rig' => 'nullable|array',                              // the character's own skeleton per facing: joints placed in the Builder
            'rig.*' => 'array',
            'rig.*.joints' => 'required|array',
            ...collect(self::JOINTS)->flatMap(fn ($j) => ["rig.*.joints.$j" => 'required|array', "rig.*.joints.$j.x" => 'required|numeric|between:-400,800', "rig.*.joints.$j.y" => 'required|numeric|between:-400,1200'])->all(),
            'rig.*.armWidth' => 'nullable|numeric|between:4,120',
            'rig.*.skirt' => 'nullable|boolean',
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

        $template = $cfg['template'] ?? \App\Services\Library\DesignTemplate::DEFAULT;
        if (! \App\Services\Library\DesignTemplate::exists($template)) {
            return response()->json(['message' => "Template desain tidak dikenal: $template", 'errors' => ['template' => ["Template desain tidak dikenal: $template"]]], 422);
        }
        $out = ['schema_version' => self::SCHEMA, ...($template !== \App\Services\Library\DesignTemplate::DEFAULT ? ['template' => $template] : []), 'view' => $cfg['view'], ...(isset($cfg['facing']) && $cfg['facing'] !== 'front' ? ['facing' => $cfg['facing']] : []), ...(isset($cfg['headFit']) ? ['headFit' => array_map('floatval', array_intersect_key($cfg['headFit'], array_flip(['s', 'nx', 'ny', 'jx', 'jy'])))] : []), 'palette' => array_intersect_key($cfg['palette'], array_flip(self::PALETTE)), 'parts' => []];
        foreach ($cfg['parts'] as $slot => $part) {
            if (! in_array($slot, [...$slots, 'shoes_r'], true)) { // shoes_r: the right foot of a mirrored single shoe (category shoes)
                return response()->json(['message' => "Slot tidak dikenal: $slot", 'errors' => ['parts' => ["Slot tidak dikenal: $slot"]]], 422);
            }
            $asset = $this->usableAsset($request, $character, $part['assetId']);
            if (! $asset || $asset->status !== 'approved' || $asset->category->slug !== ($slot === 'shoes_r' ? 'shoes' : $slot)) {
                return response()->json(['message' => "Aset untuk slot \"$slot\" tidak ditemukan, belum disetujui, atau salah kategori.", 'errors' => ['parts' => ["Aset slot $slot tidak valid."]]], 422);
            }
            $assetTemplate = $asset->meta['template'] ?? \App\Services\Library\DesignTemplate::DEFAULT;
            if ($assetTemplate !== $template) { // not interchangeable: say why and what would fit
                $alts = LibraryAsset::visibleTo($request->user()->id)->where('status', 'approved')->whereHas('category', fn ($c) => $c->where('slug', $asset->category->slug))
                    ->get()->filter(fn ($a) => ($a->meta['template'] ?? \App\Services\Library\DesignTemplate::DEFAULT) === $template)->take(5)->map(fn ($a) => ['id' => $a->id, 'name' => $a->name])->values()->all();
                $msg = "Bagian \"{$asset->name}\" dibuat untuk template \"$assetTemplate\", sedangkan karakter ini memakai \"$template\": ukuran dan titik pasangnya berbeda.";

                return response()->json(['message' => $msg, 'errors' => ['parts' => [$msg]], 'alternatives' => $alts], 422);
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
                $asset = $this->usableAsset($request, $character, $part['assetId']);
                if (! $asset || $asset->status !== 'approved' || $asset->category->slug !== $slot) {
                    return response()->json(['message' => "Aset ekspresi untuk \"$slot\" tidak valid.", 'errors' => ['expressions' => ["Aset ekspresi $slot tidak valid."]]], 422);
                }
                $parts[$slot] = $this->normPart($part, $asset);
            }
            $out['expressions'][] = ['id' => $expr['id'], 'name' => $expr['name'], 'parts' => $parts];
        }
        foreach ($cfg['rig'] ?? [] as $facing => $rig) {
            if (! in_array($facing, ['front', 'right', 'left', 'back'], true)) {
                return response()->json(['message' => "Arah bone tidak dikenal: $facing", 'errors' => ['rig' => ["Arah bone tidak dikenal: $facing"]]], 422);
            }
            $out['rig'][$facing] = ['joints' => collect(self::JOINTS)->mapWithKeys(fn ($j) => [$j => ['x' => round((float) $rig['joints'][$j]['x'], 1), 'y' => round((float) $rig['joints'][$j]['y'], 1)]])->all()]
                + (isset($rig['armWidth']) ? ['armWidth' => round((float) $rig['armWidth'], 1)] : [])
                + (isset($rig['skirt']) ? ['skirt' => (bool) $rig['skirt']] : []);
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
            + (! empty($part['zv']) && is_array($part['zv']) ? ['zv' => collect($part['zv'])->only(['front', 'right', 'left', 'back'])->map(fn ($z) => round((float) $z, 3))->all()] : [])
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
            'thumbnail' => $v?->thumbnail_path ? URL::temporarySignedRoute('builder.thumbnail', \App\Models\Asset::urlExpiry(), ['version' => $v->id], absolute: false) : null];
    }

    private function detail(Character $c, ?int $number = null): array
    {
        $versions = $c->versions()->get();
        $v = $versions->firstWhere('number', $number ?? $c->current_version) ?? $versions->first();
        $ids = $v ? $this->assetIds($v->config) : [];

        return $this->summary($c) + [
            'versions' => $versions->map(fn ($x) => ['number' => $x->number, 'note' => $x->note, 'created_at' => $x->created_at,
                'thumbnail' => $x->thumbnail_path ? URL::temporarySignedRoute('builder.thumbnail', \App\Models\Asset::urlExpiry(), ['version' => $x->id], absolute: false) : null]),
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

<?php

namespace App\Http\Controllers;

use App\Models\Asset;
use App\Models\Character;
use App\Models\CharacterPart;
use App\Models\Project;
use App\Support\DocumentMigrator;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/** Reusable character library: a set of layers (parts + bones) saved from a scene, insertable into any of the user's projects. */
class CharacterController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $rows = Character::where('user_id', $request->user()->id)->where('kind', 'rig')->withCount('parts')->orderByDesc('id')->get();

        return response()->json(['data' => $rows->map(fn ($c) => [
            'id' => $c->id, 'name' => $c->name, 'method' => $c->method, 'parts' => $c->parts_count, 'project_id' => $c->project_id, 'created_at' => $c->created_at,
        ])]);
    }

    /** Save the selected layers of a scene as a character. The selection must be closed under parent links. */
    public function store(Request $request, Project $project): JsonResponse
    {
        abort_unless($project->user_id === $request->user()->id, 404);
        $data = $request->validate([
            'name' => 'required|string|max:120',
            'method' => 'required|in:'.implode(',', Character::METHODS),
            'scene_id' => 'required|string|max:64',
            'layer_ids' => 'required|array|min:1|max:200',
            'layer_ids.*' => 'required|string|max:64',
        ]);

        $doc = DocumentMigrator::toV2($project->document);
        $scene = collect($doc['scenes'])->firstWhere('id', $data['scene_id']);
        if (! $scene) {
            return response()->json(['message' => 'Scene tidak ditemukan.'], 422);
        }
        $picked = collect($scene['layers'])->filter(fn ($l) => in_array($l['id'], $data['layer_ids'], true))->values();
        if ($picked->count() !== count(array_unique($data['layer_ids']))) {
            return response()->json(['message' => 'Sebagian layer tidak ditemukan di scene ini.'], 422);
        }
        $keys = $picked->pluck('id')->all();
        foreach ($picked as $l) {
            if (! empty($l['parentId']) && ! in_array($l['parentId'], $keys, true)) {
                return response()->json(['message' => 'Layer "'.$l['name'].'" bergantung pada parent yang tidak ikut dipilih. Pilih juga parent-nya.'], 422);
            }
        }
        $assetIds = $picked->pluck('assetId')->filter()->unique()->all();
        if (Asset::where('project_id', $project->id)->whereIn('id', $assetIds)->count() !== count($assetIds)) {
            return response()->json(['message' => 'Ada layer yang merujuk aset yang sudah tidak ada.'], 422);
        }

        $character = DB::transaction(function () use ($data, $project, $request, $picked) {
            $c = Character::create(['user_id' => $request->user()->id, 'project_id' => $project->id, 'name' => $data['name'], 'method' => $data['method'],
                'source_asset_id' => $picked->pluck('assetId')->filter()->first()]);
            foreach ($picked as $z => $l) {
                CharacterPart::create(['character_id' => $c->id, 'asset_id' => $l['assetId'] ?? null, 'part_key' => $l['id'], 'name' => $l['name'],
                    'type' => $l['type'], 'parent_key' => $l['parentId'] ?? null, 'z_order' => $z, 'layer' => $l]);
            }

            return $c;
        });

        return response()->json(['data' => ['id' => $character->id, 'name' => $character->name, 'parts' => $picked->count()]], 201);
    }

    /**
     * Returns fresh layers for the target project. Asset files are copied into that project (projects own their assets),
     * layer ids are regenerated and parent/IK references remapped. The client adds them to a scene and saves normally.
     */
    public function instantiate(Request $request, Character $character): JsonResponse
    {
        abort_unless($character->user_id === $request->user()->id, 404);
        $data = $request->validate(['project_id' => 'required|integer']);
        $target = Project::where('user_id', $request->user()->id)->findOrFail($data['project_id']);

        $layers = DB::transaction(function () use ($character, $target) {
            $parts = $character->parts()->get();
            $idMap = $parts->mapWithKeys(fn ($p) => [$p->part_key => 'l'.Str::lower(Str::random(10))])->all();
            $assetMap = [];
            $out = [];
            foreach ($parts as $p) {
                $l = $p->layer;
                $l['id'] = $idMap[$p->part_key];
                $l['parentId'] = isset($l['parentId'], $idMap[$l['parentId']]) ? $idMap[$l['parentId']] : null;
                if (! empty($l['ik'])) {
                    $l['ik']['target'] = $idMap[$l['ik']['target']] ?? null;
                    if ($l['ik']['target'] === null) {
                        $l['ik'] = null; // target was not part of the character
                    }
                }
                if (! empty($p->asset_id)) {
                    $src = Asset::find($p->asset_id);
                    if (! $src) {
                        continue; // asset was deleted since; skip the part rather than insert a broken layer
                    }
                    if ($src->project_id === $target->id) {
                        $assetMap[$src->id] = $src->id;
                    } elseif (! isset($assetMap[$src->id])) {
                        $newPath = 'projects/'.$target->id.'/assets/'.Str::uuid().'.'.pathinfo($src->path, PATHINFO_EXTENSION);
                        Storage::disk($src->disk)->copy($src->path, $newPath);
                        $assetMap[$src->id] = $target->assets()->create([...$src->only('user_id', 'disk', 'original_name', 'mime', 'size', 'width', 'height'), 'kind' => 'character', 'path' => $newPath])->id;
                    }
                    $l['assetId'] = $assetMap[$src->id];
                }
                $out[] = $l;
            }

            return $out;
        });

        return response()->json(['data' => ['layers' => $layers, 'assets' => $target->assets()->whereIn('id', array_values(array_unique(array_filter(array_column($layers, 'assetId')))))->get()->map->present()]]);
    }

    public function destroy(Request $request, Character $character): JsonResponse
    {
        abort_unless($character->user_id === $request->user()->id, 404);
        $character->delete();

        return response()->json(['ok' => true]);
    }
}

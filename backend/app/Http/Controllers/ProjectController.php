<?php

namespace App\Http\Controllers;

use App\Models\Asset;
use App\Models\Project;
use App\Models\ProjectVersion;
use App\Support\DocumentMigrator;
use App\Support\TimelineProjector;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

class ProjectController extends Controller
{
    private const MAX_VERSIONS = 30;

    public const TRANSITIONS = ['none', 'fade', 'fadeWhite', 'slideLeft', 'slideRight', 'wipe', 'zoom'];

    public function index(Request $request): JsonResponse
    {
        $projects = $request->user()->projects()
            ->orderByDesc('updated_at')
            ->get(['id', 'name', 'revision', 'updated_at', 'created_at']);

        return response()->json(['data' => $projects]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate(['name' => 'required|string|max:120']);

        $project = Project::create([
            'user_id' => $request->user()->id,
            'name' => $data['name'],
            'document' => Project::blankDocument(),
        ])->fresh(); // reload so DB defaults (revision = 1) are present in the response

        return response()->json(['data' => $this->present($project)], 201);
    }

    public function show(Request $request, Project $project): JsonResponse
    {
        $this->authorizeOwner($request, $project);

        return response()->json(['data' => $this->present($project)]);
    }

    /** Layer field rules for a path prefix such as "document.scenes.*.layers.*". validated() drops every key without a rule. */
    private function layerRules(string $p): array
    {
        $rules = [
            "$p.id" => 'required|string|max:64',
            "$p.type" => 'required|in:image,text,shape,bone,balloon',
            "$p.parentId" => 'nullable|string|max:64',
            "$p.ik" => 'nullable|array|required_array_keys:target,bend',
            "$p.ik.target" => 'string|max:64',
            "$p.ik.bend" => 'in:1,-1',
            "$p.pivotX" => 'nullable|numeric|between:-100000,100000',
            "$p.pivotY" => 'nullable|numeric|between:-100000,100000',
            "$p.length" => 'nullable|numeric|between:1,20000',
            "$p.name" => 'required|string|max:120',
            "$p.assetId" => 'nullable|integer',
            "$p.x" => 'required|numeric|between:-100000,100000',
            "$p.y" => 'required|numeric|between:-100000,100000',
            "$p.scaleX" => 'required|numeric|between:-1000,1000',
            "$p.scaleY" => 'required|numeric|between:-1000,1000',
            "$p.rotation" => 'required|numeric|between:-360000,360000',
            "$p.opacity" => 'required|numeric|between:0,1',
            "$p.visible" => 'required|boolean',
            "$p.locked" => 'required|boolean',
            "$p.text" => 'nullable|string|max:5000',
            "$p.fontSize" => 'nullable|numeric|between:1,1000',
            "$p.fill" => ['nullable', 'regex:/^#[0-9a-fA-F]{6}$/'],
            "$p.width" => 'nullable|numeric|between:1,20000',
            "$p.height" => 'nullable|numeric|between:1,20000',
            "$p.shape" => 'nullable|in:rect,ellipse',
            "$p.bubble" => 'nullable|in:speech,thought,shout',
            "$p.bubbleFill" => ['nullable', 'regex:/^#[0-9a-fA-F]{6}$/'],
            "$p.tailX" => 'nullable|numeric|between:-20000,20000',
            "$p.tailY" => 'nullable|numeric|between:-20000,20000',
            "$p.swaps" => 'nullable|array|max:5000',
            "$p.swaps.*.f" => 'required|integer|min:0|max:100000',
            "$p.swaps.*.assetId" => 'required|integer',
            "$p.expr" => 'nullable|array|max:40',
            "$p.expr.*" => 'integer',
            "$p.rig" => 'nullable|array|required_array_keys:id,role',
            "$p.rig.id" => 'string|max:64',
            "$p.rig.role" => 'string|max:64',
        ];
        foreach (['x', 'y', 'scaleX', 'scaleY', 'rotation', 'opacity'] as $prop) {
            $rules["$p.keyframes.$prop"] = 'nullable|array|max:5000';
            $rules["$p.keyframes.$prop.*.f"] = 'required|integer|min:0|max:100000';
            $rules["$p.keyframes.$prop.*.v"] = 'required|numeric|between:-1000000,1000000';
            $rules["$p.keyframes.$prop.*.e"] = 'required|in:linear,easeIn,easeOut,easeInOut,step';
        }

        return $rules;
    }

    /** Camera tracks, effects, subtitles and storyboard notes of a scene. */
    private function sceneExtraRules(): array
    {
        $p = 'document.scenes.*';
        $r = [
            "$p.effects" => 'nullable|array|max:20',
            "$p.effects.*.id" => 'required|string|max:64',
            "$p.effects.*.kind" => 'required|in:rain,snow,tint,vignette',
            "$p.effects.*.intensity" => 'required|numeric|between:0,1',
            "$p.effects.*.color" => ['nullable', 'regex:/^#[0-9a-fA-F]{6}$/'],
            "$p.effects.*.blend" => 'nullable|in:multiply,normal',
            "$p.effects.*.label" => 'nullable|string|max:40',
            "$p.subtitles" => 'nullable|array|max:300',
            "$p.subtitles.*.id" => 'required|string|max:64',
            "$p.subtitles.*.start" => 'required|numeric|min:0|max:600',
            "$p.subtitles.*.end" => 'required|numeric|min:0|max:600',
            "$p.subtitles.*.text" => 'required|string|max:300',
            "$p.board" => 'nullable|array',
            "$p.board.location" => 'nullable|string|max:120',
            "$p.board.summary" => 'nullable|string|max:2000',
            "$p.board.dialog" => 'nullable|array|max:200',
            "$p.board.dialog.*.id" => 'required|string|max:64',
            "$p.board.dialog.*.who" => 'nullable|string|max:60',
            "$p.board.dialog.*.text" => 'required|string|max:500',
            "$p.camera" => 'nullable|array',
        ];
        foreach (['x', 'y', 'zoom', 'rot'] as $prop) {
            $r["$p.camera.$prop"] = 'nullable|array|max:2000';
            $r["$p.camera.$prop.*.f"] = 'required|integer|min:0|max:100000';
            $r["$p.camera.$prop.*.v"] = 'required|numeric|between:-1000000,1000000';
            $r["$p.camera.$prop.*.e"] = 'required|in:linear,easeIn,easeOut,easeInOut,step';
        }

        return $r;
    }

    /** Autosave / save. Optimistic concurrency via base_revision. Accepts schema 1 (single scene) or 2 documents. */
    public function update(Request $request, Project $project): JsonResponse
    {
        $this->authorizeOwner($request, $project);

        if (DocumentMigrator::isV1($request->input('document'))) {
            $request->merge(['document' => DocumentMigrator::toV2($request->input('document'))]);
        }

        $data = $request->validate($this->layerRules('document.scenes.*.layers.*') + [
            'name' => 'sometimes|string|max:120',
            'document' => 'sometimes|array',
            'document.settings' => 'required_with:document|array',
            'document.settings.width' => 'required_with:document|integer|min:64|max:3840',
            'document.settings.height' => 'required_with:document|integer|min:64|max:2160',
            'document.settings.fps' => 'required_with:document|integer|min:1|max:60',
            'document.scenes' => 'required_with:document|array|min:1|max:50',
            'document.scenes.*.id' => 'required|string|max:64',
            'document.scenes.*.name' => 'required|string|max:80',
            'document.scenes.*.duration' => 'required|numeric|min:0.5|max:600',
            'document.scenes.*.background' => ['required', 'regex:/^#[0-9a-fA-F]{6}$/'],
            'document.scenes.*.transition' => 'nullable|array|required_array_keys:type,duration',
            'document.scenes.*.transition.type' => 'in:'.implode(',', self::TRANSITIONS),
            'document.scenes.*.transition.duration' => 'numeric|min:0.1|max:3',
            'document.scenes.*.layers' => 'present|array|max:500',
            ...$this->sceneExtraRules(),
            'document.audio' => 'nullable|array|max:20',
            'document.audio.*.id' => 'required|string|max:64',
            'document.audio.*.assetId' => 'required|integer',
            'document.audio.*.name' => 'required|string|max:120',
            'document.audio.*.start' => 'required|numeric|min:0|max:7200',
            'document.audio.*.volume' => 'required|numeric|min:0|max:1',
            'document.audio.*.kind' => 'nullable|in:music,sfx,voice',
            'document.audio.*.fadeIn' => 'nullable|numeric|min:0|max:30',
            'document.audio.*.fadeOut' => 'nullable|numeric|min:0|max:30',
            'base_revision' => 'sometimes|integer',
            'snapshot' => 'sometimes|boolean',
            'label' => 'sometimes|nullable|string|max:120',
        ]);

        if (isset($data['document'])) {
            $data['document'] = $this->normalizeDocument($data['document']);
            if ($err = $this->documentError($data['document'], $project)) {
                return response()->json(['message' => $err, 'errors' => ['document' => [$err]]], 422);
            }
        }

        if (isset($data['base_revision']) && $data['base_revision'] !== $project->revision) {
            return response()->json([
                'message' => 'Project sudah diubah di tempat lain. Muat ulang sebelum menyimpan.',
                'revision' => $project->revision,
            ], 409);
        }

        DB::transaction(function () use ($project, $data) {
            if (isset($data['name'])) {
                $project->name = $data['name'];
            }
            if (isset($data['document'])) {
                $project->document = $data['document'];
                $project->revision++;
            }
            $project->save();

            if (! empty($data['snapshot']) && isset($data['document'])) {
                $this->snapshot($project, $data['label'] ?? null);
            }
            if (isset($data['document'])) {
                TimelineProjector::sync($project);
            }
        });

        return response()->json(['data' => $this->present($project->fresh())]);
    }

    public function destroy(Request $request, Project $project): JsonResponse
    {
        $this->authorizeOwner($request, $project);

        foreach ($project->assets as $asset) {
            Storage::disk($asset->disk)->delete($asset->path);
        }
        foreach ($project->exports as $export) {
            Storage::disk('local')->delete(array_filter([$export->source_path, $export->output_path]));
        }
        $project->delete();

        return response()->json(['ok' => true]);
    }

    public function duplicate(Request $request, Project $project): JsonResponse
    {
        $this->authorizeOwner($request, $project);

        $copy = DB::transaction(function () use ($project, $request) {
            $copy = Project::create([
                'user_id' => $project->user_id,
                'name' => ($request->input('name') ?: $project->name.' (salinan)'),
                'document' => DocumentMigrator::toV2($project->document),
            ]);

            // Copy asset files and remap asset ids (image layers in every scene + audio clips) so the copy is independent.
            $map = [];
            foreach ($project->assets as $asset) {
                $newPath = 'projects/'.$copy->id.'/assets/'.basename($asset->path);
                Storage::disk($asset->disk)->copy($asset->path, $newPath);
                $new = $copy->assets()->create([
                    ...$asset->only('user_id', 'disk', 'original_name', 'mime', 'size', 'width', 'height', 'duration', 'kind', 'mode', 'meta'),
                    'path' => $newPath,
                ]);
                $map[$asset->id] = $new->id;
            }
            foreach ($project->assets as $asset) { // keep the enhancement lineage (original -> versions) inside the copy
                if ($asset->parent_id && isset($map[$asset->parent_id])) {
                    Asset::whereKey($map[$asset->id])->update(['parent_id' => $map[$asset->parent_id]]);
                }
            }
            $doc = $copy->document;
            foreach ($doc['scenes'] as &$scene) {
                foreach ($scene['layers'] as &$layer) {
                    if (! empty($layer['assetId']) && isset($map[$layer['assetId']])) {
                        $layer['assetId'] = $map[$layer['assetId']];
                    }
                    foreach ($layer['swaps'] ?? [] as $i => $sw) {
                        $layer['swaps'][$i]['assetId'] = $map[$sw['assetId']] ?? $sw['assetId'];
                    }
                    foreach ($layer['expr'] ?? [] as $k => $id) {
                        $layer['expr'][$k] = $map[$id] ?? $id;
                    }
                }
                unset($layer);
            }
            unset($scene);
            foreach ($doc['audio'] as &$clip) {
                $clip['assetId'] = $map[$clip['assetId']] ?? $clip['assetId'];
            }
            unset($clip);
            $copy->document = $doc;
            $copy->save();
            TimelineProjector::sync($copy);

            return $copy;
        });

        return response()->json(['data' => $this->present($copy)], 201);
    }

    public function versions(Request $request, Project $project): JsonResponse
    {
        $this->authorizeOwner($request, $project);

        return response()->json([
            'data' => $project->versions()->orderByDesc('number')
                ->get(['id', 'number', 'label', 'created_at']),
        ]);
    }

    public function restoreVersion(Request $request, Project $project, int $number): JsonResponse
    {
        $this->authorizeOwner($request, $project);
        $version = $project->versions()->where('number', $number)->firstOrFail();

        DB::transaction(function () use ($project, $version) {
            $this->snapshot($project, 'Sebelum restore v'.$version->number); // keep current state recoverable
            $project->document = DocumentMigrator::toV2($version->document);
            $project->revision++;
            $project->save();
            TimelineProjector::sync($project);
        });

        return response()->json(['data' => $this->present($project->fresh())]);
    }

    /**
     * validated() builds nested wildcard arrays in rule order, so list keys can come back shuffled
     * (which would serialise as a JSON object). Restore document order and plain lists everywhere.
     */
    private function normalizeDocument(array $doc): array
    {
        ksort($doc['scenes']);
        $doc['scenes'] = array_map(function (array $scene) {
            ksort($scene['layers']);
            $scene['layers'] = array_map(function (array $l) {
                if (isset($l['keyframes'])) {
                    foreach ($l['keyframes'] as $prop => $list) {
                        ksort($list);
                        // the animation evaluator relies on keys being sorted by frame, one per frame
                        $byFrame = [];
                        foreach ($list as $k) {
                            $byFrame[$k['f']] = $k;
                        }
                        ksort($byFrame);
                        $l['keyframes'][$prop] = array_values($byFrame);
                    }
                }

                if (isset($l['swaps'])) {
                    $byFrame = [];
                    foreach ($l['swaps'] as $k) {
                        $byFrame[$k['f']] = $k;
                    }
                    ksort($byFrame);
                    $l['swaps'] = array_values($byFrame);
                }

                return $l;
            }, array_values($scene['layers']));
            $scene['transition'] = $scene['transition'] ?? null;
            foreach (['effects', 'subtitles'] as $list) {
                if (isset($scene[$list])) {
                    ksort($scene[$list]);
                    $scene[$list] = array_values($scene[$list]);
                    if ($scene[$list] === []) {
                        unset($scene[$list]);
                    }
                }
            }
            if (isset($scene['board']['dialog'])) {
                ksort($scene['board']['dialog']);
                $scene['board']['dialog'] = array_values($scene['board']['dialog']);
            }
            if (isset($scene['camera'])) {
                foreach ($scene['camera'] as $prop => $list) {
                    $byFrame = [];
                    foreach ($list as $k) {
                        $byFrame[$k['f']] = $k;
                    }
                    ksort($byFrame);
                    $scene['camera'][$prop] = array_values($byFrame);
                }
                if ($scene['camera'] === []) {
                    unset($scene['camera']);
                }
            }

            return $scene;
        }, array_values($doc['scenes']));
        $audio = $doc['audio'] ?? [];
        ksort($audio);
        $doc['audio'] = array_values($audio);
        $doc['schema'] = 2;

        return $doc;
    }

    private function documentError(array $doc, Project $project): ?string
    {
        $sceneIds = array_column($doc['scenes'], 'id');
        if (count($sceneIds) !== count(array_unique($sceneIds))) {
            return 'ID scene duplikat.';
        }
        foreach ($doc['scenes'] as $scene) {
            if ($err = $this->hierarchyError($scene['layers'])) {
                return $scene['name'].': '.$err;
            }
        }
        if ($doc['audio'] !== []) {
            $ids = array_unique(array_column($doc['audio'], 'assetId'));
            $ok = Asset::where('project_id', $project->id)->where('mime', 'like', 'audio/%')->whereIn('id', $ids)->count();
            if ($ok !== count($ids)) {
                return 'Klip audio merujuk aset audio yang tidak ada di project ini.';
            }
        }

        return null;
    }

    /** Parent links must point at existing layers and form a forest (no cycles). */
    private function hierarchyError(array $layers): ?string
    {
        $parents = [];
        foreach ($layers as $l) {
            if (array_key_exists($l['id'], $parents)) { // isset() would miss ids whose parent is null
                return 'ID layer duplikat.';
            }
            $parents[$l['id']] = $l['parentId'] ?? null;
        }
        foreach ($layers as $l) {
            if (empty($l['ik'])) {
                continue;
            }
            $t = $l['ik']['target'];
            $pid = $parents[$l['id']];
            if ($pid === null) {
                return 'IK membutuhkan bone induk.';
            }
            if (! array_key_exists($t, $parents) || $t === $l['id'] || $t === $pid) {
                return 'Target IK tidak valid.';
            }
            // the target must not ride on the chain it drives (feedback loop)
            for ($a = $t, $n = 0; $a !== null && $n < 1000; $a = $parents[$a] ?? null, $n++) {
                if ($a === $pid) {
                    return 'Target IK tidak boleh turunan dari rantai IK.';
                }
            }
        }
        foreach ($parents as $id => $p) {
            $seen = [$id => true];
            while ($p !== null) {
                if (! array_key_exists($p, $parents)) {
                    return 'Parent layer tidak ditemukan.';
                }
                if (isset($seen[$p])) {
                    return 'Hierarki layer tidak boleh melingkar.';
                }
                $seen[$p] = true;
                $p = $parents[$p];
            }
        }

        return null;
    }

    private function snapshot(Project $project, ?string $label): void
    {
        $next = (int) ProjectVersion::where('project_id', $project->id)->max('number') + 1;
        ProjectVersion::create([
            'project_id' => $project->id,
            'number' => $next,
            'label' => $label,
            'document' => $project->document,
        ]);

        $stale = ProjectVersion::where('project_id', $project->id)
            ->orderByDesc('number')->skip(self::MAX_VERSIONS)->take(1000)->pluck('id');
        if ($stale->isNotEmpty()) {
            ProjectVersion::whereIn('id', $stale)->delete();
        }
    }

    private function present(Project $project): array
    {
        return [
            'id' => $project->id,
            'name' => $project->name,
            'revision' => $project->revision,
            'document' => DocumentMigrator::toV2($project->document), // older stored documents are upgraded on read
            'updated_at' => $project->updated_at,
        ];
    }

    private function authorizeOwner(Request $request, Project $project): void
    {
        abort_unless($project->user_id === $request->user()->id, 404);
    }
}

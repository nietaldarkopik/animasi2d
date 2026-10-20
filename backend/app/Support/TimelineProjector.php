<?php

namespace App\Support;

use App\Models\AnimationScene;
use App\Models\Asset;
use App\Models\Layer;
use App\Models\Project;
use Illuminate\Support\Facades\DB;

/**
 * Mirrors the project's JSON document into relational rows (animation_scenes -> layers -> keyframes).
 * The JSON document stays the source of truth for the editor; the rows are rewritten from it on every save
 * (call inside the save transaction) so timelines can be queried, indexed and constrained in MySQL.
 */
class TimelineProjector
{
    private const BASE_KEYS = ['id', 'type', 'name', 'parentId', 'assetId', 'visible', 'locked', 'keyframes'];

    public static function sync(Project $project): void
    {
        $doc = DocumentMigrator::toV2($project->document);
        $validAssets = Asset::where('project_id', $project->id)->pluck('id')->flip();

        DB::transaction(function () use ($project, $doc, $validAssets) {
            // cascade deletes layers + keyframes; simplest correct way to mirror reorders and deletions
            AnimationScene::where('project_id', $project->id)->delete();

            foreach ($doc['scenes'] as $pos => $s) {
                $scene = AnimationScene::create([
                    'project_id' => $project->id,
                    'scene_key' => $s['id'],
                    'name' => $s['name'],
                    'position' => $pos,
                    'duration' => $s['duration'],
                    'background' => $s['background'],
                    'transition' => $s['transition'] ?? null,
                ]);

                $rows = [];
                foreach (array_values($s['layers']) as $z => $l) {
                    $layer = Layer::create([
                        'animation_scene_id' => $scene->id,
                        'layer_key' => $l['id'],
                        'parent_key' => $l['parentId'] ?? null,
                        'type' => $l['type'],
                        'name' => $l['name'],
                        'z_order' => $z,
                        'asset_id' => isset($l['assetId'], $validAssets[$l['assetId']]) ? $l['assetId'] : null,
                        'visible' => (bool) $l['visible'],
                        'locked' => (bool) $l['locked'],
                        'properties' => array_diff_key($l, array_flip(self::BASE_KEYS)),
                    ]);
                    foreach ($l['keyframes'] ?? [] as $prop => $list) {
                        foreach ($list as $k) {
                            $rows[] = ['layer_id' => $layer->id, 'property' => $prop, 'frame' => $k['f'], 'value' => $k['v'], 'easing' => $k['e']];
                        }
                    }
                }
                foreach (array_chunk($rows, 500) as $chunk) {
                    DB::table('keyframes')->insert($chunk);
                }
            }
        });
    }
}

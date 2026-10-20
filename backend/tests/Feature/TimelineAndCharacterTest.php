<?php

namespace Tests\Feature;

use App\Models\AnimationScene;
use App\Models\Asset;
use App\Models\Character;
use App\Models\Keyframe;
use App\Models\Layer;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class TimelineAndCharacterTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
    }

    private function headers(User $u): array
    {
        $this->app['auth']->forgetGuards();

        return ['Authorization' => 'Bearer '.$u->createToken('t')->plainTextToken, 'Accept' => 'application/json'];
    }

    private function layer(string $id, array $extra = []): array
    {
        return $extra + ['id' => $id, 'type' => 'shape', 'name' => $id, 'x' => 10, 'y' => 20, 'scaleX' => 1, 'scaleY' => 1, 'rotation' => 0, 'opacity' => 1, 'visible' => true, 'locked' => false, 'width' => 50, 'height' => 50, 'fill' => '#112233'];
    }

    private function doc(array $scenes): array
    {
        return ['schema' => 2, 'settings' => ['width' => 1280, 'height' => 720, 'fps' => 24], 'scenes' => $scenes, 'audio' => []];
    }

    private function scene(string $id, array $layers): array
    {
        return ['id' => $id, 'name' => strtoupper($id), 'duration' => 3, 'background' => '#ffffff', 'transition' => null, 'layers' => $layers];
    }

    private function save(User $u, int $pid, array $doc, int $rev): \Illuminate\Testing\TestResponse
    {
        return $this->putJson("/api/projects/$pid", ['document' => $doc, 'base_revision' => $rev], $this->headers($u));
    }

    private function makeProject(User $u): array
    {
        return $this->postJson('/api/projects', ['name' => 'P'], $this->headers($u))->json('data');
    }

    public function test_saving_mirrors_the_document_into_relational_rows_and_replaces_them_on_each_save(): void
    {
        $u = User::factory()->create();
        $p = $this->makeProject($u);
        $kf = ['x' => [['f' => 12, 'v' => 100, 'e' => 'easeIn'], ['f' => 0, 'v' => 0, 'e' => 'linear']], 'opacity' => [['f' => 0, 'v' => 1, 'e' => 'step']]];
        $doc = $this->doc([
            $this->scene('s1', [$this->layer('a', ['keyframes' => $kf]), $this->layer('b', ['parentId' => 'a', 'visible' => false])]),
            $this->scene('s2', [$this->layer('c')]),
        ]);
        $this->save($u, $p['id'], $doc, $p['revision'])->assertOk();

        $scenes = AnimationScene::where('project_id', $p['id'])->orderBy('position')->get();
        $this->assertSame(['s1', 's2'], $scenes->pluck('scene_key')->all());
        $layers = Layer::where('animation_scene_id', $scenes[0]->id)->orderBy('z_order')->get();
        $this->assertSame(['a', 'b'], $layers->pluck('layer_key')->all());
        $this->assertSame('a', $layers[1]->parent_key);
        $this->assertFalse($layers[1]->visible);
        $this->assertSame(50, $layers[0]->properties['width']);

        $x = Keyframe::where('layer_id', $layers[0]->id)->where('property', 'x')->orderBy('frame')->get();
        $this->assertSame([0, 12], $x->pluck('frame')->all());
        $this->assertSame([0.0, 100.0], $x->pluck('value')->all());
        $this->assertSame('easeIn', $x[1]->easing);
        $this->assertSame(3, Keyframe::whereIn('layer_id', Layer::pluck('id'))->count());

        // a new save replaces (no stale rows)
        $rev = $this->getJson("/api/projects/{$p['id']}", $this->headers($u))->json('data.revision');
        $this->save($u, $p['id'], $this->doc([$this->scene('only', [$this->layer('z')])]), $rev)->assertOk();
        $this->assertSame(['only'], AnimationScene::where('project_id', $p['id'])->pluck('scene_key')->all());
        $this->assertSame(1, Layer::count());
        $this->assertSame(0, Keyframe::count());
    }

    public function test_restoring_a_version_resyncs_rows_and_deleting_a_project_cascades(): void
    {
        $u = User::factory()->create();
        $p = $this->makeProject($u);
        $this->putJson("/api/projects/{$p['id']}", ['document' => $this->doc([$this->scene('v1', [$this->layer('a')])]), 'base_revision' => $p['revision'], 'snapshot' => true], $this->headers($u))->assertOk();
        $this->putJson("/api/projects/{$p['id']}", ['document' => $this->doc([$this->scene('v2', [$this->layer('b'), $this->layer('c')])]), 'base_revision' => 2], $this->headers($u))->assertOk();
        $this->assertSame(2, Layer::count());

        $this->postJson("/api/projects/{$p['id']}/versions/1/restore", [], $this->headers($u))->assertOk();
        $this->assertSame(['v1'], AnimationScene::pluck('scene_key')->all());
        $this->assertSame(1, Layer::count());

        $copy = $this->postJson("/api/projects/{$p['id']}/duplicate", [], $this->headers($u))->assertCreated()->json('data');
        $this->assertSame(1, AnimationScene::where('project_id', $copy['id'])->count());

        $this->deleteJson("/api/projects/{$p['id']}", [], $this->headers($u))->assertOk();
        $this->assertSame(0, AnimationScene::where('project_id', $p['id'])->count());
        $this->assertSame(1, AnimationScene::count()); // only the copy's rows remain
    }

    public function test_invalid_documents_do_not_touch_the_rows(): void
    {
        $u = User::factory()->create();
        $p = $this->makeProject($u);
        $this->save($u, $p['id'], $this->doc([$this->scene('s1', [$this->layer('a')])]), $p['revision'])->assertOk();
        $bad = $this->doc([$this->scene('s1', [$this->layer('a'), $this->layer('a')])]); // duplicate layer ids
        $this->save($u, $p['id'], $bad, 2)->assertStatus(422);
        $this->assertSame(1, Layer::count());
    }

    private function asset(User $u, int $pid): array
    {
        $im = imagecreatetruecolor(40, 40);
        $path = tempnam(sys_get_temp_dir(), 'ch').'.png';
        imagepng($im, $path);

        return $this->post("/api/projects/$pid/assets", ['file' => new UploadedFile($path, 'part.png', 'image/png', null, true)], $this->headers($u))->assertCreated()->json('data');
    }

    public function test_character_library_save_and_instantiate_into_another_project(): void
    {
        $u = User::factory()->create();
        $a = $this->makeProject($u);
        $b = $this->makeProject($u);
        $asset = $this->asset($u, $a['id']);
        $layers = [
            $this->layer('root', ['type' => 'bone', 'length' => 40]),
            $this->layer('arm', ['type' => 'image', 'assetId' => $asset['id'], 'parentId' => 'root', 'keyframes' => ['rotation' => [['f' => 0, 'v' => 0, 'e' => 'linear'], ['f' => 6, 'v' => 30, 'e' => 'linear']]]]),
            $this->layer('other'),
        ];
        $this->save($u, $a['id'], $this->doc([$this->scene('s1', $layers)]), $a['revision'])->assertOk();

        // a child without its parent is rejected
        $this->postJson("/api/projects/{$a['id']}/characters", ['name' => 'Hero', 'method' => 'rig', 'scene_id' => 's1', 'layer_ids' => ['arm']], $this->headers($u))->assertStatus(422);

        $c = $this->postJson("/api/projects/{$a['id']}/characters", ['name' => 'Hero', 'method' => 'rig', 'scene_id' => 's1', 'layer_ids' => ['root', 'arm']], $this->headers($u))->assertCreated()->json('data');
        $this->assertSame(2, $c['parts']);
        $this->assertSame(2, Character::find($c['id'])->parts()->count());
        $this->assertSame([['name' => 'Hero', 'method' => 'rig', 'parts' => 2]], array_map(fn ($r) => ['name' => $r['name'], 'method' => $r['method'], 'parts' => $r['parts']], $this->getJson('/api/characters', $this->headers($u))->json('data')));

        $r = $this->postJson("/api/characters/{$c['id']}/instantiate", ['project_id' => $b['id']], $this->headers($u))->assertOk()->json('data');
        [$root, $arm] = $r['layers'];
        $this->assertNotSame('root', $root['id']);
        $this->assertSame($root['id'], $arm['parentId'], 'parent link is remapped to the new ids');
        $this->assertSame(6, $arm['keyframes']['rotation'][1]['f'], 'keyframes travel with the character');
        $this->assertNotSame($asset['id'], $arm['assetId']);
        $copied = Asset::find($arm['assetId']);
        $this->assertSame($b['id'], $copied->project_id, 'asset file is copied into the target project');
        $this->assertTrue(Storage::disk('local')->exists($copied->path));
        $this->assertCount(1, $r['assets']);
    }

    public function test_characters_are_isolated_between_users(): void
    {
        $owner = User::factory()->create();
        $p = $this->makeProject($owner);
        $this->save($owner, $p['id'], $this->doc([$this->scene('s1', [$this->layer('a')])]), $p['revision'])->assertOk();
        $c = $this->postJson("/api/projects/{$p['id']}/characters", ['name' => 'X', 'method' => 'frame_by_frame', 'scene_id' => 's1', 'layer_ids' => ['a']], $this->headers($owner))->assertCreated()->json('data');

        $other = User::factory()->create();
        $mine = $this->makeProject($other);
        $this->postJson("/api/projects/{$p['id']}/characters", ['name' => 'Y', 'method' => 'rig', 'scene_id' => 's1', 'layer_ids' => ['a']], $this->headers($other))->assertNotFound();
        $this->postJson("/api/characters/{$c['id']}/instantiate", ['project_id' => $mine['id']], $this->headers($other))->assertNotFound();
        $this->deleteJson("/api/characters/{$c['id']}", [], $this->headers($other))->assertNotFound();
        $this->assertSame([], $this->getJson('/api/characters', $this->headers($other))->json('data'));
        // and one cannot instantiate into somebody else's project
        $this->postJson("/api/characters/{$c['id']}/instantiate", ['project_id' => $p['id']], $this->headers($other))->assertNotFound();
        $this->deleteJson("/api/characters/{$c['id']}", [], $this->headers($owner))->assertOk();
    }
}

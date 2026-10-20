<?php

namespace Tests\Feature;

use App\Models\LibraryAsset;
use App\Models\User;
use Database\Seeders\LibrarySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/** Editing library assets: re-upload / replace, duplicate, rename/recategorise, and what happens when versions use them. */
class LibraryEditTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        $this->seed(LibrarySeeder::class);
    }

    private function h(User $u): array
    {
        $this->app['auth']->forgetGuards();

        return ['Authorization' => 'Bearer '.$u->createToken('t')->plainTextToken, 'Accept' => 'application/json'];
    }

    private function png(int $w, int $h, array $rgb = [200, 50, 50]): UploadedFile
    {
        $im = imagecreatetruecolor($w, $h);
        imagefill($im, 0, 0, imagecolorallocate($im, ...$rgb));
        $p = tempnam(sys_get_temp_dir(), 'le').'.png';
        imagepng($im, $p);

        return new UploadedFile($p, 'x.png', 'image/png', null, true);
    }

    private function svg(string $body = '<path d="M1 1L9 9" fill="#000"/>'): UploadedFile
    {
        $p = tempnam(sys_get_temp_dir(), 'ls').'.svg';
        file_put_contents($p, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 800">'.$body.'</svg>');

        return new UploadedFile($p, 'a.svg', 'image/svg+xml', null, true);
    }

    private function upload(User $u, UploadedFile $f, string $category = 'hat', string $name = 'Topi'): array
    {
        return $this->post('/api/library/assets', ['file' => $f, 'category' => $category, 'name' => $name], $this->h($u))->assertCreated()->json('data');
    }

    private function config(array $parts): array
    {
        $pal = ['skin' => '#f1c7a0', 'hair' => '#1f1b24', 'top' => '#f4f6fa', 'bottom' => '#34456a', 'hijab' => '#f1f1f5', 'tie' => '#3f5f86', 'eye' => '#3a2b2b', 'shoe' => '#2b2b33', 'accent' => '#2e3440'];

        return ['schema_version' => 1, 'view' => 'half', 'palette' => $pal, 'parts' => $parts];
    }

    public function test_unused_asset_is_replaced_in_place(): void
    {
        $u = User::factory()->create();
        $a = $this->upload($u, $this->png(50, 60));
        $oldPath = LibraryAsset::find($a['id'])->path;

        $r = $this->post("/api/library/assets/{$a['id']}/file", ['file' => $this->png(80, 90, [10, 120, 10])], $this->h($u))->assertOk();
        $this->assertSame($a['id'], $r->json('data.id'));
        $this->assertSame([80, 90], [$r->json('data.width'), $r->json('data.height')]);
        $this->assertNotSame($a['hash'], $r->json('data.hash'));
        $this->assertFalse($r->json('archived_old'));
        $this->assertFalse(Storage::disk('local')->exists($oldPath), 'old file is removed');
        $this->assertTrue(Storage::disk('local')->exists(LibraryAsset::find($a['id'])->path));
        $this->assertSame(1, LibraryAsset::where('user_id', $u->id)->count());

        // a PNG can be replaced by an SVG (and is sanitised on the way in)
        $r = $this->post("/api/library/assets/{$a['id']}/file", ['file' => $this->svg('<path data-tint="hair" d="M1 1L9 9" fill="#000" onclick="x()"/>')], $this->h($u))->assertOk();
        $this->assertSame(['image/svg+xml', true], [$r->json('data.mime'), $r->json('data.tintable')]);
        $this->assertStringNotContainsString('onclick', Storage::disk('local')->get(LibraryAsset::find($a['id'])->path));
    }

    public function test_replace_rejects_bad_files_and_keeps_the_old_one(): void
    {
        $u = User::factory()->create();
        $a = $this->upload($u, $this->png(50, 60));
        $before = LibraryAsset::find($a['id'])->only('path', 'hash');

        $this->post("/api/library/assets/{$a['id']}/file", ['file' => $this->svg('<script>alert(1)</script>')], $this->h($u))->assertStatus(422);
        $txt = tempnam(sys_get_temp_dir(), 'tx');
        file_put_contents($txt, 'plain text');
        $this->post("/api/library/assets/{$a['id']}/file", ['file' => new UploadedFile($txt, 'x.png', 'image/png', null, true)], $this->h($u))->assertStatus(422);
        $this->post("/api/library/assets/{$a['id']}/file", [], $this->h($u))->assertStatus(422);

        $this->assertSame($before, LibraryAsset::find($a['id'])->only('path', 'hash'));
        $this->assertTrue(Storage::disk('local')->exists($before['path']));
    }

    public function test_replacing_an_asset_used_by_a_version_keeps_that_version_unchanged(): void
    {
        $u = User::factory()->create();
        $a = $this->upload($u, $this->svg(), 'hat');
        $char = $this->postJson('/api/builder/characters', ['name' => 'K', 'config' => $this->config(['hat' => ['assetId' => $a['id']]])], $this->h($u))->assertCreated()->json('data');
        $oldFile = Storage::disk('local')->get(LibraryAsset::find($a['id'])->path);

        $r = $this->post("/api/library/assets/{$a['id']}/file", ['file' => $this->svg('<path d="M5 5L50 50" fill="#f00"/>')], $this->h($u))->assertCreated();
        $this->assertTrue($r->json('archived_old'));
        $this->assertSame($a['id'], $r->json('replaced_id'));
        $newId = $r->json('data.id');
        $this->assertNotSame($a['id'], $newId);

        // the old row is archived (hidden) but still has its ORIGINAL content, so version 1 renders as before
        $old = LibraryAsset::find($a['id']);
        $this->assertNotNull($old->archived_at);
        $this->assertSame($oldFile, Storage::disk('local')->get($old->path));
        $v1 = $this->getJson("/api/builder/characters/{$char['id']}?version=1", $this->h($u))->json('data');
        $this->assertSame($a['id'], $v1['config']['parts']['hat']['assetId']);
        $this->assertArrayHasKey($a['id'], $v1['assets']);
        $this->get($v1['assets'][$a['id']]['url'])->assertOk();

        // library shows only the new asset; it is usable in a NEW version
        $ids = array_column($this->getJson('/api/library/assets?mine=1', $this->h($u))->json('data'), 'id');
        $this->assertSame([$newId], $ids);
        $this->postJson("/api/builder/characters/{$char['id']}/versions", ['config' => $this->config(['hat' => ['assetId' => $newId]])], $this->h($u))->assertCreated();
        $this->assertSame(['hat', 'upload'], [LibraryAsset::find($newId)->category->slug, LibraryAsset::find($newId)->source]);
    }

    public function test_replace_and_duplicate_are_isolated_per_user(): void
    {
        $u = User::factory()->create();
        $other = User::factory()->create();
        $a = $this->upload($u, $this->png(40, 40));
        $sys = LibraryAsset::where('key', 'hat_cap')->firstOrFail();

        $this->post("/api/library/assets/{$a['id']}/file", ['file' => $this->png(10, 10)], $this->h($other))->assertNotFound();
        $this->post("/api/library/assets/{$sys->id}/file", ['file' => $this->png(10, 10)], $this->h($u))->assertNotFound(); // system assets are read-only
        $this->postJson("/api/library/assets/{$a['id']}/duplicate", [], $this->h($other))->assertNotFound();               // someone else's private asset
        $this->assertSame(40, LibraryAsset::find($a['id'])->width);
    }

    public function test_duplicate_makes_an_editable_copy_of_a_system_asset(): void
    {
        $u = User::factory()->create();
        $sys = LibraryAsset::where('key', 'glasses_round')->firstOrFail();

        $copy = $this->postJson("/api/library/assets/{$sys->id}/duplicate", [], $this->h($u))->assertCreated()->json('data');
        $this->assertSame(['Kacamata bulat (salinan)', true, 'upload', 'glasses', true], [$copy['name'], $copy['mine'], $copy['source'], $copy['category'], $copy['tintable']]);
        $this->assertSame($sys->hash, $copy['hash']);
        $this->assertNotSame($sys->path, LibraryAsset::find($copy['id'])->path);

        // the copy can now be edited (replaced) and renamed; the original is untouched
        $this->post("/api/library/assets/{$copy['id']}/file", ['file' => $this->svg('<path d="M1 1L9 9" fill="#0f0"/>')], $this->h($u))->assertOk();
        $this->patchJson("/api/library/assets/{$copy['id']}", ['name' => 'Kacamata saya'], $this->h($u))->assertOk()->assertJsonPath('data.name', 'Kacamata saya');
        $this->assertSame($sys->hash, LibraryAsset::find($sys->id)->hash);
    }

    public function test_category_change_rules(): void
    {
        $u = User::factory()->create();
        $a = $this->upload($u, $this->png(30, 30), 'hat');

        $this->patchJson("/api/library/assets/{$a['id']}", ['category' => 'glasses'], $this->h($u))->assertOk()->assertJsonPath('data.category', 'glasses');
        $this->patchJson("/api/library/assets/{$a['id']}", ['category' => 'bg_home'], $this->h($u))->assertStatus(422);   // part <-> location
        $this->patchJson("/api/library/assets/{$a['id']}", ['category' => 'nope'], $this->h($u))->assertStatus(422);

        $this->postJson('/api/builder/characters', ['name' => 'X', 'config' => $this->config(['glasses' => ['assetId' => $a['id']]])], $this->h($u))->assertCreated();
        $this->patchJson("/api/library/assets/{$a['id']}", ['category' => 'hat'], $this->h($u))->assertStatus(409);        // pinned by a version
        $this->patchJson("/api/library/assets/{$a['id']}", ['name' => 'Baru', 'tags' => 'a, b'], $this->h($u))->assertOk()->assertJsonPath('data.tags', ['a', 'b']);
    }

    public function test_reference_categories_hold_whole_figures_but_are_not_builder_parts_or_ai_targets(): void
    {
        $u = User::factory()->create();
        $cats = collect($this->getJson('/api/library/categories', $this->h($u))->json('data'))->keyBy('slug');
        $this->assertSame(['reference', 'reference'], [$cats['pose']['kind'], $cats['expression_ref']['kind']]);

        $ref = $this->upload($u, $this->png(120, 300), 'pose', 'Pose berdiri');
        $this->assertSame('pose', $ref['category']);
        $this->assertSame(['Pose berdiri'], array_column($this->getJson('/api/library/assets?kind=reference', $this->h($u))->json('data'), 'name'));
        $this->assertSame([], array_filter($this->getJson('/api/library/assets?kind=part&mine=1', $this->h($u))->json('data'), fn ($a) => $a['category'] === 'pose'));

        // a reference image cannot be placed in a character slot, and AI does not generate references
        $this->postJson('/api/builder/characters', ['name' => 'X', 'config' => $this->config(['pose' => ['assetId' => $ref['id']]])], $this->h($u))->assertStatus(422);
        $this->postJson('/api/projects', ['name' => 'P'], $this->h($u));
        config(['services.ai.api_key' => 'k']);
        $this->postJson('/api/library/ai/generate', ['category' => 'pose', 'prompt' => 'pose berlari'], $this->h($u))->assertStatus(422);
        // moving between kinds stays forbidden
        $this->patchJson("/api/library/assets/{$ref['id']}", ['category' => 'hat'], $this->h($u))->assertStatus(422);
    }

    public function test_body_kit_slots_are_stacked_between_the_skirt_and_the_top_and_legs_only_body_exists(): void
    {
        $u = User::factory()->create();
        $cats = collect($this->getJson('/api/library/categories', $this->h($u))->json('data'))->where('kind', 'part')->keyBy('slug');
        // torso above the skirt/trousers, arms above the torso but BELOW the top (sleeves cover the upper arm), then bag/face...
        $this->assertTrue($cats['bottom']['z_order'] < $cats['torso']['z_order']);
        $this->assertTrue($cats['torso']['z_order'] < $cats['arm_l']['z_order']);
        $this->assertSame($cats['arm_l']['z_order'], $cats['arm_r']['z_order']);
        $this->assertTrue($cats['arm_l']['z_order'] < $cats['top']['z_order']);
        $this->assertTrue($cats['top']['z_order'] < $cats['face']['z_order']);
        // z orders are unique per layer except the two arms, so the relative order never depends on tie-breaking
        $z = $cats->pluck('z_order')->all();
        $this->assertCount(count($z) - 1, array_unique($z));

        $legs = collect($this->getJson('/api/library/assets?category=body', $this->h($u))->json('data'))->firstWhere('key', 'body_legs');
        $this->assertNotNull($legs);
        $this->assertSame([400, 800, true], [$legs['width'], $legs['height'], $legs['tintable']]);

        // a character can be built from the kit slots (torso + both arms + legs-only body)
        $mk = fn (string $slot) => $this->post('/api/library/assets', ['file' => $this->png(800, 1600), 'category' => $slot, 'name' => $slot], $this->h($u))->assertCreated()->json('data.id');
        $parts = ['body' => ['assetId' => LibraryAsset::where('key', 'body_legs')->value('id')], 'face' => ['assetId' => LibraryAsset::where('key', 'face_round')->value('id')],
            'torso' => ['assetId' => $mk('torso')], 'arm_l' => ['assetId' => $mk('arm_l')], 'arm_r' => ['assetId' => $mk('arm_r')]];
        $this->postJson('/api/builder/characters', ['name' => 'Kit', 'config' => $this->config($parts)], $this->h($u))->assertCreated();
        // an arm asset cannot be put in the other arm's slot
        $parts['arm_r'] = ['assetId' => $parts['arm_l']['assetId']];
        $this->postJson('/api/builder/characters', ['name' => 'Kit2', 'config' => $this->config($parts)], $this->h($u))->assertStatus(422);
    }
}

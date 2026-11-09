<?php

namespace Tests\Feature;

use App\Models\AssetCategory;
use App\Models\LibraryAsset;
use App\Models\User;
use App\Services\Library\RasterAssetGenerator;
use App\Services\Library\SlotTemplate;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/** Every body part is stored in one standard format (shared canvas, fixed frame per slot), has a facing, and is generated with one master style. */
class PartFormatTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        $this->seed(\Database\Seeders\LibrarySeeder::class);
    }

    private function h(?User $u = null): array
    {
        $this->app['auth']->forgetGuards();

        return ['Authorization' => 'Bearer '.($u ?? User::factory()->create())->createToken('t')->plainTextToken, 'Accept' => 'application/json'];
    }

    private function png(int $w, int $h): UploadedFile
    {
        $im = imagecreatetruecolor($w, $h);
        imagefill($im, 0, 0, imagecolorallocate($im, 200, 40, 40));
        $p = tempnam(sys_get_temp_dir(), 'p').'.png';
        imagepng($im, $p);

        return new UploadedFile($p, 'p.png', 'image/png', null, true);
    }

    public function test_any_size_raster_lands_in_the_slot_frame_of_the_standard_canvas(): void
    {
        $out = SlotTemplate::conform('face', file_get_contents($this->png(300, 400)->getRealPath()), 'image/png', 300, 400);
        $this->assertSame([800, 1600], [$out['width'], $out['height']]);
        $img = imagecreatefromstring($out['content']);
        $f = SlotTemplate::frame('face', 300, 400);
        $alpha = fn (int $x, int $y) => (imagecolorat($img, $x, $y) >> 24) & 0x7F;
        $this->assertSame(0, $alpha((int) (($f['x'] + $f['w'] / 2) * 2), (int) (($f['y'] + $f['h'] / 2) * 2)), 'opaque at the frame centre');
        $this->assertSame(127, $alpha(2, 2), 'transparent far from the frame');
        $this->assertSame(127, $alpha(798, 1598));
        $this->assertLessThanOrEqual(170 + 0.01, $f['w']);
        $this->assertEqualsWithDelta(200, $f['x'] + $f['w'] / 2, 0.01);
        $this->assertEqualsWithDelta(190, $f['y'] + $f['h'] / 2, 0.01);
    }

    public function test_art_already_on_the_standard_canvas_is_left_alone(): void
    {
        $this->assertNull(SlotTemplate::conform('top', 'x', 'image/png', 800, 1600));
        $this->assertNull(SlotTemplate::conform('top', 'x', 'image/png', 400, 800));
        $this->assertNull(SlotTemplate::conform('nonsense', 'x', 'image/png', 10, 10));
    }

    public function test_svg_is_nested_in_a_400x800_svg_and_keeps_its_tint_regions(): void
    {
        $svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50"><path data-tint="hair" fill="#000" d="M0 0h100v50z"/></svg>';
        $out = SlotTemplate::conform('hat', $svg, 'image/svg+xml', 100, 50);
        $this->assertSame([400, 800], [$out['width'], $out['height']]);
        $this->assertStringContainsString('viewBox="0 0 400 800"', $out['content']);
        $this->assertStringContainsString('data-tint="hair"', $out['content']);
        $f = SlotTemplate::frame('hat', 100, 50);
        $this->assertStringContainsString('x="'.round($f['x'], 2).'"', $out['content']);
        $this->assertNotFalse(simplexml_load_string($out['content']));
    }

    public function test_uploads_are_conformed_and_remember_their_view(): void
    {
        $u = User::factory()->create();
        $r = $this->post('/api/library/assets', ['file' => $this->png(60, 80), 'category' => 'hat', 'name' => 'Topi samping', 'view' => 'right'], $this->h($u))->assertCreated();
        $this->assertSame([800, 1600], [$r->json('data.width'), $r->json('data.height')]);
        $this->assertSame('right', $r->json('data.view'));
        $front = $this->post('/api/library/assets', ['file' => $this->png(60, 80), 'category' => 'hat', 'name' => 'Topi depan'], $this->h($u))->assertCreated();
        $this->assertSame('front', $front->json('data.view'));

        $names = fn (string $v) => collect($this->getJson("/api/library/assets?category=hat&mine=1&view=$v", $this->h($u))->json('data'))->pluck('name')->all();
        $this->assertSame(['Topi samping'], $names('right'));
        $this->assertSame(['Topi depan'], $names('front'));
        $this->assertSame([], $names('back'));
        $this->post('/api/library/assets', ['file' => $this->png(60, 80), 'category' => 'hat', 'name' => 'x', 'view' => 'up'], $this->h($u))->assertStatus(422);
    }

    public function test_backgrounds_are_not_conformed(): void
    {
        $u = User::factory()->create();
        $r = $this->post('/api/library/assets', ['file' => $this->png(160, 90), 'category' => 'bg_school', 'name' => 'Latar'], $this->h($u))->assertCreated();
        $this->assertSame([160, 90], [$r->json('data.width'), $r->json('data.height')]);
    }

    public function test_character_facing_is_saved_in_the_config(): void
    {
        $u = User::factory()->create();
        $cfg = fn (array $extra = []) => ['schema_version' => 1, 'view' => 'full', 'palette' => ['skin' => '#f1c7a0', 'hair' => '#1f1b24', 'top' => '#f4f6fa', 'bottom' => '#34456a', 'hijab' => '#f1f1f5', 'tie' => '#3f5f86', 'eye' => '#3a2b2b', 'shoe' => '#2b2b33', 'accent' => '#2e3440'], 'parts' => []] + $extra;
        $r = $this->post('/api/builder/characters', ['name' => 'Samping', 'config' => json_encode($cfg(['facing' => 'right']))], $this->h($u))->assertCreated();
        $this->assertSame('right', $r->json('data.config.facing'));
        $r = $this->post('/api/builder/characters', ['name' => 'Depan', 'config' => json_encode($cfg(['facing' => 'front']))], $this->h($u))->assertCreated();
        $this->assertArrayNotHasKey('facing', $r->json('data.config'));
        $this->post('/api/builder/characters', ['name' => 'Salah', 'config' => json_encode($cfg(['facing' => 'up']))], $this->h($u))->assertStatus(422);
    }

    public function test_shoe_pairs_become_one_mirrored_shoe_and_old_characters_stay_editable(): void
    {
        $u = User::factory()->create();
        $shoes = AssetCategory::where('slug', 'shoes')->firstOrFail();
        // a pair on the standard canvas: a red block under the left leg and one under the right leg
        $im = imagecreatetruecolor(800, 1600);
        imagealphablending($im, false);
        imagesavealpha($im, true);
        imagefill($im, 0, 0, imagecolorallocatealpha($im, 0, 0, 0, 127));
        imagefilledrectangle($im, 300, 1500, 360, 1560, imagecolorallocate($im, 200, 20, 20));
        imagefilledrectangle($im, 440, 1500, 500, 1560, imagecolorallocate($im, 200, 20, 20));
        ob_start();
        imagepng($im);
        $pair = \App\Http\Controllers\LibraryController::persistAsset($u->id, $shoes, 'Sepatu Uji (sepasang)', [], 'upload', 'approved', (string) ob_get_clean(), 'image/png', 'png', 800, 1600, false);
        $this->assertSame('pending', $pair->status, 'a pair is outside the measured area of single shoes: the template check holds it');
        $pair->update(['status' => 'approved']); // an older, already approved pair

        // a character that already uses the pair
        $cfg = ['schema_version' => 1, 'view' => 'full', 'palette' => ['skin' => '#f1c7a0', 'hair' => '#1f1b24', 'top' => '#f4f6fa', 'bottom' => '#34456a', 'hijab' => '#f1f1f5', 'tie' => '#3f5f86', 'eye' => '#3a2b2b', 'shoe' => '#2b2b33', 'accent' => '#2e3440'], 'parts' => ['shoes' => ['assetId' => $pair->id, 'dx' => 0, 'dy' => 0, 'scale' => 1]]];
        $made = $this->post('/api/builder/characters', ['name' => 'Pakai pasangan', 'config' => json_encode($cfg)], $this->h($u))->assertCreated();

        $this->artisan('library:single-shoes')->assertSuccessful();

        $pair->refresh();
        $this->assertNotNull($pair->archived_at);
        $single = LibraryAsset::where('user_id', $u->id)->where('name', 'Sepatu Uji (satu, dicerminkan)')->whereNull('archived_at')->firstOrFail();
        $this->assertEqualsWithDelta(165, $single->meta['mirror']['px'], 0.1); // centre of the left block, canvas units
        $this->assertEqualsWithDelta(765, $single->meta['mirror']['py'], 0.1);
        $img = imagecreatefromstring(Storage::disk('local')->get($single->path));
        $alpha = fn (int $x, int $y) => (imagecolorat($img, $x, $y) >> 24) & 0x7F;
        $this->assertSame(0, $alpha(330, 1530), 'the left shoe is kept');
        $this->assertSame(127, $alpha(470, 1530), 'the right shoe is gone (it is the mirror of the left one)');
        $this->assertSame(165.0, (float) $this->getJson('/api/library/assets?category=shoes&mine=1', $this->h($u))->json('data.0.mirror.px'));

        // the character that used the pair can still be saved as a new version
        $id = $made->json('data.id');
        $this->postJson("/api/builder/characters/$id/versions", ['config' => json_encode($cfg), 'note' => 'lagi'], $this->h($u))->assertCreated();
        // ...but nobody new can pick the archived pair
        $this->post('/api/builder/characters', ['name' => 'Baru', 'config' => json_encode($cfg)], $this->h($u))->assertStatus(422);

        // the single shoe goes in "shoes" (left foot) and again in "shoes_r" (right foot) with its own placement
        $both = $cfg;
        $both['parts'] = ['shoes' => ['assetId' => $single->id, 'dx' => 0, 'dy' => 0, 'scale' => 1], 'shoes_r' => ['assetId' => $single->id, 'dx' => 7, 'dy' => -3, 'scale' => 1.2]];
        $r = $this->post('/api/builder/characters', ['name' => 'Dua kaki', 'config' => json_encode($both)], $this->h($u))->assertCreated();
        $this->assertSame($single->id, $r->json('data.config.parts.shoes_r.assetId'));
        $this->assertEquals(7, $r->json('data.config.parts.shoes_r.dx'));
        $hat = AssetCategory::where('slug', 'hat')->firstOrFail();
        $cap = \App\Http\Controllers\LibraryController::persistAsset($u->id, $hat, 'Topi', [], 'upload', 'approved', file_get_contents($this->png(50, 50)->getRealPath()), 'image/png', 'png', 50, 50, false);
        $both['parts']['shoes_r']['assetId'] = $cap->id; // not a shoe
        $this->post('/api/builder/characters', ['name' => 'Salah', 'config' => json_encode($both)], $this->h($u))->assertStatus(422);
    }

    public function test_back_heads_are_registered_once_from_the_rear_view_hair_drawings(): void
    {
        $u = User::factory()->create();
        $hairBack = AssetCategory::where('slug', 'hair_back')->firstOrFail();
        foreach ([1, 2, 3] as $i) {
            \App\Http\Controllers\LibraryController::persistAsset($u->id, $hairBack, "Rambut belakang $i", [], 'upload', 'approved', file_get_contents($this->png(800, 1600)->getRealPath()), 'image/png', 'png', 800, 1600, false);
        }
        \App\Http\Controllers\LibraryController::persistAsset($u->id, $hairBack, 'Rambut belakang panjang', [], 'upload', 'approved', file_get_contents($this->png(800, 1600)->getRealPath()), 'image/png', 'png', 800, 1600, false);
        $this->artisan('library:back-heads')->assertSuccessful();
        $this->artisan('library:back-heads')->assertSuccessful(); // idempotent
        $heads = LibraryAsset::where('user_id', $u->id)->where('name', 'like', 'Kepala belakang%')->get();
        $this->assertCount(3, $heads); // the named-by-style one is not a rear view
        foreach ($heads as $h) {
            $this->assertSame('hair_front', $h->category->slug);
            $this->assertSame('back', $h->meta['view']);
        }
    }

    public function test_head_fit_is_saved_and_validated(): void
    {
        $u = User::factory()->create();
        $cfg = fn (array $extra = []) => ['schema_version' => 1, 'view' => 'full', 'palette' => ['skin' => '#f1c7a0', 'hair' => '#1f1b24', 'top' => '#f4f6fa', 'bottom' => '#34456a', 'hijab' => '#f1f1f5', 'tie' => '#3f5f86', 'eye' => '#3a2b2b', 'shoe' => '#2b2b33', 'accent' => '#2e3440'], 'parts' => []] + $extra;
        $fit = ['s' => 0.78, 'nx' => 200, 'ny' => 300.5, 'jx' => 200, 'jy' => 211, 'evil' => 'x'];
        $r = $this->post('/api/builder/characters', ['name' => 'Kit', 'config' => json_encode($cfg(['headFit' => $fit]))], $this->h($u))->assertCreated();
        $this->assertEquals(['s' => 0.78, 'nx' => 200, 'ny' => 300.5, 'jx' => 200, 'jy' => 211], $r->json('data.config.headFit'));
        $this->post('/api/builder/characters', ['name' => 'Salah', 'config' => json_encode($cfg(['headFit' => ['s' => 9, 'nx' => 0, 'ny' => 0, 'jx' => 0, 'jy' => 0]]))], $this->h($u))->assertStatus(422);
        $this->post('/api/builder/characters', ['name' => 'Salah2', 'config' => json_encode($cfg(['headFit' => ['s' => 0.8]]))], $this->h($u))->assertStatus(422);
    }

    public function test_ai_prompt_uses_the_master_style_view_and_the_slot_template(): void
    {
        $p = (new RasterAssetGenerator)->prompt(AssetCategory::where('slug', 'hair_front')->firstOrFail(), 'long black hair with side bangs', 'left', 'female, teenager, slim');
        $this->assertStringContainsString('MASTER ART STYLE - CONSISTENT JAPANESE ANIME', $p);
        $this->assertStringContainsString('no chibi style', $p);
        $this->assertStringContainsString("facing the viewer's left", $p);
        $this->assertStringContainsString('[CHARACTER]: female, teenager, slim', $p);
        $this->assertStringContainsString('long black hair with side bangs', $p);
        $this->assertStringContainsString('400x800', $p);
        $this->assertStringContainsString('replace any other', $p);
        $bg = (new RasterAssetGenerator)->prompt(AssetCategory::where('slug', 'bg_school')->firstOrFail(), 'canteen');
        $this->assertStringContainsString('MASTER ART STYLE', $bg);
        $this->assertStringContainsString('canteen', $bg);
    }

    public function test_slot_template_mirrors_the_frontend_anchors(): void
    {
        $ts = file_get_contents(base_path('../frontend/src/builder/spec.ts'));
        preg_match_all('/(\w+): \{ cx: (\d+), cy: (\d+), maxW: (\d+) \}/', $ts, $m, PREG_SET_ORDER);
        $this->assertNotEmpty($m);
        foreach ($m as [, $slot, $cx, $cy, $maxW]) {
            $this->assertSame(['cx' => (int) $cx, 'cy' => (int) $cy, 'maxW' => (int) $maxW], SlotTemplate::ANCHORS[$slot] ?? null, "anchor of $slot differs from spec.ts");
        }
        $this->assertCount(count(SlotTemplate::ANCHORS), $m);
    }

    public function test_kit_views_are_imported_once_in_the_standard_format_and_linked_by_set(): void
    {
        $u = User::factory()->create();
        $this->artisan('library:import-views', ['--user' => $u->id])->assertSuccessful();
        $imported = LibraryAsset::where('user_id', $u->id)->whereNotNull('meta->set')->get();
        $this->assertCount(36, $imported); // 3 kits x 3 views x 4 slots
        foreach ($imported as $a) {
            $this->assertSame([800, 1600], [$a->width, $a->height]);
            $this->assertContains($a->meta['view'], ['right', 'left', 'back']);
            $this->assertStringStartsWith('kit:', $a->meta['set']);
        }
        $top = $imported->filter(fn ($a) => $a->meta['set'] === 'kit:laki_laki_anime:top');
        $this->assertSame(['back', 'left', 'right'], $top->pluck('meta.view')->sort()->values()->all());

        $this->artisan('library:import-views', ['--user' => $u->id])->assertSuccessful(); // idempotent
        $this->assertCount(36, LibraryAsset::where('user_id', $u->id)->whereNotNull('meta->set')->get());
        $this->assertSame('right', $this->getJson('/api/library/assets?category=top&mine=1&view=right', $this->h($u))->json('data.0.view'));
    }

    public function test_every_library_part_is_in_the_standard_format_after_conform(): void
    {
        $this->artisan('library:conform')->assertSuccessful();
        foreach (LibraryAsset::with('category')->whereNull('archived_at')->get() as $a) {
            if ($a->category->kind === 'part') {
                $this->assertTrue(SlotTemplate::isFullCanvas($a->width, $a->height), "#{$a->id} {$a->name} {$a->width}x{$a->height}");
            }
        }
    }
}

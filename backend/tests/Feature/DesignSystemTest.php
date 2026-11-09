<?php

namespace Tests\Feature;

use App\Models\AssetCategory;
use App\Models\LibraryAsset;
use App\Models\User;
use App\Services\Library\AssetValidator;
use App\Services\Library\DesignTemplate;
use App\Services\Library\SlotTemplate;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/** The design template (canvas, landmarks, slot regions), asset validation, and template compatibility. */
class DesignSystemTest extends TestCase
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

    /** A 800x1600 transparent canvas with one filled box (canvas units) in it; `opaque` fills the whole canvas instead. */
    private function canvas(?array $box, bool $opaque = false): string
    {
        $im = imagecreatetruecolor(800, 1600);
        imagealphablending($im, false);
        imagesavealpha($im, true);
        imagefill($im, 0, 0, $opaque ? imagecolorallocate($im, 255, 255, 255) : imagecolorallocatealpha($im, 0, 0, 0, 127));
        if ($box) {
            imagefilledrectangle($im, $box[0] * 2, $box[1] * 2, $box[2] * 2 - 1, $box[3] * 2 - 1, imagecolorallocate($im, 200, 40, 40));
        }
        ob_start();
        imagepng($im);

        return (string) ob_get_clean();
    }

    private function file(string $png): UploadedFile
    {
        $p = tempnam(sys_get_temp_dir(), 'd').'.png';
        file_put_contents($p, $png);

        return new UploadedFile($p, 'p.png', 'image/png', null, true);
    }

    private function codes(array $report, string $kind = 'errors'): array
    {
        return array_column($report[$kind], 'code');
    }

    public function test_template_describes_the_canvas_every_slot_and_matches_the_slot_constants(): void
    {
        $t = DesignTemplate::load();
        $this->assertSame([400, 800], [$t->canvasWidth(), $t->canvasHeight()]);
        $this->assertSame(['front', 'right', 'left', 'back'], $t->data['views']);
        $this->assertSame(array_keys(SlotTemplate::ANCHORS), array_keys($t->data['slots']));
        foreach (SlotTemplate::ANCHORS as $slot => $a) {
            $this->assertSame(['x' => $a['cx'], 'y' => $a['cy']], $t->anchor($slot), "anchor of $slot");
            $this->assertSame($a['maxW'], $t->data['slots'][$slot]['max_width']);
        }
        $this->assertSame(200, $t->data['canvas']['centerline_x']);
        $this->assertNotNull($t->landmark('head.neck_anchor'));
        $this->assertNotNull($t->view('face', 'front')['region']);
        $this->assertNull($t->view('face', 'back'), 'a view with no measured example stays unmeasured');
        $this->assertFalse(DesignTemplate::exists('../etc/passwd'));
        $this->assertTrue(DesignTemplate::exists('anime-v1'));
    }

    public function test_a_well_placed_part_passes(): void
    {
        $r = (new AssetValidator)->validate($this->canvas([115, 100, 285, 380]), 'image/png', 800, 1600, 'face', 'front');
        $this->assertTrue($r['ok'], json_encode($r['errors']));
        $this->assertSame([115, 100, 285, 380], $r['metrics']['bbox']);
    }

    public function test_art_outside_the_slot_region_is_an_error_with_a_reason(): void
    {
        $r = (new AssetValidator)->validate($this->canvas([10, 700, 80, 780]), 'image/png', 800, 1600, 'face', 'front');
        $this->assertFalse($r['ok']);
        $this->assertContains('region', $this->codes($r));
        $this->assertStringContainsString('keluar dari area face arah front', $r['errors'][0]['message']);
    }

    public function test_a_part_without_transparency_or_without_pixels_is_refused(): void
    {
        $v = new AssetValidator;
        $this->assertContains('alpha', $this->codes($v->validate($this->canvas(null, true), 'image/png', 800, 1600, 'face')));
        $this->assertContains('empty', $this->codes($v->validate($this->canvas(null), 'image/png', 800, 1600, 'face')));
    }

    public function test_wrong_canvas_unknown_view_and_unknown_slot_are_reported(): void
    {
        $v = new AssetValidator;
        $im = imagecreatetruecolor(300, 300);
        ob_start();
        imagepng($im);
        $this->assertContains('canvas', $this->codes($v->validate((string) ob_get_clean(), 'image/png', 300, 300, 'face')));
        $this->assertContains('view', $this->codes($v->validate($this->canvas([115, 100, 285, 380]), 'image/png', 800, 1600, 'face', 'up')));
        $this->assertContains('slot', $this->codes($v->validate($this->canvas([115, 100, 285, 380]), 'image/png', 800, 1600, 'bg_school')));
    }

    public function test_a_size_far_from_the_approved_ones_warns_and_an_unmeasured_view_is_said_so(): void
    {
        $v = new AssetValidator;
        $r = $v->validate($this->canvas([190, 98, 210, 110]), 'image/png', 800, 1600, 'face', 'front'); // tiny face, top of the head where it belongs
        $this->assertTrue($r['ok']);
        $this->assertContains('size', $this->codes($r, 'warnings'));
        $back = $v->validate($this->canvas([115, 100, 285, 380]), 'image/png', 800, 1600, 'face', 'back');
        $this->assertContains('unmeasured', $this->codes($back, 'warnings'));
    }

    public function test_svg_parts_are_checked_for_the_canvas_only(): void
    {
        $r = (new AssetValidator)->validate('<svg viewBox="0 0 400 800"/>', 'image/svg+xml', 400, 800, 'hat');
        $this->assertTrue($r['ok']);
        $this->assertContains('vector', $this->codes($r, 'warnings'));
    }

    public function test_uploads_are_validated_and_a_failing_one_is_held_for_review_instead_of_approved(): void
    {
        $u = User::factory()->create();
        $good = $this->post('/api/library/assets', ['file' => $this->file($this->canvas([115, 100, 285, 380])), 'category' => 'face', 'name' => 'Wajah bagus'], $this->h($u))->assertCreated();
        $this->assertSame('approved', $good->json('data.status'));
        $this->assertTrue($good->json('data.validation.ok'));
        $this->assertSame('anime-v1', $good->json('data.template'));

        $bad = $this->post('/api/library/assets', ['file' => $this->file($this->canvas([10, 700, 80, 780])), 'category' => 'face', 'name' => 'Wajah salah'], $this->h($u))->assertCreated();
        $this->assertSame('pending', $bad->json('data.status'), 'not approved automatically');
        $this->assertFalse($bad->json('data.validation.ok'));
        $this->assertTrue($bad->json('data.validation.held'));
        $this->assertSame('region', $bad->json('data.validation.errors.0.code'));

        // pending parts cannot be used in a character until the author approves them
        $cfg = fn (int $id) => ['schema_version' => 1, 'view' => 'full', 'palette' => ['skin' => '#f1c7a0', 'hair' => '#1f1b24', 'top' => '#f4f6fa', 'bottom' => '#34456a', 'hijab' => '#f1f1f5', 'tie' => '#3f5f86', 'eye' => '#3a2b2b', 'shoe' => '#2b2b33', 'accent' => '#2e3440'], 'parts' => ['face' => ['assetId' => $id, 'dx' => 0, 'dy' => 0, 'scale' => 1]]];
        $this->post('/api/builder/characters', ['name' => 'X', 'config' => json_encode($cfg($bad->json('data.id')))], $this->h($u))->assertStatus(422);
        $this->post('/api/builder/characters', ['name' => 'Y', 'config' => json_encode($cfg($good->json('data.id')))], $this->h($u))->assertCreated();

        $this->patchJson('/api/library/assets/'.$bad->json('data.id'), ['status' => 'approved'], $this->h($u))->assertOk()->assertJsonPath('data.status', 'approved'); // the author's call
    }

    public function test_duplicates_are_flagged_and_validation_can_be_rerun(): void
    {
        $u = User::factory()->create();
        $png = $this->canvas([115, 100, 285, 380]);
        $first = $this->post('/api/library/assets', ['file' => $this->file($png), 'category' => 'face', 'name' => 'A'], $this->h($u))->assertCreated();
        $second = $this->post('/api/library/assets', ['file' => $this->file($png), 'category' => 'face', 'name' => 'B'], $this->h($u))->assertCreated();
        $this->assertContains('duplicate', array_column($second->json('data.validation.warnings'), 'code'));
        $this->assertSame('approved', $second->json('data.status'), 'a duplicate only warns');

        $again = $this->postJson('/api/library/assets/'.$first->json('data.id').'/validate', [], $this->h($u))->assertOk();
        $this->assertTrue($again->json('report.ok'));
        $this->assertContains('duplicate', array_column($again->json('report.warnings'), 'code'));

        $other = User::factory()->create();
        $this->postJson('/api/library/assets/'.$first->json('data.id').'/validate', [], $this->h($other))->assertNotFound();
        $bg = $this->post('/api/library/assets', ['file' => $this->file($this->canvas([0, 0, 50, 50])), 'category' => 'bg_school', 'name' => 'Latar'], $this->h($u))->assertCreated();
        $this->postJson('/api/library/assets/'.$bg->json('data.id').'/validate', [], $this->h($u))->assertStatus(422);
    }

    public function test_a_part_made_for_another_template_is_refused_with_the_reason_and_alternatives(): void
    {
        $u = User::factory()->create();
        $good = $this->post('/api/library/assets', ['file' => $this->file($this->canvas([115, 100, 285, 380])), 'category' => 'face', 'name' => 'Wajah anime'], $this->h($u))->assertCreated();
        $chibi = LibraryAsset::find($good->json('data.id'))->replicate();
        $chibi->name = 'Wajah chibi';
        $chibi->meta = ($chibi->meta ?? []) + ['template' => 'chibi-v1'];
        $chibi->hash = str_repeat('c', 64);
        $chibi->save();

        $cfg = ['schema_version' => 1, 'view' => 'full', 'palette' => ['skin' => '#f1c7a0', 'hair' => '#1f1b24', 'top' => '#f4f6fa', 'bottom' => '#34456a', 'hijab' => '#f1f1f5', 'tie' => '#3f5f86', 'eye' => '#3a2b2b', 'shoe' => '#2b2b33', 'accent' => '#2e3440'], 'parts' => ['face' => ['assetId' => $chibi->id, 'dx' => 0, 'dy' => 0, 'scale' => 1]]];
        $r = $this->post('/api/builder/characters', ['name' => 'Campur', 'config' => json_encode($cfg)], $this->h($u))->assertStatus(422);
        $this->assertStringContainsString('chibi-v1', $r->json('message'));
        $this->assertStringContainsString('anime-v1', $r->json('message'));
        $this->assertContains(['id' => $good->json('data.id'), 'name' => 'Wajah anime'], $r->json('alternatives')); // compatible faces are offered (the seeded ones too)
        $this->assertNotContains($chibi->id, array_column($r->json('alternatives'), 'id'));

        $this->post('/api/builder/characters', ['name' => 'Salah', 'config' => json_encode($cfg + ['template' => 'tidak-ada'])], $this->h($u))->assertStatus(422)->assertSee('tidak dikenal');
    }

    public function test_audit_command_runs_over_the_library(): void
    {
        $u = User::factory()->create();
        $this->post('/api/library/assets', ['file' => $this->file($this->canvas([10, 700, 80, 780])), 'category' => 'face', 'name' => 'Salah'], $this->h($u))->assertCreated();
        $this->artisan('library:validate', ['--category' => 'face'])->expectsOutputToContain('keluar dari area face')->assertSuccessful();
        $this->assertNotNull(LibraryAsset::where('name', 'Salah')->first()->meta['validation']);
    }
}

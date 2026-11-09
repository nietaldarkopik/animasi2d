<?php

namespace Tests\Feature;

use App\Models\LibraryAsset;
use App\Models\User;
use App\Services\Library\AnchorExtractor;
use App\Services\Library\AssetValidator;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/** Named attachment points: measured from the art, compared with the template, used to align a freshly picked part. */
class AnchorTest extends TestCase
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

    /** 800x1600 transparent canvas with filled boxes given in canvas units */
    private function art(array ...$boxes): string
    {
        $im = imagecreatetruecolor(800, 1600);
        imagealphablending($im, false);
        imagesavealpha($im, true);
        imagefill($im, 0, 0, imagecolorallocatealpha($im, 0, 0, 0, 127));
        foreach ($boxes as $b) {
            imagefilledrectangle($im, $b[0] * 2, $b[1] * 2, $b[2] * 2 - 1, $b[3] * 2 - 1, imagecolorallocate($im, 30, 30, 30));
        }
        ob_start();
        imagepng($im);

        return (string) ob_get_clean();
    }

    private function file(string $png): UploadedFile
    {
        $p = tempnam(sys_get_temp_dir(), 'a').'.png';
        file_put_contents($p, $png);

        return new UploadedFile($p, 'p.png', 'image/png', null, true);
    }

    public function test_extracts_the_named_points_of_each_kind_of_part(): void
    {
        $eyes = AnchorExtractor::extract($this->art([150, 190, 182, 200], [218, 190, 250, 200]), 'eyes');
        $this->assertSame(['face.left_eye_anchor', 'face.right_eye_anchor'], array_keys($eyes));
        $this->assertEqualsWithDelta(166, $eyes['face.left_eye_anchor']['x'], 1);
        $this->assertEqualsWithDelta(234, $eyes['face.right_eye_anchor']['x'], 1);
        $this->assertEqualsWithDelta(195, $eyes['face.left_eye_anchor']['y'], 1);

        $face = AnchorExtractor::extract($this->art([115, 98, 285, 380]), 'face');
        $this->assertEqualsWithDelta(98, $face['head.top_anchor']['y'], 1);
        $this->assertEqualsWithDelta(200, $face['head.top_anchor']['x'], 1);
        $this->assertEqualsWithDelta(380, $face['head.neck_anchor']['y'], 1.5);

        $shoe = AnchorExtractor::extract($this->art([140, 725, 180, 790]), 'shoes');
        $this->assertEqualsWithDelta(725, $shoe['foot.ankle_anchor']['y'], 1);
        $this->assertEqualsWithDelta(790, $shoe['foot.ground_anchor']['y'], 1.5);

        $this->assertSame([], AnchorExtractor::extract($this->art(), 'face'), 'an empty image has no anchors');
        $this->assertSame([], AnchorExtractor::extract($this->art([1, 1, 9, 9]), 'bg_school'), 'a category without anchors');
    }

    public function test_alignment_is_the_shift_onto_the_templates_points_and_is_limited(): void
    {
        $expected = ['face.left_eye_anchor' => ['x' => 166.7, 'y' => 192.6], 'face.right_eye_anchor' => ['x' => 233.1, 'y' => 192.5]];
        $mine = ['face.left_eye_anchor' => ['x' => 160.7, 'y' => 198.6], 'face.right_eye_anchor' => ['x' => 227.1, 'y' => 198.5]];
        $this->assertSame(['dx' => 6.0, 'dy' => -6.0], AnchorExtractor::alignment('eyes', $mine, $expected));

        $this->assertNull(AnchorExtractor::alignment('eyes', ['face.left_eye_anchor' => ['x' => 166, 'y' => 193], 'face.right_eye_anchor' => ['x' => 233, 'y' => 192]], $expected), 'under 2 units: not worth moving');
        $this->assertNull(AnchorExtractor::alignment('top', $mine, $expected), 'a slot that is not aligned');
        $this->assertNull(AnchorExtractor::alignment('eyes', ['face.left_eye_anchor' => ['x' => 1, 'y' => 1]], $expected), 'an anchor is missing');
        $far = ['face.left_eye_anchor' => ['x' => 0, 'y' => 0], 'face.right_eye_anchor' => ['x' => 0, 'y' => 0]];
        $this->assertSame(['dx' => 30.0, 'dy' => 30.0], AnchorExtractor::alignment('eyes', $far, $expected), 'never more than 30 units');
    }

    public function test_the_validator_compares_anchors_with_the_template(): void
    {
        $v = new AssetValidator;
        // eyes where they belong: no remark. A little low: a warning that says how far to move. Far off: an error.
        $ok = $v->validate($this->art([150, 190, 182, 200], [218, 190, 250, 200]), 'image/png', 800, 1600, 'eyes');
        $this->assertSame([], array_column(array_filter($ok['warnings'], fn ($w) => $w['code'] === 'anchor'), 'code'));
        $this->assertTrue($ok['ok']);

        $low = $v->validate($this->art([150, 215, 182, 225], [218, 215, 250, 225]), 'image/png', 800, 1600, 'eyes');
        $this->assertTrue($low['ok']);
        $msgs = array_column(array_filter($low['warnings'], fn ($w) => $w['code'] === 'anchor'), 'message');
        $this->assertNotEmpty($msgs);
        $this->assertStringContainsString('face.left_eye_anchor', $msgs[0]);
        $this->assertStringContainsString('geser', $msgs[0]);

        // (the area rule already forbids art that is far away; a part inside the area but 45 units off is the anchor error)
        $this->assertArrayHasKey('anchors', $low['metrics']);
    }

    public function test_a_stored_part_knows_its_anchors_and_how_far_to_move(): void
    {
        $u = User::factory()->create();
        $r = $this->post('/api/library/assets', ['file' => $this->file($this->art([150, 215, 182, 225], [218, 215, 250, 225])), 'category' => 'eyes', 'name' => 'Mata rendah'], $this->h($u))->assertCreated();
        $this->assertEqualsWithDelta(232.5, $r->json('data.anchors')['face.left_eye_anchor']['y'] ?? 0, 30); // measured on the stored art
        $align = $r->json('data.align');
        $this->assertNotNull($align);
        $this->assertLessThan(0, $align['dy'], 'the eyes are below the template: move them up');

        $good = $this->post('/api/library/assets', ['file' => $this->file($this->art([150, 188, 182, 197], [218, 188, 250, 197])), 'category' => 'eyes', 'name' => 'Mata pas'], $this->h($u))->assertCreated();
        $this->assertNull($good->json('data.align'));

        $face = $this->post('/api/library/assets', ['file' => $this->file($this->art([115, 98, 285, 380])), 'category' => 'face', 'name' => 'Wajah'], $this->h($u))->assertCreated();
        $this->assertArrayHasKey('head.top_anchor', $face->json('data.anchors'));
    }

    public function test_backfill_command_measures_parts_that_have_no_anchors_yet(): void
    {
        $u = User::factory()->create();
        $r = $this->post('/api/library/assets', ['file' => $this->file($this->art([115, 98, 285, 380])), 'category' => 'face', 'name' => 'Lama'], $this->h($u))->assertCreated();
        $a = LibraryAsset::find($r->json('data.id'));
        $meta = $a->meta;
        unset($meta['anchors']);
        $a->update(['meta' => $meta]);

        $this->artisan('library:anchors')->assertSuccessful();
        $this->assertArrayHasKey('head.top_anchor', LibraryAsset::find($a->id)->meta['anchors']);
    }

    public function test_the_template_lists_what_each_slot_is_aligned_by(): void
    {
        $t = \App\Services\Library\DesignTemplate::load();
        $this->assertSame(['head.top_anchor'], $t->data['slots']['face']['align_by']);
        $this->assertSame(['torso.neck_anchor'], $t->data['slots']['top']['align_by']); // (compared within a design family only)
        $this->assertSame([], $t->data['slots']['hair_front']['align_by'], 'hair varies with its volume: not forced onto one number');
        $this->assertNotEmpty($t->view('eyes', 'front')['anchors']['face.left_eye_anchor'] ?? null);
        $this->assertSame(['warn' => 14, 'error' => 40], $t->data['anchor_tolerance']);
    }
}

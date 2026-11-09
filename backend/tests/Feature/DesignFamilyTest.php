<?php

namespace Tests\Feature;

use App\Models\LibraryAsset;
use App\Models\User;
use App\Services\Library\AssetValidator;
use App\Services\Library\DesignFamily;
use App\Services\Library\DesignTemplate;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/** Design families: labelled parts, family-specific anchor expectations, and which families fit together. */
class DesignFamilyTest extends TestCase
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

    private function art(array $box): string
    {
        $im = imagecreatetruecolor(800, 1600);
        imagealphablending($im, false);
        imagesavealpha($im, true);
        imagefill($im, 0, 0, imagecolorallocatealpha($im, 0, 0, 0, 127));
        imagefilledrectangle($im, $box[0] * 2, $box[1] * 2, $box[2] * 2 - 1, $box[3] * 2 - 1, imagecolorallocate($im, 30, 30, 30));
        ob_start();
        imagepng($im);

        return (string) ob_get_clean();
    }

    private function file(string $png): UploadedFile
    {
        $p = tempnam(sys_get_temp_dir(), 'f').'.png';
        file_put_contents($p, $png);

        return new UploadedFile($p, 'p.png', 'image/png', null, true);
    }

    public function test_families_are_guessed_from_the_name_of_a_part(): void
    {
        $cases = [
            'Kit SMA L1 (anime) – kemeja putih' => 'kit-l1', 'Kit SMA P3 (anime) – rok' => 'kit-p3', 'Kit SMA P2 (anime) – rok' => 'kit-p2', 'Kit SMA P – badan & kaki (untuk rok)' => 'kit-p',
            'Wajah laki-laki 05 - dagu v' => 'male', 'Atasan perempuan 03 - blus' => 'female', 'Badan perempuan - depan' => 'female',
            'Wajah 4' => 'legacy', 'Rambut depan 7' => 'legacy', 'Kemeja SMK saku' => 'legacy', 'Hoodie biru' => 'legacy',
            'Topi saya' => 'general', 'Mata 01 - bulat coklat' => 'general',
        ];
        foreach ($cases as $name => $family) {
            $this->assertSame($family, DesignFamily::infer($name), $name);
        }
        $this->assertSame('general', DesignFamily::infer('Wajah 4', 'face_round'), 'a seeded vector part is general, not a sheet part');
    }

    public function test_compatibility_is_symmetric_and_generic_parts_fit_everything(): void
    {
        $this->assertTrue(DesignFamily::compatible('male', 'kit-l1'));
        $this->assertTrue(DesignFamily::compatible('female', 'kit-p3'));
        $this->assertTrue(DesignFamily::compatible('kit-p2', 'kit-p3'));
        $this->assertFalse(DesignFamily::compatible('male', 'female'));
        $this->assertFalse(DesignFamily::compatible('kit-l1', 'kit-p2'));
        foreach (array_keys(DesignFamily::FAMILIES) as $f) {
            $this->assertTrue(DesignFamily::compatible($f, 'general'));
            $this->assertTrue(DesignFamily::compatible('legacy', $f));
            foreach (array_keys(DesignFamily::FAMILIES) as $g) {
                $this->assertSame(DesignFamily::compatible($f, $g), DesignFamily::compatible($g, $f), "$f / $g");
            }
        }
    }

    public function test_the_library_was_labelled_and_the_command_is_idempotent(): void
    {
        $u = User::factory()->create();
        $a = $this->post('/api/library/assets', ['file' => $this->file($this->art([115, 98, 285, 380])), 'category' => 'face', 'name' => 'Wajah perempuan 99'], $this->h($u))->assertCreated();
        $this->assertSame('female', $a->json('data.family'), 'labelled from the name when stored');
        $b = $this->post('/api/library/assets', ['file' => $this->file($this->art([116, 98, 285, 380])), 'category' => 'face', 'name' => 'Wajah bebas', 'family' => 'kit-p3'], $this->h($u))->assertCreated();
        $this->assertSame('kit-p3', $b->json('data.family'), 'an explicit family wins');
        $this->post('/api/library/assets', ['file' => $this->file($this->art([115, 98, 285, 380])), 'category' => 'face', 'name' => 'X', 'family' => 'alien'], $this->h($u))->assertStatus(422);

        $x = LibraryAsset::find($a->json('data.id'));
        $meta = $x->meta;
        unset($meta['family']);
        $x->update(['meta' => $meta]);
        $this->artisan('library:families')->assertSuccessful();
        $this->assertSame('female', LibraryAsset::find($x->id)->meta['family']);
        $this->assertSame('kit-p3', LibraryAsset::find($b->json('data.id'))->meta['family'], 'existing labels are kept');
    }

    public function test_the_template_expects_anchors_per_family_and_only_where_that_makes_sense(): void
    {
        $t = DesignTemplate::load();
        $male = $t->expectedAnchors('top', 'front', 'male');
        $this->assertEqualsWithDelta(306, $male['torso.neck_anchor']['y'], 8);
        $this->assertSame([], $t->expectedAnchors('top', 'front', 'general'), 'a mix of unrelated designs has no meaningful median');
        $this->assertSame([], $t->expectedAnchors('top', 'front', 'legacy'));
        $this->assertSame([], $t->expectedAnchors('top', 'front', 'kit-l1'), 'one example is not a standard');
        $this->assertSame([], $t->expectedAnchors('top', 'front', null));
        $this->assertNotEmpty($t->expectedAnchors('eyes', 'front', null), 'face parts are fixed by the head: the library-wide numbers do');
        $this->assertNotEmpty($t->expectedAnchors('eyes', 'front', 'general'));
        $this->assertSame([], $t->expectedAnchors('face', 'back', null), 'no measured example for that view');
    }

    public function test_a_garment_is_compared_with_its_own_family_only(): void
    {
        $v = new AssetValidator;
        // a "male" top whose collar sits 56 units higher than the male tops: an error; the same art as a "general" top: nothing to compare
        $high = $this->art([50, 250, 350, 560]);
        $male = $v->validate($high, 'image/png', 800, 1600, 'top', 'front', null, null, null, 'male');
        $this->assertContains('anchor', array_column($male['errors'], 'code'));
        $this->assertStringContainsString('torso.neck_anchor', $male['errors'][0]['message']);
        $general = $v->validate($high, 'image/png', 800, 1600, 'top', 'front', null, null, null, 'general');
        $this->assertNotContains('anchor', array_column($general['errors'], 'code'));
        $this->assertNotContains('anchor', array_column($general['warnings'], 'code'));
    }

    public function test_garments_and_shoes_are_aligned_vertically_only(): void
    {
        $this->assertSame(['dx' => 0.0, 'dy' => -12.0], \App\Services\Library\AnchorExtractor::alignment('top', ['torso.neck_anchor' => ['x' => 180, 'y' => 318]], ['torso.neck_anchor' => ['x' => 200, 'y' => 306]]));
        $this->assertSame(['dx' => 20.0, 'dy' => 0.0], \App\Services\Library\AnchorExtractor::alignment('mouth', ['face.mouth_anchor' => ['x' => 180, 'y' => 248]], ['face.mouth_anchor' => ['x' => 200, 'y' => 248]]));
    }

    public function test_the_design_template_endpoint_lists_the_families(): void
    {
        $r = $this->getJson('/api/design/template', $this->h())->assertOk();
        $this->assertSame('anime-v1', $r->json('data.id'));
        $this->assertSame(array_keys(DesignFamily::FAMILIES), array_keys($r->json('data.families')));
        $this->assertContains('kit-l1', $r->json('data.families.male.compatible'));
        $this->app['auth']->forgetGuards();
        $this->getJson('/api/design/template')->assertUnauthorized();
    }

    public function test_vrm_families_are_made_up_per_avatar_and_fit_only_themselves_and_generic_parts(): void
    {
        $this->assertTrue(DesignFamily::valid('vrm-avatarsample-m'));
        $this->assertFalse(DesignFamily::valid('vrm-'));
        $this->assertFalse(DesignFamily::valid('alien'));
        $this->assertTrue(DesignFamily::compatible('vrm-a', 'vrm-a'));
        $this->assertTrue(DesignFamily::compatible('vrm-a', 'general'));
        $this->assertTrue(DesignFamily::compatible('general', 'vrm-a'));
        $this->assertFalse(DesignFamily::compatible('vrm-a', 'vrm-b'));
        $this->assertFalse(DesignFamily::compatible('vrm-a', 'male'));
        $this->assertFalse(DesignFamily::compatible('female', 'vrm-a'));
    }
}

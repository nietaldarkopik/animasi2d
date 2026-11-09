<?php

namespace Tests\Feature;

use App\Models\LibraryAsset;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/** Parts rendered from a VRM avatar: the licence of the avatar gates the import and travels with every part. */
class VrmImportTest extends TestCase
{
    use RefreshDatabase;

    private string $dir;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        $this->seed(\Database\Seeders\LibrarySeeder::class);
        User::factory()->create();
        $this->dir = sys_get_temp_dir().'/vrm_'.uniqid();
        mkdir($this->dir);
    }

    private function vrm()
    {
        return LibraryAsset::where('name', 'like', 'VRM %');
    }

    private function manifest(array $avatar): void
    {
        $im = imagecreatetruecolor(800, 1600);
        imagealphablending($im, false);
        imagesavealpha($im, true);
        imagefill($im, 0, 0, imagecolorallocatealpha($im, 0, 0, 0, 127));
        imagefilledrectangle($im, 230, 200, 570, 760, imagecolorallocate($im, 40, 40, 90));
        imagepng($im, $this->dir.'/front-torso.png');
        file_put_contents($this->dir.'/manifest.json', json_encode(['source' => 'x.vrm', 'avatar' => $avatar + ['name' => 'Tes Avatar'], 'items' => [['slot' => 'torso', 'view' => 'front', 'file' => 'front-torso.png', 'label' => null]]]));
    }

    public function test_an_avatar_that_forbids_modification_is_refused_without_a_permission(): void
    {
        $this->manifest(['modification' => 'prohibited', 'allowRedistribution' => false]);
        $this->artisan('library:import-vrm', ['dir' => $this->dir])->assertFailed();
        $this->assertSame(0, $this->vrm()->count());
    }

    public function test_with_a_permission_the_parts_get_their_family_and_the_licence(): void
    {
        $this->manifest(['modification' => 'prohibited', 'allowRedistribution' => false, 'licenseUrl' => 'https://example.test/l']);
        $this->artisan('library:import-vrm', ['dir' => $this->dir, '--permission' => 'pemilik', '--approve' => true])->assertSuccessful();
        $a = $this->vrm()->first();
        $this->assertNotNull($a);
        $this->assertSame('vrm-tes-avatar', $a->meta['family']);
        $this->assertSame('vrm-vroid', $a->meta['template']);
        $this->assertSame('pemilik', $a->meta['vrm']['permission']);
        $this->assertSame('https://example.test/l', $a->meta['vrm']['license_url']);
        $n = $this->vrm()->count();
        $this->artisan('library:import-vrm', ['dir' => $this->dir, '--permission' => 'pemilik'])->assertSuccessful();
        $this->assertSame($n, $this->vrm()->count(), 're-importing adds nothing');
    }

    public function test_the_design_templates_endpoint_lists_the_vrm_template(): void
    {
        $this->app['auth']->forgetGuards();
        $h = ['Authorization' => 'Bearer '.User::first()->createToken('t')->plainTextToken, 'Accept' => 'application/json'];
        $ids = collect($this->getJson('/api/design/templates', $h)->assertOk()->json('data'))->pluck('id');
        $this->assertContains('anime-v1', $ids);
        $this->assertContains('vrm-vroid', $ids);
    }
}

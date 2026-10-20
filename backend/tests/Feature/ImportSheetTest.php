<?php

namespace Tests\Feature;

use App\Models\LibraryAsset;
use App\Models\User;
use Database\Seeders\LibrarySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class ImportSheetTest extends TestCase
{
    use RefreshDatabase;

    private string $dir;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        $this->seed(LibrarySeeder::class);
        $this->dir = sys_get_temp_dir().'/sheet_'.uniqid();
        mkdir($this->dir.'/items', 0777, true);
    }

    protected function tearDown(): void
    {
        array_map('unlink', glob($this->dir.'/items/*') ?: []);
        @unlink($this->dir.'/manifest.json');
        @rmdir($this->dir.'/items');
        @rmdir($this->dir);
        parent::tearDown();
    }

    private function item(string $key, string $category, int $w = 800, int $h = 1600, string $name = 'Rambut depan 1'): array
    {
        $im = imagecreatetruecolor($w, $h);
        imagealphablending($im, false);
        imagesavealpha($im, true);
        imagefill($im, 0, 0, imagecolorallocatealpha($im, 0, 0, 0, 127));
        imagepng($im, $this->dir."/items/$key.png");

        return ['key' => $key, 'category' => $category, 'name' => $name, 'tags' => ['smk', 'sheet'], 'file' => "items/$key.png"];
    }

    private function manifest(array $items): void
    {
        file_put_contents($this->dir.'/manifest.json', json_encode(['source' => 'sheet.png', 'items' => $items]));
    }

    public function test_imports_parts_as_the_users_own_assets_and_is_idempotent(): void
    {
        $u = User::factory()->create();
        $this->manifest([$this->item('a', 'hair_front'), $this->item('b', 'hijab', name: 'Kerudung putih')]);

        $this->artisan('library:import-sheet', ['dir' => $this->dir, '--user' => $u->id])->assertSuccessful()->expectsOutputToContain('Ditambahkan: 2');
        $a = LibraryAsset::where('user_id', $u->id)->where('name', 'Rambut depan 1')->firstOrFail();
        $this->assertSame(['hair_front', 'upload', 'approved', 800, 1600, false], [$a->category->slug, $a->source, $a->status, $a->width, $a->height, $a->tintable]);
        $this->assertContains('smk', $a->tags);
        $this->assertTrue(Storage::disk('local')->exists($a->path));

        // again: nothing new
        $this->artisan('library:import-sheet', ['dir' => $this->dir, '--user' => $u->email])->assertSuccessful()->expectsOutputToContain('sudah ada: 2');
        $this->assertSame(2, LibraryAsset::where('user_id', $u->id)->count());

        // visible to the owner through the API and usable in a character, invisible to others
        $this->app['auth']->forgetGuards();
        $h = ['Authorization' => 'Bearer '.$u->createToken('t')->plainTextToken, 'Accept' => 'application/json'];
        $this->assertContains('Kerudung putih', array_column($this->getJson('/api/library/assets?category=hijab&mine=1', $h)->json('data'), 'name'));
        $this->app['auth']->forgetGuards();
        $o = ['Authorization' => 'Bearer '.User::factory()->create()->createToken('t')->plainTextToken, 'Accept' => 'application/json'];
        $this->assertNotContains('Kerudung putih', array_column($this->getJson('/api/library/assets?category=hijab', $o)->json('data'), 'name'));
    }

    public function test_dry_run_and_invalid_input(): void
    {
        $u = User::factory()->create();
        $this->manifest([$this->item('a', 'hair_front')]);
        $this->artisan('library:import-sheet', ['dir' => $this->dir, '--user' => $u->id, '--dry-run' => true])->assertSuccessful()->expectsOutputToContain('[dry-run] Ditambahkan: 1');
        $this->assertSame(0, LibraryAsset::where('user_id', $u->id)->count());

        $this->manifest([$this->item('x', 'no_such_category')]);
        $this->artisan('library:import-sheet', ['dir' => $this->dir, '--user' => $u->id])->assertFailed();
        $this->artisan('library:import-sheet', ['dir' => $this->dir, '--user' => 99999])->assertFailed();
        $this->artisan('library:import-sheet', ['dir' => $this->dir.'/missing', '--user' => $u->id])->assertFailed();

        file_put_contents($this->dir.'/items/bad.png', 'not a png');
        $this->manifest([['key' => 'bad', 'category' => 'hair_front', 'name' => 'x', 'file' => 'items/bad.png']]);
        $this->artisan('library:import-sheet', ['dir' => $this->dir, '--user' => $u->id])->assertFailed();
        $this->assertSame(0, LibraryAsset::where('user_id', $u->id)->count());
    }
}

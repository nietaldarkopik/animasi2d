<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\Process\Process;
use Tests\TestCase;

/**
 * Card Builder endpoints, end to end with the real Python tool: a temporary karakter/ folder holding a copy of Arum, and Flow sheets simulated from
 * Arum's own images (tools/card_builder/tests). Skipped when Python with Pillow and numpy is not available.
 */
class CardBuilderApiTest extends TestCase
{
    use RefreshDatabase;

    private string $root;

    private string $tools;

    private array $h = [];

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        $this->tools = realpath(base_path('../tools'));
        $real = realpath(base_path('../karakter/arum'));
        $python = (string) config('services.card_builder.python');
        $probe = new Process([$python, '-c', 'import PIL, numpy'], $this->tools);
        $probe->run();
        if (! $real || ! $probe->isSuccessful()) {
            $this->markTestSkipped('karakter/arum atau Python + Pillow + numpy tidak tersedia.');
        }
        $this->root = sys_get_temp_dir().DIRECTORY_SEPARATOR.'cbapi-'.bin2hex(random_bytes(4));
        File::makeDirectory($this->root.DIRECTORY_SEPARATOR.'arum', 0777, true);
        foreach (glob($real.DIRECTORY_SEPARATOR.'*.{png,json}', GLOB_BRACE) as $f) {
            if (! str_contains(basename($f), ' - ') && ! str_ends_with($f, '_a_.png')) {
                File::copy($f, $this->root.DIRECTORY_SEPARATOR.'arum'.DIRECTORY_SEPARATOR.basename($f));
            }
        }
        $meta = json_decode(file_get_contents($this->root.'/arum/character.json'), true);
        $meta['appearance'] = 'long straight dark-purple hair, white sailor blouse, long grey pleated skirt';
        file_put_contents($this->root.'/arum/character.json', json_encode($meta));
        config(['services.card_builder.root' => $this->root]);
        $this->user = User::factory()->create();
    }

    private User $user;

    protected function tearDown(): void
    {
        if (isset($this->root)) {
            File::deleteDirectory($this->root);
        }
        parent::tearDown();
    }

    private function headers(?User $u = null): array
    {
        $this->app['auth']->forgetGuards();

        return ['Authorization' => 'Bearer '.($u ?? $this->user)->createToken('t')->plainTextToken, 'Accept' => 'application/json'];
    }

    /** Runs a snippet of Python inside tools/ (so card_builder and its test helpers import). */
    private function py(string $code, array $args = []): void
    {
        $p = new Process([(string) config('services.card_builder.python'), '-c', "import sys; sys.path.insert(0, '.')\n".$code, ...$args], $this->tools, null, null, 180);
        $p->mustRun();
    }

    /** Simulated Flow sheets for a motion pack, saved in $dir. */
    private function packSheets(string $dir): void
    {
        File::makeDirectory($dir, 0777, true, true);
        $this->py(<<<'PY'
from pathlib import Path
from card_builder.tests.test_sheets import make_sheet, trimmed
src, out = Path(sys.argv[1]), Path(sys.argv[2])
for name, poses in (('duduk_badan_a', ['diam', 'angkat', 'lambai']), ('duduk_badan_b', ['diam', 'pelipis', 'dagu'])):
    make_sheet([trimmed(src / f'arum_badan_{p}.png') for p in poses], 3, 1, .5).convert('RGB').save(out / f'arum_{name}.png')
PY, [$this->root.'/arum', $dir]);
    }

    /** Simulated sheets of a whole new character, named bar_*.png. */
    private function newSheets(string $dir): void
    {
        File::makeDirectory($dir, 0777, true, true);
        $this->py(<<<'PY'
from pathlib import Path
from card_builder.tests.test_newchar import write_sheets
write_sheets(Path(sys.argv[1]))
PY, [$dir]);
    }

    private function png(string $path): UploadedFile
    {
        return new UploadedFile($path, basename($path), 'image/png', null, true);
    }

    private function importArum(array $h): int
    {
        return $this->postJson('/api/builder/cards', ['slug' => 'arum'], $h)->assertCreated()->json('data.id');
    }

    // ----------------------------------------------------------------------------------------------

    public function test_status_prompts_upload_import_and_refresh_make_the_pack_playable(): void
    {
        $h = $this->headers();
        $id = $this->importArum($h);
        $b = "/api/builder/cards/$id/builder";

        $s = $this->getJson($b, $h)->assertOk()->json('data');
        $this->assertSame([4, 0, false], [$s['packs']['duduk']['required_total'], $s['packs']['duduk']['required_present'], $s['packs']['duduk']['enabled']]);
        $this->assertSame('pass', $s['validation']['verdict']);

        $p = $this->postJson("$b/prompts", ['pack' => 'duduk'], $h)->assertOk()->json('data');
        $this->assertCount(4, $p['sheets']);
        $this->assertStringContainsString('NO HEAD', $p['sheets'][0]['text']);
        $this->postJson("$b/prompts", ['pack' => 'dasar'], $h)->assertStatus(422);

        $this->packSheets($sheets = $this->root.'/_sheets');
        $this->post("$b/sheets/duduk/duduk_badan_a", ['file' => $this->png($sheets.'/arum_duduk_badan_a.png')], $h)->assertOk()->assertJsonPath('data.file', 'arum_duduk_badan_a.png');
        $this->post("$b/sheets/duduk/duduk_badan_b", ['file' => $this->png($sheets.'/arum_duduk_badan_b.png')], $h)->assertOk();
        $this->post("$b/sheets/duduk/tidak_ada", ['file' => $this->png($sheets.'/arum_duduk_badan_a.png')], $h)->assertNotFound();
        $this->post("$b/sheets/xx/duduk_badan_a", ['file' => $this->png($sheets.'/arum_duduk_badan_a.png')], $h)->assertNotFound();
        $notImage = UploadedFile::fake()->createWithContent('x.png', 'bukan gambar');
        $this->post("$b/sheets/duduk/duduk_badan_a", ['file' => $notImage], $h)->assertStatus(422)->assertJsonPath('message', fn ($m) => str_contains($m, 'bukan gambar'));
        $this->assertSame([true, true, false, false], array_column($this->getJson($b, $h)->json('data.packs.duduk.sheets'), 'uploaded'));

        $dry = $this->postJson("$b/import", ['pack' => 'duduk', 'dry_run' => true], $h)->assertOk()->json('data');
        $this->assertTrue($dry['dry_run']);
        $this->assertFileDoesNotExist($this->root.'/arum/arum_badan_duduk_tegak.png');
        $url = collect($dry['previews'])->firstWhere('name', '_cek_duduk_badan_a.png')['url'];
        $img = $this->get($url)->assertOk();
        $this->assertSame('image/png', $img->headers->get('Content-Type'));

        $done = $this->postJson("$b/import", ['pack' => 'duduk'], $h)->assertOk()->json('data');
        $this->assertSame('pass', $done['validation']['verdict']);
        $this->assertCount(4, array_filter($done['imported'], fn ($i) => ! $i['skipped']));
        $this->assertTrue($this->getJson($b, $h)->json('data.packs.duduk.enabled'));

        // the editor sees the new slots after "Perbarui dari folder"
        $d = $this->postJson("/api/builder/cards/$id/refresh", [], $h)->assertCreated()->json('data');
        $this->assertSame(['duduk_tegak', 'duduk_condong', 'duduk_sila', 'duduk_tangan_lutut'], array_keys($d['urls']['extra']['body']));
        $this->assertArrayHasKey('duduk_sila', $d['meta']['body']['head_at']);
    }

    public function test_other_users_cannot_touch_a_character_or_a_draft(): void
    {
        $h = $this->headers();
        $id = $this->importArum($h);
        $other = $this->headers(User::factory()->create());
        $this->getJson("/api/builder/cards/$id/builder", $other)->assertNotFound();
        $this->app['auth']->forgetGuards();
        $this->postJson("/api/builder/cards/$id/builder/prompts", ['pack' => 'duduk'], $other)->assertNotFound();
        $this->app['auth']->forgetGuards();
        $this->postJson('/api/builder/card-drafts', ['slug' => 'bar', 'name' => 'Bar', 'appearance' => 'long hair'], $h)->assertCreated();
        $this->app['auth']->forgetGuards();
        $this->getJson('/api/builder/card-drafts/bar', $h)->assertOk();
        $this->app['auth']->forgetGuards();
        $this->getJson('/api/builder/card-drafts/bar', $other)->assertNotFound();
        $this->app['auth']->forgetGuards();
        $this->deleteJson('/api/builder/card-drafts/bar', [], $other)->assertNotFound();
        $this->app['auth']->forgetGuards();
        $this->postJson('/api/builder/card-drafts', ['slug' => 'bar', 'name' => 'Bar', 'appearance' => 'x'], $other)->assertStatus(409);
        $this->app['auth']->forgetGuards();
        $this->getJson("/api/builder/cards/$id/builder")->assertUnauthorized();
    }

    public function test_a_new_character_goes_from_draft_to_a_playable_card(): void
    {
        $h = $this->headers();
        $start = $this->postJson('/api/builder/card-drafts', ['slug' => 'bar', 'name' => 'Bar', 'appearance' => 'long dark-purple hair, white sailor blouse', 'style' => 'anime'], $h)->assertCreated()->json('data');
        $this->assertSame(['acuan', 'kepala', 'badan_a', 'badan_b', 'badan_c', 'mulut', 'kelopak'], array_column($start['sheets_full'], 'id'));
        $this->assertFalse($start['imported']);
        $this->assertDirectoryExists($this->root.'/_draf/bar');
        $this->assertFileExists($this->root.'/_draf/bar/owner.json');
        $this->postJson('/api/builder/card-drafts/bar/import', [], $h)->assertStatus(422)->assertJsonPath('message', fn ($m) => str_contains($m, 'wajib'));
        $this->postJson('/api/builder/card-drafts/bar/finish', [], $h)->assertStatus(422);

        $this->newSheets($sheets = $this->root.'/_sheets');
        foreach (['kepala', 'badan_a', 'badan_b', 'badan_c', 'mulut', 'kelopak'] as $sid) {
            $this->post("/api/builder/card-drafts/bar/sheets/$sid", ['file' => $this->png("$sheets/bar_$sid.png")], $h)->assertOk();
        }
        $r = $this->postJson('/api/builder/card-drafts/bar/import', [], $h)->assertOk()->json('data');
        $this->assertTrue($r['state']['imported'] && $r['has_blink']);
        $this->assertSame('pass', $r['state']['validation']['verdict']);
        $this->assertSame(['_cek_pose.png', '_cek_wajah.png'], array_column($r['state']['previews'], 'name'));
        $this->get($r['state']['assets']['head'])->assertOk();
        $this->get($r['state']['previews'][0]['url'])->assertOk();

        $c = $this->postJson('/api/builder/card-drafts/bar/import', ['calib' => ['mouth' => [205, 262], 'eyes' => [[160, 212], [240, 212]], 'mouth_scale' => 1.2]], $h)->assertOk()->json('data');
        $this->assertSame([205, 262], $c['calib']['mouth']);
        $this->postJson('/api/builder/card-drafts/bar/import', ['calib' => ['mouth_scale' => 9]], $h)->assertStatus(422);
        $this->postJson('/api/builder/card-drafts/bar/import', ['calib' => ['eyes' => [[200, 10], [100, 10]]]], $h)->assertStatus(422);

        $done = $this->postJson('/api/builder/card-drafts/bar/finish', ['name' => 'Bar Baru'], $h)->assertCreated()->json('data');
        $this->assertSame('Bar Baru', $done['name']);
        $this->assertCount(9, $done['meta']['body']['poses']);
        $this->assertCount(10, $done['meta']['head']['expressions']);
        $this->assertCount(5, $done['urls']['mouth']);
        $this->assertNotNull($done['urls']['blink']);
        // raw sheets are kept (draft and final folder) so a revision needs no new upload
        $this->assertFileExists($this->root.'/_draf/bar/_mentah/bar_kepala.png');
        $this->assertFileExists($this->root.'/bar/character.json');
        $this->assertFileExists($this->root.'/bar/_mentah/bar_kepala.png');
        $this->assertContains('Bar Baru', array_column($this->getJson('/api/builder/cards', $h)->json('data'), 'name'));
        $this->getJson('/api/builder/card-drafts/bar', $h)->assertOk()->assertJsonPath('data.exists_final', true);
        $this->postJson('/api/builder/card-drafts', ['slug' => 'bar', 'name' => 'Bar', 'appearance' => 'x'], $h)->assertStatus(422);
        $this->postJson('/api/builder/card-drafts/bar/finish', [], $h)->assertStatus(422);   // plain finish still refuses an existing folder

        // revision from the same raw sheets: recalibrate, then update the finished character (new version, same id)
        $this->postJson('/api/builder/card-drafts/bar/import', ['calib' => ['mouth_scale' => 1.4]], $h)->assertOk();
        $up = $this->postJson('/api/builder/card-drafts/bar/finish', ['update' => true], $h)->assertCreated()->json('data');
        $this->assertSame($done['id'], $up['id']);
        $this->assertSame(1.4, $up['meta']['calibration']['mouth_scale']);
        $this->assertGreaterThan($done['current_version'], $up['current_version']);
    }

    public function test_draft_can_be_discarded_and_input_is_validated(): void
    {
        $h = $this->headers();
        $this->postJson('/api/builder/card-drafts', ['slug' => 'Nama Salah', 'name' => 'x', 'appearance' => 'x'], $h)->assertStatus(422);
        $this->postJson('/api/builder/card-drafts', ['slug' => 'baz', 'name' => 'x'], $h)->assertStatus(422);
        $this->postJson('/api/builder/card-drafts', ['slug' => 'baz', 'name' => 'Baz', 'appearance' => 'short hair'], $h)->assertCreated();
        $this->deleteJson('/api/builder/card-drafts/baz', [], $h)->assertOk();
        $this->assertDirectoryDoesNotExist($this->root.'/_draf/baz');
        $this->getJson('/api/builder/card-drafts/baz', $h)->assertNotFound();
        $this->getJson('/api/builder/card-drafts/..%2Fetc', $h)->assertNotFound();
    }

    public function test_recolor_previews_then_saves_a_new_character(): void
    {
        $h = $this->headers();
        $id = $this->importArum($h);
        $b = "/api/builder/cards/$id/builder";
        $colors = $this->getJson("$b/colors", $h)->assertOk()->json('data.clusters');
        $this->assertTrue(collect($colors)->contains(fn ($c) => $c['name'] === 'ungu'));
        $maps = ['#5e516d>#3f5f9f;not=125,185,275,250;groups=head', '#84525c>#2e7d4f;tol=14'];

        $pv = $this->postJson("$b/recolor", ['as' => 'arum_biru', 'maps' => $maps, 'preview' => true], $h)->assertOk()->json('data');
        $this->assertNotEmpty($pv['preview_png_base64']);
        $this->assertSame('pass', $pv['validation']['verdict']);
        $this->assertDirectoryDoesNotExist($this->root.'/arum_biru');

        $saved = $this->postJson("$b/recolor", ['as' => 'arum_biru', 'name' => 'Arum Biru', 'maps' => $maps], $h)->assertCreated()->json('data');
        $this->assertSame('Arum Biru', $saved['character']['name']);
        $this->assertSame('pass', $saved['validation']['verdict']);
        $this->assertDirectoryExists($this->root.'/arum_biru');
        $this->postJson("$b/recolor", ['as' => 'arum_biru', 'maps' => $maps], $h)->assertStatus(422);

        foreach ([['as' => '../x', 'maps' => $maps], ['as' => 'ok1', 'maps' => []], ['as' => 'ok2', 'maps' => ['bukan warna']], ['as' => 'ok3', 'maps' => ['#112233>#445566;mask=../../x.png']], ['as' => 'ok4', 'maps' => $maps, 'groups' => ['kaki']]] as $i => $bad) {
            $r = $this->postJson("$b/recolor", $bad + ['preview' => true], $h);
            $this->assertContains($r->status(), [422], "case $i");
        }
    }

    public function test_mouth_position_and_appearance_are_saved(): void
    {
        $h = $this->headers();
        $id = $this->importArum($h);
        $b = "/api/builder/cards/$id/builder";
        $this->putJson("$b/mouth-at", ['view' => '34', 'x' => 198, 'y' => 250], $h)->assertOk();
        $this->putJson("$b/mouth-at", ['view' => 'belakang', 'x' => 1, 'y' => 1], $h)->assertStatus(422);
        $this->assertSame([198, 250], json_decode(file_get_contents($this->root.'/arum/character.json'), true)['mouth']['at']['34']);
        $this->putJson("$b/head-at", ['slot' => 'duduk_sila_34', 'x' => 210, 'y' => 380, 'rot' => -6.5], $h)->assertOk()->assertJsonPath('data.at', [210, 380]);
        $body = json_decode(file_get_contents($this->root.'/arum/character.json'), true)['body'];
        $this->assertSame([210, 380], $body['head_at']['duduk_sila_34']);
        $this->assertSame(-6.5, $body['head_rot']['duduk_sila_34']);
        $this->putJson("$b/head-at", ['slot' => 'duduk_sila_34', 'x' => 210, 'y' => 380, 'rot' => 0], $h)->assertOk();
        $this->assertArrayNotHasKey('head_rot', json_decode(file_get_contents($this->root.'/arum/character.json'), true)['body']);   // 0 clears it
        $this->putJson("$b/head-at", ['slot' => 'diam', 'x' => 1, 'y' => 1], $h)->assertStatus(422);       // not a pack body
        $this->putJson("$b/head-at", ['slot' => 'duduk_sila', 'x' => 1, 'y' => 1, 'rot' => 80], $h)->assertStatus(422);
        $this->putJson("$b/appearance", ['appearance' => 'short blue hair'], $h)->assertOk();
        $this->assertSame('short blue hair', $this->getJson($b, $h)->json('data.appearance'));
        $this->putJson("$b/appearance", ['appearance' => ''], $h)->assertStatus(422);
    }

    public function test_preview_urls_are_signed_and_limited(): void
    {
        $h = $this->headers();
        $id = $this->importArum($h);
        $b = "/api/builder/cards/$id/builder";
        $this->postJson("$b/prompts", ['pack' => 'duduk'], $h)->assertOk();
        $this->packSheets($sheets = $this->root.'/_sheets');
        $this->post("$b/sheets/duduk/duduk_badan_a", ['file' => $this->png($sheets.'/arum_duduk_badan_a.png')], $h)->assertOk();
        $dry = $this->postJson("$b/import", ['pack' => 'duduk', 'dry_run' => true], $h)->json('data');
        $url = $dry['previews'][0]['url'];
        $this->assertStringContainsString('signature=', $url);
        $this->get(preg_replace('/signature=[a-f0-9]+/', 'signature=00', $url))->assertForbidden();
        $this->get('/api/builder/card-previews/c/arum/_cek_x.png')->assertForbidden();                    // tanpa tanda tangan
        $this->get(\URL::temporarySignedRoute('card-builder.preview', now()->addHour(), ['kind' => 'c', 'slug' => 'arum', 'name' => 'arum_kepala_netral.png'], absolute: false))->assertNotFound();   // karakter jadi: hanya gambar cek
        $this->get(\URL::temporarySignedRoute('card-builder.preview', now()->addHour(), ['kind' => 'c', 'slug' => 'arum', 'name' => '_cek_tidak_ada.png'], absolute: false))->assertNotFound();
        $this->get(\URL::temporarySignedRoute('card-builder.preview', now()->addHour(), ['kind' => 'x', 'slug' => 'arum', 'name' => '_cek_a.png'], absolute: false))->assertNotFound();
    }

    public function test_a_broken_tool_is_reported_not_hidden(): void
    {
        $h = $this->headers();
        $id = $this->importArum($h);
        config(['services.card_builder.python' => 'python-yang-tidak-ada']);
        $r = $this->getJson("/api/builder/cards/$id/builder", $h)->assertStatus(500);
        $this->assertStringContainsString('card_builder', $r->json('message'));
    }
}

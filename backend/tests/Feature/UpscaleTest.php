<?php

namespace Tests\Feature;

use App\Models\LibraryAsset;
use App\Models\User;
use App\Services\Enhancement\Upscaler;
use Database\Seeders\LibrarySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/** Local AI super-resolution (Real-ESRGAN). Tests that really run the model are skipped when the binary/GPU is missing. */
class UpscaleTest extends TestCase
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

    private function requireUpscaler(): void
    {
        if (! Upscaler::available()) {
            $this->markTestSkipped('Real-ESRGAN binary not installed');
        }
    }

    /** Transparent PNG with a dark ring: something with edges for the model, and alpha to keep. */
    private function png(int $w, int $h): UploadedFile
    {
        $im = imagecreatetruecolor($w, $h);
        imagealphablending($im, false);
        imagesavealpha($im, true);
        imagefill($im, 0, 0, imagecolorallocatealpha($im, 0, 0, 0, 127));
        imagealphablending($im, true);
        imagefilledellipse($im, intdiv($w, 2), intdiv($h, 2), (int) ($w * .7), (int) ($h * .7), imagecolorallocate($im, 240, 190, 150));
        imagesetthickness($im, 2);
        imageellipse($im, intdiv($w, 2), intdiv($h, 2), (int) ($w * .7), (int) ($h * .7), imagecolorallocate($im, 30, 30, 40));
        $p = tempnam(sys_get_temp_dir(), 'up').'.png';
        imagepng($im, $p);

        return new UploadedFile($p, 'p.png', 'image/png', null, true);
    }

    public function test_modes_report_the_local_ai_upscaler_status_honestly(): void
    {
        $u = User::factory()->create();
        $mode = collect($this->getJson('/api/enhance/modes', $this->h($u))->json('data.modes'))->firstWhere('id', 'upscale_ai');
        $this->assertSame('local-ai', $mode['engine']);
        $this->assertSame(Upscaler::available(), $mode['available']);

        config(['services.upscaler.bin' => '/definitely/not/here']);
        $mode = collect($this->getJson('/api/enhance/modes', $this->h($u))->json('data.modes'))->firstWhere('id', 'upscale_ai');
        $this->assertFalse($mode['available']);
        $this->assertStringContainsString('tools/realesrgan', $mode['unavailable_reason']);

        $pid = $this->postJson('/api/projects', ['name' => 'P'], $this->h($u))->json('data.id');
        $a = $this->post("/api/projects/$pid/assets", ['file' => $this->png(40, 40)], $this->h($u))->json('data');
        $this->postJson("/api/assets/{$a['id']}/enhance", ['mode' => 'upscale_ai'], $this->h($u))->assertStatus(503)->assertJsonPath('code', 'upscaler_unavailable');
    }

    public function test_project_asset_is_upscaled_by_a_queued_job_keeping_alpha_and_the_original(): void
    {
        $this->requireUpscaler();
        $u = User::factory()->create();
        $pid = $this->postJson('/api/projects', ['name' => 'P'], $this->h($u))->json('data.id');
        $a = $this->post("/api/projects/$pid/assets", ['file' => $this->png(64, 48)], $this->h($u))->json('data');

        $job = $this->postJson("/api/assets/{$a['id']}/enhance", ['mode' => 'upscale_ai', 'options' => ['upscale' => 3]], $this->h($u))->assertStatus(202)->json('data.job');
        $done = $this->getJson('/api/ai/jobs/'.$job['id'], $this->h($u))->json('data'); // queue runs synchronously in tests
        $this->assertSame('done', $done['status'], (string) $done['error']);
        $r = $done['result']['asset'];
        $this->assertSame([192, 144], [$r['width'], $r['height']]);
        $this->assertSame([$a['id'], 'enhanced', 'upscale_ai'], [$r['parent_id'], $r['kind'], $r['mode']]);

        $im = imagecreatefromstring(Storage::disk('local')->get(\App\Models\Asset::find($r['id'])->path));
        $this->assertSame(127, (imagecolorat($im, 2, 2) >> 24) & 0x7F, 'transparent corner stays transparent');
        $this->assertLessThan(10, (imagecolorat($im, 96, 72) >> 24) & 0x7F, 'the centre stays opaque');
        $this->assertSame([64, 48], [\App\Models\Asset::find($a['id'])->width, \App\Models\Asset::find($a['id'])->height]);
    }

    public function test_oversized_sources_fail_with_a_clear_message(): void
    {
        $this->requireUpscaler();
        $u = User::factory()->create();
        $pid = $this->postJson('/api/projects', ['name' => 'P'], $this->h($u))->json('data.id');
        $a = $this->post("/api/projects/$pid/assets", ['file' => $this->png(1200, 100)], $this->h($u))->json('data');
        $job = $this->postJson("/api/assets/{$a['id']}/enhance", ['mode' => 'upscale_ai'], $this->h($u))->json('data.job');
        $done = $this->getJson('/api/ai/jobs/'.$job['id'], $this->h($u))->json('data');
        $this->assertSame('failed', $done['status']);
        $this->assertStringContainsString('terlalu besar', $done['error']);
    }

    public function test_library_asset_gets_a_new_hd_copy(): void
    {
        $this->requireUpscaler();
        $u = User::factory()->create();
        $this->postJson('/api/projects', ['name' => 'P'], $this->h($u));
        $own = $this->post('/api/library/assets', ['file' => $this->png(60, 80), 'category' => 'hat', 'name' => 'Topi kecil', 'tags' => 'smk'], $this->h($u))->assertCreated()->json('data');

        $job = $this->postJson("/api/library/assets/{$own['id']}/upscale", ['factor' => 2], $this->h($u))->assertStatus(202)->json('data');
        $done = $this->getJson('/api/ai/jobs/'.$job['id'], $this->h($u))->json('data');
        $this->assertSame('done', $done['status'], (string) $done['error']);
        $hd = $done['result']['asset'];
        $this->assertSame([120, 160], [$hd['width'], $hd['height']]);
        $this->assertSame('Topi kecil (HD 2x)', $hd['name']);
        $this->assertSame('hat', $hd['category']);
        $this->assertContains('hd', $hd['tags']);
        $this->assertSame($own['id'], LibraryAsset::find($hd['id'])->meta['upscaled_from']);
        $this->assertSame(60, LibraryAsset::find($own['id'])->width, 'original is untouched');
    }

    public function test_library_upscale_rules_and_isolation(): void
    {
        $u = User::factory()->create();
        $other = User::factory()->create();
        $this->postJson('/api/projects', ['name' => 'P'], $this->h($u));
        $own = $this->post('/api/library/assets', ['file' => $this->png(50, 50), 'category' => 'hat', 'name' => 'x'], $this->h($u))->json('data');
        $sys = LibraryAsset::where('key', 'hat_cap')->firstOrFail();

        $this->postJson("/api/library/assets/{$own['id']}/upscale", ['factor' => 2], $this->h($other))->assertNotFound();
        $this->postJson("/api/library/assets/{$sys->id}/upscale", ['factor' => 2], $this->h($u))->assertNotFound(); // system assets are not the user's
        $this->postJson("/api/library/assets/{$own['id']}/upscale", ['factor' => 9], $this->h($u))->assertStatus(422);
        $this->postJson("/api/library/assets/{$own['id']}/upscale", [], $this->h($u))->assertStatus(422);

        $svg = tempnam(sys_get_temp_dir(), 'sv').'.svg';
        file_put_contents($svg, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 800"><path d="M1 1L9 9" fill="#000"/></svg>');
        $v = $this->post('/api/library/assets', ['file' => new UploadedFile($svg, 'a.svg', 'image/svg+xml', null, true), 'category' => 'hat', 'name' => 'vektor'], $this->h($u))->json('data');
        $this->postJson("/api/library/assets/{$v['id']}/upscale", ['factor' => 2], $this->h($u))->assertStatus(422)->assertSee('vektor');

        $big = $this->post('/api/library/assets', ['file' => $this->png(1200, 100), 'category' => 'hat', 'name' => 'besar'], $this->h($u))->json('data');
        $this->postJson("/api/library/assets/{$big['id']}/upscale", ['factor' => 2], $this->h($u))->assertStatus(422);

        config(['services.upscaler.bin' => '/definitely/not/here']);
        $this->postJson("/api/library/assets/{$own['id']}/upscale", ['factor' => 2], $this->h($u))->assertStatus(503);
    }
}

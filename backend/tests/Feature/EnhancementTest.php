<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class EnhancementTest extends TestCase
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

    /** A "scan": tan paper with a gradient shadow, dark ink lines and a circle. */
    private function scan(): UploadedFile
    {
        $im = imagecreatetruecolor(320, 240);
        for ($x = 0; $x < 320; $x++) { // shadow gradient on the left
            $v = 205 + (int) (35 * $x / 320);
            imageline($im, $x, 0, $x, 239, imagecolorallocate($im, $v, $v - 4, $v - 20));
        }
        $ink = imagecolorallocate($im, 25, 25, 35);
        imagesetthickness($im, 4);
        imageellipse($im, 160, 110, 120, 120, $ink);
        imageline($im, 100, 200, 220, 200, $ink);
        $path = tempnam(sys_get_temp_dir(), 'scan').'.png';
        imagepng($im, $path);

        return new UploadedFile($path, 'scan.png', 'image/png', null, true);
    }

    private function upload(User $u, int $projectId): array
    {
        return $this->post("/api/projects/$projectId/assets", ['file' => $this->scan()], $this->headers($u))->assertCreated()->json('data');
    }

    private function project(User $u): int
    {
        return $this->postJson('/api/projects', ['name' => 'P'], $this->headers($u))->json('data.id');
    }

    public function test_modes_report_local_available_and_ai_unavailable_without_provider(): void
    {
        $u = User::factory()->create();
        $modes = collect($this->getJson('/api/enhance/modes', $this->headers($u))->assertOk()->json('data.modes'))->keyBy('id');

        $this->assertSame(['preserve', 'clean_sketch', 'clean_line_art', 'colorize', 'ai_redraw', 'upscale_ai'], $modes->keys()->all());
        foreach (['preserve', 'clean_sketch', 'clean_line_art'] as $id) {
            $this->assertTrue($modes[$id]['available']);
        }
        foreach (['colorize', 'ai_redraw'] as $id) {
            $this->assertFalse($modes[$id]['available']);
            $this->assertNotEmpty($modes[$id]['unavailable_reason']);
        }
        $this->assertTrue($modes['preserve']['default']);
    }

    public function test_local_modes_create_new_versions_and_keep_the_original(): void
    {
        $u = User::factory()->create();
        $pid = $this->project($u);
        $orig = $this->upload($u, $pid);
        $this->assertSame('original', $orig['kind']);

        $ids = [];
        foreach (['preserve', 'clean_sketch', 'clean_line_art'] as $mode) {
            $r = $this->postJson("/api/assets/{$orig['id']}/enhance", ['mode' => $mode, 'options' => ['upscale' => 2, 'deskew' => true]], $this->headers($u))->assertCreated();
            $this->assertSame('enhanced', $r->json('data.kind'));
            $this->assertSame($orig['id'], $r->json('data.parent_id'));
            $this->assertSame($mode, $r->json('data.mode'));
            $this->assertSame(640, $r->json('data.width')); // upscale 2x of 320
            $ids[] = $r->json('data.id');
        }

        // original untouched, every version listed with lineage (also when asked from a derived version)
        $list = $this->getJson("/api/assets/{$ids[1]}/versions", $this->headers($u))->assertOk()->json('data');
        $this->assertSame([$orig['id'], ...$ids], array_column($list, 'id'));
        $this->assertSame(320, $list[0]['width']);
    }

    public function test_clean_line_art_is_transparent_with_dark_lines_and_flatten_removes_shadow(): void
    {
        $u = User::factory()->create();
        $pid = $this->project($u);
        $orig = $this->upload($u, $pid);

        $art = $this->postJson("/api/assets/{$orig['id']}/enhance", ['mode' => 'clean_line_art'], $this->headers($u))->assertCreated()->json('data');
        $im = imagecreatefromstring(Storage::disk('local')->get(\App\Models\Asset::find($art['id'])->path));
        $this->assertSame(127, (imagecolorat($im, 2, 2) >> 24) & 0x7F, 'paper must be fully transparent');
        $transparent = $dark = 0;
        for ($y = 0; $y < imagesy($im); $y += 2) {
            for ($x = 0; $x < imagesx($im); $x += 2) {
                $c = imagecolorat($im, $x, $y);
                if ((($c >> 24) & 0x7F) < 40) { // mostly opaque pixel = a line pixel
                    $dark++;
                    $this->assertLessThan(80, ($c >> 16) & 0xFF, 'line pixels are near-black');
                } else {
                    $transparent++;
                }
            }
        }
        $this->assertGreaterThan(50, $dark);
        $this->assertGreaterThan($dark * 5, $transparent);

        $kept = $this->postJson("/api/assets/{$orig['id']}/enhance", ['mode' => 'preserve'], $this->headers($u))->assertCreated()->json('data');
        $im = imagecreatefromstring(Storage::disk('local')->get(\App\Models\Asset::find($kept['id'])->path));
        $left = imagecolorat($im, 5, 5) & 0xFF;
        $right = imagecolorat($im, 310, 5) & 0xFF;
        $this->assertLessThan(25, abs($left - $right), 'uneven paper tone is flattened (source differs by ~35)');
    }

    public function test_provider_modes_fail_clearly_when_unconfigured_and_need_consent_when_configured(): void
    {
        $u = User::factory()->create();
        $pid = $this->project($u);
        $orig = $this->upload($u, $pid);

        $this->postJson("/api/assets/{$orig['id']}/enhance", ['mode' => 'colorize', 'consent_external' => true], $this->headers($u))
            ->assertStatus(503)->assertJsonPath('code', 'provider_unconfigured');

        config(['services.ai_image.enabled' => true, 'services.ai_image.model' => 'img-1', 'services.ai.api_key' => 'k', 'services.ai.base_url' => 'http://gateway.test/v1']);
        $this->postJson("/api/assets/{$orig['id']}/enhance", ['mode' => 'colorize'], $this->headers($u))
            ->assertStatus(422)->assertJsonPath('code', 'consent_required');
        Http::assertNothingSent(); // nothing left the server without consent
    }

    public function test_provider_mode_runs_in_a_job_and_stores_a_version(): void
    {
        config(['services.ai_image.enabled' => true, 'services.ai_image.model' => 'img-1', 'services.ai.api_key' => 'k', 'services.ai.base_url' => 'http://gateway.test/v1']);
        $im = imagecreatetruecolor(64, 48);
        imagefill($im, 0, 0, imagecolorallocate($im, 200, 40, 40));
        ob_start();
        imagepng($im);
        $png = base64_encode((string) ob_get_clean());
        Http::fake(['gateway.test/v1/images/edits' => Http::response(['data' => [['b64_json' => $png]]])]);

        $u = User::factory()->create();
        $pid = $this->project($u);
        $orig = $this->upload($u, $pid);

        $job = $this->postJson("/api/assets/{$orig['id']}/enhance", ['mode' => 'colorize', 'consent_external' => true], $this->headers($u))->assertStatus(202)->json('data.job');
        // QUEUE_CONNECTION=sync in tests: the job has already run
        $done = $this->getJson("/api/ai/jobs/{$job['id']}", $this->headers($u))->assertOk()->json('data');
        $this->assertSame('done', $done['status'], (string) $done['error']);
        $this->assertSame('colorize', $done['result']['asset']['mode']);
        $this->assertSame($orig['id'], $done['result']['asset']['parent_id']);
        Http::assertSent(fn ($r) => str_ends_with($r->url(), '/images/edits') && $r->hasHeader('Authorization'));

        // a second call is blocked by the daily limit once it is reached
        config(['services.ai_image.daily_limit' => 1]);
        $this->postJson("/api/assets/{$orig['id']}/enhance", ['mode' => 'colorize', 'consent_external' => true], $this->headers($u))->assertStatus(429);
    }

    public function test_provider_failure_is_reported_on_the_job(): void
    {
        config(['services.ai_image.enabled' => true, 'services.ai_image.model' => 'img-1', 'services.ai.api_key' => 'k', 'services.ai.base_url' => 'http://gateway.test/v1']);
        Http::fake(['gateway.test/*' => Http::response(['error' => ['message' => 'quota']], 500)]);
        $u = User::factory()->create();
        $orig = $this->upload($u, $this->project($u));

        $job = $this->postJson("/api/assets/{$orig['id']}/enhance", ['mode' => 'ai_redraw', 'consent_external' => true], $this->headers($u))->json('data.job');
        $done = $this->getJson("/api/ai/jobs/{$job['id']}", $this->headers($u))->json('data');
        $this->assertSame('failed', $done['status']);
        $this->assertStringContainsString('quota', $done['error']);
    }

    public function test_other_users_cannot_enhance_or_list_versions_and_input_is_validated(): void
    {
        $owner = User::factory()->create();
        $orig = $this->upload($owner, $this->project($owner));
        $other = User::factory()->create();

        $this->postJson("/api/assets/{$orig['id']}/enhance", ['mode' => 'preserve'], $this->headers($other))->assertNotFound();
        $this->getJson("/api/assets/{$orig['id']}/versions", $this->headers($other))->assertNotFound();
        $this->postJson("/api/assets/{$orig['id']}/enhance", ['mode' => 'nope'], $this->headers($owner))->assertStatus(422);
        $this->postJson("/api/assets/{$orig['id']}/enhance", ['mode' => 'preserve', 'options' => ['upscale' => 9]], $this->headers($owner))->assertStatus(422);
    }

    public function test_perspective_correction_straightens_a_photographed_sheet(): void
    {
        $u = User::factory()->create();
        $pid = $this->project($u);
        // gray table with a white sheet (black frame) photographed as a trapezoid
        $im = imagecreatetruecolor(400, 300);
        imagefill($im, 0, 0, imagecolorallocate($im, 90, 90, 90));
        $white = imagecolorallocate($im, 255, 255, 255);
        $black = imagecolorallocate($im, 0, 0, 0);
        $quad = [60, 40, 340, 20, 380, 270, 20, 250];
        imagefilledpolygon($im, $quad, $white);
        imagesetthickness($im, 5);
        imagepolygon($im, $quad, $black);
        $path = tempnam(sys_get_temp_dir(), 'pp').'.png';
        imagepng($im, $path);
        $orig = $this->post("/api/projects/$pid/assets", ['file' => new UploadedFile($path, 'photo.png', 'image/png', null, true)], $this->headers($u))->json('data');

        $r = $this->postJson("/api/assets/{$orig['id']}/enhance", [
            'mode' => 'preserve',
            'options' => ['perspective' => [[60, 40], [340, 20], [380, 270], [20, 250]]],
        ], $this->headers($u))->assertCreated();
        $this->assertGreaterThan(300, $r->json('data.width'));
        $this->assertStringContainsString('Perspektif', implode(' ', $r->json('notes')));

        $out = imagecreatefromstring(Storage::disk('local')->get(\App\Models\Asset::find($r->json('data.id'))->path));
        $w = imagesx($out);
        $h = imagesy($out);
        // the table (gray) must be gone: the four corner regions and the center are all paper-or-frame, none gray
        foreach ([[12, 12], [$w - 12, 12], [$w - 12, $h - 12], [12, $h - 12], [intdiv($w, 2), intdiv($h, 2)]] as [$x, $y]) {
            $this->assertGreaterThan(200, imagecolorat($out, $x, $y) & 0xFF, "pixel $x,$y should be paper, not table");
        }

        // wrong order (self-crossing) and out-of-image points are rejected with a readable message
        $this->postJson("/api/assets/{$orig['id']}/enhance", ['mode' => 'preserve', 'options' => ['perspective' => [[60, 40], [380, 270], [340, 20], [20, 250]]]], $this->headers($u))->assertStatus(422);
        $this->postJson("/api/assets/{$orig['id']}/enhance", ['mode' => 'preserve', 'options' => ['perspective' => [[60, 40], [340, 20], [380, 270]]]], $this->headers($u))->assertStatus(422);
        $this->postJson("/api/assets/{$orig['id']}/enhance", ['mode' => 'preserve', 'options' => ['perspective' => [[0, 0], [9999, 0], [9999, 9999], [0, 9999]]]], $this->headers($u))->assertStatus(422);
    }
}

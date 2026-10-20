<?php

namespace Tests\Feature;

use App\Models\Asset;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class AiSegmentTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        config(['services.ai.api_key' => 'sk-test-secret-123', 'services.ai.base_url' => 'http://ai.test/v1']);
    }

    private function headers(?User $u = null): array
    {
        $this->app['auth']->forgetGuards();

        return ['Authorization' => 'Bearer '.($u ?? User::factory()->create())->createToken('t')->plainTextToken, 'Accept' => 'application/json'];
    }

    /** @return array{0: array, 1: int, 2: array} headers, project id, asset (400x600) */
    private function projectWithImage(): array
    {
        $h = $this->headers();
        $pid = $this->postJson('/api/projects', ['name' => 'P'], $h)->json('data.id');
        $im = imagecreatetruecolor(400, 600);
        imagefill($im, 0, 0, imagecolorallocate($im, 255, 255, 255));
        imagefilledrectangle($im, 100, 200, 300, 500, imagecolorallocate($im, 30, 90, 200));
        $tmp = tempnam(sys_get_temp_dir(), 'seg').'.png';
        imagepng($im, $tmp);
        $asset = $this->post("/api/projects/$pid/assets", ['file' => new UploadedFile($tmp, 'char.png', 'image/png', null, true)], $h)->assertCreated()->json('data');

        return [$h, $pid, $asset];
    }

    private function reply(array $data): void
    {
        Http::fake(['ai.test/*' => Http::response(['choices' => [['message' => ['content' => "```json\n".json_encode($data)."\n```"]]]])]);
    }

    public function test_plan_is_converted_to_pixels_and_sanitised(): void
    {
        [$h, , $asset] = $this->projectWithImage();
        $this->reply(['notes' => 'ok', 'parts' => [
            ['name' => 'Badan', 'box' => ['x' => 250, 'y' => 333, 'w' => 500, 'h' => 500], 'parent' => null, 'joint' => ['x' => 500, 'y' => 700]],
            ['name' => 'Kepala', 'box' => ['x' => 300, 'y' => 100, 'w' => 400, 'h' => 233], 'parent' => 'badan'], // case-insensitive parent
            ['name' => 'Kepala', 'box' => ['x' => 0, 'y' => 0, 'w' => 5000, 'h' => 5000], 'parent' => 'Hantu'], // duplicate name, clamped, unknown parent
            ['name' => 'Titik', 'box' => ['x' => 10, 'y' => 10, 'w' => 2, 'h' => 2], 'parent' => null], // too small
            ['name' => 'A', 'box' => ['x' => 0, 'y' => 0, 'w' => 100, 'h' => 100], 'parent' => 'B'],
            ['name' => 'B', 'box' => ['x' => 100, 'y' => 0, 'w' => 100, 'h' => 100], 'parent' => 'A'], // cycle
            ['name' => 'Rusak', 'box' => 'x'],
        ]]);

        $id = $this->postJson("/api/assets/{$asset['id']}/ai/segment", [], $h)->assertStatus(202)->json('data.id');
        $job = $this->getJson("/api/ai/jobs/$id", $h)->json('data');
        $this->assertSame('done', $job['status'], (string) $job['error']);

        $parts = collect($job['result']['parts'])->keyBy('name');
        $this->assertEqualsCanonicalizing(['x' => 100, 'y' => 200, 'w' => 200, 'h' => 300], $parts['Badan']['box']); // 1000-grid -> 400x600 px
        $this->assertEqualsCanonicalizing(['x' => 200, 'y' => 420], $parts['Badan']['joint']);
        $this->assertSame('Badan', $parts['Kepala']['parent']);
        $this->assertTrue($parts->has('Kepala 2'), 'duplicate name renamed');
        $this->assertNull($parts['Kepala 2']['parent'], 'unknown parent -> root');
        $this->assertEqualsCanonicalizing(['x' => 0, 'y' => 0, 'w' => 400, 'h' => 600], $parts['Kepala 2']['box'], 'clamped to the image');
        $this->assertFalse($parts->has('Titik'));
        $this->assertFalse($parts->has('Rusak'));
        $this->assertTrue($parts['A']['parent'] === null || $parts['B']['parent'] === null, 'cycle broken');
        $this->assertNotEmpty($job['result']['warnings']);

        Http::assertSent(function ($req) {
            $img = collect($req['messages'][1]['content'])->firstWhere('type', 'image_url');

            return $img && str_starts_with($img['image_url']['url'], 'data:image/jpeg;base64,');
        });
    }

    public function test_apply_cuts_boxes_into_new_assets_all_or_nothing(): void
    {
        [$h, , $asset] = $this->projectWithImage();
        $this->reply(['parts' => [['name' => 'Badan', 'box' => ['x' => 250, 'y' => 333, 'w' => 500, 'h' => 500], 'parent' => null]]]);
        $id = $this->postJson("/api/assets/{$asset['id']}/ai/segment", [], $h)->json('data.id');

        $before = Asset::count();
        $r = $this->postJson("/api/ai/jobs/$id/segment/apply", ['parts' => [
            ['name' => 'Badan', 'x' => 100, 'y' => 200, 'w' => 200, 'h' => 300],
            ['name' => 'Kepala', 'x' => 150, 'y' => 50, 'w' => 100, 'h' => 120],
        ]], $h)->assertCreated();
        $this->assertSame([200, 300], [$r->json('data.0.asset.width'), $r->json('data.0.asset.height')]);
        $this->assertSame([100, 120], [$r->json('data.1.asset.width'), $r->json('data.1.asset.height')]);
        $this->assertSame($before + 2, Asset::count());

        // out of bounds -> rejected, nothing created
        $this->postJson("/api/ai/jobs/$id/segment/apply", ['parts' => [['name' => 'X', 'x' => 350, 'y' => 0, 'w' => 100, 'h' => 10]]], $h)->assertStatus(422);
        $this->assertSame($before + 2, Asset::count());

        // somebody else cannot cut from my job
        $this->postJson("/api/ai/jobs/$id/segment/apply", ['parts' => [['name' => 'X', 'x' => 0, 'y' => 0, 'w' => 10, 'h' => 10]]], $this->headers())->assertNotFound();
    }

    public function test_guards(): void
    {
        [$h, , $asset] = $this->projectWithImage();
        $this->postJson("/api/assets/{$asset['id']}/ai/segment", [], $this->headers())->assertNotFound();
        Http::fake(['ai.test/*' => Http::response(['error' => ['message' => 'nope']], 401)]);
        $this->app['auth']->forgetGuards(); // the previous call authenticated as somebody else
        $id =$this->postJson("/api/assets/{$asset['id']}/ai/segment", [], $h)->json('data.id');
        $job = $this->getJson("/api/ai/jobs/$id", $h)->json('data');
        $this->assertSame('failed', $job['status']);
        $this->assertStringNotContainsString('sk-test-secret-123', json_encode($job));
        $this->postJson("/api/ai/jobs/$id/segment/apply", ['parts' => [['name' => 'X', 'x' => 0, 'y' => 0, 'w' => 10, 'h' => 10]]], $h)->assertStatus(409);
        config(['services.ai.api_key' => null]);
        $this->postJson("/api/assets/{$asset['id']}/ai/segment", [], $h)->assertStatus(503);
    }
}

<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class AiMotionTest extends TestCase
{
    use RefreshDatabase;

    private const SECRET = 'sk-test-secret-123';

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.ai.api_key' => self::SECRET, 'services.ai.base_url' => 'http://ai.test/v1', 'services.ai.model' => 'test-model']);
    }

    private function headers(?User $u = null): array
    {
        $this->app['auth']->forgetGuards();

        return ['Authorization' => 'Bearer '.($u ?? User::factory()->create())->createToken('t')->plainTextToken, 'Accept' => 'application/json'];
    }

    private function projectWithRig(array $h): int
    {
        $p = $this->postJson('/api/projects', ['name' => 'P'], $h)->json('data');
        $mk = fn (string $id, ?string $parent, array $x = []) => $x + ['id' => $id, 'type' => 'bone', 'name' => strtoupper($id), 'x' => 0, 'y' => 0, 'scaleX' => 1, 'scaleY' => 1, 'rotation' => 0, 'opacity' => 1, 'visible' => true, 'locked' => false, 'parentId' => $parent, 'length' => 100];
        $layers = [$mk('arm', null), $mk('hand', 'arm', ['ik' => ['target' => 'goal', 'bend' => 1]]), $mk('goal', null), $mk('tail', null)];
        $this->putJson("/api/projects/{$p['id']}", ['document' => ['settings' => $p['document']['settings'], 'layers' => $layers]], $h)->assertOk();

        return $p['id'];
    }

    private function fakeReply(string $content): void
    {
        Http::fake(['ai.test/*' => Http::response(['choices' => [['message' => ['content' => $content]]]])]);
    }

    public function test_status_never_leaks_the_key(): void
    {
        $r = $this->getJson('/api/ai/status', $this->headers())->assertOk();
        $this->assertTrue($r->json('data.configured'));
        $this->assertFalse($r->json('data.features.image_to_video'));
        $this->assertStringNotContainsString(self::SECRET, $r->getContent());
    }

    public function test_plan_is_sanitised(): void
    {
        $h = $this->headers();
        $pid = $this->projectWithRig($h);
        $reply = "Tentu!\n```json\n".json_encode([
            'duration' => 2,
            'notes' => 'Melambai',
            'tracks' => [
                ['layer' => 'tail', 'prop' => 'rotation', 'keys' => [['t' => 1, 'v' => 99999, 'e' => 'weird'], ['t' => 0, 'v' => 0, 'e' => 'easeInOut'], ['t' => 2, 'v' => 0, 'e' => 'linear']]],
                ['layer' => 'arm', 'prop' => 'rotation', 'keys' => [['t' => 0, 'v' => 0], ['t' => 1, 'v' => 30]]], // IK-locked: dropped
                ['layer' => 'ghost', 'prop' => 'x', 'keys' => [['t' => 0, 'v' => 1], ['t' => 1, 'v' => 2]]],
                ['layer' => 'hand', 'prop' => 'rotation', 'keys' => [['t' => 0, 'v' => 0], ['t' => 1, 'v' => 10]]],
                ['layer' => 'goal', 'prop' => 'x', 'keys' => [['t' => 0, 'v' => 50], ['t' => 1, 'v' => 150]]],
                ['layer' => 'goal', 'prop' => 'opacity', 'keys' => [['t' => 0, 'v' => 1]]],
                ['layer' => 'goal', 'prop' => 'bogus', 'keys' => [['t' => 0, 'v' => 1], ['t' => 1, 'v' => 2]]],
            ],
        ])."\n```";
        $this->fakeReply($reply);

        $id = $this->postJson("/api/projects/$pid/ai/motion", ['prompt' => 'lambaikan tangan'], $h)->assertStatus(202)->json('data.id');
        $job = $this->getJson("/api/ai/jobs/$id", $h)->assertOk()->json('data'); // queue is sync in tests

        $this->assertSame('done', $job['status'], (string) $job['error']);
        $tracks = $job['result']['tracks'];
        $this->assertCount(2, $tracks, 'only tail.rotation and goal.x survive');
        $arm = collect($tracks)->firstWhere('layer', 'tail');
        $this->assertSame([0.0, 1.0, 2.0], array_map('floatval', array_column($arm['keys'], 't')), 'sorted by time');
        $this->assertSame(1440.0, (float) $arm['keys'][1]['v'], 'value clamped');
        $this->assertSame('easeInOut', $arm['keys'][1]['e'], 'unknown easing falls back');
        $this->assertGreaterThanOrEqual(4, count($job['result']['dropped']));
        $this->assertSame('Melambai', $job['result']['notes']);

        // the key goes out as a Bearer token, to the configured base URL, with the model name
        Http::assertSent(fn ($req) => $req->hasHeader('Authorization', 'Bearer '.self::SECRET)
            && $req->url() === 'http://ai.test/v1/chat/completions' && $req['model'] === 'test-model'
            && str_contains(json_encode($req['messages']), 'ik_locked'));
        $this->assertStringNotContainsString(self::SECRET, json_encode($job));
    }

    public function test_bad_key_is_reported_without_leaking_it(): void
    {
        $h = $this->headers();
        $pid = $this->projectWithRig($h);
        Http::fake(['ai.test/*' => Http::response(['error' => ['message' => 'Missing API key']], 401)]);
        $id = $this->postJson("/api/projects/$pid/ai/motion", ['prompt' => 'jalan'], $h)->json('data.id');
        $job = $this->getJson("/api/ai/jobs/$id", $h)->json('data');
        $this->assertSame('failed', $job['status']);
        $this->assertStringContainsString('API key 9router ditolak', $job['error']);
        $this->assertStringNotContainsString(self::SECRET, json_encode($job));
    }

    public function test_invalid_model_output_is_retried_once_then_fails(): void
    {
        $h = $this->headers();
        $pid = $this->projectWithRig($h);
        $this->fakeReply('maaf, saya tidak bisa');
        $id = $this->postJson("/api/projects/$pid/ai/motion", ['prompt' => 'jalan'], $h)->json('data.id');
        $job = $this->getJson("/api/ai/jobs/$id", $h)->json('data');
        $this->assertSame('failed', $job['status']);
        $this->assertStringContainsString('rencana gerak yang valid', $job['error']);
        Http::assertSentCount(2);
    }

    public function test_unreachable_gateway_message(): void
    {
        $h = $this->headers();
        $pid = $this->projectWithRig($h);
        Http::fake(fn () => throw new \Illuminate\Http\Client\ConnectionException('refused'));
        $id = $this->postJson("/api/projects/$pid/ai/motion", ['prompt' => 'jalan'], $h)->json('data.id');
        $this->assertStringContainsString('Pastikan 9router sedang berjalan', $this->getJson("/api/ai/jobs/$id", $h)->json('data.error'));
    }

    public function test_guards(): void
    {
        $h = $this->headers();
        $pid = $this->projectWithRig($h);
        $this->postJson("/api/projects/$pid/ai/motion", ['prompt' => 'x'], $h)->assertStatus(422); // too short
        $this->postJson("/api/projects/$pid/ai/motion", ['prompt' => 'jalan'], $this->headers())->assertNotFound(); // other user's project
        config(['services.ai.api_key' => null]);
        $this->postJson("/api/projects/$pid/ai/motion", ['prompt' => 'jalan'], $this->headers(\App\Models\Project::find($pid)->user))->assertStatus(503);
    }

    public function test_job_of_another_user_is_hidden(): void
    {
        $h = $this->headers();
        $pid = $this->projectWithRig($h);
        $this->fakeReply('{}');
        $id = $this->postJson("/api/projects/$pid/ai/motion", ['prompt' => 'jalan'], $h)->json('data.id');
        $this->getJson("/api/ai/jobs/$id", $this->headers())->assertNotFound();
    }
}
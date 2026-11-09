<?php

namespace Tests\Feature;

use App\Jobs\GenerateStory;
use App\Jobs\ProduceEpisode;
use App\Models\Character;
use App\Models\StoryEpisode;
use App\Models\StorySeries;
use App\Models\User;
use App\Services\DailyCartoonService;
use App\Services\StoryWriter;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

/** Story series: idea -> AI-written episodes -> scheduled films. */
class StorySeriesTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.ai.api_key' => null]); // no AI unless a test turns it on: the machine's real 9router must not decide these tests
        $this->user = User::factory()->create();
        foreach (['Uki', 'Sekar', 'Pak Suga'] as $n) {
            Character::create(['user_id' => $this->user->id, 'kind' => 'builder', 'name' => $n, 'method' => 'rig']);
        }
    }

    private function h(?User $u = null): array
    {
        $this->app['auth']->forgetGuards();

        return ['Authorization' => 'Bearer '.($u ?? $this->user)->createToken('t')->plainTextToken, 'Accept' => 'application/json'];
    }

    private function body(array $extra = []): array
    {
        return $extra + ['title' => 'Uki SMK', 'premise' => 'Uki masuk SMK Informatika dan belajar tidak menyerah.', 'tone' => 'hangat',
            'characters' => [['name' => 'uki', 'role' => 'tokoh utama', 'voice' => 'male'], ['name' => 'SEKAR', 'traits' => 'ramah', 'voice' => 'female']]];
    }

    private function series(array $extra = []): StorySeries
    {
        return StorySeries::create($extra + ['user_id' => $this->user->id, 'title' => 'S', 'premise' => 'Premis cerita panjang.', 'characters' => [['name' => 'Uki', 'voice' => 'male'], ['name' => 'Sekar', 'voice' => 'female']], 'use_narrator' => true]);
    }

    private function aiReplies(array ...$json): void
    {
        config(['services.ai.api_key' => 'k', 'services.ai.base_url' => 'http://ai.test/v1']);
        Http::fake(['ai.test/*' => Http::sequence(array_map(fn ($j) => Http::response(['choices' => [['message' => ['content' => json_encode($j)]]]]), $json))]);
    }

    public function test_series_needs_builder_characters_and_names_are_matched_ignoring_case(): void
    {
        $r = $this->postJson('/api/story/series', $this->body(), $this->h())->assertCreated();
        $this->assertSame(['Uki', 'Sekar'], array_column($r->json('data.characters'), 'name'));
        $this->assertFalse($r->json('data.capabilities.ai'));

        $this->postJson('/api/story/series', $this->body(['characters' => [['name' => 'Hantu']]]), $this->h())->assertStatus(422)->assertSee('Character Builder');
        $this->postJson('/api/story/series', $this->body(['characters' => [['name' => 'Uki'], ['name' => 'uki']]]), $this->h())->assertStatus(422)->assertSee('ganda');
        $this->postJson('/api/story/series', $this->body(['title' => '']), $this->h())->assertStatus(422);
        $this->postJson('/api/story/series', $this->body(['schedule_time' => '25:00']), $this->h())->assertStatus(422);
    }

    public function test_several_characters_may_share_a_name_and_the_series_remembers_which_one(): void
    {
        $first = Character::where('user_id', $this->user->id)->where('name', 'Uki')->first();
        $second = Character::create(['user_id' => $this->user->id, 'kind' => 'builder', 'name' => 'Uki', 'method' => 'rig']);

        $byName = $this->postJson('/api/story/series', $this->body(['characters' => [['name' => 'uki']]]), $this->h())->assertCreated();
        $this->assertSame($first->id, $byName->json('data.characters.0.id'), 'no id given: the oldest one with that name');

        $picked = $this->postJson('/api/story/series', $this->body(['characters' => [['id' => $second->id, 'name' => 'x', 'voice' => 'male'], ['name' => 'Sekar']]]), $this->h())->assertCreated();
        $this->assertSame([$second->id, 'Uki'], [$picked->json('data.characters.0.id'), $picked->json('data.characters.0.name')]);
        $series = StorySeries::find($picked->json('data.id'));
        $this->assertSame(['uki' => $second->id, 'sekar' => Character::where('name', 'Sekar')->value('id')], $series->characterIds());

        $other = User::factory()->create();
        $theirs = Character::create(['user_id' => $other->id, 'kind' => 'builder', 'name' => 'Uki', 'method' => 'rig']);
        $stolen = $this->postJson('/api/story/series', $this->body(['characters' => [['id' => $theirs->id, 'name' => 'Uki']]]), $this->h())->assertCreated();
        $this->assertSame($first->id, $stolen->json('data.characters.0.id'), "someone else's character id is ignored");
    }

    public function test_series_are_private_to_their_owner(): void
    {
        $s = $this->series();
        $other = User::factory()->create();
        $this->getJson("/api/story/series/{$s->id}", $this->h($other))->assertNotFound();
        $this->deleteJson("/api/story/series/{$s->id}", [], $this->h($other))->assertNotFound();
        $this->assertSame([], $this->getJson('/api/story/series', $this->h($other))->json('data'));
        $this->assertCount(1, $this->getJson('/api/story/series', $this->h())->json('data'));
    }

    public function test_auto_run_needs_a_time(): void
    {
        $s = $this->series();
        $this->patchJson("/api/story/series/{$s->id}", ['auto_run' => true], $this->h())->assertStatus(422);
        $this->patchJson("/api/story/series/{$s->id}", ['auto_run' => true, 'schedule_time' => '07:30', 'auto_publish' => true], $this->h())->assertOk()->assertJsonPath('data.schedule_time', '07:30');
    }

    public function test_ai_writes_the_outline_and_then_the_scripts_and_only_the_cast_may_speak(): void
    {
        $s = $this->series();
        $this->aiReplies(
            ['episodes' => [['title' => 'Hari Pertama', 'synopsis' => 'Uki tiba.'], ['title' => 'Ujian', 'synopsis' => 'Ujian pertama.']]],
            ['title' => 'Hari Pertama', 'theme' => 'berani', 'scenes' => [['name' => 'Gerbang', 'location' => 'halaman sekolah', 'time' => 'pagi', 'dialog' => [
                ['who' => 'narrator', 'text' => 'Pagi itu Uki tiba di sekolah.'], ['who' => 'UKI', 'text' => 'Wah, besar sekali!'], ['who' => 'Hantu', 'text' => 'Buu!'], ['who' => 'Sekar', 'text' => 'Selamat datang.'],
            ]], ['name' => 'Kosong', 'location' => 'Taman', 'time' => 'siang', 'dialog' => [['who' => 'Hantu', 'text' => 'Hanya hantu']]]]],
            ['title' => 'Ujian', 'scenes' => [['name' => 'Kelas', 'location' => 'Ruang kelas', 'time' => 'malam', 'dialog' => [['who' => 'Sekar', 'text' => 'Mulai ujian.']]]]],
        );

        GenerateStory::dispatchSync($s->id, 'all', 2);

        $s->refresh();
        $this->assertSame('idle', $s->ai_status);
        $eps = $s->episodes()->get();
        $this->assertSame(['Hari Pertama', 'Ujian'], $eps->pluck('title')->all());
        $this->assertSame(['scripted', 'scripted'], $eps->pluck('status')->all());

        $scenes = $eps[0]->script['scenes'];
        $this->assertCount(1, $scenes, 'the scene only the unknown speaker talks in disappears');
        $this->assertSame('Halaman sekolah', $scenes[0]['location'], 'location is matched to the film maker names');
        $this->assertSame([['Narator', 'Pagi itu Uki tiba di sekolah.'], ['Uki', 'Wah, besar sekali!'], ['Sekar', 'Selamat datang.']], array_map(fn ($d) => [$d['who'], $d['text']], $scenes[0]['dialog']));
        $this->assertSame('malam', $eps[1]->script['scenes'][0]['time']);
    }

    public function test_a_failing_ai_is_reported_on_the_series_and_keeps_earlier_work(): void
    {
        $s = $this->series();
        $s->episodes()->create(['number' => 1, 'title' => 'Satu', 'synopsis' => 'x', 'status' => 'planned']);
        config(['services.ai.api_key' => 'k', 'services.ai.base_url' => 'http://ai.test/v1']);
        Http::fake(['ai.test/*' => Http::response(['choices' => [['message' => ['content' => 'bukan json sama sekali']]]])]);

        GenerateStory::dispatchSync($s->id, 'scripts');

        $s->refresh();
        $this->assertSame('failed', $s->ai_status);
        $this->assertStringContainsString('JSON', $s->ai_message);
        $this->assertSame('planned', $s->episodes()->first()->status);
    }

    public function test_generate_refuses_without_ai_and_while_another_run_is_going(): void
    {
        $s = $this->series();
        $this->postJson("/api/story/series/{$s->id}/generate", ['mode' => 'all'], $this->h())->assertStatus(503);
        $this->postJson("/api/story/series/{$s->id}/generate", ['mode' => 'nonsense'], $this->h())->assertStatus(422);
    }

    public function test_the_author_can_type_a_script_and_it_is_cleaned_like_an_ai_one(): void
    {
        $s = $this->series();
        $e = $s->episodes()->create(['number' => 1, 'title' => 'Satu', 'status' => 'planned']);
        $script = ['scenes' => [['name' => 'A', 'location' => 'dapur', 'time' => 'sore', 'dialog' => [['who' => 'sekar', 'text' => 'Halo'], ['who' => 'X', 'text' => 'abaikan']]]]];
        $r = $this->patchJson("/api/story/episodes/{$e->id}", ['script' => $script], $this->h())->assertOk();
        $this->assertSame('scripted', $r->json('data.status'));
        $this->assertSame([['who' => 'Sekar', 'text' => 'Halo']], $r->json('data.script.scenes.0.dialog'));
        $this->patchJson("/api/story/episodes/{$e->id}", ['script' => ['scenes' => [['name' => 'A', 'dialog' => [['who' => 'X', 'text' => 'z']]]]]], $this->h())->assertStatus(422);
        $this->patchJson("/api/story/episodes/{$e->id}", ['script' => null], $this->h())->assertOk()->assertJsonPath('data.status', 'planned');
        $this->patchJson("/api/story/episodes/{$e->id}", ['scheduled_at' => '2030-01-01 07:00:00'], $this->h())->assertOk();
    }

    public function test_a_typed_script_keeps_its_actions_sound_effects_and_background_people(): void
    {
        $s = $this->series();
        $e = $s->episodes()->create(['number' => 1, 'title' => 'Satu', 'status' => 'planned']);
        $script = ['scenes' => [
            ['name' => 'A', 'location' => 'dapur', 'time' => 'sore', 'cast' => ['Kris', 'Arum'], 'after' => [['action' => 'Uki melompat']], 'dialog' => [
                ['who' => 'X', 'text' => 'dibuang', 'before' => [['sfx' => 'bel']]], // its speaker is unknown: the bell still rings
                ['who' => 'uki', 'text' => 'Halo', 'before' => [['action' => 'Uki melambai']]],
            ]],
            ['name' => 'Tanpa kata', 'location' => 'Taman', 'time' => 'pagi', 'dialog' => [], 'after' => [['action' => 'Uki berjalan'], ['sfx' => 'langkah']]],
        ]];
        $r = $this->patchJson("/api/story/episodes/{$e->id}", ['script' => $script], $this->h())->assertOk();
        $this->assertSame(['Kris', 'Arum'], $r->json('data.script.scenes.0.cast'));
        $this->assertSame([['who' => 'Uki', 'text' => 'Halo', 'before' => [['sfx' => 'bel'], ['action' => 'Uki melambai']]]], $r->json('data.script.scenes.0.dialog'));
        $this->assertSame([['action' => 'Uki melompat']], $r->json('data.script.scenes.0.after'));
        $this->assertSame([], $r->json('data.script.scenes.1.dialog'));
        $this->assertSame([['action' => 'Uki berjalan'], ['sfx' => 'langkah']], $r->json('data.script.scenes.1.after'));
        // nothing at all is still refused
        $this->patchJson("/api/story/episodes/{$e->id}", ['script' => ['scenes' => [['name' => 'A', 'dialog' => []]]]], $this->h())->assertStatus(422);
    }

    public function test_the_beats_of_a_scene_survive_saving_the_project(): void
    {
        $p = $this->postJson('/api/projects', ['name' => 'Beat'], $this->h())->assertCreated()->json('data');
        $doc = $p['document'];
        $doc['scenes'][0]['board'] = ['location' => 'Taman', 'beats' => [['at' => 0.5, 'sfx' => 'bel', 'junk' => 'x'], ['at' => 2.5, 'action' => 'Uki melambai']]];
        $r = $this->putJson("/api/projects/{$p['id']}", ['document' => $doc, 'base_revision' => $p['revision']], $this->h())->assertOk();
        $this->assertSame([['at' => 0.5, 'sfx' => 'bel'], ['at' => 2.5, 'action' => 'Uki melambai']], $r->json('data.document.scenes.0.board.beats'));
    }

    public function test_produce_queues_once_and_needs_a_script_or_ai(): void
    {
        Queue::fake();
        config(['services.clipper.path' => null, 'services.clipper.account' => null]); // the machine's real .env must not decide this test
        $s = $this->series();
        $bare = $s->episodes()->create(['number' => 1, 'title' => 'Tanpa naskah', 'status' => 'planned']);
        $this->postJson("/api/story/episodes/{$bare->id}/produce", [], $this->h())->assertStatus(422);

        $ready = $s->episodes()->create(['number' => 2, 'title' => 'Siap', 'status' => 'scripted', 'script' => ['scenes' => [['name' => 'A', 'location' => 'Taman', 'time' => 'siang', 'dialog' => [['who' => 'Uki', 'text' => 'Hai']]]]]]);
        $this->postJson("/api/story/episodes/{$ready->id}/produce", ['publish' => true], $this->h())->assertStatus(422)->assertSee('YouTube'); // not set up here
        $this->postJson("/api/story/episodes/{$ready->id}/produce", [], $this->h())->assertStatus(202)->assertJsonPath('data.status', 'queued');
        Queue::assertPushed(ProduceEpisode::class, fn ($j) => $j->episodeId === $ready->id);
        $this->postJson("/api/story/episodes/{$ready->id}/produce", [], $this->h())->assertStatus(409);
        $this->patchJson("/api/story/episodes/{$ready->id}", ['title' => 'x'], $this->h())->assertStatus(409);
    }

    public function test_run_due_starts_scheduled_episodes_and_one_episode_a_day_per_auto_series(): void
    {
        Queue::fake();
        $s = $this->series(['auto_run' => true, 'schedule_time' => '00:00', 'auto_publish' => true]);
        $one = $s->episodes()->create(['number' => 1, 'title' => 'Satu', 'status' => 'scripted']);
        $two = $s->episodes()->create(['number' => 2, 'title' => 'Dua', 'status' => 'planned']);
        $timed = $s->episodes()->create(['number' => 3, 'title' => 'Berjadwal', 'status' => 'scripted', 'scheduled_at' => now()->subMinute()]);
        $future = $s->episodes()->create(['number' => 4, 'title' => 'Nanti', 'status' => 'scripted', 'scheduled_at' => now()->addDay()]);

        $this->artisan('story:run-due')->assertSuccessful();

        $this->assertSame('queued', $timed->fresh()->status);
        $this->assertSame('queued', $one->fresh()->status, 'the first unscheduled episode');
        $this->assertTrue($one->fresh()->publish, 'follows the series auto-publish setting');
        $this->assertSame('planned', $two->fresh()->status);
        $this->assertSame('scripted', $future->fresh()->status);
        Queue::assertPushed(ProduceEpisode::class, 2);

        $this->artisan('story:run-due')->assertSuccessful(); // same day: nothing more for the daily run
        Queue::assertPushed(ProduceEpisode::class, 2);
    }

    public function test_narrator_is_recognised_and_series_know_their_voices(): void
    {
        $this->assertTrue(DailyCartoonService::isNarrator('Narator'));
        $this->assertTrue(DailyCartoonService::isNarrator(' narrator '));
        $this->assertFalse(DailyCartoonService::isNarrator('Uki'));
        $s = $this->series(['narrator_voice' => 'id-ID-GadisNeural']);
        $this->assertEquals(['uki' => 'id-ID-ArdiNeural', 'sekar' => 'id-ID-GadisNeural', 'narator' => 'id-ID-GadisNeural', 'narrator' => 'id-ID-GadisNeural'], $s->voices());
        $this->assertSame(['Uki', 'Sekar'], $s->characterNames());
    }

    public function test_writer_keeps_only_allowed_speakers(): void
    {
        $w = app(StoryWriter::class);
        $out = $w->clean(['scenes' => [['name' => 's', 'dialog' => [['who' => 'uki', 'text' => 'a'], ['who' => 'Narrator', 'text' => 'b']]]]], ['Uki', 'Narator']);
        $this->assertSame(['Uki', 'Narator'], array_column($out['scenes'][0]['dialog'], 'who'));
        $this->expectException(\RuntimeException::class);
        $w->clean(['scenes' => [['name' => 's', 'dialog' => [['who' => 'Hantu', 'text' => 'a']]]]], ['Uki']);
    }

    public function test_an_episode_belongs_to_one_series_and_is_removed_with_it(): void
    {
        $s = $this->series();
        $s->episodes()->create(['number' => 1, 'title' => 'x', 'status' => 'planned']);
        $this->deleteJson("/api/story/series/{$s->id}", [], $this->h())->assertOk();
        $this->assertSame(0, StoryEpisode::count());
    }
}

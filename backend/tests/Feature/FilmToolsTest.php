<?php

namespace Tests\Feature;

use App\Models\Asset;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\Process\Process;
use Tests\TestCase;

/** Camera, effects, subtitles, storyboard notes, image swaps, balloons and audio fades in the project document. */
class FilmToolsTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
    }

    private function headers(): array
    {
        $this->app['auth']->forgetGuards();

        return ['Authorization' => 'Bearer '.User::factory()->create()->createToken('t')->plainTextToken, 'Accept' => 'application/json'];
    }

    private function layer(string $id, array $extra = []): array
    {
        return $extra + ['id' => $id, 'type' => 'shape', 'name' => $id, 'x' => 1, 'y' => 2, 'scaleX' => 1, 'scaleY' => 1, 'rotation' => 0, 'opacity' => 1, 'visible' => true, 'locked' => false, 'width' => 50, 'height' => 50, 'fill' => '#112233'];
    }

    private function doc(array $scene, array $audio = []): array
    {
        return ['schema' => 2, 'settings' => ['width' => 1280, 'height' => 720, 'fps' => 24], 'scenes' => [$scene + ['id' => 's1', 'name' => 'S1', 'duration' => 3, 'background' => '#ffffff', 'transition' => null, 'layers' => []]], 'audio' => $audio];
    }

    private function project(array $h): int
    {
        return $this->postJson('/api/projects', ['name' => 'P'], $h)->json('data.id');
    }

    public function test_scene_extras_round_trip_in_order(): void
    {
        $h = $this->headers();
        $pid = $this->project($h);
        $scene = [
            'camera' => ['zoom' => [['f' => 24, 'v' => 1.5, 'e' => 'easeInOut'], ['f' => 0, 'v' => 1, 'e' => 'linear']], 'x' => [['f' => 0, 'v' => 100, 'e' => 'linear']]],
            'effects' => [['id' => 'e1', 'kind' => 'rain', 'intensity' => 0.5], ['id' => 'e2', 'kind' => 'tint', 'intensity' => 0.4, 'color' => '#1c2a66', 'blend' => 'multiply', 'label' => 'Malam']],
            'subtitles' => [['id' => 'a', 'start' => 0, 'end' => 1, 'text' => 'Halo'], ['id' => 'b', 'start' => 1, 'end' => 2, 'text' => 'Hai']],
            'board' => ['location' => 'Sekolah', 'summary' => 'Pagi hari', 'dialog' => [['id' => 'd1', 'who' => 'Uki', 'text' => 'Halo!'], ['id' => 'd2', 'who' => 'Sekar', 'text' => 'Hai']], 'cast' => ['Ines', 'Pak Suga']],
            'transition' => ['type' => 'wipe', 'duration' => 1],
        ];
        $r = $this->putJson("/api/projects/$pid", ['document' => $this->doc($scene)], $h)->assertOk();
        $s = $r->json('data.document.scenes.0');
        $this->assertSame([0, 24], array_column($s['camera']['zoom'], 'f'), 'camera keys are sorted by frame');
        $this->assertSame(['e1', 'e2'], array_column($s['effects'], 'id'));
        $this->assertSame('Malam', $s['effects'][1]['label']);
        $this->assertSame(['Halo', 'Hai'], array_column($s['subtitles'], 'text'));
        $this->assertSame(['Uki', 'Sekar'], array_column($s['board']['dialog'], 'who'));
        $this->assertSame(['Ines', 'Pak Suga'], $s['board']['cast'], 'the crowd of the scene is kept');
        $this->assertSame('wipe', $s['transition']['type']);

        // empty lists are dropped; the stored document is what a reload returns
        $r = $this->putJson("/api/projects/$pid", ['document' => $this->doc(['effects' => [], 'subtitles' => []])], $h)->assertOk();
        $this->assertArrayNotHasKey('effects', $r->json('data.document.scenes.0'));
        $this->assertArrayNotHasKey('subtitles', $r->json('data.document.scenes.0'));
    }

    public function test_invalid_extras_are_rejected(): void
    {
        $h = $this->headers();
        $pid = $this->project($h);
        $bad = [
            ['effects' => [['id' => 'e', 'kind' => 'lava', 'intensity' => 1]]],
            ['effects' => [['id' => 'e', 'kind' => 'rain', 'intensity' => 5]]],
            ['subtitles' => [['id' => 'a', 'start' => 0, 'end' => 1, 'text' => str_repeat('x', 301)]]],
            ['camera' => ['zoom' => [['f' => 1.5, 'v' => 1, 'e' => 'linear']]]],
            ['camera' => ['zoom' => [['f' => 1, 'v' => 1, 'e' => 'bounce']]]],
            ['transition' => ['type' => 'spiral', 'duration' => 1]],
        ];
        foreach ($bad as $i => $scene) {
            $this->putJson("/api/projects/$pid", ['document' => $this->doc($scene)], $h)->assertStatus(422, "case $i");
        }
        $this->putJson("/api/projects/$pid", ['document' => $this->doc([], [['id' => 'c', 'assetId' => 1, 'name' => 'x', 'start' => 0, 'volume' => 1, 'kind' => 'radio']])], $h)->assertStatus(422);
        $this->putJson("/api/projects/$pid", ['document' => $this->doc([], [['id' => 'c', 'assetId' => 1, 'name' => 'x', 'start' => 0, 'volume' => 1, 'fadeIn' => 99]])], $h)->assertStatus(422);
    }

    public function test_layer_swaps_expressions_rig_and_balloon_fields_are_kept(): void
    {
        $h = $this->headers();
        $pid = $this->project($h);
        $png = UploadedFile::fake()->image('a.png', 20, 20);
        $a = $this->post("/api/projects/$pid/assets", ['file' => $png], $h)->assertCreated()->json('data.id');
        $b = $this->post("/api/projects/$pid/assets", ['file' => UploadedFile::fake()->image('b.png', 20, 20)], $h)->assertCreated()->json('data.id');
        $layers = [
            $this->layer('mouth', ['type' => 'image', 'assetId' => $a, 'swaps' => [['f' => 30, 'assetId' => $b], ['f' => 10, 'assetId' => $a]], 'expr' => ['default' => $a, 'senang' => $b], 'rig' => ['id' => 'r1', 'role' => 'piece:mouth']]),
            $this->layer('bal', ['type' => 'balloon', 'text' => 'Halo', 'fontSize' => 32, 'fill' => '#111111', 'bubble' => 'thought', 'bubbleFill' => '#ffffff', 'tailX' => -40, 'tailY' => 90]),
            $this->layer('oval', ['shape' => 'ellipse']),
        ];
        $r = $this->putJson("/api/projects/$pid", ['document' => $this->doc(['layers' => $layers])], $h)->assertOk();
        $m = $r->json('data.document.scenes.0.layers.0');
        $this->assertSame([10, 30], array_column($m['swaps'], 'f'), 'swaps sorted by frame');
        $this->assertSame($b, $m['expr']['senang']);
        $this->assertSame('piece:mouth', $m['rig']['role']);
        $bal = $r->json('data.document.scenes.0.layers.1');
        $this->assertSame('thought', $bal['bubble']);
        $this->assertSame(90, $bal['tailY']);
        $this->assertSame('ellipse', $r->json('data.document.scenes.0.layers.2.shape'));

        $this->putJson("/api/projects/$pid", ['document' => $this->doc(['layers' => [$this->layer('x', ['shape' => 'star'])]])], $h)->assertStatus(422);
        $this->putJson("/api/projects/$pid", ['document' => $this->doc(['layers' => [$this->layer('x', ['type' => 'balloon', 'bubble' => 'cloud'])]])], $h)->assertStatus(422);

        // duplicating the project remaps swap and expression asset ids to the copied assets
        $copy = $this->postJson("/api/projects/$pid/duplicate", [], $h)->assertCreated()->json('data');
        $cm = $copy['document']['scenes'][0]['layers'][0];
        $this->assertNotSame($a, $cm['assetId']);
        $this->assertNotContains($b, array_column($cm['swaps'], 'assetId'));
        $this->assertNotContains($b, $cm['expr']);
        $this->assertTrue(Asset::whereIn('id', $cm['expr'])->where('project_id', $copy['id'])->count() === 2);
    }

    public function test_export_applies_audio_fades(): void
    {
        $tmp = sys_get_temp_dir().'/ft_'.uniqid();
        $run = function (array $args) {
            $p = new Process([config('services.ffmpeg.bin'), '-y', '-loglevel', 'error', ...$args]);
            $p->run();
            if (! $p->isSuccessful()) {
                $this->markTestSkipped('ffmpeg unavailable: '.$p->getErrorOutput());
            }
        };
        $run(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', "$tmp.wav"]);
        $run(['-f', 'lavfi', '-i', 'color=c=white:s=160x90:d=2:r=10', '-c:v', 'libvpx', "$tmp.webm"]);
        $h = $this->headers();
        $pid = $this->project($h);
        $tone = $this->post("/api/projects/$pid/audio", ['file' => new UploadedFile("$tmp.wav", 'tone.wav', 'audio/wav', null, true)], $h)->assertCreated()->json('data');

        $this->putJson("/api/projects/$pid", ['document' => $this->doc([], [['id' => 'c', 'assetId' => $tone['id'], 'name' => 't', 'start' => 0, 'volume' => 1, 'kind' => 'sfx', 'fadeIn' => 0.5, 'fadeOut' => 0.5]])], $h)->assertOk()
            ->assertJsonPath('data.document.audio.0.kind', 'sfx')->assertJsonPath('data.document.audio.0.fadeOut', 0.5);

        $job = $this->post("/api/projects/$pid/exports", ['format' => 'mp4', 'width' => 160, 'height' => 90, 'fps' => 10, 'file' => new UploadedFile("$tmp.webm", 'v.webm', 'video/webm', null, true),
            'audio' => json_encode([['asset_id' => $tone['id'], 'start' => 0, 'volume' => 1, 'fade_in' => 0.5, 'fade_out' => 0.5]])], $h)->assertStatus(202)->json('data');
        $e = \App\Models\ExportJob::find($job['id']);
        $this->assertSame(0.5, $e->audio[0]['fade_in']);
        $e->refresh();
        $this->assertSame('done', $e->status, (string) $e->error);

        // the first and last 0.2 s of the mixed file are much quieter than the middle (fades applied)
        $out = Storage::disk('local')->path($e->output_path);
        $vol = function (float $from, float $len) use ($out): float {
            $p = new Process([config('services.ffmpeg.bin'), '-hide_banner', '-ss', (string) $from, '-t', (string) $len, '-i', $out, '-vn', '-af', 'volumedetect', '-f', 'null', '-']);
            $p->run();
            preg_match('/mean_volume:\s*(-?[\d.]+) dB/', $p->getErrorOutput(), $m);

            return (float) ($m[1] ?? 0);
        };
        $this->assertLessThan($vol(0.8, 0.4) - 6, $vol(0.0, 0.2), 'fade-in: start is quieter than the middle');
        $this->assertLessThan($vol(0.8, 0.4) - 6, $vol(1.8, 0.2), 'fade-out: end is quieter than the middle');
        @unlink("$tmp.wav");
        @unlink("$tmp.webm");
    }

    public function test_a_burst_of_image_uploads_does_not_lock_out_audio_uploads(): void
    {
        $tmp = sys_get_temp_dir().'/ra_'.uniqid().'.wav';
        $p = new Process([config('services.ffmpeg.bin'), '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.5', $tmp]);
        $p->run();
        if (! $p->isSuccessful()) {
            $this->markTestSkipped('ffmpeg unavailable');
        }
        $h = $this->headers();
        $pid = $this->project($h);
        // inserting a rigged character uploads 15-25 pieces at once, a script several characters: more than 60 in a minute
        for ($i = 0; $i < 75; $i++) {
            $this->post("/api/projects/$pid/assets", ['file' => UploadedFile::fake()->image("p$i.png", 8, 8)], $h)->assertCreated();
        }
        $this->post("/api/projects/$pid/audio", ['file' => new UploadedFile($tmp, 'a.wav', 'audio/wav', null, true)], $h)->assertCreated();
        @unlink($tmp);
    }

    public function test_daily_cartoon_flags_survive_a_save(): void
    {
        $h = $this->headers();
        $pid = $this->project($h);
        $doc = $this->doc([]) + ['auto_generated' => true, 'characters' => ['Kris', 'Riska']];
        $r = $this->putJson("/api/projects/$pid", ['document' => $doc], $h)->assertOk();
        $this->assertTrue($r->json('data.document.auto_generated'));
        $this->assertSame(['Kris', 'Riska'], $r->json('data.document.characters'));
        // after the editor placed the characters it saves the flag as false: it must be kept as false, not dropped
        $doc['auto_generated'] = false;
        $this->assertFalse($this->putJson("/api/projects/$pid", ['document' => $doc], $h)->assertOk()->json('data.document.auto_generated'));
        $this->putJson("/api/projects/$pid", ['document' => array_merge($doc, ['characters' => array_fill(0, 11, 'x')])], $h)->assertStatus(422);
    }

    public function test_export_skips_audio_whose_file_is_missing_instead_of_failing_the_film(): void
    {
        $tmp = sys_get_temp_dir().'/ms_'.uniqid();
        foreach ([['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', "$tmp.wav"], ['-f', 'lavfi', '-i', 'color=c=white:s=160x90:d=2:r=10', '-c:v', 'libvpx', "$tmp.webm"]] as $args) {
            $p = new Process([config('services.ffmpeg.bin'), '-y', '-loglevel', 'error', ...$args]);
            $p->run();
            if (! $p->isSuccessful()) {
                $this->markTestSkipped('ffmpeg unavailable');
            }
        }
        $h = $this->headers();
        $pid = $this->project($h);
        $good = $this->post("/api/projects/$pid/audio", ['file' => new UploadedFile("$tmp.wav", 'a.wav', 'audio/wav', null, true)], $h)->assertCreated()->json('data');
        $lost = $this->post("/api/projects/$pid/audio", ['file' => new UploadedFile("$tmp.wav", 'b.wav', 'audio/wav', null, true)], $h)->assertCreated()->json('data');
        $row = Asset::find($lost['id']);
        Storage::disk($row->disk)->delete($row->path); // a text-to-speech run that left only the database row

        $job = $this->post("/api/projects/$pid/exports", ['format' => 'mp4', 'width' => 160, 'height' => 90, 'fps' => 10, 'file' => new UploadedFile("$tmp.webm", 'v.webm', 'video/webm', null, true),
            'audio' => json_encode([['asset_id' => $good['id'], 'start' => 0, 'volume' => 1], ['asset_id' => $lost['id'], 'start' => 0.5, 'volume' => 1]])], $h)->assertStatus(202)->json('data');
        $e = \App\Models\ExportJob::find($job['id'])->refresh();
        $this->assertSame('done', $e->status, (string) $e->error);
        @unlink("$tmp.wav");
        @unlink("$tmp.webm");
    }

    public function test_asset_urls_are_stable_for_a_while_so_the_browser_can_cache_images(): void
    {
        $h = $this->headers();
        $pid = $this->project($h);
        $id = $this->post("/api/projects/$pid/assets", ['file' => UploadedFile::fake()->image('a.png', 8, 8)], $h)->assertCreated()->json('data.id');
        $urls = [];
        for ($i = 0; $i < 3; $i++) {
            $urls[] = $this->getJson("/api/projects/$pid/assets", $h)->assertOk()->json('data.0.url');
        }
        $this->assertSame($urls[0], $urls[1], 'same URL on every load within the step');
        $this->assertSame($urls[0], $urls[2]);
        parse_str((string) parse_url($urls[0], PHP_URL_QUERY), $q);
        $this->assertSame(0, ((int) $q['expires']) % 1800, 'expiry rounded to the 30 minute step');
        $this->assertGreaterThanOrEqual(time() + 11.5 * 3600, (int) $q['expires'], 'still valid for ~12 hours');
        $this->get($urls[0])->assertOk(); // the signature is valid
        $this->get(preg_replace('/signature=[0-9a-f]+/', 'signature=deadbeef', $urls[0]))->assertForbidden();
    }

    public function test_a_hand_written_script_can_put_a_silent_crowd_in_a_scene(): void
    {
        $svc = app(\App\Services\DailyCartoonService::class);
        $out = $svc->validateScript(['title' => 'MOS', 'scenes' => [['name' => 'Upacara', 'location' => 'Lapangan upacara', 'cast' => ['Ines', ' Riska ', 'Ines', 'Narator', ''], 'dialog' => [['who' => 'Pak Suga', 'text' => 'Selamat datang!']]]]]);
        $this->assertSame(['Ines', 'Riska'], $out['scenes'][0]['cast']);
        $this->expectException(\InvalidArgumentException::class);
        $svc->validateScript(['scenes' => [['cast' => array_map(fn ($i) => "Siswa $i", range(1, 17)), 'dialog' => [['who' => 'A', 'text' => 'b']]]]]);
    }
}

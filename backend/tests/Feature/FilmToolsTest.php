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
            'board' => ['location' => 'Sekolah', 'summary' => 'Pagi hari', 'dialog' => [['id' => 'd1', 'who' => 'Uki', 'text' => 'Halo!'], ['id' => 'd2', 'who' => 'Sekar', 'text' => 'Hai']]],
            'transition' => ['type' => 'wipe', 'duration' => 1],
        ];
        $r = $this->putJson("/api/projects/$pid", ['document' => $this->doc($scene)], $h)->assertOk();
        $s = $r->json('data.document.scenes.0');
        $this->assertSame([0, 24], array_column($s['camera']['zoom'], 'f'), 'camera keys are sorted by frame');
        $this->assertSame(['e1', 'e2'], array_column($s['effects'], 'id'));
        $this->assertSame('Malam', $s['effects'][1]['label']);
        $this->assertSame(['Halo', 'Hai'], array_column($s['subtitles'], 'text'));
        $this->assertSame(['Uki', 'Sekar'], array_column($s['board']['dialog'], 'who'));
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
}

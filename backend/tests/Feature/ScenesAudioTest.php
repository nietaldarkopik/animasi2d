<?php

namespace Tests\Feature;

use App\Models\Asset;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\Process\Process;
use Tests\TestCase;

class ScenesAudioTest extends TestCase
{
    use RefreshDatabase;

    /** @var list<string> temp files created by helpers, removed after each test */
    private array $tmp = [];

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
    }

    protected function tearDown(): void
    {
        foreach ($this->tmp as $f) {
            @unlink($f);
        }
        parent::tearDown();
    }

    private function headers(?User $u = null): array
    {
        $this->app['auth']->forgetGuards();

        return ['Authorization' => 'Bearer '.($u ?? User::factory()->create())->createToken('t')->plainTextToken, 'Accept' => 'application/json'];
    }

    private function layer(string $id, array $extra = []): array
    {
        return $extra + ['id' => $id, 'type' => 'shape', 'name' => $id, 'x' => 1, 'y' => 2, 'scaleX' => 1, 'scaleY' => 1, 'rotation' => 0, 'opacity' => 1, 'visible' => true, 'locked' => false, 'width' => 50, 'height' => 50, 'fill' => '#112233'];
    }

    private function scene(string $id, array $layers = [], array $extra = []): array
    {
        return $extra + ['id' => $id, 'name' => strtoupper($id), 'duration' => 3, 'background' => '#ffffff', 'transition' => null, 'layers' => $layers];
    }

    private function doc(array $scenes, array $audio = []): array
    {
        return ['schema' => 2, 'settings' => ['width' => 1280, 'height' => 720, 'fps' => 24], 'scenes' => $scenes, 'audio' => $audio];
    }

    private function ffmpeg(array $args): string
    {
        $out = sys_get_temp_dir().'/sa_'.uniqid().'.'.pathinfo(end($args), PATHINFO_EXTENSION);
        $this->tmp[] = $out;
        $args[count($args) - 1] = $out;
        $p = new Process([config('services.ffmpeg.bin'), '-y', '-loglevel', 'error', ...$args]);
        $p->run();
        if (! $p->isSuccessful()) {
            $this->markTestSkipped('ffmpeg unavailable: '.$p->getErrorOutput());
        }

        return $out;
    }

    private function uploadAudio(array $h, int $pid, float $seconds = 1.0): array
    {
        $wav = $this->ffmpeg(['-f', 'lavfi', '-i', "sine=frequency=440:duration=$seconds", 'x.wav']);

        return $this->post("/api/projects/$pid/audio", ['file' => new UploadedFile($wav, 'tone.wav', 'audio/wav', null, true)], $h)->assertCreated()->json('data');
    }

    public function test_schema1_documents_are_converted_to_one_scene(): void
    {
        $h = $this->headers();
        $p = $this->postJson('/api/projects', ['name' => 'P'], $h)->json('data');
        $this->assertCount(1, $p['document']['scenes']);
        $v1 = ['settings' => ['width' => 800, 'height' => 600, 'fps' => 30, 'duration' => 7.5, 'background' => '#112233'], 'layers' => [$this->layer('a')]];
        $r = $this->putJson("/api/projects/{$p['id']}", ['document' => $v1], $h)->assertOk();
        $this->assertSame(2, $r->json('data.document.schema'));
        $this->assertSame(800, $r->json('data.document.settings.width'));
        $this->assertSame(7.5, $r->json('data.document.scenes.0.duration'));
        $this->assertSame('#112233', $r->json('data.document.scenes.0.background'));
        $this->assertSame('a', $r->json('data.document.scenes.0.layers.0.id'));
        $this->assertSame([], $r->json('data.document.audio'));
    }

    public function test_old_stored_documents_are_upgraded_on_read(): void
    {
        $h = $this->headers();
        $p = $this->postJson('/api/projects', ['name' => 'P'], $h)->json('data');
        \App\Models\Project::find($p['id'])->update(['document' => ['settings' => ['width' => 640, 'height' => 360, 'fps' => 12, 'duration' => 2, 'background' => '#000000'], 'layers' => [$this->layer('old')]]]);
        $r = $this->getJson("/api/projects/{$p['id']}", $h)->assertOk();
        $this->assertSame('old', $r->json('data.document.scenes.0.layers.0.id'));
        $this->assertSame(640, $r->json('data.document.settings.width'));
    }

    public function test_multi_scene_validation_and_ordering(): void
    {
        $h = $this->headers();
        $pid = $this->postJson('/api/projects', ['name' => 'P'], $h)->json('data.id');
        $kf = ['x' => [['f' => 10, 'v' => 1, 'e' => 'linear'], ['f' => 0, 'v' => 0, 'e' => 'linear']]];
        $doc = $this->doc([
            $this->scene('s1', [$this->layer('a')], ['transition' => ['type' => 'fade', 'duration' => 0.8]]),
            $this->scene('s2', [$this->layer('a'), $this->layer('b', ['keyframes' => $kf]), $this->layer('c')]), // same layer id as scene 1 is fine
        ]);
        $r = $this->putJson("/api/projects/$pid", ['document' => $doc], $h)->assertOk();
        $scenes = $r->json('data.document.scenes');
        $this->assertTrue(array_is_list($scenes) && array_is_list($scenes[1]['layers']));
        $this->assertSame(['a', 'b', 'c'], array_column($scenes[1]['layers'], 'id'));
        $this->assertSame([0, 10], array_column($scenes[1]['layers'][1]['keyframes']['x'], 'f'));
        $this->assertSame('fade', $scenes[0]['transition']['type']);
        $this->assertNull($scenes[1]['transition']);

        $bad = $doc;
        $bad['scenes'][0]['transition']['type'] = 'explode';
        $this->putJson("/api/projects/$pid", ['document' => $bad], $h)->assertStatus(422);
        $bad = $doc;
        $bad['scenes'][1]['id'] = 's1';
        $this->putJson("/api/projects/$pid", ['document' => $bad], $h)->assertStatus(422); // duplicate scene id
        $bad = $doc;
        $bad['scenes'][1]['layers'][0]['parentId'] = 'zzz';
        $this->putJson("/api/projects/$pid", ['document' => $bad], $h)->assertStatus(422)->assertJsonPath('message', 'S2: Parent layer tidak ditemukan.');
        $bad = $doc;
        $bad['scenes'] = [];
        $this->putJson("/api/projects/$pid", ['document' => $bad], $h)->assertStatus(422);
        $bad = $doc;
        $bad['scenes'][0]['duration'] = 0.1;
        $this->putJson("/api/projects/$pid", ['document' => $bad], $h)->assertStatus(422);
    }

    public function test_audio_upload_validates_content_and_reports_duration(): void
    {
        $h = $this->headers();
        $pid = $this->postJson('/api/projects', ['name' => 'P'], $h)->json('data.id');
        $a = $this->uploadAudio($h, $pid, 1.5);
        $this->assertEqualsWithDelta(1.5, $a['duration'], 0.1);
        $this->assertStringStartsWith('audio/', $a['mime']);
        $this->get($a['url'])->assertOk();

        $this->post("/api/projects/$pid/audio", ['file' => UploadedFile::fake()->createWithContent('x.mp3', 'not audio at all')], $h)->assertStatus(422);
        $this->post("/api/projects/$pid/audio", ['file' => UploadedFile::fake()->image('p.png')], $h)->assertStatus(422);
        $this->post("/api/projects/$pid/audio", ['file' => UploadedFile::fake()->create('x.mp3', 1, 'audio/mpeg')], $this->headers())->assertNotFound();

        // audio assets are not images
        $this->postJson("/api/assets/{$a['id']}/process", ['ops' => [['op' => 'trim']]], $this->headers(User::find(Asset::find($a['id'])->user_id)))->assertStatus(422);
    }

    public function test_audio_clips_must_reference_audio_assets_of_the_project(): void
    {
        $h = $this->headers();
        $pid = $this->postJson('/api/projects', ['name' => 'P'], $h)->json('data.id');
        $audio = $this->uploadAudio($h, $pid);
        $img = $this->post("/api/projects/$pid/assets", ['file' => UploadedFile::fake()->image('i.png', 10, 10)], $h)->json('data');
        $clip = fn (int $id) => ['id' => 'c1', 'assetId' => $id, 'name' => 'tone', 'start' => 1.5, 'volume' => 0.8];
        $doc = fn (array $audioClips) => $this->doc([$this->scene('s1')], $audioClips);

        $this->putJson("/api/projects/$pid", ['document' => $doc([$clip($audio['id'])])], $h)->assertOk()->assertJsonPath('data.document.audio.0.start', 1.5);
        $this->putJson("/api/projects/$pid", ['document' => $doc([$clip($img['id'])])], $h)->assertStatus(422);
        $this->putJson("/api/projects/$pid", ['document' => $doc([$clip(999999)])], $h)->assertStatus(422);
        $bad = $clip($audio['id']);
        $bad['volume'] = 3;
        $this->putJson("/api/projects/$pid", ['document' => $doc([$bad])], $h)->assertStatus(422);
    }

    public function test_duplicate_remaps_assets_in_every_scene_and_audio(): void
    {
        $h = $this->headers();
        $pid = $this->postJson('/api/projects', ['name' => 'P'], $h)->json('data.id');
        $audio = $this->uploadAudio($h, $pid);
        $img = $this->post("/api/projects/$pid/assets", ['file' => UploadedFile::fake()->image('i.png', 10, 10)], $h)->json('data');
        $doc = $this->doc([
            $this->scene('s1', [$this->layer('a', ['type' => 'image', 'assetId' => $img['id']])]),
            $this->scene('s2', [$this->layer('b', ['type' => 'image', 'assetId' => $img['id']])]),
        ], [['id' => 'c1', 'assetId' => $audio['id'], 'name' => 'tone', 'start' => 0, 'volume' => 1]]);
        $this->putJson("/api/projects/$pid", ['document' => $doc], $h)->assertOk();

        $copy = $this->postJson("/api/projects/$pid/duplicate", [], $h)->assertCreated()->json('data.document');
        $newImg = $copy['scenes'][0]['layers'][0]['assetId'];
        $this->assertNotSame($img['id'], $newImg);
        $this->assertSame($newImg, $copy['scenes'][1]['layers'][0]['assetId']);
        $this->assertNotSame($audio['id'], $copy['audio'][0]['assetId']);
        $this->assertTrue(Asset::where('id', $copy['audio'][0]['assetId'])->where('mime', 'like', 'audio/%')->exists());
    }

    public function test_audio_padding_never_makes_the_output_endless(): void
    {
        $h = $this->headers();
        $pid = $this->postJson('/api/projects', ['name' => 'P'], $h)->json('data.id');
        $tone = $this->uploadAudio($h, $pid, 0.5);
        // no duration header, like a browser recording (-fflags +bitexact + live-style muxing)
        $video = $this->ffmpeg(['-f', 'lavfi', '-i', 'color=c=red:s=160x90:d=1.5:r=10', '-c:v', 'libvpx', '-f', 'webm', '-live', '1', 'v.webm']);
        $r = $this->post("/api/projects/$pid/exports", ['format' => 'mp4', 'width' => 160, 'height' => 90, 'fps' => 10, 'file' => new UploadedFile($video, 'v.webm', 'video/webm', null, true), 'audio' => json_encode([['asset_id' => $tone['id'], 'start' => 0, 'volume' => 1]])], $h)->assertStatus(202);
        $job = $this->getJson('/api/exports/'.$r->json('data.id'), $h)->json('data');
        $this->assertSame('done', $job['status'], (string) $job['error']);
        $out = Storage::disk('local')->path(\App\Models\ExportJob::find($r->json('data.id'))->output_path);
        $probe = new Process([config('services.ffmpeg.probe'), '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', $out]);
        $probe->run();
        $this->assertEqualsWithDelta(1.5, (float) trim($probe->getOutput()), 0.4);
        $this->assertLessThan(500_000, filesize($out), 'output must be tiny, not an endless padded stream');
    }

    public function test_export_mixes_audio_with_ffmpeg(): void
    {
        $h = $this->headers();
        $pid = $this->postJson('/api/projects', ['name' => 'P'], $h)->json('data.id');
        $tone = $this->uploadAudio($h, $pid, 1.0);
        $video = $this->ffmpeg(['-f', 'lavfi', '-i', 'color=c=blue:s=160x90:d=2:r=10', '-c:v', 'libvpx', 'v.webm']);

        foreach (['mp4' => 'aac', 'webm' => 'opus'] as $format => $codec) {
            $r = $this->post("/api/projects/$pid/exports", [
                'format' => $format, 'width' => 160, 'height' => 90, 'fps' => 10,
                'file' => new UploadedFile($video, 'v.webm', 'video/webm', null, true),
                'audio' => json_encode([['asset_id' => $tone['id'], 'start' => 0.2, 'volume' => 0.7], ['asset_id' => $tone['id'], 'start' => 0.4, 'volume' => 0.5]]),
            ], $h)->assertStatus(202);
            $job = $this->getJson('/api/exports/'.$r->json('data.id'), $h)->json('data');
            $this->assertSame('done', $job['status'], (string) $job['error']);

            $out = Storage::disk('local')->path(\App\Models\ExportJob::find($r->json('data.id'))->output_path);
            $probe = new Process([config('services.ffmpeg.probe'), '-v', 'error', '-show_entries', 'stream=codec_type,codec_name', '-show_entries', 'format=duration', '-of', 'json', $out]);
            $probe->run();
            $info = json_decode($probe->getOutput(), true);
            $types = array_column($info['streams'], 'codec_name', 'codec_type');
            $this->assertSame($codec, $types['audio'] ?? null, "$format must contain $codec audio");
            $this->assertArrayHasKey('video', $types);
            $this->assertEqualsWithDelta(2.0, (float) $info['format']['duration'], 0.35, 'output keeps the VIDEO length even when the audio ends earlier (audio is padded with silence)');
        }

        // without audio there is no audio stream; bad clip lists are rejected
        $r = $this->post("/api/projects/$pid/exports", ['format' => 'mp4', 'width' => 160, 'height' => 90, 'fps' => 10, 'file' => new UploadedFile($video, 'v.webm', 'video/webm', null, true)], $h)->assertStatus(202);
        $out = Storage::disk('local')->path(\App\Models\ExportJob::find($r->json('data.id'))->output_path);
        $probe = new Process([config('services.ffmpeg.probe'), '-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', $out]);
        $probe->run();
        $this->assertSame('', trim($probe->getOutput()));
        $this->post("/api/projects/$pid/exports", ['format' => 'mp4', 'width' => 160, 'height' => 90, 'fps' => 10, 'file' => new UploadedFile($video, 'v.webm', 'video/webm', null, true), 'audio' => json_encode([['asset_id' => 424242, 'start' => 0, 'volume' => 1]])], $h)->assertStatus(422);
        $this->post("/api/projects/$pid/exports", ['format' => 'mp4', 'width' => 160, 'height' => 90, 'fps' => 10, 'file' => new UploadedFile($video, 'v.webm', 'video/webm', null, true), 'audio' => 'garbage'], $h)->assertStatus(422);
    }
}

<?php

namespace Tests\Feature;

use App\Models\ExportJob;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\Process\Process;
use Tests\TestCase;
use ZipArchive;

class ExportFormatsTest extends TestCase
{
    use RefreshDatabase;

    private ?string $video = null;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        $this->video = sys_get_temp_dir().'/ef_'.uniqid().'.webm';
        $p = new Process([config('services.ffmpeg.bin'), '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=s=160x90:d=2:r=10', '-c:v', 'libvpx', $this->video]);
        $p->run();
        if (! $p->isSuccessful()) {
            $this->markTestSkipped('ffmpeg unavailable: '.$p->getErrorOutput());
        }
    }

    protected function tearDown(): void
    {
        $this->video && @unlink($this->video);
        parent::tearDown();
    }

    private function export(string $format, array $extra = []): ExportJob
    {
        $u = User::factory()->create();
        $h = ['Authorization' => 'Bearer '.$u->createToken('t')->plainTextToken, 'Accept' => 'application/json'];
        $pid = $this->postJson('/api/projects', ['name' => 'P'], $h)->json('data.id');
        $r = $this->post("/api/projects/$pid/exports", ['format' => $format, 'width' => 160, 'height' => 90, 'fps' => 10, 'file' => new UploadedFile($this->video, 'v.webm', 'video/webm', null, true)] + $extra, $h)->assertStatus(202);

        return ExportJob::findOrFail($r->json('data.id'));
    }

    public function test_gif_export_is_a_real_animated_gif(): void
    {
        $job = $this->export('gif')->fresh();
        $this->assertSame('done', $job->status, (string) $job->error);
        $bytes = Storage::disk('local')->get($job->output_path);
        $this->assertStringStartsWith('GIF89a', $bytes);
        $this->assertGreaterThan(5, substr_count($bytes, "\x21\xF9\x04")); // graphic-control extension per frame
        $this->assertStringContainsString('NETSCAPE2.0', $bytes);           // loop extension
    }

    public function test_sprite_sheet_export_contains_grid_png_and_matching_json(): void
    {
        $job = $this->export('sprite_sheet', ['max_frames' => 100])->fresh();
        $this->assertSame('done', $job->status, (string) $job->error);

        $zip = new ZipArchive;
        $this->assertTrue($zip->open(Storage::disk('local')->path($job->output_path)));
        $meta = json_decode($zip->getFromName('sheet.json'), true);
        $png = imagecreatefromstring($zip->getFromName('sheet.png'));
        $this->assertSame(20, $meta['frames']); // 2s * 10fps
        $this->assertSame(5, $meta['columns']);
        $this->assertSame(4, $meta['rows']);
        $this->assertSame($meta['columns'] * $meta['frameWidth'], imagesx($png));
        $this->assertSame($meta['rows'] * $meta['frameHeight'], imagesy($png));
    }

    public function test_sprite_sheet_thins_out_sampling_above_the_frame_cap(): void
    {
        $job = $this->export('sprite_sheet', ['max_frames' => 8])->fresh();
        $this->assertSame('done', $job->status, (string) $job->error);
        $zip = new ZipArchive;
        $zip->open(Storage::disk('local')->path($job->output_path));
        $this->assertSame(8, json_decode($zip->getFromName('sheet.json'), true)['frames']);
    }

    public function test_unknown_formats_are_rejected(): void
    {
        $u = User::factory()->create();
        $h = ['Authorization' => 'Bearer '.$u->createToken('t')->plainTextToken, 'Accept' => 'application/json'];
        $pid = $this->postJson('/api/projects', ['name' => 'P'], $h)->json('data.id');
        $this->post("/api/projects/$pid/exports", ['format' => 'avi', 'width' => 160, 'height' => 90, 'fps' => 10, 'file' => new UploadedFile($this->video, 'v.webm', 'video/webm', null, true)], $h)->assertStatus(422);
    }

    private function frameZip(array $names): string
    {
        $path = sys_get_temp_dir().'/fz_'.uniqid().'.zip';
        $zip = new ZipArchive;
        $zip->open($path, ZipArchive::CREATE);
        foreach ($names as $name) {
            $im = imagecreatetruecolor(8, 8);
            imagealphablending($im, false);
            imagesavealpha($im, true);
            imagefill($im, 0, 0, imagecolorallocatealpha($im, 255, 0, 0, 127)); // fully transparent
            ob_start();
            imagepng($im);
            $zip->addFromString($name, ob_get_clean());
        }
        $zip->close();

        return $path;
    }

    public function test_transparent_png_sequence_keeps_the_alpha_channel(): void
    {
        $u = User::factory()->create();
        $h = ['Authorization' => 'Bearer '.$u->createToken('t')->plainTextToken, 'Accept' => 'application/json'];
        $pid = $this->postJson('/api/projects', ['name' => 'P'], $h)->json('data.id');
        $zipPath = $this->frameZip(['frame_00001.png', 'frame_00002.png']);

        $r = $this->post("/api/projects/$pid/exports", ['format' => 'png_sequence', 'transparent' => 1, 'width' => 64, 'height' => 64, 'fps' => 10, 'file' => new UploadedFile($zipPath, 'frames.zip', 'application/zip', null, true)], $h)->assertStatus(202);
        $job = ExportJob::find($r->json('data.id'));
        $this->assertSame('done', $job->status, (string) $job->error);

        $zip = new ZipArchive;
        $zip->open(Storage::disk('local')->path($job->output_path));
        $this->assertSame(2, $zip->numFiles);
        $im = imagecreatefromstring($zip->getFromName('frame_00001.png'));
        $this->assertSame(127, (imagecolorat($im, 3, 3) >> 24) & 0x7F, 'alpha survived the export');
        $this->assertFalse(Storage::disk('local')->exists($job->source_path));
    }

    public function test_transparent_upload_is_validated(): void
    {
        $u = User::factory()->create();
        $h = ['Authorization' => 'Bearer '.$u->createToken('t')->plainTextToken, 'Accept' => 'application/json'];
        $pid = $this->postJson('/api/projects', ['name' => 'P'], $h)->json('data.id');
        $send = fn (string $fmt, string $file) => $this->post("/api/projects/$pid/exports", ['format' => $fmt, 'transparent' => 1, 'width' => 64, 'height' => 64, 'fps' => 10, 'file' => new UploadedFile($file, 'f.zip', 'application/zip', null, true)], $h);

        $send('png_sequence', $this->frameZip(['../evil.png']))->assertStatus(422);       // path traversal name
        $send('png_sequence', $this->video)->assertStatus(422);                           // not a zip
        $send('mp4', $this->frameZip(['frame_00001.png']))->assertStatus(422);            // transparent only for PNG
        $notPng = sys_get_temp_dir().'/np_'.uniqid().'.zip';
        $z = new ZipArchive;
        $z->open($notPng, ZipArchive::CREATE);
        $z->addFromString('frame_00001.png', 'not a png');
        $z->close();
        $send('png_sequence', $notPng)->assertStatus(422);
    }
}

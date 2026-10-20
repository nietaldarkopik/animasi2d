<?php

namespace App\Jobs;

use App\Models\Asset;
use App\Models\ExportJob;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Storage;
use RuntimeException;
use Symfony\Component\Process\Process;
use ZipArchive;

class ProcessExport implements ShouldQueue
{
    use Queueable;

    public int $tries = 1;

    public int $timeout = 900;

    public function __construct(public int $exportId) {}

    public function handle(): void
    {
        $export = ExportJob::findOrFail($this->exportId);
        $export->update(['status' => 'processing', 'error' => null]);

        try {
            $disk = Storage::disk('local');
            $src = $disk->path($export->source_path);
            $base = preg_replace('/\.src\.(webm|zip)$/', '', $export->source_path);

            $out = ($export->format === 'png_sequence' && ($export->options['transparent'] ?? false)) ? $this->passThroughZip($disk, $export->source_path, $base.'.zip') : match ($export->format) {
                'webm' => $this->toVideo($export, $src, $disk->path($base.'.webm'), $base.'.webm', ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '32'], ['-c:a', 'libopus', '-b:a', '128k']),
                'mp4' => $this->toVideo($export, $src, $disk->path($base.'.mp4'), $base.'.mp4', ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'medium', '-crf', '20', '-movflags', '+faststart'], ['-c:a', 'aac', '-b:a', '160k']),
                'gif' => $this->toGif($export, $src, $disk->path($base.'.gif'), $base.'.gif'),
                'sprite_sheet' => $this->toSpriteSheet($export, $src, $disk->path($base.'.sheet'), $disk->path($base.'.sheet.zip'), $base.'.sheet.zip'),
                'png_sequence' => $this->toPngZip($export, $src, $disk->path($base.'.frames'), $disk->path($base.'.zip'), $base.'.zip'),
            };

            $export->update(['status' => 'done', 'output_path' => $out]);
            $disk->delete($export->source_path); // the raw recording can be up to hundreds of MB; keep it only for failed exports
        } catch (\Throwable $e) {
            report($e);
            $export->update(['status' => 'failed', 'error' => mb_substr($e->getMessage(), 0, 1000)]);
        }
    }

    /** Transparent PNG frames were rendered (with alpha) in the browser and validated at upload: no re-encode, or alpha would be lost. */
    private function passThroughZip($disk, string $from, string $to): string
    {
        $disk->copy($from, $to);

        return $to;
    }

    private function ffmpeg(array $args): void
    {
        $p = new Process([config('services.ffmpeg.bin'), '-y', '-hide_banner', '-loglevel', 'error', ...$args]);
        $p->setTimeout(800);
        $p->run();
        if (! $p->isSuccessful()) {
            throw new RuntimeException('FFmpeg gagal: '.trim($p->getErrorOutput()));
        }
    }

    private function size(ExportJob $e): array
    {
        // libx264/yuv420p needs even dimensions.
        return [$e->width & ~1, $e->height & ~1];
    }

    private function scale(ExportJob $e): string
    {
        [$w, $h] = $this->size($e);

        return sprintf('scale=%d:%d:force_original_aspect_ratio=decrease,pad=%d:%d:(ow-iw)/2:(oh-ih)/2:color=white,fps=%d', $w, $h, $w, $h, $e->fps);
    }

    /**
     * Video (+ optional mixed audio). Each clip is delayed to its start time and scaled by its volume; the clips are
     * summed (amix, un-normalised) and cut at the end of the video.
     */
    private function toVideo(ExportJob $e, string $src, string $dst, string $rel, array $vcodec, array $acodec): string
    {
        $this->fpsHint = $e->fps;
        $clips = $this->audioInputs($e);
        $seconds = $clips === [] ? 0.0 : $this->videoSeconds($src);
        if ($clips === []) {
            $this->ffmpeg(['-i', $src, '-vf', $this->scale($e), ...$vcodec, '-an', $dst]);

            return $rel;
        }

        $args = ['-i', $src];
        $filters = ['[0:v]'.$this->scale($e).'[v]'];
        $labels = [];
        foreach ($clips as $i => $c) {
            $args[] = '-i';
            $args[] = $c['path'];
            $n = $i + 1;
            $ms = (int) round($c['start'] * 1000);
            $filters[] = "[$n:a]aresample=48000,".$this->fades($c)."adelay=$ms:all=1,volume=".round($c['volume'], 3)."[a$n]";
            $labels[] = "[a$n]";
        }
        // Pad the mix with silence up to the VIDEO length. `whole_dur` keeps the stream finite: an unbounded `apad` made
        // FFmpeg's filter queues overflow intermittently (reported as ENOSPC). Audio longer than the video is cut by -t.
        $pad = sprintf('apad=whole_dur=%.3f', $seconds);
        $filters[] = count($labels) === 1
            ? $labels[0].$pad.'[aout]'
            : implode('', $labels).'amix=inputs='.count($labels).':duration=longest:normalize=0,'.$pad.'[aout]';

        // the output length is capped explicitly (-t) at the video length: a runaway encode must never fill the disk
        $this->ffmpeg([...$args, '-filter_complex', implode(';', $filters), '-map', '[v]', '-map', '[aout]', ...$vcodec, ...$acodec, '-t', sprintf('%.3f', $seconds), $dst]);

        return $rel;
    }

    /**
     * Length of the recorded video. Browser (MediaRecorder) WebM files usually carry no duration header, so fall back to
     * the last packet timestamp; if even that fails use the largest allowed scene length.
     */
    private function videoSeconds(string $src): float
    {
        $run = function (array $args) use ($src): string {
            $p = new Process([config('services.ffmpeg.probe'), '-v', 'error', ...$args, $src]);
            $p->setTimeout(60);
            $p->run();

            return $p->isSuccessful() ? trim($p->getOutput()) : '';
        };

        $d = $run(['-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1']);
        if (is_numeric($d) && (float) $d > 0) {
            return (float) $d;
        }
        $times = array_filter(array_map('floatval', explode("\n", $run(['-select_streams', 'v:0', '-show_entries', 'packet=pts_time', '-of', 'csv=p=0']))));

        return $times ? max($times) + 1 / max(1, $this->fpsHint ?? 24) : 600.0;
    }

    private ?int $fpsHint = null;

    /** afade filters (with trailing comma) for the clip's fade-in / fade-out; fade-out needs the clip length. */
    private function fades(array $c): string
    {
        $out = '';
        $dur = (float) ($c['duration'] ?? 0);
        $in = min((float) ($c['fade_in'] ?? 0), $dur > 0 ? $dur : 30);
        if ($in > 0.01) {
            $out .= sprintf('afade=t=in:st=0:d=%.3f,', $in);
        }
        $fo = min((float) ($c['fade_out'] ?? 0), $dur);
        if ($fo > 0.01 && $dur > 0) {
            $out .= sprintf('afade=t=out:st=%.3f:d=%.3f,', max(0, $dur - $fo), $fo);
        }

        return $out;
    }

    /** @return list<array{path: string, start: float, volume: float}> clips whose asset still exists */
    private function audioInputs(ExportJob $e): array
    {
        $out = [];
        foreach ($e->audio ?? [] as $clip) {
            $asset = Asset::where('project_id', $e->project_id)->where('mime', 'like', 'audio/%')->find($clip['asset_id'] ?? 0);
            if ($asset) {
                $out[] = ['path' => Storage::disk($asset->disk)->path($asset->path), 'start' => (float) $clip['start'], 'volume' => (float) $clip['volume'], 'fade_in' => (float) ($clip['fade_in'] ?? 0), 'fade_out' => (float) ($clip['fade_out'] ?? 0), 'duration' => (float) ($asset->duration ?? 0)];
            }
        }

        return $out;
    }

    /** Animated GIF with a per-clip optimised 256-colour palette (GIF has no audio and only 1-bit transparency; the recording itself is opaque). */
    private function toGif(ExportJob $e, string $src, string $dst, string $rel): string
    {
        $fps = min($e->fps, 30);
        $w = min($e->width & ~1, 720);
        $this->ffmpeg(['-i', $src, '-vf', "fps=$fps,scale=$w:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=256:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4", '-loop', '0', $dst]);

        return $rel;
    }

    /** One PNG with all frames in a grid + sheet.json (frame size, grid, fps) so game engines can slice it. Zipped. */
    private function toSpriteSheet(ExportJob $e, string $src, string $dir, string $zipPath, string $rel): string
    {
        $maxFrames = (int) ($e->options['max_frames'] ?? 120);
        $seconds = $this->videoSeconds($src);
        $fps = (float) $e->fps;
        $n = max(1, (int) ceil($seconds * $fps));
        if ($n > $maxFrames) { // thin out the sampling instead of producing a gigantic sheet
            $fps = $maxFrames / $seconds;
            $n = $maxFrames;
        }
        $cols = (int) ceil(sqrt($n));
        $rows = (int) ceil($n / $cols);
        $cw = min($e->width & ~1, intdiv(8192, $cols) & ~1);
        $ch = max(2, (int) round($cw * $e->height / $e->width) & ~1);

        File::ensureDirectoryExists($dir);
        $png = $dir.DIRECTORY_SEPARATOR.'sheet.png';
        $this->ffmpeg(['-i', $src, '-vf', sprintf('fps=%.4f,scale=%d:%d,tile=%dx%d:padding=0', $fps, $cw, $ch, $cols, $rows), '-frames:v', '1', $png]);
        file_put_contents($dir.DIRECTORY_SEPARATOR.'sheet.json', json_encode([
            'image' => 'sheet.png', 'frames' => $n, 'columns' => $cols, 'rows' => $rows,
            'frameWidth' => $cw, 'frameHeight' => $ch, 'fps' => round($fps, 4), 'duration' => round($seconds, 3),
        ], JSON_PRETTY_PRINT));

        $zip = new ZipArchive;
        if ($zip->open($zipPath, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
            throw new RuntimeException('Gagal membuat ZIP.');
        }
        $zip->addFile($png, 'sheet.png');
        $zip->addFile($dir.DIRECTORY_SEPARATOR.'sheet.json', 'sheet.json');
        $zip->close();
        File::deleteDirectory($dir);

        return $rel;
    }

    private function toPngZip(ExportJob $e, string $src, string $dir, string $zipPath, string $rel): string
    {
        File::ensureDirectoryExists($dir);
        $this->ffmpeg(['-i', $src, '-vf', $this->scale($e), $dir.DIRECTORY_SEPARATOR.'frame_%05d.png']);

        $zip = new ZipArchive;
        if ($zip->open($zipPath, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
            throw new RuntimeException('Gagal membuat ZIP.');
        }
        foreach (File::files($dir) as $f) {
            $zip->addFile($f->getPathname(), $f->getFilename());
        }
        $zip->close();
        File::deleteDirectory($dir);

        return $rel;
    }
}

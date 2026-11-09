<?php

namespace App\Jobs;

use App\Http\Controllers\LibraryController;
use App\Models\AiJob;
use App\Models\LibraryAsset;
use App\Services\Library\SlotTemplate;
use App\Services\Enhancement\Upscaler;
use App\Services\ImageWorker;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/** Makes a high-resolution COPY of a raster library asset with the local AI upscaler. The original stays untouched. */
class ProcessLibraryUpscale implements ShouldQueue
{
    use Queueable;

    public int $tries = 1;

    public int $timeout = 700;

    public function __construct(public int $jobId) {}

    /** The visible artwork of a canvas-sized PNG: its bounding box (plus a small margin) as a PNG, with where it was. */
    private function artwork(string $path): ?array
    {
        $im = @imagecreatefromstring((string) file_get_contents($path));
        if ($im === false) {
            return null;
        }
        $w = imagesx($im);
        $h = imagesy($im);
        [$x0, $y0, $x1, $y1] = [$w, $h, -1, -1];
        for ($y = 0; $y < $h; $y++) {
            for ($x = 0; $x < $w; $x++) {
                if (((imagecolorat($im, $x, $y) >> 24) & 0x7F) < 120) {
                    $x0 = min($x0, $x);
                    $x1 = max($x1, $x);
                    $y0 = min($y0, $y);
                    $y1 = max($y1, $y);
                }
            }
        }
        if ($x1 < 0) {
            return null;
        }
        $m = 2;
        [$x0, $y0, $x1, $y1] = [max(0, $x0 - $m), max(0, $y0 - $m), min($w - 1, $x1 + $m), min($h - 1, $y1 + $m)];
        $crop = imagecrop($im, ['x' => $x0, 'y' => $y0, 'width' => $x1 - $x0 + 1, 'height' => $y1 - $y0 + 1]);
        if ($crop === false) {
            return null;
        }
        imagesavealpha($crop, true);
        ob_start();
        imagepng($crop);

        return ['png' => (string) ob_get_clean(), 'x' => $x0, 'y' => $y0, 'w' => $x1 - $x0 + 1, 'h' => $y1 - $y0 + 1];
    }

    /** Paste the upscaled artwork back on a transparent canvas scaled by the same factor, at the same relative spot. */
    private function putBack(string $upscaledPath, array $art, int $w, int $h, int $upscaledW): string
    {
        $f = $upscaledW / $art['w'];
        $up = imagecreatefromstring((string) file_get_contents($upscaledPath));
        $canvas = imagecreatetruecolor((int) round($w * $f), (int) round($h * $f));
        imagealphablending($canvas, false);
        imagesavealpha($canvas, true);
        imagefill($canvas, 0, 0, imagecolorallocatealpha($canvas, 0, 0, 0, 127));
        imagecopy($canvas, $up, (int) round($art['x'] * $f), (int) round($art['y'] * $f), 0, 0, imagesx($up), imagesy($up));
        ob_start();
        imagepng($canvas);

        return (string) ob_get_clean();
    }

    public function handle(ImageWorker $worker): void
    {
        $job = AiJob::findOrFail($this->jobId);
        $job->update(['status' => 'processing', 'error' => null]);
        $tmp = null;

        try {
            $src = LibraryAsset::where('user_id', $job->user_id)->findOrFail($job->input['asset_id']);
            $factor = (float) $job->input['factor'];
            $disk = Storage::disk($src->disk);
            $rel = 'tmp/'.Str::uuid().'.png';
            $disk->makeDirectory('tmp');
            $tmp = $disk->path($rel);

            $standard = SlotTemplate::isFullCanvas($src->width, $src->height) ? $this->artwork($disk->path($src->path)) : null;
            if ($standard) { // a part on the standard canvas: upscale just its artwork, then put it back at the same spot of a bigger canvas
                $cropIn = $disk->path('tmp/'.Str::uuid().'.png');
                file_put_contents($cropIn, $standard['png']);
                try {
                    $result = $worker->process($cropIn, $tmp, Upscaler::ops($factor), 600);
                } finally {
                    @unlink($cropIn);
                }
                $bytes = $this->putBack($tmp, $standard, $src->width, $src->height, $result['width']);
                $result['width'] = (int) round($src->width * $result['width'] / $standard['w']);
                $result['height'] = (int) round($src->height * $result['width'] / $src->width);
            } else {
                $result = $worker->process($disk->path($src->path), $tmp, Upscaler::ops($factor), 600);
                $bytes = (string) file_get_contents($tmp);
            }
            $asset = LibraryController::persistAsset($job->user_id, $src->category, Str::limit($src->name, 100, '').' (HD '.rtrim(rtrim(number_format($factor, 1), '0'), '.').'x)',
                array_values(array_unique([...($src->tags ?? []), 'hd'])), 'upload', 'approved', $bytes, 'image/png', 'png', $result['width'], $result['height'], false, null,
                ['upscaled_from' => $src->id, 'factor' => $factor, 'engine' => 'local-ai', 'model' => config('services.upscaler.model'), 'notes' => $result['notes'] ?? []]);
            $job->update(['status' => 'done', 'result' => ['asset' => $asset->present(), 'notes' => $result['notes'] ?? []]]);
        } catch (\App\Services\ImageWorkerException|\RuntimeException $e) {
            $job->update(['status' => 'failed', 'error' => mb_substr($e->getMessage(), 0, 500)]);
        } catch (\Throwable $e) {
            report($e);
            $job->update(['status' => 'failed', 'error' => 'Terjadi kesalahan internal saat meningkatkan resolusi.']);
        } finally {
            $tmp && @unlink($tmp);
        }
    }
}

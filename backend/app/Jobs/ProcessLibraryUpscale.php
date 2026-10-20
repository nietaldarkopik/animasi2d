<?php

namespace App\Jobs;

use App\Http\Controllers\LibraryController;
use App\Models\AiJob;
use App\Models\LibraryAsset;
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

            $result = $worker->process($disk->path($src->path), $tmp, Upscaler::ops($factor), 600);
            $bytes = (string) file_get_contents($tmp);
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

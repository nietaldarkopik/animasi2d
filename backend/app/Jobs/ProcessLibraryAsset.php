<?php

namespace App\Jobs;

use App\Http\Controllers\LibraryController;
use App\Models\AiJob;
use App\Models\AssetCategory;
use App\Services\Library\AiAssetGenerator;
use App\Services\Library\RasterAssetGenerator;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Str;

/** Generates one library asset with the AI adapter. The asset is stored as PENDING: the user reviews it before it is usable. */
class ProcessLibraryAsset implements ShouldQueue
{
    use Queueable;

    public int $tries = 1;

    public int $timeout = 300;

    public function __construct(public int $jobId) {}

    public function handle(AiAssetGenerator $gen): void
    {
        $job = AiJob::findOrFail($this->jobId);
        $job->update(['status' => 'processing', 'error' => null]);

        try {
            $category = AssetCategory::where('slug', $job->input['category'])->firstOrFail();
            $prompt = $job->input['prompt'];
            if (RasterAssetGenerator::available()) { // image model: same look as the uploaded anime assets
                $r = (new RasterAssetGenerator)->generate($category, $prompt);
                $asset = LibraryController::persistAsset($job->user_id, $category, Str::limit($prompt, 60, '…'), ['ai'], 'ai', 'pending',
                    $r['png'], 'image/png', 'png', $r['width'], $r['height'], false, null, ['prompt' => $prompt, 'model' => $r['model'], 'raster' => true]);
            } else {
                $r = $gen->generate($category, $prompt);
                $asset = LibraryController::persistAsset($job->user_id, $category, Str::limit($prompt, 60, '…'), ['ai'], 'ai', 'pending',
                    $r['svg'], 'image/svg+xml', 'svg', $r['width'], $r['height'], $r['tintable'], null, ['prompt' => $prompt, 'model' => $r['model']]);
            }
            $job->update(['status' => 'done', 'result' => ['asset' => $asset->present()]]);
        } catch (\Throwable $e) {
            $user = $e instanceof \RuntimeException;
            if (! $user) {
                report($e);
            }
            $job->update(['status' => 'failed', 'error' => $user ? mb_substr($e->getMessage(), 0, 500) : 'Terjadi kesalahan internal saat membuat aset.']);
        }
    }
}

<?php

namespace App\Jobs;

use App\Models\AiJob;
use App\Models\Asset;
use App\Services\Enhancement\EnhancementService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/** Provider-backed enhancement (Colorize / AI Redraw). Local modes run inline: they are capped and take a few seconds. */
class ProcessEnhancement implements ShouldQueue
{
    use Queueable;

    public int $tries = 1;

    public int $timeout = 700;

    public function __construct(public int $jobId) {}

    public function handle(EnhancementService $service): void
    {
        $job = AiJob::findOrFail($this->jobId);
        $job->update(['status' => 'processing', 'error' => null]);

        try {
            $source = Asset::where('project_id', $job->project_id)->findOrFail($job->input['asset_id']);
            ['asset' => $new, 'notes' => $notes] = $job->input['mode'] === 'upscale_ai'
                ? $service->localAi($source, (float) ($job->input['factor'] ?? 2))
                : $service->remote($source, $job->input['mode']);
            $job->update(['status' => 'done', 'result' => ['asset' => $new->present(), 'notes' => $notes]]);
        } catch (\Throwable $e) {
            $user = $e instanceof \RuntimeException;
            if (! $user) {
                report($e);
            }
            $job->update(['status' => 'failed', 'error' => $user ? mb_substr($e->getMessage(), 0, 500) : 'Terjadi kesalahan internal saat memproses gambar.']);
        }
    }
}

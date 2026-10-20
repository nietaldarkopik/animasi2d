<?php

namespace App\Jobs;

use App\Models\AiJob;
use App\Models\Asset;
use App\Services\SegmentPlanner;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

class ProcessAiSegment implements ShouldQueue
{
    use Queueable;

    public int $tries = 1;

    public int $timeout = 300;

    public function __construct(public int $jobId) {}

    public function handle(SegmentPlanner $planner): void
    {
        $job = AiJob::findOrFail($this->jobId);
        $job->update(['status' => 'processing', 'error' => null]);

        try {
            $asset = Asset::where('project_id', $job->project_id)->findOrFail($job->input['asset_id']);
            $job->update(['status' => 'done', 'result' => $planner->plan($asset)]);
        } catch (\Throwable $e) {
            $user = $e instanceof \RuntimeException;
            if (! $user) {
                report($e);
            }
            $job->update(['status' => 'failed', 'error' => $user ? mb_substr($e->getMessage(), 0, 500) : 'Terjadi kesalahan internal saat memproses permintaan AI.']);
        }
    }
}
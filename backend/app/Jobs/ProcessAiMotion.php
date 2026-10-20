<?php

namespace App\Jobs;

use App\Models\AiJob;
use App\Services\MotionPlanner;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

class ProcessAiMotion implements ShouldQueue
{
    use Queueable;

    public int $tries = 1;

    public int $timeout = 300;

    public function __construct(public int $jobId) {}

    public function handle(MotionPlanner $planner): void
    {
        $job = AiJob::findOrFail($this->jobId);
        $job->update(['status' => 'processing', 'error' => null]);

        try {
            $plan = $planner->plan($job->project, $job->input['prompt'], $job->input['scene_id'] ?? null);
            $job->update(['status' => 'done', 'result' => $plan]);
        } catch (\Throwable $e) {
            // RuntimeException/InvalidArgument messages are written for users (and never contain the API key)
            $user = $e instanceof \RuntimeException;
            if (! $user) {
                report($e);
            }
            $job->update(['status' => 'failed', 'error' => $user ? mb_substr($e->getMessage(), 0, 500) : 'Terjadi kesalahan internal saat memproses permintaan AI.']);
        }
    }
}
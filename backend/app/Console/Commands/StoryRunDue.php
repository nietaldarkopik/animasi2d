<?php

namespace App\Console\Commands;

use App\Jobs\ProduceEpisode;
use App\Models\StoryEpisode;
use App\Models\StorySeries;
use Illuminate\Console\Command;

/**
 * Called every few minutes by the scheduler: starts the films that are due.
 *  - an episode whose own date/time (scheduled_at) has come
 *  - the next unfilmed episode of every series set to "film every day at HH:MM" (once per day)
 */
class StoryRunDue extends Command
{
    protected $signature = 'story:run-due';

    protected $description = 'Start the story episodes that are scheduled for now';

    public function handle(): int
    {
        $started = 0;

        foreach (StoryEpisode::whereIn('status', ['planned', 'scripted'])->whereNotNull('scheduled_at')->where('scheduled_at', '<=', now())->orderBy('scheduled_at')->get() as $ep) {
            $this->start($ep);
            $started++;
        }

        foreach (StorySeries::where('auto_run', true)->whereNotNull('schedule_time')->get() as $series) {
            if ($series->last_auto_date?->isToday() || now()->format('H:i') < $series->schedule_time) {
                continue;
            }
            $next = $series->episodes()->whereIn('status', ['planned', 'scripted'])->whereNull('scheduled_at')->first();
            $series->update(['last_auto_date' => now()->toDateString()]); // once a day, whether or not there was an episode left
            if ($next) {
                $next->update(['publish' => $series->auto_publish]);
                $this->start($next);
                $started++;
            }
        }

        $this->info("$started episode dijalankan.");

        return self::SUCCESS;
    }

    private function start(StoryEpisode $ep): void
    {
        $ep->update(['status' => 'queued', 'error' => null]);
        ProduceEpisode::dispatch($ep->id);
        $this->line("Episode #{$ep->id} (seri {$ep->series_id}, no. {$ep->number}) masuk antrean.");
    }
}

<?php

namespace App\Jobs;

use App\Models\StoryEpisode;
use App\Models\StorySeries;
use App\Services\StoryWriter;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * Asks the AI to write the story of a series: the episode outline, the scripts of the episodes that have none yet, or both ("all").
 * Progress is visible on the series (ai_status / ai_message) and on each episode (status scripted).
 */
class GenerateStory implements ShouldQueue
{
    use Queueable;

    public int $timeout = 3000;

    public int $tries = 1;

    /** @param 'outline'|'scripts'|'all' $mode */
    public function __construct(public int $seriesId, public string $mode = 'all', public int $count = 5, public ?int $episodeId = null)
    {
        $this->onQueue('story'); // long AI calls: kept away from the default queue (exports)
    }

    public function handle(StoryWriter $writer): void
    {
        $series = StorySeries::findOrFail($this->seriesId);
        $series->update(['ai_status' => 'working', 'ai_message' => 'Menulis…']);

        try {
            if (in_array($this->mode, ['outline', 'all'], true)) {
                $series->update(['ai_message' => 'Menyusun alur episode…']);
                $next = ($series->episodes()->max('number') ?? 0) + 1;
                foreach ($writer->outline($series, $this->count) as $i => $e) {
                    StoryEpisode::create(['series_id' => $series->id, 'number' => $next + $i, 'title' => $e['title'], 'synopsis' => $e['synopsis'], 'status' => 'planned']);
                }
            }
            if (in_array($this->mode, ['scripts', 'all'], true)) {
                $todo = $series->episodes()->whereNull('script')->whereIn('status', ['planned', 'failed'])
                    ->when($this->episodeId, fn ($q) => $q->where('id', $this->episodeId))->get();
                foreach ($todo as $n => $ep) {
                    $series->update(['ai_message' => 'Menulis naskah episode '.$ep->number.' ('.($n + 1).'/'.$todo->count().')…']);
                    $ep->update(['script' => $writer->script($series->fresh(), $ep), 'status' => 'scripted', 'error' => null]);
                }
            }
            $series->update(['ai_status' => 'idle', 'ai_message' => null]);
        } catch (\Throwable $e) {
            $user = $e instanceof \RuntimeException;
            if (! $user) {
                report($e);
            }
            $series->update(['ai_status' => 'failed', 'ai_message' => $user ? mb_substr($e->getMessage(), 0, 500) : 'Terjadi kesalahan internal saat menulis cerita.']);
        }
    }
}

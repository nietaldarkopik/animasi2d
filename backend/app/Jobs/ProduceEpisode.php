<?php

namespace App\Jobs;

use App\Models\Project;
use App\Models\StoryEpisode;
use App\Services\DailyCartoonService;
use App\Services\FilmPipeline;
use App\Services\StoryWriter;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/** Films one episode: script (written now if it has none) -> project with voices -> MP4 -> optional YouTube upload. */
class ProduceEpisode implements ShouldQueue
{
    use Queueable;

    // Long episodes can render thousands of Blender frames; keep the queue job alive for up to 6 hours.
    public int $timeout = 21600;

    public int $tries = 1;

    /**
     * Own queue: filming WAITS for the export, which is a job of the default queue. On one shared worker the film job held the worker
     * while its export waited behind it, and nothing ever finished.
     */
    public function __construct(public int $episodeId)
    {
        $this->onQueue('story');
    }

    public function handle(DailyCartoonService $film, FilmPipeline $pipeline, StoryWriter $writer): void
    {
        $ep = StoryEpisode::with('series')->findOrFail($this->episodeId);
        if ($ep->status === 'producing') {
            return; // already running
        }
        $series = $ep->series;
        $ep->update(['status' => 'producing', 'error' => null]);

        try {
            if (empty($ep->script)) {
                $ep->update(['script' => $writer->script($series, $ep)]);
            }
            $film->voices = $series->voices();

            // Reuse the episode's existing generated project when it still belongs to this user.
            // This preserves completed Blender scenes and QC-passed frames after an interrupted render.
            $project = $ep->project_id
                ? Project::where('user_id', $series->user_id)->find($ep->project_id)
                : null;
            $document = $project?->document;
            $canReuseProject = $project
                && is_array($document)
                && ! empty($document['auto_generated'])
                && ! empty($document['scenes']);

            if ($canReuseProject) {
                $projectId = $project->id;
            } else {
                $res = $film->createDailyCartoon(
                    $series->user_id,
                    null,
                    array_values(array_filter($series->characterNames(), fn ($n) => ! DailyCartoonService::isNarrator($n))),
                    $ep->script,
                    $series->characterIds()
                );
                $projectId = $res['project_id'];
                $ep->update(['project_id' => $projectId]);
            }

            $file = $pipeline->export($projectId, $series->user_id, null, 21600, $ep->script);
            if (! $file) {
                throw new \RuntimeException('Perekaman film gagal: '.($pipeline->lastOutput ?: 'tanpa keterangan').' (Project #'.$projectId.' tetap bisa dibuka di editor.)');
            }
            $ep->update(['output_path' => 'daily_output/'.basename($file), 'status' => 'done']);

            if ($ep->publish && FilmPipeline::publishConfigured()) {
                $up = $pipeline->publish($file, $series->title.' - Episode '.$ep->number.': '.$ep->title, ($ep->synopsis ?? '')."\n\nFilm kartun dibuat otomatis dengan Cartoon Maker AI.",
                    ['kartun', 'animasi', 'kartunindonesia', 'ceritaanak', 'buttudesign']);
                $ep->update($up['ok'] ? ['published_url' => 'terunggah'] : ['error' => 'Film jadi, tetapi unggahan gagal: '.mb_substr($up['output'], -400)]);
            }
        } catch (\Throwable $e) {
            $user = $e instanceof \RuntimeException || $e instanceof \InvalidArgumentException;
            if (! $user) {
                report($e);
            }
            $ep->update(['status' => 'failed', 'error' => $user ? mb_substr($e->getMessage(), 0, 500) : 'Terjadi kesalahan internal saat membuat film.']);
        }
    }
}

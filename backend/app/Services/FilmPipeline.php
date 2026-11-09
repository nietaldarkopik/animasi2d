<?php

namespace App\Services;

use Symfony\Component\Process\Process;

/** The two steps after a film project exists: record it to an MP4 (headless editor) and, optionally, hand the MP4 to clipper-tool for YouTube. */
class FilmPipeline
{
    /** Where the headless exporter writes the film of a project. */
    public static function mp4Path(int $projectId): string
    {
        return base_path('../daily_output/kartun_'.date('Y-m-d').'_project_'.$projectId.'.mp4');
    }

    /** the end of the exporter's output of the last export(): says why it failed */
    public string $lastOutput = '';

    /** @return string|null the MP4 path, null when the export failed */
    public function export(int $projectId, int $userId, ?callable $out = null, int $timeout = 3000): ?string
    {
        $runner = base_path('../tools/daily_cartoon_runner.js');
        if (! file_exists($runner)) {
            return null;
        }
        $p = new Process(['node', $runner, '--projectId', (string) $projectId, '--userId', (string) $userId], base_path('..'));
        $p->setTimeout($timeout);
        $p->run($out ? fn ($t, $b) => $out($b) : null);
        $this->lastOutput = trim(mb_substr(trim($p->getOutput()."
".$p->getErrorOutput()), -600));
        $file = self::mp4Path($projectId);

        return $p->isSuccessful() && is_file($file) ? $file : null;
    }

    public static function publishConfigured(): bool
    {
        $c = config('services.clipper');

        return ! empty($c['path']) && ! empty($c['account']);
    }

    /** @return array{ok: bool, output: string} */
    public function publish(string $file, string $title, string $caption, array $tags, ?string $privacy = null, ?callable $out = null): array
    {
        $cfg = config('services.clipper');
        if (! self::publishConfigured() || ! is_file($file)) {
            return ['ok' => false, 'output' => 'Unggah dilewati: isi CLIPPER_PATH dan CLIPPER_YOUTUBE_ACCOUNT di .env, dan pastikan MP4-nya ada.'];
        }
        $p = new Process([PHP_BINARY, 'artisan', 'clips:publish-file', $file, '--account='.$cfg['account'], '--title='.mb_substr($title, 0, 95), '--caption='.$caption,
            '--tags='.implode(',', $tags), '--privacy='.($privacy ?: $cfg['privacy'])], $cfg['path'].'/backend');
        $p->setTimeout(1800);
        $p->run($out ? fn ($t, $b) => $out($b) : null);

        return ['ok' => $p->isSuccessful(), 'output' => trim($p->getOutput().$p->getErrorOutput())];
    }
}

<?php

namespace App\Services;

use App\Models\Project;
use App\Models\StoryEpisode;
use Symfony\Component\Process\Process;

/** 
 * FilmPipeline: Produces the final cartoon movie using Blender MCP 3D Environment & Cinematography Engine
 * with graceful fallback to headless canvas recording.
 */
class FilmPipeline
{
    /** Where the exporter writes the film of a project. */
    public static function mp4Path(int $projectId): string
    {
        return base_path('../daily_output/kartun_'.date('Y-m-d').'_project_'.$projectId.'.mp4');
    }

    /** The end of the exporter's output of the last export(): says why it failed or succeeded */
    public string $lastOutput = '';

    /**
     * @param int $projectId
     * @param int $userId
     * @param callable|null $out
     * @param int $timeout
     * @param array|null $script Full structured script JSON {title, scenes: [...]}
     * @return string|null the MP4 path, null when the export failed
     */
    public function export(int $projectId, int $userId, ?callable $out = null, int $timeout = 3600, ?array $script = null): ?string
    {
        $file = self::mp4Path($projectId);
        @mkdir(dirname($file), 0755, true);

        // 1. First priority: Build 3D Environment, Props, Lighting, and Cinematography with Blender MCP
        $scriptData = $script;
        if (!$scriptData) {
            $ep = StoryEpisode::where('project_id', $projectId)->first();
            if ($ep && !empty($ep->script)) {
                $scriptData = $ep->script;
            }
        }

        if (!empty($scriptData)) {
            $blenderFile = $this->exportWithBlender($projectId, $scriptData, $file, $out, $timeout);
            if ($blenderFile && is_file($blenderFile) && filesize($blenderFile) > 1000) {
                return $blenderFile;
            }

            // Story episodes must never silently fall back to the legacy Puppeteer recorder.
            // A failed Blender render is a failed production; keep its diagnostics visible.
            $this->lastOutput = trim($this->lastOutput."\n[FilmPipeline] Blender render gagal; fallback renderer lama dinonaktifkan untuk episode naskah.");
            return null;
        }

        // 2. Legacy daily-cartoon jobs without a structured story script may still use Puppeteer.
        $runner = base_path('../tools/daily_cartoon_runner.js');
        if (!file_exists($runner)) {
            return null;
        }
        $p = new Process(['node', $runner, '--projectId', (string) $projectId, '--userId', (string) $userId], base_path('..'));
        $p->setTimeout($timeout);
        $p->run($out ? fn ($t, $b) => $out($b) : null);
        $this->lastOutput = trim(mb_substr(trim($p->getOutput()."\n".$p->getErrorOutput()), -800));

        return $p->isSuccessful() && is_file($file) ? $file : null;
    }

    /**
     * Executes the Autonomous Cartoon Production System via Blender MCP / CLI.
     * Supports multi-scene rendering: each scene is rendered separately then FFmpeg-concatenated.
     */
    public function exportWithBlender(int $projectId, array $script, string $targetMp4, ?callable $out = null, int $timeout = 1800): ?string
    {
        $outputDir = base_path('../tools/blender/output');
        @mkdir($outputDir, 0755, true);

        $scriptPath = $outputDir . DIRECTORY_SEPARATOR . "project_{$projectId}_script.json";
        $blendPath = dirname($targetMp4) . DIRECTORY_SEPARATOR . 'kartun_' . date('Y-m-d') . "_project_{$projectId}.blend";

        @file_put_contents($scriptPath, json_encode($script, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));

        $pythonScript = base_path('../tools/blender/script_to_blender.py');
        if (!file_exists($pythonScript)) {
            return null;
        }

        // Count scenes — use --all-scenes mode when there are multiple scenes
        $sceneCount = count($script['scenes'] ?? []);
        $useAllScenes = $sceneCount > 1;

        $cmd = [
            'python',
            '-u',
            $pythonScript,
            "--script={$scriptPath}",
            "--save-blend={$blendPath}",
            "--render-video={$targetMp4}",
        ];

        $aspectRatio = ($script['aspect_ratio'] ?? '9:16') === '16:9' ? '16:9' : '9:16';
        $cmd[] = "--aspect-ratio={$aspectRatio}";

        if ($useAllScenes) {
            $cmd[] = '--all-scenes';
            if ($out) $out("[FilmPipeline] Produksi {$sceneCount} adegan — mode multi-scene + FFmpeg concat\n");
        } else {
            if ($out) $out("[FilmPipeline] Produksi adegan tunggal (scene 0)\n");
        }

        // Remove any previous output so a stale/legacy MP4 cannot be mistaken for this Blender render.
        if (is_file($targetMp4)) {
            @unlink($targetMp4);
        }

        $diagnosticLog = $outputDir . DIRECTORY_SEPARATOR . "project_{$projectId}_blender.log";
        @file_put_contents($diagnosticLog, '['.date('c')."] [Laravel] Blender production started.\n", LOCK_EX);

        $p = new Process($cmd, base_path('..'));
        $p->setTimeout($timeout);
        $logHandle = @fopen($diagnosticLog, 'ab');
        try {
            $p->run(function ($type, $buffer) use ($out, $logHandle) {
                if (is_resource($logHandle)) {
                    fwrite($logHandle, $buffer);
                    fflush($logHandle);
                }
                if ($out) $out($buffer);
            });
        } catch (\Throwable $e) {
            if (is_resource($logHandle)) {
                fwrite($logHandle, "\n[".date('c')."] [Laravel] Process exception: ".$e->getMessage()."\n");
                fflush($logHandle);
            }
            throw $e;
        } finally {
            if (is_resource($logHandle)) fclose($logHandle);
        }

        $combinedOutput = trim($p->getOutput()."\n".$p->getErrorOutput());
        @file_put_contents($diagnosticLog, "\n[".date('c')."] [Laravel] Blender process finished; exit code ".$p->getExitCode().".\n", FILE_APPEND | LOCK_EX);
        $this->lastOutput = trim(mb_substr($combinedOutput, -12000));
        if (! $p->isSuccessful()) {
            $this->lastOutput = "Blender process exit code ".$p->getExitCode()."\n".$this->lastOutput
                ."\n[Blender log lengkap: ".$diagnosticLog."]";
            return null;
        }

        if (is_file($targetMp4) && filesize($targetMp4) > 1000) {
            return $targetMp4;
        }

        // Check if Blender saved preview image instead (single scene still render)
        $previewImg = dirname($targetMp4) . DIRECTORY_SEPARATOR . 'kartun_' . date('Y-m-d') . "_project_{$projectId}.jpg";
        if (is_file($previewImg) && filesize($previewImg) > 1000) {
            $this->lastOutput .= " (Blender Scene 3D & Still Preview berhasil dibuat: {$previewImg})";
        }

        return is_file($targetMp4) ? $targetMp4 : null;
    }

    public static function publishConfigured(): bool
    {
        $c = config('services.clipper');
        return !empty($c['path']) && !empty($c['account']);
    }

    /** @return array{ok: bool, output: string} */
    public function publish(string $file, string $title, string $caption, array $tags, ?string $privacy = null, ?callable $out = null): array
    {
        $cfg = config('services.clipper');
        if (!self::publishConfigured() || !is_file($file)) {
            return ['ok' => false, 'output' => 'Unggah dilewati: isi CLIPPER_PATH dan CLIPPER_YOUTUBE_ACCOUNT di .env, dan pastikan MP4-nya ada.'];
        }
        $p = new Process([PHP_BINARY, 'artisan', 'clips:publish-file', $file, '--account='.$cfg['account'], '--title='.mb_substr($title, 0, 95), '--caption='.$caption,
            '--tags='.implode(',', $tags), '--privacy='.($privacy ?: $cfg['privacy'])], $cfg['path'].'/backend');
        $p->setTimeout(1800);
        $p->run($out ? fn ($t, $b) => $out($b) : null);

        return ['ok' => $p->isSuccessful(), 'output' => trim($p->getOutput().$p->getErrorOutput())];
    }
}

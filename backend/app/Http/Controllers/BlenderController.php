<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\Process\Process;

class BlenderController extends Controller
{
    protected string $karakterDir;
    protected string $toolsDir;
    protected string $naskahDir;
    protected string $outputDir;

    public function __construct()
    {
        $base = base_path('..');
        $this->karakterDir = $base . DIRECTORY_SEPARATOR . 'karakter';
        $this->toolsDir = $base . DIRECTORY_SEPARATOR . 'tools' . DIRECTORY_SEPARATOR . 'blender';
        $this->naskahDir = $base . DIRECTORY_SEPARATOR . 'naskah';
        $this->outputDir = $this->toolsDir . DIRECTORY_SEPARATOR . 'output';

        if (!is_dir($this->outputDir)) {
            @mkdir($this->outputDir, 0755, true);
        }
    }

    public function status(): JsonResponse
    {
        $mcpOnline = false;
        try {
            $fp = @fsockopen('127.0.0.1', 9876, $errno, $errstr, 0.5);
            if ($fp) {
                $mcpOnline = true;
                fclose($fp);
            }
        } catch (\Throwable) {
            $mcpOnline = false;
        }

        $blenderExe = 'C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe';
        $cliAvailable = file_exists($blenderExe);

        return response()->json([
            'mcp_online' => $mcpOnline,
            'cli_available' => $cliAvailable,
            'host' => '127.0.0.1',
            'port' => 9876,
            'blender_version' => '5.2.3',
            'blender_path' => $blenderExe,
        ]);
    }

    public function characters(): JsonResponse
    {
        $chars = [];
        if (is_dir($this->karakterDir)) {
            $dirs = scandir($this->karakterDir);
            foreach ($dirs as $d) {
                if ($d === '.' || $d === '..' || str_starts_with($d, '_')) {
                    continue;
                }
                $charPath = $this->karakterDir . DIRECTORY_SEPARATOR . $d;
                $jsonFile = $charPath . DIRECTORY_SEPARATOR . 'character.json';
                if (is_dir($charPath) && file_exists($jsonFile)) {
                    $meta = json_decode((string) file_get_contents($jsonFile), true) ?: [];
                    $name = $meta['name'] ?? $d;
                    $chars[] = [
                        'id' => $d,
                        'name' => ucfirst($name),
                        'style' => $meta['style'] ?? 'Anime 2.5D',
                        'poses' => $meta['body']['poses'] ?? [],
                        'expressions' => $meta['head']['expressions'] ?? [],
                        'has_blink' => isset($meta['blink']),
                        'has_mouth' => isset($meta['mouth']),
                    ];
                }
            }
        }

        return response()->json([
            'characters' => $chars,
        ]);
    }

    public function scripts(): JsonResponse
    {
        $scripts = [];
        if (is_dir($this->naskahDir)) {
            $files = glob($this->naskahDir . DIRECTORY_SEPARATOR . '*.json');
            foreach ($files as $file) {
                $content = json_decode((string) file_get_contents($file), true);
                if (is_array($content)) {
                    $scripts[] = [
                        'file' => basename($file),
                        'title' => $content['title'] ?? basename($file, '.json'),
                        'theme' => $content['theme'] ?? 'Umum',
                        'scenes_count' => count($content['scenes'] ?? []),
                        'content' => $content,
                    ];
                }
            }
        }

        return response()->json([
            'scripts' => $scripts,
        ]);
    }

    public function animate(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'mode' => 'required|in:prompt,script',
            'prompt' => 'nullable|string|max:2000',
            'script_file' => 'nullable|string',
            'render_still' => 'nullable|boolean',
            'render_video' => 'nullable|boolean',
            'save_blend' => 'nullable|boolean',
        ]);

        $mode = $validated['mode'];
        $pythonScript = $this->toolsDir . DIRECTORY_SEPARATOR . 'script_to_blender.py';

        if (!file_exists($pythonScript)) {
            return response()->json([
                'status' => 'error',
                'message' => 'script_to_blender.py tidak ditemukan.',
            ], 404);
        }

        $timestamp = date('Ymd_His');
        $cmd = ['python', $pythonScript];

        if ($mode === 'script') {
            $scriptFile = $validated['script_file'] ?? '';
            $fullScriptPath = $this->naskahDir . DIRECTORY_SEPARATOR . basename($scriptFile);
            if (!file_exists($fullScriptPath)) {
                return response()->json([
                    'status' => 'error',
                    'message' => "File naskah tidak ditemukan: {$scriptFile}",
                ], 404);
            }
            $cmd[] = "--script={$fullScriptPath}";
        } else {
            $prompt = trim((string) ($validated['prompt'] ?? ''));
            if (!$prompt) {
                return response()->json([
                    'status' => 'error',
                    'message' => 'Prompt tidak boleh kosong.',
                ], 422);
            }
            $cmd[] = "--prompt={$prompt}";
        }

        $outputs = [];

        // Selalu simpan .blend agar bisa dibuka di Blender
        $blendFile = "animasi_{$timestamp}.blend";
        $blendPath = $this->outputDir . DIRECTORY_SEPARATOR . $blendFile;
        $cmd[] = "--save-blend={$blendPath}";
        $outputs['blend'] = $blendFile;

        if (!empty($validated['render_video'])) {
            $videoFile = "animasi_{$timestamp}.mp4";
            $videoPath = $this->outputDir . DIRECTORY_SEPARATOR . $videoFile;
            $cmd[] = "--render-video={$videoPath}";
            $outputs['video'] = $videoFile;
        } else {
            // Default render still frame preview
            $stillFile = "preview_{$timestamp}.jpg";
            $stillPath = $this->outputDir . DIRECTORY_SEPARATOR . $stillFile;
            $cmd[] = "--render-still={$stillPath}";
            $outputs['preview'] = $stillFile;
        }

        $process = new Process($cmd, base_path('..'), [
            'PYTHONIOENCODING' => 'utf-8',
            'PYTHONUTF8' => '1',
        ]);
        $process->setTimeout(600); // 10 minutes timeout
        $process->run();

        $stdout = $process->getOutput();
        $stderr = $process->getErrorOutput();
        $isOk = $process->isSuccessful();

        return response()->json([
            'status' => $isOk ? 'ok' : 'error',
            'returncode' => $process->getExitCode(),
            'outputs' => $outputs,
            'stdout' => substr($stdout, -2000),
            'stderr' => substr($stderr, -2000),
        ]);
    }

    public function outputs(): JsonResponse
    {
        $items = [];
        if (is_dir($this->outputDir)) {
            $files = scandir($this->outputDir, SCANDIR_SORT_DESCENDING);
            foreach ($files as $f) {
                if ($f === '.' || $f === '..') {
                    continue;
                }
                $path = $this->outputDir . DIRECTORY_SEPARATOR . $f;
                if (is_file($path)) {
                    $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
                    $items[] = [
                        'filename' => $f,
                        'type' => match ($ext) {
                            'jpg', 'jpeg', 'png' => 'image',
                            'mp4' => 'video',
                            'blend' => 'blend',
                            default => 'file',
                        },
                        'size' => filesize($path),
                        'created_at' => date('Y-m-d H:i:s', filemtime($path)),
                        'url' => url("/api/blender/file/{$f}"),
                    ];
                }
            }
        }

        return response()->json([
            'outputs' => $items,
        ]);
    }

    public function file(string $filename): BinaryFileResponse
    {
        $clean = basename($filename);
        $path = $this->outputDir . DIRECTORY_SEPARATOR . $clean;

        if (!file_exists($path)) {
            abort(404, 'File output tidak ditemukan.');
        }

        $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
        $mime = match ($ext) {
            'jpg', 'jpeg' => 'image/jpeg',
            'png' => 'image/png',
            'mp4' => 'video/mp4',
            'blend' => 'application/x-blender',
            default => 'application/octet-stream',
        };

        return response()->file($path, [
            'Content-Type' => $mime,
            'Cache-Control' => 'no-cache, private',
        ]);
    }

    public function characterFace(string $name): BinaryFileResponse
    {
        $clean = strtolower(basename($name));
        $path = $this->karakterDir . DIRECTORY_SEPARATOR . $clean . DIRECTORY_SEPARATOR . "{$clean}_kepala_netral.png";

        if (!file_exists($path)) {
            abort(404, 'Wajah karakter tidak ditemukan.');
        }

        return response()->file($path, [
            'Content-Type' => 'image/png',
            'Cache-Control' => 'public, max-age=86400',
        ]);
    }
}


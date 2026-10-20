<?php

namespace App\Http\Controllers;

use App\Models\Asset;
use App\Models\Project;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\Str;
use Illuminate\Support\Facades\Validator;
use Symfony\Component\HttpFoundation\StreamedResponse;
use App\Services\ImageWorker;
use Symfony\Component\Process\Process;
use App\Services\ImageWorkerException;

class AssetController extends Controller
{
    private const EXT = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];

    public function index(Request $request, Project $project): JsonResponse
    {
        abort_unless($project->user_id === $request->user()->id, 404);

        return response()->json(['data' => $project->assets()->orderBy('id')->get()->map(fn ($a) => $this->present($a))]);
    }

    public function store(Request $request, Project $project): JsonResponse
    {
        abort_unless($project->user_id === $request->user()->id, 404);

        $request->validate([
            'file' => 'required|file|mimetypes:image/jpeg,image/png,image/webp|max:15360',
        ]);

        $file = $request->file('file');
        $mime = $file->getMimeType(); // sniffed from content, not client-provided
        $info = @getimagesize($file->getRealPath());
        abort_if($info === false, 422, 'File bukan gambar yang valid.');

        $path = $file->storeAs(
            'projects/'.$project->id.'/assets',
            Str::uuid().'.'.self::EXT[$mime],
            'local',
        );

        $asset = $project->assets()->create([
            'user_id' => $request->user()->id,
            'kind' => 'original',
            'disk' => 'local',
            'path' => $path,
            'original_name' => Str::limit($file->getClientOriginalName(), 200, ''),
            'mime' => $mime,
            'size' => $file->getSize(),
            'width' => $info[0],
            'height' => $info[1],
        ]);

        return response()->json(['data' => $this->present($asset)], 201);
    }

    /**
     * Non-destructive image clean-up: runs the Python/Pillow worker and stores the result as a NEW asset
     * (the original is kept). Ops: crop, resize, remove_bg, sketch, trim, enhance.
     * Synchronous on purpose: capped at 2400px working size and a 60s timeout (typically 1-3s);
     * AI jobs and exports are the ones that go through the queue.
     */
    public function process(Request $request, Asset $asset): JsonResponse
    {
        abort_unless($asset->user_id === $request->user()->id, 404);
        abort_unless(str_starts_with($asset->mime, 'image/'), 422, 'Hanya aset gambar yang dapat diproses.');

        $data = Validator::make($request->all(), [
            'ops' => 'required|array|min:1|max:6',
            'ops.*.op' => 'required|in:crop,resize,remove_bg,sketch,trim,enhance',
            'ops.*.x' => 'nullable|integer|min:0|max:20000',
            'ops.*.y' => 'nullable|integer|min:0|max:20000',
            'ops.*.w' => 'nullable|integer|min:1|max:20000',
            'ops.*.h' => 'nullable|integer|min:1|max:20000',
            'ops.*.width' => 'nullable|integer|min:8|max:4096',
            'ops.*.scale' => 'nullable|numeric|min:0.05|max:4',
            'ops.*.tolerance' => 'nullable|numeric|min:0|max:100',
            'ops.*.strength' => 'nullable|numeric|min:0|max:100',
            'ops.*.color' => ['nullable', 'regex:/^#[0-9a-fA-F]{6}$/'],
            'name' => 'nullable|string|max:100',
        ])->validate();

        $ops = array_values($data['ops']); // keep execution order (validated() key order is not reliable)
        foreach ($ops as $i => $op) {
            $missing = match ($op['op']) {
                'crop' => collect(['x', 'y', 'w', 'h'])->first(fn ($k) => ! isset($op[$k])),
                'resize' => (isset($op['width']) || isset($op['scale'])) ? null : 'width',
                default => null,
            };
            if ($missing) {
                return response()->json(['message' => "Operasi #".($i + 1)." ($op[op]) membutuhkan $missing.", 'errors' => ['ops' => ["Parameter $missing wajib."]]], 422);
            }
        }

        try {
            ['asset' => $new, 'result' => $result] = app(ImageWorker::class)->run($asset, $ops, $data['name'] ?? null);
        } catch (ImageWorkerException $e) {
            return response()->json(['message' => $e->getMessage(), 'errors' => ['ops' => [$e->getMessage()]]], $e->status);
        }
        return response()->json([
            'data' => $this->present($new),
            'notes' => $result['notes'] ?? [],
            // geometry of the result relative to the input, so the editor can keep a replaced layer in place
            'geometry' => ['pixel_scale' => $result['pixel_scale'] ?? 1, 'origin' => $result['origin'] ?? [0, 0], 'input_size' => $result['input_size'] ?? [$asset->width, $asset->height]],
        ], 201);
    }

    /** Audio is stored like any asset (file in storage) but validated by decoding it: the duration comes from ffprobe. */
    private const AUDIO_EXT = [
        'audio/mpeg' => 'mp3', 'audio/mp3' => 'mp3', 'audio/wav' => 'wav', 'audio/x-wav' => 'wav', 'audio/wave' => 'wav',
        'audio/ogg' => 'ogg', 'application/ogg' => 'ogg', 'audio/mp4' => 'm4a', 'audio/x-m4a' => 'm4a', 'audio/aac' => 'aac', 'audio/webm' => 'webm', 'video/webm' => 'webm', 'audio/flac' => 'flac', 'audio/x-flac' => 'flac',
    ];

    public function storeAudio(Request $request, Project $project): JsonResponse
    {
        abort_unless($project->user_id === $request->user()->id, 404);
        $request->validate(['file' => 'required|file|max:30720']);

        $file = $request->file('file');
        $mime = $file->getMimeType(); // sniffed from content
        if (! isset(self::AUDIO_EXT[$mime])) {
            return response()->json(['message' => 'Format audio tidak didukung (gunakan MP3, WAV, OGG, M4A/AAC, FLAC, atau WebM).', 'errors' => ['file' => ['Format audio tidak didukung.']]], 422);
        }

        $probe = new Process([config('services.ffmpeg.probe'), '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', $file->getRealPath()]);
        $probe->setTimeout(20);
        try {
            $probe->run();
        } catch (\Throwable $e) {
            report($e);
            abort(500, 'Tidak dapat memeriksa file audio (ffprobe tidak tersedia).');
        }
        $duration = (float) trim($probe->getOutput());
        if (! $probe->isSuccessful() || $duration <= 0) {
            return response()->json(['message' => 'File tidak berisi audio yang dapat dibaca.', 'errors' => ['file' => ['File audio tidak valid.']]], 422);
        }
        if ($duration > 3600) {
            return response()->json(['message' => 'Audio terlalu panjang (maks. 1 jam).', 'errors' => ['file' => ['Audio terlalu panjang.']]], 422);
        }

        $path = $file->storeAs('projects/'.$project->id.'/assets', Str::uuid().'.'.self::AUDIO_EXT[$mime], 'local');
        $asset = $project->assets()->create([
            'user_id' => $request->user()->id,
            'disk' => 'local',
            'path' => $path,
            'original_name' => Str::limit($file->getClientOriginalName(), 200, ''),
            'mime' => str_starts_with($mime, 'audio/') ? $mime : 'audio/webm',
            'size' => $file->getSize(),
            'duration' => round($duration, 3),
        ]);

        return response()->json(['data' => $asset->present()], 201);
    }

    /** Served via a signed URL so <img>/Pixi can load it without Authorization headers. */
    public function file(Asset $asset): StreamedResponse
    {
        return Storage::disk($asset->disk)->response($asset->path, $asset->original_name, [
            'Content-Type' => $asset->mime,
            'Cache-Control' => 'private, max-age=3600',
        ], 'inline');
    }

    public function destroy(Request $request, Asset $asset): JsonResponse
    {
        abort_unless($asset->user_id === $request->user()->id, 404);
        Storage::disk($asset->disk)->delete($asset->path);
        $asset->delete();

        return response()->json(['ok' => true]);
    }

    private function present(Asset $a): array
    {
        return $a->present();
    }
}

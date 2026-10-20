<?php

namespace App\Http\Controllers;

use App\Jobs\ProcessAiMotion;
use App\Jobs\ProcessAiSegment;
use App\Models\Asset;
use App\Services\AiClient;
use App\Services\ImageWorker;
use App\Services\ImageWorkerException;
use Illuminate\Support\Facades\Storage;
use App\Models\AiJob;
use App\Models\Project;
use App\Services\MotionPlanner;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AiController extends Controller
{
    /** What is available — without revealing anything about the key. */
    public function status(): JsonResponse
    {
        return response()->json(['data' => [
            'configured' => MotionPlanner::configured(),
            'model' => config('services.ai.model'),
            'features' => [
                'prompt_to_motion' => MotionPlanner::configured(),
                'segment_parts' => AiClient::configured(),
                // no video / lip-sync models behind the gateway: reported honestly instead of faked
                'image_to_video' => false,
                'lip_sync' => false,
                'video_to_motion' => false,
            ],
        ]]);
    }

    public function motion(Request $request, Project $project): JsonResponse
    {
        abort_unless($project->user_id === $request->user()->id, 404);
        $data = $request->validate(['prompt' => 'required|string|min:3|max:1000', 'scene_id' => 'nullable|string|max:64']);

        if (! MotionPlanner::configured()) {
            return response()->json(['message' => 'AI belum dikonfigurasi: isi AI_API_KEY (API key 9router) di backend/.env.'], 503);
        }
        if (AiJob::where('project_id', $project->id)->whereIn('status', ['queued', 'processing'])->where('created_at', '>', now()->subMinutes(10))->exists()) {
            return response()->json(['message' => 'Masih ada permintaan AI yang berjalan untuk project ini.'], 429);
        }

        $job = AiJob::create([
            'project_id' => $project->id,
            'user_id' => $request->user()->id,
            'type' => 'prompt_to_motion',
            'status' => 'queued',
            'input' => ['prompt' => $data['prompt'], 'scene_id' => $data['scene_id'] ?? null, 'revision' => $project->revision],
        ]);
        ProcessAiMotion::dispatch($job->id);

        return response()->json(['data' => $this->present($job)], 202);
    }

    /** Vision model proposes body parts for an image asset; the user reviews/corrects before anything is cut. */
    public function segment(Request $request, Asset $asset): JsonResponse
    {
        abort_unless($asset->user_id === $request->user()->id, 404);
        if (! AiClient::configured()) {
            return response()->json(['message' => 'AI belum dikonfigurasi: isi AI_API_KEY (API key 9router) di backend/.env.'], 503);
        }
        if (AiJob::where('project_id', $asset->project_id)->whereIn('status', ['queued', 'processing'])->where('created_at', '>', now()->subMinutes(10))->exists()) {
            return response()->json(['message' => 'Masih ada permintaan AI yang berjalan untuk project ini.'], 429);
        }

        $job = AiJob::create([
            'project_id' => $asset->project_id,
            'user_id' => $request->user()->id,
            'type' => 'segment_parts',
            'status' => 'queued',
            'input' => ['asset_id' => $asset->id],
        ]);
        ProcessAiSegment::dispatch($job->id);

        return response()->json(['data' => $this->present($job)], 202);
    }

    /** Cut the (user-corrected) boxes out of the source image into new assets. All-or-nothing. */
    public function applySegment(Request $request, AiJob $job): JsonResponse
    {
        abort_unless($job->user_id === $request->user()->id && $job->type === 'segment_parts', 404);
        abort_unless($job->status === 'done', 409, 'Pemisahan belum selesai.');
        $asset = Asset::where('project_id', $job->project_id)->findOrFail($job->input['asset_id']);

        $data = $request->validate([
            'parts' => 'required|array|min:1|max:16',
            'parts.*.name' => 'required|string|max:40',
            'parts.*.x' => 'required|integer|min:0|max:20000',
            'parts.*.y' => 'required|integer|min:0|max:20000',
            'parts.*.w' => 'required|integer|min:1|max:20000',
            'parts.*.h' => 'required|integer|min:1|max:20000',
        ]);
        $parts = array_values($data['parts']);
        foreach ($parts as $p) {
            if ($p['x'] + $p['w'] > $asset->width || $p['y'] + $p['h'] > $asset->height) {
                return response()->json(['message' => 'Kotak "'.$p['name'].'" keluar dari gambar ('.$asset->width.'x'.$asset->height.').'], 422);
            }
        }

        $made = [];
        $base = pathinfo($asset->original_name, PATHINFO_FILENAME);
        try {
            foreach ($parts as $p) {
                $r = app(ImageWorker::class)->run($asset, [['op' => 'crop', 'x' => $p['x'], 'y' => $p['y'], 'w' => $p['w'], 'h' => $p['h']]], $base.'-'.$p['name'], ['kind' => 'character']);
                $made[] = ['name' => $p['name'], 'asset' => $r['asset']];
            }
        } catch (ImageWorkerException $e) {
            foreach ($made as $m) { // roll back partial work
                Storage::disk($m['asset']->disk)->delete($m['asset']->path);
                $m['asset']->delete();
            }

            return response()->json(['message' => $e->getMessage()], $e->status);
        }

        return response()->json(['data' => array_map(fn ($m) => ['name' => $m['name'], 'asset' => $m['asset']->present()], $made)], 201);
    }

    public function show(Request $request, AiJob $job): JsonResponse
    {
        abort_unless($job->user_id === $request->user()->id, 404);

        return response()->json(['data' => $this->present($job)]);
    }

    private function present(AiJob $j): array
    {
        return [
            'id' => $j->id,
            'type' => $j->type,
            'status' => $j->status,
            'error' => $j->error,
            'result' => $j->result,
            'prompt' => $j->input['prompt'] ?? null,
            'created_at' => $j->created_at,
        ];
    }
}
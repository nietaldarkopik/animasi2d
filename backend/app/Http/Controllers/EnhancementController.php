<?php

namespace App\Http\Controllers;

use App\Jobs\ProcessEnhancement;
use App\Models\AiJob;
use App\Models\Asset;
use App\Services\Enhancement\EnhancementPlanner;
use App\Services\Enhancement\EnhancementService;
use App\Services\Enhancement\RemoteImageProvider;
use App\Services\Enhancement\Upscaler;
use App\Services\ImageWorkerException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;

class EnhancementController extends Controller
{
    /** Modes + provider status, so the UI can say exactly what is (not) available. */
    public function modes(): JsonResponse
    {
        return response()->json(['data' => [
            'modes' => EnhancementPlanner::describe(),
            'provider' => [
                'configured' => RemoteImageProvider::available(),
                'model' => RemoteImageProvider::available() ? config('services.ai_image.model') : null,
                'daily_limit' => (int) config('services.ai_image.daily_limit'),
                'sends_images_externally' => true,
            ],
        ]]);
    }

    public function enhance(Request $request, Asset $asset, EnhancementService $service): JsonResponse
    {
        abort_unless($asset->user_id === $request->user()->id, 404);
        abort_unless(str_starts_with($asset->mime, 'image/'), 422, 'Hanya aset gambar yang dapat diperbaiki.');

        $data = Validator::make($request->all(), [
            'mode' => 'required|in:'.implode(',', EnhancementPlanner::MODES),
            'options' => 'nullable|array',
            'options.perspective' => 'nullable|array|size:4',
            'options.perspective.*' => 'array|size:2',
            'options.perspective.*.*' => 'numeric|between:0,20000',
            'options.rotate' => 'nullable|numeric|between:-360,360',
            'options.deskew' => 'nullable|boolean',
            'options.strength' => 'nullable|numeric|between:0,100',
            'options.upscale' => 'nullable|numeric|between:1,4',
            'options.remove_bg' => 'nullable|boolean',
            'options.tolerance' => 'nullable|numeric|between:0,100',
            'options.crop' => 'nullable|array|required_array_keys:x,y,w,h',
            'options.crop.x' => 'integer|min:0|max:20000',
            'options.crop.y' => 'integer|min:0|max:20000',
            'options.crop.w' => 'integer|min:1|max:20000',
            'options.crop.h' => 'integer|min:1|max:20000',
            'consent_external' => 'nullable|boolean',
        ])->validate();
        $mode = $data['mode'];
        $options = $data['options'] ?? [];

        if ($mode === 'upscale_ai') {
            if (! Upscaler::available()) {
                return response()->json(['message' => Upscaler::unavailableReason(), 'code' => 'upscaler_unavailable'], 503);
            }
            $factor = (float) (($options['upscale'] ?? 1) > 1 ? $options['upscale'] : 2);
            if (AiJob::where('project_id', $asset->project_id)->whereIn('status', ['queued', 'processing'])->where('created_at', '>', now()->subMinutes(15))->exists()) {
                return response()->json(['message' => 'Masih ada proses AI yang berjalan untuk project ini.'], 429);
            }
            $job = AiJob::create(['project_id' => $asset->project_id, 'user_id' => $request->user()->id, 'type' => 'enhance', 'status' => 'queued',
                'input' => ['asset_id' => $asset->id, 'mode' => $mode, 'factor' => $factor]]);
            ProcessEnhancement::dispatch($job->id);

            return response()->json(['data' => ['job' => ['id' => $job->id, 'status' => $job->status, 'type' => $job->type]]], 202);
        }

        if (EnhancementPlanner::isRemote($mode)) {
            if (! RemoteImageProvider::available()) {
                return response()->json(['message' => 'Mode ini membutuhkan provider gambar AI, dan belum dikonfigurasi (AI_IMAGE_ENABLED, AI_IMAGE_MODEL, AI_API_KEY di backend/.env). Gunakan Preserve Original / Clean Sketch / Clean Line Art yang diproses lokal.', 'code' => 'provider_unconfigured'], 503);
            }
            if (empty($data['consent_external'])) {
                return response()->json(['message' => 'Mode ini mengirim gambar Anda ke layanan AI eksternal. Setujui pengiriman terlebih dahulu.', 'code' => 'consent_required'], 422);
            }
            $limit = (int) config('services.ai_image.daily_limit');
            $today = AiJob::where('user_id', $request->user()->id)->where('type', 'enhance')->where('created_at', '>=', now()->startOfDay())->count();
            if ($today >= $limit) {
                return response()->json(['message' => "Batas harian provider gambar tercapai ($limit permintaan)."], 429);
            }
            if (AiJob::where('project_id', $asset->project_id)->whereIn('status', ['queued', 'processing'])->where('created_at', '>', now()->subMinutes(10))->exists()) {
                return response()->json(['message' => 'Masih ada permintaan AI yang berjalan untuk project ini.'], 429);
            }
            $job = AiJob::create([
                'project_id' => $asset->project_id,
                'user_id' => $request->user()->id,
                'type' => 'enhance',
                'status' => 'queued',
                'input' => ['asset_id' => $asset->id, 'mode' => $mode],
            ]);
            ProcessEnhancement::dispatch($job->id);

            return response()->json(['data' => ['job' => ['id' => $job->id, 'status' => $job->status, 'type' => $job->type]]], 202);
        }

        try {
            ['asset' => $new, 'notes' => $notes] = $service->local($asset, $mode, $options);
        } catch (ImageWorkerException $e) {
            return response()->json(['message' => $e->getMessage(), 'errors' => ['mode' => [$e->getMessage()]]], $e->status);
        }

        return response()->json(['data' => $new->present(), 'notes' => $notes], 201);
    }

    /** Original + every enhancement version derived from it (for the before/after picker). */
    public function versions(Request $request, Asset $asset, EnhancementService $service): JsonResponse
    {
        abort_unless($asset->user_id === $request->user()->id, 404);

        return response()->json(['data' => $service->lineage($asset)->map(fn (Asset $a) => $a->present() + ['notes' => $a->meta['notes'] ?? []])]);
    }
}

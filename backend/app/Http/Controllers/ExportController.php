<?php

namespace App\Http\Controllers;

use App\Jobs\ProcessExport;
use App\Models\ExportJob;
use App\Models\Project;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\StreamedResponse;

class ExportController extends Controller
{
    public function index(Request $request, Project $project): JsonResponse
    {
        abort_unless($project->user_id === $request->user()->id, 404);

        return response()->json([
            'data' => $project->exports()->orderByDesc('id')->limit(20)->get()->map(fn ($e) => $this->present($e)),
        ]);
    }

    /**
     * The browser renders the animation (PixiJS) into a WebM recording and uploads it;
     * the worker then runs FFmpeg to produce the requested deliverable.
     */
    public function store(Request $request, Project $project): JsonResponse
    {
        abort_unless($project->user_id === $request->user()->id, 404);

        $data = $request->validate([
            'format' => 'required|in:webm,mp4,png_sequence,gif,sprite_sheet',
            'width' => 'required|integer|min:64|max:3840',
            'height' => 'required|integer|min:64|max:2160',
            'fps' => 'required|integer|min:1|max:60',
            'file' => 'required|file|max:512000',
            'audio' => 'nullable|string|max:8000', // JSON: [{asset_id, start, volume}]
            'transparent' => 'nullable|boolean', // png_sequence only: file is a ZIP of PNG frames rendered with alpha
            'max_frames' => 'nullable|integer|min:1|max:400', // sprite_sheet only
        ]);

        $audio = null;
        if (in_array($data['format'], ['webm', 'mp4'], true) && ! empty($data['audio'])) {
            $decoded = json_decode($data['audio'], true);
            $v = \Illuminate\Support\Facades\Validator::make(['audio' => $decoded], [
                'audio' => 'required|array|max:20',
                'audio.*.asset_id' => 'required|integer',
                'audio.*.start' => 'required|numeric|min:0|max:7200',
                'audio.*.volume' => 'required|numeric|min:0|max:1',
                'audio.*.fade_in' => 'nullable|numeric|min:0|max:30',
                'audio.*.fade_out' => 'nullable|numeric|min:0|max:30',
            ]);
            if (! is_array($decoded) || $v->fails()) {
                return response()->json(['message' => 'Daftar audio tidak valid.', 'errors' => ['audio' => ['Daftar audio tidak valid.']]], 422);
            }
            $audio = array_values(array_map(fn ($c) => ['asset_id' => (int) $c['asset_id'], 'start' => (float) $c['start'], 'volume' => (float) $c['volume'], 'fade_in' => (float) ($c['fade_in'] ?? 0), 'fade_out' => (float) ($c['fade_out'] ?? 0)], $decoded));
            $ids = array_unique(array_column($audio, 'asset_id'));
            if (\App\Models\Asset::where('project_id', $project->id)->where('mime', 'like', 'audio/%')->whereIn('id', $ids)->count() !== count($ids)) {
                return response()->json(['message' => 'Klip audio merujuk aset yang tidak ada di project ini.', 'errors' => ['audio' => ['Aset audio tidak ditemukan.']]], 422);
            }
        }

        $transparent = ! empty($data['transparent']);
        if ($transparent) {
            if ($data['format'] !== 'png_sequence') {
                return response()->json(['message' => 'Transparan hanya untuk PNG sequence.', 'errors' => ['transparent' => ['Tidak didukung untuk format ini.']]], 422);
            }
            if ($err = $this->frameZipError($request->file('file')->getRealPath())) {
                return response()->json(['message' => $err, 'errors' => ['file' => [$err]]], 422);
            }
        }

        $path = $request->file('file')->storeAs(
            'projects/'.$project->id.'/exports',
            Str::uuid().($transparent ? '.src.zip' : '.src.webm'),
            'local',
        );

        $export = $project->exports()->create([
            'user_id' => $request->user()->id,
            'format' => $data['format'],
            'width' => $data['width'],
            'height' => $data['height'],
            'fps' => $data['fps'],
            'status' => 'queued',
            'audio' => $audio,
            'options' => $data['format'] === 'sprite_sheet' ? ['max_frames' => (int) ($data['max_frames'] ?? 120)] : ($transparent ? ['transparent' => true] : null),
            'source_path' => $path,
        ]);

        ProcessExport::dispatch($export->id);

        return response()->json(['data' => $this->present($export)], 202);
    }

    /** A transparent PNG export is uploaded as a ZIP of frame_00001.png ...: check it really is one before queueing. */
    private function frameZipError(string $path): ?string
    {
        $zip = new \ZipArchive;
        if ($zip->open($path) !== true) {
            return 'File bukan ZIP yang valid.';
        }
        $n = $zip->numFiles;
        if ($n < 1 || $n > 600) {
            return 'ZIP harus berisi 1–600 frame.';
        }
        $total = 0;
        for ($i = 0; $i < $n; $i++) {
            $st = $zip->statIndex($i);
            if (! preg_match('/^frame_\d{5}\.png$/', $st['name'])) {
                return 'Nama file di dalam ZIP tidak valid: '.mb_substr($st['name'], 0, 40);
            }
            $total += $st['size'];
            if ($st['size'] > 40_000_000 || $total > 1_500_000_000) {
                return 'Frame terlalu besar.';
            }
            if ($zip->getFromIndex($i, 8) !== "\x89PNG\r\n\x1a\n") {
                return 'Frame '.$st['name'].' bukan PNG.';
            }
        }
        $zip->close();

        return null;
    }

    public function show(Request $request, ExportJob $export): JsonResponse
    {
        abort_unless($export->user_id === $request->user()->id, 404);

        return response()->json(['data' => $this->present($export)]);
    }

    public function download(Request $request, ExportJob $export): StreamedResponse
    {
        abort_unless($export->user_id === $request->user()->id, 404);
        abort_unless($export->status === 'done' && $export->output_path, 409, 'Export belum selesai.');

        return Storage::disk('local')->download($export->output_path, 'export-'.$export->id.'.'.pathinfo($export->output_path, PATHINFO_EXTENSION));
    }

    private function present(ExportJob $e): array
    {
        return [
            'id' => $e->id,
            'format' => $e->format,
            'width' => $e->width,
            'height' => $e->height,
            'fps' => $e->fps,
            'status' => $e->status,
            'error' => $e->error,
            'created_at' => $e->created_at,
        ];
    }
}

<?php

namespace App\Http\Controllers;

use App\Jobs\GenerateStory;
use App\Jobs\ProduceEpisode;
use App\Models\Character;
use App\Models\StoryEpisode;
use App\Models\StorySeries;
use App\Services\DailyCartoonService;
use App\Services\FilmPipeline;
use App\Services\StoryWriter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** Story series: the author's idea (plot, characters, narration), the episodes written from it, and their film production / schedule. */
class StoryController extends Controller
{
    private const VOICES = ['id-ID-ArdiNeural', 'id-ID-GadisNeural'];

    private function own(Request $request, StorySeries $series): void
    {
        abort_unless($series->user_id === $request->user()->id, 404);
    }

    private function ownEpisode(Request $request, StoryEpisode $episode): StorySeries
    {
        $episode->loadMissing('series');
        $this->own($request, $episode->series);

        return $episode->series;
    }

    private function presentEpisode(StoryEpisode $e): array
    {
        return [
            'id' => $e->id, 'number' => $e->number, 'title' => $e->title, 'synopsis' => $e->synopsis, 'script' => $e->script, 'status' => $e->status,
            'scheduled_at' => $e->scheduled_at?->toIso8601String(), 'project_id' => $e->project_id, 'output_path' => $e->output_path,
            'publish' => $e->publish, 'published' => (bool) $e->published_url, 'error' => $e->error, 'scenes' => count($e->script['scenes'] ?? []),
        ];
    }

    private function presentSeries(StorySeries $s, bool $withEpisodes = false): array
    {
        $out = $s->only(['id', 'title', 'premise', 'genre', 'tone', 'narration_style', 'use_narrator', 'narrator_voice', 'characters', 'notes', 'episodes_planned', 'auto_run', 'schedule_time', 'auto_publish', 'ai_status', 'ai_message']);
        $out['last_auto_date'] = $s->last_auto_date?->toDateString();
        $out['episodes_count'] = $s->episodes()->count();
        $out['done_count'] = $s->episodes()->where('status', 'done')->count();
        if ($withEpisodes) {
            $out['episodes'] = $s->episodes()->get()->map(fn ($e) => $this->presentEpisode($e))->all();
            $out['capabilities'] = ['ai' => StoryWriter::available(), 'publish' => FilmPipeline::publishConfigured(), 'privacy' => config('services.clipper.privacy')];
        }

        return $out;
    }

    public function index(Request $request): JsonResponse
    {
        return response()->json(['data' => StorySeries::where('user_id', $request->user()->id)->orderByDesc('updated_at')->get()->map(fn ($s) => $this->presentSeries($s))]);
    }

    /** @return array|JsonResponse validated + normalised series fields */
    private function seriesData(Request $request, ?StorySeries $series = null): array|JsonResponse
    {
        $required = $series ? 'sometimes' : 'required';
        $d = $request->validate([
            'title' => "$required|string|max:120",
            'premise' => "$required|string|min:10|max:6000",
            'genre' => 'nullable|string|max:60',
            'tone' => 'nullable|string|max:120',
            'narration_style' => 'nullable|string|max:600',
            'use_narrator' => 'sometimes|boolean',
            'narrator_voice' => ['sometimes', Rule::in(self::VOICES)],
            'characters' => "$required|array|min:1|max:8",
            'characters.*.id' => 'nullable|integer',
            'characters.*.name' => 'required|string|max:40',
            'characters.*.role' => 'nullable|string|max:80',
            'characters.*.traits' => 'nullable|string|max:300',
            'characters.*.voice' => ['nullable', Rule::in(['male', 'female'])],
            'notes' => 'nullable|string|max:2000',
            'episodes_planned' => 'sometimes|integer|min:1|max:30',
            'auto_run' => 'sometimes|boolean',
            'schedule_time' => ['nullable', 'regex:/^([01]\d|2[0-3]):[0-5]\d$/'],
            'auto_publish' => 'sometimes|boolean',
        ]);
        if (isset($d['characters'])) {
            // a character that speaks must exist in the user's Character Builder (the film maker draws it from there)
            $all = Character::where('user_id', $request->user()->id)->whereIn('kind', ['builder', 'card'])->pluck('name');
            $mine = $all->reverse()->mapWithKeys(fn ($n) => [mb_strtolower($n) => $n]); // (several with the same name: the first one wins, and the spelling typed wins if it exists)
            $seen = [];
            foreach ($d['characters'] as $i => $c) {
                // an explicit id (picked in the editor) says which of several same-named characters is meant
                $byId = ! empty($c['id']) ? Character::where('user_id', $request->user()->id)->whereIn('kind', ['builder', 'card'])->find($c['id']) : null;
                $typed = trim($byId?->name ?? $c['name']);
                $canon = $byId ? $byId->name : ($all->contains($typed) ? $typed : ($mine[mb_strtolower($typed)] ?? null));
                if ($canon === null) {
                    return response()->json(['message' => "Karakter \"{$c['name']}\" belum dibuat di Character Builder.", 'errors' => ['characters' => ["Karakter \"{$c['name']}\" belum dibuat di Character Builder."]]], 422);
                }
                if (isset($seen[mb_strtolower($canon)])) {
                    return response()->json(['message' => "Karakter ganda: $canon", 'errors' => ['characters' => ["Karakter ganda: $canon"]]], 422);
                }
                if (DailyCartoonService::isNarrator($canon)) {
                    return response()->json(['message' => 'Nama "Narator" dipakai untuk narasi, pakai nama lain.', 'errors' => ['characters' => ['Nama Narator dipakai untuk narasi.']]], 422);
                }
                $seen[mb_strtolower($canon)] = true;
                $id = $byId?->id ?? Character::where('user_id', $request->user()->id)->whereIn('kind', ['builder', 'card'])->where('name', $canon)->orderBy('id')->value('id');
                $d['characters'][$i] = ['id' => $id, 'name' => $canon, 'role' => $c['role'] ?? null, 'traits' => $c['traits'] ?? null, 'voice' => $c['voice'] ?? null];
            }
        }

        return $d;
    }

    public function store(Request $request): JsonResponse
    {
        $d = $this->seriesData($request);
        if ($d instanceof JsonResponse) {
            return $d;
        }
        $series = StorySeries::create($d + ['user_id' => $request->user()->id])->refresh(); // (reads the column defaults back)

        return response()->json(['data' => $this->presentSeries($series, true)], 201);
    }

    public function show(Request $request, StorySeries $series): JsonResponse
    {
        $this->own($request, $series);

        return response()->json(['data' => $this->presentSeries($series, true)]);
    }

    public function update(Request $request, StorySeries $series): JsonResponse
    {
        $this->own($request, $series);
        $d = $this->seriesData($request, $series);
        if ($d instanceof JsonResponse) {
            return $d;
        }
        if (($d['auto_run'] ?? $series->auto_run) && empty($d['schedule_time'] ?? $series->schedule_time)) {
            return response()->json(['message' => 'Isi jam jadwal (HH:MM) untuk film otomatis harian.', 'errors' => ['schedule_time' => ['Jam jadwal wajib diisi.']]], 422);
        }
        $series->update($d);

        return response()->json(['data' => $this->presentSeries($series->fresh(), true)]);
    }

    public function destroy(Request $request, StorySeries $series): JsonResponse
    {
        $this->own($request, $series);
        $series->delete();

        return response()->json(['ok' => true]);
    }

    /** "Generate cerita lengkap": outline, scripts or both, written by the AI in the background. */
    public function generate(Request $request, StorySeries $series): JsonResponse
    {
        $this->own($request, $series);
        $d = $request->validate(['mode' => ['required', Rule::in(['outline', 'scripts', 'all'])], 'count' => 'nullable|integer|min:1|max:30']);
        if (! StoryWriter::available()) {
            return response()->json(['message' => 'AI tidak tersedia: nyalakan 9router dan isi AI_API_KEY di backend/.env, atau tulis naskah sendiri.'], 503);
        }
        if ($series->ai_status === 'working' && $series->updated_at->gt(now()->subMinutes(45))) {
            return response()->json(['message' => 'Masih ada penulisan cerita yang berjalan untuk seri ini.'], 429);
        }
        if ($d['mode'] !== 'outline' && $d['mode'] !== 'all' && ! $series->episodes()->exists()) {
            return response()->json(['message' => 'Belum ada episode. Buat alur episode dulu.'], 422);
        }
        $series->update(['ai_status' => 'working', 'ai_message' => 'Menunggu antrean…']);
        GenerateStory::dispatch($series->id, $d['mode'], (int) ($d['count'] ?? $series->episodes_planned));

        return response()->json(['data' => $this->presentSeries($series->fresh())], 202);
    }

    /** Generate series fields and episode scripts from a free-form prompt. */
    public function generateFromPrompt(Request $request, StorySeries $series): JsonResponse
    {
        $this->own($request, $series);
        $d = $request->validate(['prompt' => 'required|string|min:20|max:20000', 'count' => 'nullable|integer|min:1|max:10']);
        if (! StoryWriter::available()) return response()->json(['message' => 'AI tidak tersedia: nyalakan 9router dan periksa AI_API_KEY.'], 503);
        if ($series->ai_status === 'working' && $series->updated_at->gt(now()->subMinutes(45))) return response()->json(['message' => 'Masih ada proses AI yang berjalan untuk seri ini.'], 409);
        try {
            $result = app(StoryWriter::class)->fromPrompt($series, $d['prompt'], (int) ($d['count'] ?? 1));
            $series->update(['title' => $result['title'], 'premise' => $result['premise'], 'genre' => $result['genre'], 'tone' => $result['tone']]);
            $next = ($series->episodes()->max('number') ?? 0) + 1;
            foreach ($result['episodes'] as $i => $ep) StoryEpisode::create(['series_id' => $series->id, 'number' => $next + $i, 'title' => $ep['title'], 'synopsis' => $ep['synopsis'], 'script' => $ep['script'], 'status' => 'scripted']);
            return response()->json(['data' => $this->presentSeries($series->fresh(), true)]);
        } catch (\\RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }
    }

    public function addEpisode(Request $request, StorySeries $series): JsonResponse
    {
        $this->own($request, $series);
        $d = $request->validate(['title' => 'required|string|max:160', 'synopsis' => 'nullable|string|max:1500']);
        $ep = StoryEpisode::create($d + ['series_id' => $series->id, 'number' => ($series->episodes()->max('number') ?? 0) + 1, 'status' => 'planned']);

        return response()->json(['data' => $this->presentEpisode($ep)], 201);
    }

    public function updateEpisode(Request $request, StoryEpisode $episode): JsonResponse
    {
        $series = $this->ownEpisode($request, $episode);
        if (in_array($episode->status, ['producing', 'queued'], true)) {
            return response()->json(['message' => 'Episode sedang dibuat; tunggu selesai dulu.'], 409);
        }
        $d = $request->validate([
            'title' => 'sometimes|string|max:160', 'synopsis' => 'nullable|string|max:1500',
            'script' => 'nullable|array', 'scheduled_at' => 'nullable|date', 'publish' => 'sometimes|boolean',
        ]);
        if (array_key_exists('script', $d)) {
            if ($d['script'] === null) {
                $d['status'] = 'planned';
            } else {
                $allowed = $series->characterNames();
                if ($series->use_narrator) {
                    $allowed[] = 'Narator';
                }
                try {
                    $d['script'] = app(StoryWriter::class)->clean($d['script'], $allowed, $episode->title);
                } catch (\RuntimeException $e) {
                    return response()->json(['message' => $e->getMessage(), 'errors' => ['script' => [$e->getMessage()]]], 422);
                }
                $d['status'] = 'scripted';
                $d['error'] = null;
            }
        }
        $episode->update($d);

        return response()->json(['data' => $this->presentEpisode($episode->fresh())]);
    }

    public function destroyEpisode(Request $request, StoryEpisode $episode): JsonResponse
    {
        $this->ownEpisode($request, $episode);
        if (in_array($episode->status, ['producing', 'queued'], true)) {
            return response()->json(['message' => 'Episode sedang dibuat; tunggu selesai dulu.'], 409);
        }
        $episode->delete();

        return response()->json(['ok' => true]);
    }

    /** Write (or rewrite) the script of one episode with the AI. */
    public function writeScript(Request $request, StoryEpisode $episode): JsonResponse
    {
        $series = $this->ownEpisode($request, $episode);
        if (! StoryWriter::available()) {
            return response()->json(['message' => 'AI tidak tersedia: nyalakan 9router, atau tulis naskah sendiri.'], 503);
        }
        if (in_array($episode->status, ['producing', 'queued'], true) || ($series->ai_status === 'working' && $series->updated_at->gt(now()->subMinutes(45)))) {
            return response()->json(['message' => 'Masih ada proses yang berjalan untuk seri ini.'], 409);
        }
        $episode->update(['script' => null, 'status' => 'planned']);
        $series->update(['ai_status' => 'working', 'ai_message' => 'Menunggu antrean…']);
        GenerateStory::dispatch($series->id, 'scripts', 1, $episode->id);

        return response()->json(['data' => $this->presentSeries($series->fresh())], 202);
    }

    /** Film the episode now (or schedule it: PATCH scheduled_at). */
    public function produce(Request $request, StoryEpisode $episode): JsonResponse
    {
        $series = $this->ownEpisode($request, $episode);
        $d = $request->validate(['publish' => 'nullable|boolean']);
        if (in_array($episode->status, ['producing', 'queued'], true)) {
            return response()->json(['message' => 'Episode ini sudah dalam antrean atau sedang dibuat.'], 409);
        }
        if (empty($episode->script) && ! StoryWriter::available()) {
            return response()->json(['message' => 'Episode belum punya naskah dan AI tidak tersedia. Tulis naskahnya dulu.'], 422);
        }
        if (! empty($d['publish']) && ! FilmPipeline::publishConfigured()) {
            return response()->json(['message' => 'Unggah YouTube belum diatur: isi CLIPPER_PATH dan CLIPPER_YOUTUBE_ACCOUNT di .env.'], 422);
        }
        $episode->update(['status' => 'queued', 'error' => null, 'publish' => (bool) ($d['publish'] ?? false)]);
        ProduceEpisode::dispatch($episode->id);

        return response()->json(['data' => $this->presentEpisode($episode->fresh())], 202);
    }
}

<?php

namespace App\Http\Controllers;

use App\Jobs\ProcessLibraryAsset;
use App\Jobs\ProcessLibraryUpscale;
use App\Services\Enhancement\Upscaler;
use App\Models\AiJob;
use App\Models\AssetCategory;
use App\Models\LibraryAsset;
use App\Services\Library\AiAssetGenerator;
use App\Support\SvgSanitizer;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use RuntimeException;
use Symfony\Component\HttpFoundation\StreamedResponse;

/** Asset library: seeded system assets + the user's uploads and AI-generated assets (which wait for review). */
class LibraryController extends Controller
{
    private const RASTER = ['image/png' => 'png', 'image/jpeg' => 'jpg', 'image/webp' => 'webp'];

    public function categories(): JsonResponse
    {
        return response()->json(['data' => AssetCategory::orderBy('kind')->orderBy('sort')->get()]);
    }

    public function index(Request $request): JsonResponse
    {
        $data = $request->validate([
            'kind' => 'nullable|in:part,background,reference,prop',
            'category' => 'nullable|string|max:32',
            'q' => 'nullable|string|max:80',
            'status' => 'nullable|in:approved,pending,rejected',
            'mine' => 'nullable|boolean',
        ]);
        $q = LibraryAsset::visibleTo($request->user()->id)->with('category');
        if (! empty($data['kind'])) {
            $q->whereHas('category', fn ($c) => $c->where('kind', $data['kind']));
        }
        if (! empty($data['category'])) {
            $q->whereHas('category', fn ($c) => $c->where('slug', $data['category']));
        }
        if (! empty($data['status'])) {
            $q->where('status', $data['status']);
        } else {
            $q->where('status', '!=', 'rejected');
        }
        if (! empty($data['mine'])) {
            $q->where('user_id', $request->user()->id);
        }
        if (! empty($data['q'])) {
            $like = '%'.str_replace(['%', '_'], ['\\%', '\\_'], $data['q']).'%';
            $q->where(fn ($w) => $w->where('name', 'like', $like)->orWhere('tags', 'like', $like));
        }

        return response()->json(['data' => $q->orderBy('category_id')->orderBy('id')->limit(500)->get()->map->present()]);
    }

    /** Manual upload (SVG is sanitised; PNG/JPEG/WebP is validated). */
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'file' => 'required|file|max:6144',
            'category' => 'required|string|exists:asset_categories,slug',
            'name' => 'required|string|max:120',
            'tags' => 'nullable|string|max:200',
        ]);
        $file = $request->file('file');
        $category = AssetCategory::where('slug', $data['category'])->firstOrFail();

        try {
            [$content, $mime, $ext, $w, $h, $tint] = $this->readUpload($file);
        } catch (RuntimeException $e) {
            return response()->json(['message' => $e->getMessage(), 'errors' => ['file' => [$e->getMessage()]]], 422);
        }

        $asset = $this->persist($request->user()->id, $category, $data['name'], $this->tags($data['tags'] ?? ''), 'upload', 'approved', $content, $mime, $ext, $w, $h, $tint);

        return response()->json(['data' => $asset->present()], 201);
    }

    /**
     * Validates an uploaded SVG (sanitised) or raster file.
     *
     * @return array{0: string, 1: string, 2: string, 3: int, 4: int, 5: bool} content, mime, extension, width, height, tintable
     *
     * @throws RuntimeException user-facing message
     */
    private function readUpload(\Illuminate\Http\UploadedFile $file): array
    {
        $raw = (string) file_get_contents($file->getRealPath());
        if (preg_match('/^\s*(<\?xml[^>]*\?>\s*)?(<!--.*?-->\s*)*<svg[\s>]/is', $raw) === 1) {
            $clean = SvgSanitizer::clean($raw);

            return [$clean['svg'], 'image/svg+xml', 'svg', $clean['width'], $clean['height'], $clean['tintable']];
        }
        $mime = $file->getMimeType();
        $info = @getimagesize($file->getRealPath());
        if (! isset(self::RASTER[$mime]) || $info === false) {
            throw new RuntimeException('Format tidak didukung. Gunakan SVG, PNG, JPEG, atau WebP.');
        }
        if ($info[0] > 4000 || $info[1] > 4000) {
            throw new RuntimeException('Gambar maksimal 4000×4000 px.');
        }

        return [$raw, $mime, self::RASTER[$mime], $info[0], $info[1], false];
    }

    private function usedByVersions(LibraryAsset $asset): bool
    {
        return DB::table('character_version_assets')->where('library_asset_id', $asset->id)->exists();
    }

    /**
     * Replace the file of one of the user's assets (re-upload, or the result of the in-browser editor).
     * If a character version already uses the asset, that version must keep looking the same: the old row is archived
     * (still served) and the new content becomes a NEW asset; otherwise the file is replaced in place.
     */
    public function replace(Request $request, LibraryAsset $asset): JsonResponse
    {
        $this->own($request, $asset);
        $request->validate(['file' => 'required|file|max:6144']);
        try {
            [$content, $mime, $ext, $w, $h, $tint] = $this->readUpload($request->file('file'));
        } catch (RuntimeException $e) {
            return response()->json(['message' => $e->getMessage(), 'errors' => ['file' => [$e->getMessage()]]], 422);
        }
        $asset->load('category');

        if ($this->usedByVersions($asset)) {
            $new = DB::transaction(function () use ($asset, $content, $mime, $ext, $w, $h, $tint) {
                $asset->update(['archived_at' => now()]);

                return self::persistAsset($asset->user_id, $asset->category, $asset->name, $asset->tags ?? [], $asset->source === 'ai' ? 'upload' : $asset->source, 'approved',
                    $content, $mime, $ext, $w, $h, $tint, null, ($asset->meta ?? []) + ['replaces' => $asset->id]);
            });

            return response()->json(['data' => $new->present(), 'archived_old' => true, 'replaced_id' => $asset->id], 201);
        }

        $old = $asset->path;
        $path = 'library/u'.$asset->user_id.'/'.Str::uuid().'.'.$ext;
        Storage::disk($asset->disk)->put($path, $content);
        $asset->update(['path' => $path, 'mime' => $mime, 'width' => $w, 'height' => $h, 'tintable' => $tint, 'hash' => hash('sha256', $content)]);
        Storage::disk($asset->disk)->delete($old);

        return response()->json(['data' => $asset->fresh('category')->present(), 'archived_old' => false]);
    }

    /** Own, editable copy of any visible asset (e.g. a system SVG you want to modify). */
    public function duplicate(Request $request, LibraryAsset $asset): JsonResponse
    {
        abort_unless(LibraryAsset::visibleTo($request->user()->id)->whereKey($asset->id)->exists(), 404);
        $asset->load('category');
        $copy = self::persistAsset($request->user()->id, $asset->category, Str::limit($asset->name, 100, '').' (salinan)', $asset->tags ?? [], 'upload', 'approved',
            Storage::disk($asset->disk)->get($asset->path), $asset->mime, pathinfo($asset->path, PATHINFO_EXTENSION), $asset->width, $asset->height, $asset->tintable, null, ['copied_from' => $asset->id]);

        return response()->json(['data' => $copy->present()], 201);
    }

    public function file(LibraryAsset $asset): StreamedResponse
    {
        return Storage::disk($asset->disk)->response($asset->path, null, [
            'Content-Type' => $asset->mime,
            'Cache-Control' => 'private, max-age=3600',
            'X-Content-Type-Options' => 'nosniff',
            'Content-Security-Policy' => "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        ], 'inline');
    }

    public function update(Request $request, LibraryAsset $asset): JsonResponse
    {
        $this->own($request, $asset);
        $data = $request->validate([
            'name' => 'sometimes|string|max:120',
            'tags' => 'sometimes|nullable|string|max:200',
            'status' => 'sometimes|in:approved,rejected', // review of AI results
            'category' => 'sometimes|string|exists:asset_categories,slug',
        ]);
        if (isset($data['category'])) {
            $new = AssetCategory::where('slug', $data['category'])->firstOrFail();
            $asset->loadMissing('category');
            if ($new->kind !== $asset->category->kind) {
                return response()->json(['message' => 'Tidak bisa memindahkan antara bagian karakter dan lokasi.'], 422);
            }
            if ($new->id !== $asset->category_id && $this->usedByVersions($asset)) {
                return response()->json(['message' => 'Aset ini dipakai versi karakter; kategorinya tidak bisa diubah. Duplikat aset lalu ubah salinannya.'], 409);
            }
            $data['category_id'] = $new->id;
            unset($data['category']);
        }
        if (isset($data['status']) && $asset->status !== 'pending' && $data['status'] !== $asset->status) {
            return response()->json(['message' => 'Hanya aset berstatus pending yang bisa disetujui/ditolak.'], 409);
        }
        if (isset($data['tags'])) {
            $data['tags'] = $this->tags($data['tags']);
        }
        $asset->update($data);

        return response()->json(['data' => $asset->fresh('category')->present()]);
    }

    /** Assets used by any character version are archived (hidden), never deleted: old versions must keep rendering. */
    public function destroy(Request $request, LibraryAsset $asset): JsonResponse
    {
        $this->own($request, $asset);
        if ($this->usedByVersions($asset)) {
            $asset->update(['archived_at' => now()]);

            return response()->json(['ok' => true, 'archived' => true]);
        }
        Storage::disk($asset->disk)->delete($asset->path);
        $asset->delete();

        return response()->json(['ok' => true, 'archived' => false]);
    }

    /** AI Asset Studio: queue a generation job; the result arrives as a PENDING asset for review. */
    public function generate(Request $request): JsonResponse
    {
        $data = $request->validate([
            'category' => 'required|string|exists:asset_categories,slug',
            'prompt' => 'required|string|min:3|max:400',
        ]);
        if (in_array(AssetCategory::where('slug', $data['category'])->value('kind'), ['reference', 'prop'], true)) {
            return response()->json(['message' => 'Kategori referensi (pose/ekspresi) dan properti tidak dibuat oleh AI; unggah gambarnya.'], 422);
        }
        if (! AiAssetGenerator::configured()) {
            return response()->json(['message' => 'AI belum dikonfigurasi: isi AI_API_KEY di backend/.env.'], 503);
        }
        $uid = $request->user()->id;
        $limit = (int) config('services.ai.asset_daily_limit', 30);
        if (AiJob::where('user_id', $uid)->where('type', 'library_asset')->where('created_at', '>=', now()->startOfDay())->count() >= $limit) {
            return response()->json(['message' => "Batas harian pembuatan aset AI tercapai ($limit)."], 429);
        }
        if (AiJob::where('user_id', $uid)->where('type', 'library_asset')->whereIn('status', ['queued', 'processing'])->where('created_at', '>', now()->subMinutes(10))->exists()) {
            return response()->json(['message' => 'Masih ada pembuatan aset AI yang berjalan.'], 429);
        }

        // animation_jobs.project_id is required: AI asset jobs are not tied to a project, so use the user's first one
        $project = $request->user()->projects()->orderBy('id')->first();
        if (! $project) {
            return response()->json(['message' => 'Buat minimal satu project dulu.'], 422);
        }
        $job = AiJob::create(['project_id' => $project->id, 'user_id' => $uid, 'type' => 'library_asset', 'status' => 'queued',
            'input' => ['category' => $data['category'], 'prompt' => $data['prompt']]]);
        ProcessLibraryAsset::dispatch($job->id);

        return response()->json(['data' => ['id' => $job->id, 'status' => $job->status, 'type' => $job->type]], 202);
    }

    /** Local AI super-resolution of one of the user's raster assets -> a new, sharper copy (queued; the original is kept). */
    public function upscale(Request $request, LibraryAsset $asset): JsonResponse
    {
        $this->own($request, $asset);
        $data = $request->validate(['factor' => 'required|numeric|min:1.5|max:4']);
        if ($asset->mime === 'image/svg+xml') {
            return response()->json(['message' => 'Aset SVG sudah berupa vektor dan tidak perlu di-upscale.'], 422);
        }
        if (! Upscaler::available()) {
            return response()->json(['message' => Upscaler::unavailableReason(), 'code' => 'upscaler_unavailable'], 503);
        }
        if (max($asset->width, $asset->height) > 1100) {
            return response()->json(['message' => 'Gambar terlalu besar untuk upscale AI (maks. 1100 px sisi terpanjang).'], 422);
        }
        if (max($asset->width, $asset->height) * (float) $data['factor'] > 4096) {
            return response()->json(['message' => 'Hasil akan melebihi 4096 px; pilih faktor lebih kecil.'], 422);
        }
        $uid = $request->user()->id;
        if (AiJob::where('user_id', $uid)->where('type', 'library_upscale')->whereIn('status', ['queued', 'processing'])->where('created_at', '>', now()->subMinutes(15))->exists()) {
            return response()->json(['message' => 'Masih ada peningkatan resolusi yang berjalan.'], 429);
        }
        $project = $request->user()->projects()->orderBy('id')->first();
        if (! $project) {
            return response()->json(['message' => 'Buat minimal satu project dulu.'], 422);
        }
        $job = AiJob::create(['project_id' => $project->id, 'user_id' => $uid, 'type' => 'library_upscale', 'status' => 'queued',
            'input' => ['asset_id' => $asset->id, 'factor' => (float) $data['factor']]]);
        ProcessLibraryUpscale::dispatch($job->id);

        return response()->json(['data' => ['id' => $job->id, 'status' => $job->status, 'type' => $job->type]], 202);
    }

    /** Shared by upload, AI and the seeder. */
    public static function persistAsset(?int $userId, AssetCategory $category, string $name, array $tags, string $source, string $status, string $content, string $mime, string $ext, int $w, int $h, bool $tint, ?string $key = null, array $meta = []): LibraryAsset
    {
        $path = 'library/'.($userId ? 'u'.$userId : 'system').'/'.Str::uuid().'.'.$ext;
        Storage::disk('local')->put($path, $content);

        return LibraryAsset::create(['user_id' => $userId, 'category_id' => $category->id, 'key' => $key, 'name' => $name, 'tags' => $tags,
            'source' => $source, 'status' => $status, 'disk' => 'local', 'path' => $path, 'mime' => $mime, 'width' => $w, 'height' => $h,
            'tintable' => $tint, 'hash' => hash('sha256', $content), 'meta' => $meta ?: null])->load('category');
    }

    private function persist(int $uid, AssetCategory $c, string $name, array $tags, string $source, string $status, string $content, string $mime, string $ext, int $w, int $h, bool $tint): LibraryAsset
    {
        return self::persistAsset($uid, $c, $name, $tags, $source, $status, $content, $mime, $ext, $w, $h, $tint);
    }

    private function tags(string $s): array
    {
        return array_values(array_unique(array_filter(array_map(fn ($t) => Str::limit(Str::lower(trim($t)), 24, ''), explode(',', $s)))));
    }

    private function own(Request $request, LibraryAsset $asset): void
    {
        abort_unless($asset->user_id === $request->user()->id, 404);
    }
}

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
            'view' => 'nullable|in:front,right,left,back',
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
        if (! empty($data['view'])) { // an asset without a view faces front
            $data['view'] === 'front'
                ? $q->where(fn ($w) => $w->whereNull('meta->view')->orWhere('meta->view', 'front'))
                : $q->where('meta->view', $data['view']);
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
            'view' => 'nullable|in:front,right,left,back',
            'family' => ['nullable', \Illuminate\Validation\Rule::in(array_keys(\App\Services\Library\DesignFamily::FAMILIES))],
        ]);
        $file = $request->file('file');
        $category = AssetCategory::where('slug', $data['category'])->firstOrFail();

        try {
            [$content, $mime, $ext, $w, $h, $tint] = $this->readUpload($file);
        } catch (RuntimeException $e) {
            return response()->json(['message' => $e->getMessage(), 'errors' => ['file' => [$e->getMessage()]]], 422);
        }

        $asset = self::persistAsset($request->user()->id, $category, $data['name'], $this->tags($data['tags'] ?? ''), 'upload', 'approved', $content, $mime, $ext, $w, $h, $tint, null, (($data['view'] ?? 'front') === 'front' ? [] : ['view' => $data['view']]) + (empty($data['family']) ? [] : ['family' => $data['family']]));

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

    /** Create an immutable new version; previous versions remain available for restore. */
    public function replace(Request $request, LibraryAsset $asset): JsonResponse
    {
        $this->own($request, $asset);
        $data = $request->validate([
            'file' => 'required|file|max:6144',
            'note' => 'nullable|string|max:200',
        ]);
        try {
            [$content, $mime, $ext, $w, $h, $tint] = $this->readUpload($request->file('file'));
        } catch (RuntimeException $e) {
            return response()->json(['message' => $e->getMessage(), 'errors' => ['file' => [$e->getMessage()]]], 422);
        }
        $asset->load('category');

        $new = DB::transaction(function () use ($asset, $content, $mime, $ext, $w, $h, $tint, $data) {
            $current = LibraryAsset::whereKey($asset->id)->lockForUpdate()->firstOrFail();
            abort_unless($current->user_id === $asset->user_id, 404);
            abort_unless($current->is_current && $current->archived_at === null, 409, 'Versi ini sudah tidak aktif. Muat ulang riwayat aset.');
            $current->update(['archived_at' => now(), 'is_current' => false]);

            $next = self::persistAsset(
                $current->user_id,
                $current->category,
                $current->name,
                $current->tags ?? [],
                $current->source,
                'approved',
                $content,
                $mime,
                $ext,
                $w,
                $h,
                $tint,
                null,
                ($current->meta ?? []) + ['replaces' => $current->id]
            );
            $next->update([
                'asset_uuid' => $current->asset_uuid,
                'version_number' => $current->version_number + 1,
                'parent_asset_id' => $current->id,
                'is_current' => true,
                'change_note' => $data['note'] ?? 'File diperbarui',
            ]);

            return $next->fresh('category');
        });

        return response()->json(['data' => $new->present(), 'archived_old' => true, 'replaced_id' => $asset->id], 201);
    }

    /** Return every immutable version belonging to this logical asset. */
    public function versions(Request $request, LibraryAsset $asset): JsonResponse
    {
        $this->own($request, $asset);

        $versions = LibraryAsset::where('user_id', $asset->user_id)
            ->where('asset_uuid', $asset->asset_uuid)
            ->with('category')
            ->orderByDesc('version_number')
            ->get()
            ->map(fn (LibraryAsset $version) => $version->present());

        return response()->json(['data' => $versions]);
    }

    /** Restore an older snapshot by creating a new current version; history is never rewritten. */
    public function restoreVersion(Request $request, LibraryAsset $asset): JsonResponse
    {
        $this->own($request, $asset);
        $data = $request->validate(['note' => 'nullable|string|max:200']);
        $asset->load('category');
        $content = Storage::disk($asset->disk)->get($asset->path);

        $restored = DB::transaction(function () use ($request, $asset, $content, $data) {
            $family = LibraryAsset::where('user_id', $request->user()->id)
                ->where('asset_uuid', $asset->asset_uuid)
                ->lockForUpdate()
                ->get();
            $current = $family->firstWhere('is_current', true);

            if ($current && $current->id === $asset->id) {
                return $current->load('category');
            }

            if ($current) {
                $current->update(['archived_at' => now(), 'is_current' => false]);
            }

            $asset->loadMissing('category');
            $next = self::persistAsset(
                $request->user()->id,
                $asset->category,
                $asset->name,
                $asset->tags ?? [],
                $asset->source,
                'approved',
                $content,
                $asset->mime,
                pathinfo($asset->path, PATHINFO_EXTENSION),
                $asset->width,
                $asset->height,
                $asset->tintable,
                null,
                ($asset->meta ?? []) + ['restored_from' => $asset->id]
            );
            $next->update([
                'asset_uuid' => $asset->asset_uuid,
                'version_number' => ((int) LibraryAsset::where('asset_uuid', $asset->asset_uuid)->max('version_number')) + 1,
                'parent_asset_id' => $current?->id,
                'is_current' => true,
                'change_note' => $data['note'] ?? 'Restore dari versi '.$asset->version_number,
            ]);

            return $next->fresh('category');
        });

        return response()->json(['data' => $restored->present()]);
    }

    /** Run the design-template checks again on one of the user's parts and store the report. */
    public function validateAsset(Request $request, LibraryAsset $asset): JsonResponse
    {
        $this->own($request, $asset);
        $asset->load('category');
        if ($asset->category->kind !== 'part') {
            return response()->json(['message' => 'Hanya bagian karakter yang divalidasi terhadap template.'], 422);
        }
        $report = (new \App\Services\Library\AssetValidator)->validate(Storage::disk($asset->disk)->get($asset->path), $asset->mime, $asset->width, $asset->height, $asset->category->slug, $asset->meta['view'] ?? 'front', \App\Services\Library\DesignTemplate::exists($asset->meta['template'] ?? '') ? \App\Services\Library\DesignTemplate::load($asset->meta['template']) : null, $asset->id, $asset->hash, $asset->meta['family'] ?? null);
        $meta = $asset->meta ?? [];
        $meta['validation'] = $report + (($meta['validation']['held'] ?? false) ? ['held' => true] : []);
        $asset->update(['meta' => $meta]);

        return response()->json(['data' => $asset->fresh('category')->present(), 'report' => $report]);
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
        abort_unless($asset->is_current && $asset->archived_at === null, 409, 'Versi ini sudah tidak aktif. Muat ulang Library.');
        $data = $request->validate([
            'name' => 'sometimes|string|max:120',
            'tags' => 'sometimes|nullable|string|max:200',
            'status' => 'sometimes|in:approved,rejected',
            'category' => 'sometimes|string|exists:asset_categories,slug',
            'note' => 'nullable|string|max:200',
        ]);

        if (isset($data['status']) && $asset->status !== 'pending' && $data['status'] !== $asset->status) {
            return response()->json(['message' => 'Hanya aset berstatus pending yang bisa disetujui/ditolak.'], 409);
        }
        if (isset($data['tags'])) {
            $data['tags'] = $this->tags($data['tags']);
        }

        $revisionKeys = ['name', 'tags', 'category'];
        $hasRevision = count(array_intersect($revisionKeys, array_keys($data))) > 0;

        if ($hasRevision) {
            $asset->load('category');
            $category = isset($data['category'])
                ? AssetCategory::where('slug', $data['category'])->firstOrFail()
                : $asset->category;
            if ($category->kind !== $asset->category->kind) {
                return response()->json(['message' => 'Tidak bisa memindahkan antara jenis aset yang berbeda.'], 422);
            }

            $new = DB::transaction(function () use ($asset, $data, $category) {
                $current = LibraryAsset::whereKey($asset->id)->lockForUpdate()->firstOrFail();
                $newPath = 'library/u'.$current->user_id.'/'.Str::uuid().'.'.pathinfo($current->path, PATHINFO_EXTENSION);
                $contents = Storage::disk($current->disk)->get($current->path);
                if (! Storage::disk($current->disk)->put($newPath, $contents)) {
                    throw new RuntimeException('Gagal menyimpan snapshot aset baru.');
                }

                $current->update(['archived_at' => now(), 'is_current' => false]);
                $next = LibraryAsset::create([
                    'user_id' => $current->user_id,
                    'category_id' => $category->id,
                    'key' => null,
                    'name' => $data['name'] ?? $current->name,
                    'tags' => $data['tags'] ?? ($current->tags ?? []),
                    'source' => $current->source,
                    'status' => $data['status'] ?? $current->status,
                    'disk' => $current->disk,
                    'path' => $newPath,
                    'mime' => $current->mime,
                    'width' => $current->width,
                    'height' => $current->height,
                    'tintable' => $current->tintable,
                    'hash' => $current->hash,
                    'meta' => $current->meta,
                    'asset_uuid' => $current->asset_uuid,
                    'version_number' => $current->version_number + 1,
                    'parent_asset_id' => $current->id,
                    'is_current' => true,
                    'change_note' => $data['note'] ?? 'Metadata aset diperbarui',
                ]);

                return $next->load('category');
            });

            return response()->json(['data' => $new->present(), 'new_version' => true], 201);
        }

        if (isset($data['status'])) {
            $asset->update(['status' => $data['status']]);
        }

        return response()->json(['data' => $asset->fresh('category')->present(), 'new_version' => false]);
    }

    /** Assets used by any character version are archived (hidden), never deleted: old versions must keep rendering. */
    public function destroy(Request $request, LibraryAsset $asset): JsonResponse
    {
        $this->own($request, $asset);
        $hasHistory = LibraryAsset::where('user_id', $asset->user_id)
            ->where('asset_uuid', $asset->asset_uuid)
            ->where('id', '!=', $asset->id)
            ->exists();

        if ($this->usedByVersions($asset) || $hasHistory) {
            $asset->update(['archived_at' => now(), 'is_current' => false]);

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
            'view' => 'nullable|in:front,right,left,back',
            'character' => 'nullable|string|max:200', // e.g. "male, teenager, slim"
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
            'input' => ['category' => $data['category'], 'prompt' => $data['prompt'], 'view' => $data['view'] ?? 'front', 'character' => $data['character'] ?? null]]);
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
        // a part on the standard canvas is mostly transparent: only its artwork is upscaled (see ProcessLibraryUpscale), which the worker limits itself
        if (! \App\Services\Library\SlotTemplate::isFullCanvas($asset->width, $asset->height) && max($asset->width, $asset->height) > 1100) {
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
        // every body part is stored in the standard part format (one shared canvas, fixed place per slot): see SlotTemplate
        if ($category->kind === 'part' && ($c = \App\Services\Library\SlotTemplate::conform($category->slug, $content, $mime, $w, $h))) {
            ['content' => $content, 'mime' => $mime, 'ext' => $ext, 'width' => $w, 'height' => $h] = $c;
            $meta['conformed'] = true;
        }
        // an uploaded or generated part is checked against the design template; one that breaks a rule is NOT approved automatically
        if ($userId !== null && $category->kind === 'part' && \App\Services\Library\DesignTemplate::load()->hasSlot($category->slug)) {
            $meta['family'] ??= \App\Services\Library\DesignFamily::infer($name, $key);
            $tplId = \App\Services\Library\DesignTemplate::exists($meta['template'] ?? '') ? $meta['template'] : \App\Services\Library\DesignTemplate::DEFAULT;
            $report = (new \App\Services\Library\AssetValidator)->validate($content, $mime, $w, $h, $category->slug, $meta['view'] ?? 'front', \App\Services\Library\DesignTemplate::load($tplId), null, hash('sha256', $content), $meta['family']);
            $meta['validation'] = $report;
            if ($mime !== 'image/svg+xml' && ($found = \App\Services\Library\AnchorExtractor::extract($content, $category->slug))) {
                $meta['anchors'] = $found; // named attachment points of this part (canvas units)
            }
            if (! $report['ok'] && $status === 'approved') {
                $status = 'pending';
                $meta['validation']['held'] = true; // waits for the author's decision in the review list
            }
        }
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

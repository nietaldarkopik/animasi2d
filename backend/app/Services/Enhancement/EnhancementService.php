<?php

namespace App\Services\Enhancement;

use App\Models\Asset;
use App\Services\ImageWorker;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/** Produces a NEW asset (kind=enhanced, parent=source) per run; originals and earlier versions are never overwritten. */
class EnhancementService
{
    public function __construct(private ImageWorker $worker) {}

    /** @return array{asset: Asset, notes: list<string>} */
    public function local(Asset $source, string $mode, array $options): array
    {
        $ops = EnhancementPlanner::localOps($mode, $options);
        ['asset' => $new, 'result' => $result] = $this->worker->run(
            $source,
            $ops,
            pathinfo($source->original_name, PATHINFO_FILENAME).'-'.str_replace('_', '-', $mode),
            ['kind' => 'enhanced', 'mode' => $mode],
        );
        $new->update(['meta' => ['engine' => 'local', 'ops' => $ops, 'notes' => $result['notes'] ?? []]]);

        return ['asset' => $new, 'notes' => $result['notes'] ?? []];
    }

    /** @return array{asset: Asset, notes: list<string>} */
    public function localAi(Asset $source, float $factor): array
    {
        ['asset' => $new, 'result' => $result] = $this->worker->run(
            $source,
            Upscaler::ops($factor),
            pathinfo($source->original_name, PATHINFO_FILENAME).'-hd',
            ['kind' => 'enhanced', 'mode' => 'upscale_ai'],
            600,
        );
        $notes = $result['notes'] ?? [];
        $new->update(['meta' => ['engine' => 'local-ai', 'model' => config('services.upscaler.model'), 'factor' => $factor, 'notes' => $notes]]);

        return ['asset' => $new, 'notes' => $notes];
    }

    /** @return array{asset: Asset, notes: list<string>} */
    public function remote(Asset $source, string $mode): array
    {
        $bytes = app(RemoteImageProvider::class)->run($source, $mode);
        $img = imagecreatefromstring($bytes);
        $rel = 'projects/'.$source->project_id.'/assets/'.Str::uuid().'.png';
        $disk = Storage::disk($source->disk);
        $disk->put($rel, $this->toPng($img));

        $notes = ['Dihasilkan oleh provider AI eksternal ('.config('services.ai_image.model').'). Periksa hasilnya: bentuk karakter dapat berubah.'];
        $new = Asset::create([
            'project_id' => $source->project_id, 'user_id' => $source->user_id, 'disk' => $source->disk, 'path' => $rel,
            'kind' => 'enhanced', 'parent_id' => $source->id, 'mode' => $mode,
            'original_name' => Str::limit(pathinfo($source->original_name, PATHINFO_FILENAME).'-'.str_replace('_', '-', $mode), 190, '').'.png',
            'mime' => 'image/png', 'size' => $disk->size($rel), 'width' => imagesx($img), 'height' => imagesy($img),
            'meta' => ['engine' => 'ai', 'model' => config('services.ai_image.model'), 'notes' => $notes],
        ]);

        return ['asset' => $new, 'notes' => $notes];
    }

    /**
     * All versions that belong to the same original as $asset (the root plus every descendant), oldest first.
     *
     * @return Collection<int, Asset>
     */
    public function lineage(Asset $asset): Collection
    {
        $all = Asset::where('project_id', $asset->project_id)->where('mime', 'like', 'image/%')->get()->keyBy('id');
        $root = $asset;
        for ($i = 0; $i < 100 && $root->parent_id && isset($all[$root->parent_id]); $i++) {
            $root = $all[$root->parent_id];
        }
        $ids = [$root->id => true];
        do {
            $grew = false;
            foreach ($all as $a) {
                if ($a->parent_id && isset($ids[$a->parent_id]) && ! isset($ids[$a->id])) {
                    $ids[$a->id] = true;
                    $grew = true;
                }
            }
        } while ($grew);

        return $all->filter(fn ($a) => isset($ids[$a->id]))->sortBy('id')->values();
    }

    private function toPng(\GdImage $img): string
    {
        ob_start();
        imagepng($img);

        return (string) ob_get_clean();
    }
}

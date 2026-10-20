<?php

namespace App\Services;

use App\Models\Asset;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use RuntimeException;
use Symfony\Component\Process\Process;

/** Runs worker/imagetool.py (Pillow) on a stored asset and stores the PNG result as a NEW asset. */
class ImageWorker
{
    /**
     * @param  list<array>  $ops
     * @return array{asset: Asset, result: array}
     *
     * @throws ImageWorkerException user-facing message + suggested HTTP status
     */
    public function run(Asset $asset, array $ops, ?string $name = null, array $attrs = [], int $timeout = 60): array
    {
        $disk = Storage::disk($asset->disk);
        $rel = 'projects/'.$asset->project_id.'/assets/'.Str::uuid().'.png';
        $disk->makeDirectory(dirname($rel));
        $out = $disk->path($rel);

        try {
            $result = $this->process($disk->path($asset->path), $out, $ops, $timeout);
        } catch (ImageWorkerException $e) {
            $disk->delete($rel);
            throw $e;
        }

        $name ??= pathinfo($asset->original_name, PATHINFO_FILENAME).'-edit';
        $new = Asset::create($attrs + [
            'kind' => 'enhanced',
            'parent_id' => $asset->id,
            'project_id' => $asset->project_id,
            'user_id' => $asset->user_id,
            'disk' => $asset->disk,
            'path' => $rel,
            'original_name' => Str::limit($name, 190, '').'.png',
            'mime' => 'image/png',
            'size' => filesize($out),
            'width' => $result['width'],
            'height' => $result['height'],
        ]);

        return ['asset' => $new, 'result' => $result];
    }

    /**
     * File-to-file core (also used for library assets). Returns the worker's JSON result.
     *
     * @return array{width: int, height: int, notes?: list<string>, pixel_scale?: float, origin?: array, input_size?: array}
     *
     * @throws ImageWorkerException
     */
    public function process(string $inPath, string $outPath, array $ops, int $timeout = 60): array
    {
        $p = new Process([
            config('services.python.bin'), '-I', rtrim(config('services.python.worker_dir'), '/\\').DIRECTORY_SEPARATOR.'imagetool.py',
            '--in', $inPath, '--out', $outPath, '--ops', json_encode($ops),
        ]);
        $p->setTimeout($timeout);
        try {
            $p->run();
        } catch (\Throwable $e) {
            report($e);
            throw new ImageWorkerException('Pemrosesan gambar melebihi batas waktu atau gagal dijalankan.', 500);
        }

        $result = json_decode($p->getOutput(), true);
        if (! $p->isSuccessful() || ! is_array($result) || isset($result['error'])) {
            $known = is_array($result) && isset($result['error']);
            if (! $known) {
                report(new RuntimeException('imagetool: '.$p->getErrorOutput()));
            }
            throw new ImageWorkerException($known ? $result['error'] : 'Pemrosesan gambar gagal.', $known ? 422 : 500);
        }

        return $result;
    }
}
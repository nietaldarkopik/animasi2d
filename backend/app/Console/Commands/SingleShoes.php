<?php

namespace App\Console\Commands;

use App\Http\Controllers\LibraryController;
use App\Models\LibraryAsset;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;

/**
 * Shoes as ONE shoe (the viewer-left one); the other foot is the same shoe mirrored about the centre line. A pair drawn in one image
 * could not be resized to fit the legs (scaling the pair also moves the shoes apart); a single shoe scales about its own centre.
 * The pairs are archived (characters that use them keep rendering and can still be edited), the library lists the single shoes.
 */
class SingleShoes extends Command
{
    protected $signature = 'library:single-shoes {--dry-run}';

    protected $description = 'Replace raster shoe pairs of the library by one mirrored shoe (meta.mirror = pivot of the shoe)';

    public function handle(): int
    {
        $n = 0;
        foreach (LibraryAsset::with('category')->whereNull('archived_at')->whereHas('category', fn ($c) => $c->where('slug', 'shoes'))->orderBy('id')->get() as $a) {
            if ($a->mime !== 'image/png' || ($a->meta['mirror'] ?? null) || ($a->meta['view'] ?? 'front') !== 'front' || $a->width !== 800 || $a->height !== 1600) {
                continue;
            }
            $im = @imagecreatefromstring(Storage::disk($a->disk)->get($a->path));
            if ($im === false) {
                continue;
            }
            $left = imagecreatetruecolor(800, 1600);
            imagealphablending($left, false);
            imagesavealpha($left, true);
            imagefill($left, 0, 0, imagecolorallocatealpha($left, 0, 0, 0, 127));
            imagecopy($left, $im, 0, 0, 0, 0, 400, 1600); // only the viewer-left half
            [$x0, $y0, $x1, $y1] = [800, 1600, -1, -1];
            for ($y = 0; $y < 1600; $y += 2) {
                for ($x = 0; $x < 400; $x += 2) {
                    if (((imagecolorat($left, $x, $y) >> 24) & 0x7F) < 120) {
                        [$x0, $y0, $x1, $y1] = [min($x0, $x), min($y0, $y), max($x1, $x), max($y1, $y)];
                    }
                }
            }
            if ($x1 < 0) {
                continue;
            }
            $pivot = ['px' => round(($x0 + $x1) / 4, 1), 'py' => round(($y0 + $y1) / 4, 1)]; // canvas units
            $this->line(sprintf('#%d %s -> 1 sepatu, pivot (%s, %s)', $a->id, $a->name, $pivot['px'], $pivot['py']));
            if ($this->option('dry-run')) {
                continue;
            }
            ob_start();
            imagepng($left);
            $png = (string) ob_get_clean();
            $name = preg_replace('/\s*\((sepasang|pasang)\)\s*/i', ' ', $a->name);
            $a->update(['archived_at' => now()]);
            LibraryController::persistAsset($a->user_id, $a->category, trim($name).' (satu, dicerminkan)', $a->tags ?? [], $a->source, $a->status, $png, 'image/png', 'png', 800, 1600, $a->tintable, null,
                ($a->meta ?? []) + ['mirror' => $pivot, 'replaces' => $a->id]);
            $n++;
        }
        $this->info("$n pasang sepatu diganti satu sepatu dicerminkan.");

        return self::SUCCESS;
    }
}

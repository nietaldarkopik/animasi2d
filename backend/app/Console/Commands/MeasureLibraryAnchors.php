<?php

namespace App\Console\Commands;

use App\Models\LibraryAsset;
use App\Services\Library\AnchorExtractor;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;

/** Measures and stores the named anchors of every raster body part of the library (new parts get theirs when they are stored). */
class MeasureLibraryAnchors extends Command
{
    protected $signature = 'library:anchors {--force : measure again even when the part already has anchors}';

    protected $description = 'Store the named attachment points (neck, eyes, shoulder, ankle...) of every raster part';

    public function handle(): int
    {
        $n = 0;
        foreach (LibraryAsset::with('category')->whereNull('archived_at')->where('mime', 'image/png')->whereHas('category', fn ($c) => $c->where('kind', 'part'))->get() as $a) {
            if (! $this->option('force') && ! empty($a->meta['anchors'])) {
                continue;
            }
            $found = AnchorExtractor::extract(Storage::disk($a->disk)->get($a->path), $a->category->slug);
            if ($found) {
                $a->update(['meta' => ($a->meta ?? []) + ['anchors' => $found]]);
                $n++;
            }
        }
        $this->info("$n bagian diukur titik pasangnya.");

        return self::SUCCESS;
    }
}

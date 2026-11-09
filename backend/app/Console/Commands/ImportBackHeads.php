<?php

namespace App\Console\Commands;

use App\Http\Controllers\LibraryController;
use App\Models\AssetCategory;
use App\Models\LibraryAsset;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;

/**
 * "Rambut belakang 1-8" are drawings of the head seen from BEHIND (hair, ears, nape). Registered again as front-layer hair of
 * the back view, they give a character a back of the head: face, eyes and mouth are not drawn from behind, the hair covers them.
 */
class ImportBackHeads extends Command
{
    protected $signature = 'library:back-heads';

    protected $description = 'Register the back-of-head drawings as back-facing hair (hair_front, view=back)';

    public function handle(): int
    {
        $cat = AssetCategory::where('slug', 'hair_front')->firstOrFail();
        $n = 0;
        foreach (LibraryAsset::with('category')->whereNull('archived_at')->where('name', 'like', 'Rambut belakang %')->whereHas('category', fn ($c) => $c->where('slug', 'hair_back'))->orderBy('id')->get() as $a) {
            if (! preg_match('/^Rambut belakang (\d+)$/', $a->name, $m)) {
                continue; // the three drawn-in-code ones (panjang, pendek, sanggul) are not rear views
            }
            $name = "Kepala belakang {$m[1]} (rambut)";
            if (LibraryAsset::where('user_id', $a->user_id)->where('name', $name)->whereNull('archived_at')->exists()) {
                continue;
            }
            LibraryController::persistAsset($a->user_id, $cat, $name, ['belakang', 'kepala'], $a->source, 'approved', Storage::disk($a->disk)->get($a->path), $a->mime, pathinfo($a->path, PATHINFO_EXTENSION),
                $a->width, $a->height, $a->tintable, null, ['view' => 'back', 'copied_from' => $a->id]);
            $n++;
        }
        $this->info("$n kepala belakang didaftarkan.");

        return self::SUCCESS;
    }
}

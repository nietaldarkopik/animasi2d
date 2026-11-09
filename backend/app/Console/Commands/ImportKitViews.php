<?php

namespace App\Console\Commands;

use App\Http\Controllers\LibraryController;
use App\Models\AssetCategory;
use App\Models\LibraryAsset;
use App\Models\User;
use Illuminate\Console\Command;

/**
 * Registers the side/back parts composed by tools/sheet_import/compose_views.py (master-assets/kit_badan_sma/<kit>/views) in the
 * library, in the standard part format, and links every view of a kit part into one "set" so the Builder can swap the whole
 * character to another facing in one click. The front assets of the kits get the same set key.
 */
class ImportKitViews extends Command
{
    protected $signature = 'library:import-views {--user=1}';

    protected $description = 'Import the right/left/back parts of the body kits and link them with their front assets';

    /** kit folder => [slot => library id of the already imported FRONT asset] */
    private const FRONT = [
        'laki_laki_anime' => ['body' => 1510, 'top' => 1511, 'bottom' => 1512, 'shoes' => 1513],
        'perempuan_panjang_anime' => ['body' => 1502, 'top' => 1503, 'bottom' => 1504, 'shoes' => 1505],
        'perempuan_pendek_anime' => ['body' => 1506, 'top' => 1507, 'bottom' => 1508, 'shoes' => 1509],
    ];

    public function handle(): int
    {
        $root = base_path('../master-assets/kit_badan_sma');
        $index = json_decode((string) @file_get_contents($root.'/views_index.json'), true);
        if (! is_array($index)) {
            $this->error('views_index.json tidak ada: jalankan python tools/sheet_import/compose_views.py dulu.');

            return self::FAILURE;
        }
        $user = User::find((int) $this->option('user'));
        if (! $user) {
            $this->error('User tidak ditemukan.');

            return self::FAILURE;
        }
        $cats = AssetCategory::pluck('id', 'slug');
        $added = $linked = 0;

        foreach (self::FRONT as $kit => $slots) {
            foreach ($slots as $slot => $id) {
                $a = LibraryAsset::find($id);
                if ($a && ($a->meta['set'] ?? null) !== "kit:$kit:$slot") {
                    $a->update(['meta' => ($a->meta ?? []) + ['set' => "kit:$kit:$slot"]]);
                    $linked++;
                }
            }
        }
        // the bare torsos ("Badan laki-laki - depan/kanan/kiri/belakang") already exist in 4 views: link them by gender
        foreach (LibraryAsset::whereNull('archived_at')->where('name', 'like', 'Badan %- %')->get() as $a) {
            if (preg_match('/^Badan (laki-laki|perempuan) - (depan|kanan|kiri|belakang)$/', $a->name, $m) && ($a->meta['set'] ?? null) !== "torso:{$m[1]}") {
                $a->update(['meta' => ($a->meta ?? []) + ['set' => "torso:{$m[1]}", 'view' => ['depan' => 'front', 'kanan' => 'right', 'kiri' => 'left', 'belakang' => 'back'][$m[2]]]]);
                $linked++;
            }
        }
        foreach ($index as $row) {
            $exists = LibraryAsset::where('user_id', $user->id)->where('name', $row['name'])->whereNull('archived_at')->exists();
            if ($exists) {
                continue;
            }
            $file = $root.'/'.$row['file'];
            if (! is_file($file) || ! isset($cats[$row['slot']])) {
                $this->warn("dilewati: {$row['name']}");

                continue;
            }
            LibraryController::persistAsset($user->id, AssetCategory::find($cats[$row['slot']]), $row['name'], ['kit', 'sma', $row['view']], 'upload', 'approved',
                (string) file_get_contents($file), 'image/png', 'png', 800, 1600, false, null, ['view' => $row['view'], 'set' => "kit:{$row['kit']}:{$row['slot']}", 'licence' => 'Kit turnaround milik pengguna']);
            $added++;
        }
        $this->info("Selesai: $added aset arah baru, $linked aset depan ditautkan.");

        return self::SUCCESS;
    }
}

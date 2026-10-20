<?php

namespace App\Console\Commands;

use App\Http\Controllers\LibraryController;
use App\Models\AssetCategory;
use App\Models\LibraryAsset;
use App\Models\User;
use Illuminate\Console\Command;

/**
 * Imports the output of tools/sheet_import/slice_sheet.py (a manifest.json + items/*.png) as the given user's own
 * library assets. Idempotent: an item already imported for that user (same sheet key) is skipped.
 */
class ImportLibrarySheet extends Command
{
    protected $signature = 'library:import-sheet {dir : folder with manifest.json and items/} {--user= : user id or email that will own the assets} {--dry-run}';

    protected $description = 'Import sliced asset-sheet parts into a user\'s library';

    public function handle(): int
    {
        $dir = rtrim((string) $this->argument('dir'), '/\\');
        $manifestPath = $dir.'/manifest.json';
        if (! is_file($manifestPath)) {
            $this->error("manifest.json tidak ditemukan di $dir");

            return self::FAILURE;
        }
        $ident = (string) $this->option('user');
        $user = ctype_digit($ident) ? User::find((int) $ident) : User::where('email', $ident)->first();
        if (! $user) {
            $this->error('Gunakan --user=<id|email> yang valid.');

            return self::FAILURE;
        }

        $manifest = json_decode((string) file_get_contents($manifestPath), true);
        $source = (string) ($manifest['source'] ?? 'sheet');
        [$added, $skipped, $failed] = [0, 0, 0];

        foreach ($manifest['items'] ?? [] as $item) {
            $category = AssetCategory::where('slug', $item['category'] ?? '')->first();
            $file = $dir.'/'.($item['file'] ?? '');
            $info = is_file($file) ? @getimagesize($file) : false;
            if (! $category || $info === false || $info['mime'] !== 'image/png') {
                $this->warn('Lewati (data tidak valid): '.($item['key'] ?? '?'));
                $failed++;

                continue;
            }
            $key = $source.':'.$item['key'];
            if (LibraryAsset::where('user_id', $user->id)->where('meta->sheet_key', $key)->exists()) {
                $skipped++;

                continue;
            }
            if (! $this->option('dry-run')) {
                LibraryController::persistAsset($user->id, $category, (string) $item['name'], array_values($item['tags'] ?? []), 'upload', 'approved',
                    (string) file_get_contents($file), 'image/png', 'png', $info[0], $info[1], false, null,
                    ['sheet_key' => $key, 'licence' => 'Dari sheet milik pengguna; pastikan hak pakai Anda']);
            }
            $added++;
        }

        $this->info(($this->option('dry-run') ? '[dry-run] ' : '')."Ditambahkan: $added, sudah ada: $skipped, gagal: $failed");

        return $failed ? self::FAILURE : self::SUCCESS;
    }
}

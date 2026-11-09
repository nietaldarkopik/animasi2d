<?php

namespace App\Console\Commands;

use App\Http\Controllers\LibraryController;
use App\Models\AssetCategory;
use App\Models\LibraryAsset;
use App\Models\User;
use App\Services\Library\AssetValidator;
use App\Services\Library\DesignFamily;
use App\Services\Library\DesignTemplate;
use Illuminate\Console\Command;
use Illuminate\Support\Str;

/**
 * Registers the 2D parts rendered from a VRM avatar (tools/vrm_import/render.mjs) in the library: every part in the standard format,
 * with its direction, a design family of its own (`vrm-<avatar>`), and the licence of the avatar on every asset.
 *
 * A VRM carries its own licence. Cutting an avatar into parts is a MODIFICATION of it (and putting the parts in a library may be a
 * redistribution), so avatars whose licence forbids that are refused unless you state that you have permission (--permission=...).
 */
class ImportVrmParts extends Command
{
    protected $signature = 'library:import-vrm {dir : output folder of tools/vrm_import/render.mjs}
        {--user=1}
        {--permission= : who allowed the conversion (required when the avatar licence forbids modification or redistribution)}
        {--template=vrm-vroid : design template the parts are made for (proportions of the avatar); create it with design:new}
        {--approve : approve parts the template check holds back (the report stays on the asset)}
        {--dry-run : only run the template check and print the result}';

    protected $description = 'Import the 2D parts rendered from a VRM avatar into the library (family vrm-<avatar>)';

    private const NAMES = ['face' => 'Wajah', 'eyes' => 'Mata', 'brows' => 'Alis', 'mouth' => 'Mulut', 'hair_front' => 'Rambut depan', 'hair_back' => 'Rambut belakang', 'torso' => 'Badan atas', 'arm_l' => 'Lengan kiri', 'arm_r' => 'Lengan kanan', 'body' => 'Kaki & leher', 'top' => 'Atasan', 'bottom' => 'Bawahan', 'shoes' => 'Sepatu'];

    private const VIEWS = ['front' => 'depan', 'right' => 'kanan', 'left' => 'kiri', 'back' => 'belakang'];

    public function handle(AssetValidator $validator): int
    {
        $dir = rtrim((string) $this->argument('dir'), '/\\');
        $manifest = json_decode((string) @file_get_contents($dir.'/manifest.json'), true);
        if (! is_array($manifest) || empty($manifest['items'])) {
            $this->error('manifest.json tidak ada: jalankan tools/vrm_import/render.mjs dulu.');

            return self::FAILURE;
        }
        $avatar = $manifest['avatar'] ?? [];
        $name = (string) ($avatar['name'] ?? pathinfo($manifest['source'] ?? 'avatar', PATHINFO_FILENAME));
        $forbidden = ($avatar['modification'] ?? 'prohibited') === 'prohibited' || ($avatar['allowRedistribution'] ?? false) === false;
        if ($forbidden && ! $this->option('permission')) {
            $this->error("Lisensi avatar \"$name\" melarang modifikasi dan/atau redistribusi (modification={$avatar['modification']}, redistribusi=".(($avatar['allowRedistribution'] ?? false) ? 'ya' : 'tidak').').');
            $this->line('Memotong avatar menjadi bagian adalah modifikasi. Jalankan lagi dengan --permission="siapa yang mengizinkan" bila Anda memang berhak.');

            return self::FAILURE;
        }
        $user = User::find((int) $this->option('user'));
        if (! $user) {
            $this->error('User tidak ditemukan.');

            return self::FAILURE;
        }
        $tpl = (string) $this->option('template');
        if (! DesignTemplate::exists($tpl)) {
            $this->error("Template $tpl belum ada: php artisan design:new $tpl --from=anime-v1 (lalu design:measure $tpl setelah impor).");

            return self::FAILURE;
        }
        $template = DesignTemplate::load($tpl);
        $family = 'vrm-'.Str::slug($name);
        $license = [
            'avatar' => $name, 'authors' => $avatar['authors'] ?? [], 'license_url' => $avatar['licenseUrl'] ?? null,
            'modification' => $avatar['modification'] ?? null, 'redistribution' => $avatar['allowRedistribution'] ?? null,
            'commercial' => $avatar['commercialUsage'] ?? null, 'credit' => $avatar['creditNotation'] ?? null, 'permission' => $this->option('permission'),
        ];
        $cats = AssetCategory::pluck('id', 'slug');
        $added = $held = $skipped = 0;

        foreach ($manifest['items'] as $it) {
            $file = $dir.'/'.$it['file'];
            if (! is_file($file) || ! isset($cats[$it['slot']])) {
                $this->warn("dilewati: {$it['file']}");

                continue;
            }
            $label = self::NAMES[$it['slot']].(! empty($it['label']) ? " ({$it['label']})" : '').($it['view'] !== 'front' ? ' ('.self::VIEWS[$it['view']].')' : '');
            $title = "VRM $name – $label";
            $png = (string) file_get_contents($file);
            $report = $validator->validate($png, 'image/png', 800, 1600, $it['slot'], $it['view'], $template, null, hash('sha256', $png), $family);
            if ($this->option('dry-run')) {
                $this->line(sprintf('%s %-44s %s', $report['ok'] ? '✓' : '✗', $title, $report['ok'] ? '' : $report['errors'][0]['message']));

                continue;
            }
            $set = "vrm:$family:{$it['slot']}".(! empty($it['label']) ? ':'.Str::slug($it['label']) : ''); // the same part for every direction: the Builder turns the whole character with it
            // (a pair of shoes was turned into one mirrored shoe by library:single-shoes: that counts as already imported)
            $have = LibraryAsset::where('user_id', $user->id)->whereIn('name', [$title, $title.' (satu, dicerminkan)'])->whereNull('archived_at')->first();
            if ($have) {
                if (empty($have->meta['set'])) {
                    $have->update(['meta' => ($have->meta ?? []) + ['set' => $set]]);
                }
                $skipped++;

                continue;
            }
            $asset = LibraryController::persistAsset($user->id, AssetCategory::find($cats[$it['slot']]), $title, ['vrm', Str::slug($name)], 'upload', 'approved', $png, 'image/png', 'png', 800, 1600, false, null,
                ['view' => $it['view'], 'family' => $family, 'template' => $tpl, 'set' => $set, 'vrm' => $license] + (! empty($it['label']) ? ['expression' => $it['label']] : []));
            if ($asset->status === 'pending' && $this->option('approve')) {
                $asset->update(['status' => 'approved']);
            } elseif ($asset->status === 'pending') {
                $held++;
            }
            $added++;
        }
        if (! $this->option('dry-run')) {
            $this->info("Selesai: $added bagian ditambahkan (keluarga $family), $held ditahan validator, $skipped sudah ada. Lisensi avatar tersimpan di tiap aset.");
        }

        return self::SUCCESS;
    }
}

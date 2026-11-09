<?php

namespace App\Console\Commands;

use App\Models\AssetCategory;
use App\Services\Library\RasterAssetGenerator;
use Illuminate\Console\Command;

/** Writes docs/PROMPT_BAGIAN_ARAH.md: the exact master-style prompts for the head parts that still need a right/left/back drawing. */
class WritePartPrompts extends Command
{
    protected $signature = 'library:prompts';

    protected $description = 'Write ready-to-paste image prompts (master style) for the right/left/back head parts';

    /** slot => [views that need art, example variation] (eyes/brows/mouth are not visible from behind) */
    private const NEEDED = [
        'face' => [['right', 'left', 'back'], 'bare head shape with neck and one ear, no hair, no eyes, no brows, no mouth, skin tone #f1c7a0'],
        'hair_front' => [['right', 'left', 'back'], 'short black neat side-parted hair, the front/top hair layer only'],
        'hair_back' => [['right', 'left', 'back'], 'short black hair, the part behind the head and nape only'],
        'eyes' => [['right', 'left'], 'one visible anime eye seen in profile, dark brown iris, no brow'],
        'brows' => [['right', 'left'], 'one visible eyebrow seen in profile'],
        'mouth' => [['right', 'left'], 'closed neutral mouth seen in profile, just the lip line'],
    ];

    public function handle(): int
    {
        $gen = new RasterAssetGenerator;
        $md = "# Prompt bagian kepala arah kanan / kiri / belakang\n\n"
            ."Dibuat otomatis oleh `php artisan library:prompts` dari `RasterAssetGenerator::prompt()` (master art style + aturan slot).\n"
            ."Pakai di generator gambar Anda (hasil: PNG transparan), lalu unggah di **Library** dengan kategori yang sama dan menu **Menghadap** yang sesuai.\n"
            ."Ukuran bebas: otomatis dipas ke format standar slot. Ganti bagian `[EXTRA REQUIREMENTS]` untuk gaya rambut/warna lain, dan `[CHARACTER]` untuk jenis kelamin/usia.\n"
            ."Agar bisa ditukar otomatis saat arah karakter diganti, nama aset sebaiknya sama dengan versi depannya.\n";
        foreach (self::NEEDED as $slot => [$views, $variation]) {
            $cat = AssetCategory::where('slug', $slot)->firstOrFail();
            foreach ($views as $view) {
                $md .= "\n## {$cat->name} — {$view}\n\n```\n".$gen->prompt($cat, $variation, $view, 'male, teenager, slim')."\n```\n";
            }
        }
        file_put_contents(base_path('../docs/PROMPT_BAGIAN_ARAH.md'), $md);
        $this->info('docs/PROMPT_BAGIAN_ARAH.md ditulis ('.substr_count($md, "\n## ").' prompt).');

        return self::SUCCESS;
    }
}

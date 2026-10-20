<?php

namespace App\Services\Library;

use App\Models\AssetCategory;
use App\Models\LibraryAsset;
use App\Services\AiClient;
use App\Support\SvgSanitizer;
use Illuminate\Support\Facades\Storage;
use RuntimeException;

/**
 * Provider adapter for AI asset creation. This implementation asks the configured chat model to WRITE an SVG in the
 * library's fixed coordinate system (so every generated part lines up with the seeded ones), then sanitises it.
 * A raster provider (image-generation model) can implement the same generate() contract later.
 */
class AiAssetGenerator
{
    public const CHARACTER_VIEWBOX = '0 0 400 800';

    public static function configured(): bool
    {
        return AiClient::configured();
    }

    /** Anatomy of the shared character canvas, given to the model so new parts fit the existing ones. */
    private const GEOMETRY = <<<'TXT'
Kanvas karakter 400x800 (seluruh badan, pusat horizontal x=200). Koordinat acuan:
- Kepala: elips wajah pusat (200,190) rx=80 ry=92 (atas y=98, dagu y=282). Telinga di x=120 dan x=280, y~200.
- Mata y~195 (kiri x~165, kanan x~235). Alis y~165. Mulut y~245. Hidung y~222.
- Leher x 180-220, y 270-315. Bahu y~330, lebar x 105-295.
- Badan (dada ke pinggang): y 320-560, lebar dada x 110-290, pinggang x 120-280.
- Lengan menggantung: kiri x 85-118, kanan x 282-315, y 330-560; tangan y 560-615.
- Pinggul y=560. Kaki y 560-745 (kiri x 140-198, kanan x 202-260). Sepatu y 745-785.
TXT;

    /** Slot-specific hints (what the part covers and where). */
    private const HINTS = [
        'hair_back' => 'rambut bagian belakang kepala/tergerai di belakang bahu; digambar DI BELAKANG tubuh',
        'hair_front' => 'rambut bagian depan: poni dan sisi kepala menutupi bagian atas wajah (jangan menutupi mata/mulut)',
        'hijab' => 'kerudung menutupi kepala dan leher dengan lubang wajah oval terbuka (gunakan path fill-rule="evenodd")',
        'top' => 'atasan (baju) dari bahu sampai pinggang, termasuk lengan baju',
        'bottom' => 'bawahan (celana/rok) dari pinggang y=545 ke bawah',
        'shoes' => 'sepasang sepatu',
        'face' => 'bentuk wajah + leher + telinga (warna kulit, tanpa mata/mulut)',
        'eyes' => 'sepasang mata saja',
        'brows' => 'sepasang alis saja',
        'mouth' => 'mulut saja',
        'glasses' => 'kacamata di sekitar mata',
        'hat' => 'topi di atas kepala',
        'headphone' => 'headphone melingkar kepala dan menutupi telinga',
        'bag' => 'tas ransel (tali bahu terlihat di depan dada; badan tas di belakang)',
        'accessory' => 'aksesori kecil (mis. dasi/name tag) pada badan',
        'body' => 'tubuh warna kulit (leher, lengan, tangan, kaki) tanpa pakaian',
        'torso' => 'badan atas (leher, bahu sampai pinggang) dengan lengan pendek (stub)',
        'arm_l' => 'satu lengan (kiri di layar) dari bahu x~106,y~345 sampai ujung jari',
        'arm_r' => 'satu lengan (kanan di layar) dari bahu x~294,y~345 sampai ujung jari',
    ];

    /** @return array{svg: string, width: int, height: int, tintable: bool, model: string} */
    public function generate(AssetCategory $category, string $prompt): array
    {
        $isBg = $category->kind === 'background';
        $example = $this->example($category);
        $system = $isBg ? $this->backgroundSystem() : $this->partSystem($category, $example);
        $messages = [['role' => 'system', 'content' => $system], ['role' => 'user', 'content' => 'Permintaan: '.$prompt]];

        $lastError = null;
        for ($i = 0; $i < 2; $i++) { // one repair attempt
            $reply = (new AiClient)->chat($messages, 0.5);
            try {
                $svg = $this->extractSvg($reply);
                $clean = SvgSanitizer::clean($svg);
                $expect = $isBg ? '1280x720' : '400x800';
                if ($clean['width'].'x'.$clean['height'] !== $expect) {
                    throw new RuntimeException("viewBox harus 0 0 ".str_replace('x', ' ', $expect).'.');
                }

                return $clean + ['model' => (string) config('services.ai.model')];
            } catch (RuntimeException $e) {
                $lastError = $e->getMessage();
                $messages[] = ['role' => 'assistant', 'content' => mb_substr($reply, 0, 6000)];
                $messages[] = ['role' => 'user', 'content' => "SVG ditolak: $lastError Balas ULANG hanya dengan satu elemen <svg> yang valid."];
            }
        }

        throw new RuntimeException('Model tidak menghasilkan SVG yang valid: '.$lastError);
    }

    private function partSystem(AssetCategory $c, ?string $example): string
    {
        $hint = self::HINTS[$c->slug] ?? 'bagian karakter';
        $tints = implode(', ', SvgSanitizer::TINTS);

        return "Kamu ilustrator kartun 2D untuk film anak SMK Informatika (gaya: karakter pelajar remaja Indonesia, anime-ish bersih, garis tepi tipis gelap, warna datar lembut dengan sedikit bayangan).\n"
            ."Tugas: buat SATU aset SVG untuk kategori \"{$c->name}\": {$hint}.\n\n".self::GEOMETRY."\n\n"
            ."ATURAN KERAS:\n- Balas HANYA elemen <svg> (tanpa markdown/penjelasan).\n- <svg viewBox=\"0 0 400 800\"> dengan koordinat di atas; HANYA gambar bagian yang diminta, latar transparan.\n"
            ."- Elemen yang boleh: g, path, rect, circle, ellipse, line, polyline, polygon, linearGradient, radialGradient, stop, clipPath. DILARANG: script, style, image, text, foreignObject, href, atribut on*.\n"
            ."- Garis tepi: stroke=\"#26262e\" stroke-width=\"3\" stroke-linejoin=\"round\" stroke-linecap=\"round\".\n"
            ."- Area yang boleh diganti warnanya diberi atribut data-tint (nilai: {$tints}) dan fill default yang bagus. Contoh: rambut data-tint=\"hair\", kulit data-tint=\"skin\", baju data-tint=\"top\".\n"
            .($example ? "\nContoh aset kategori sama (ikuti gaya & koordinatnya):\n".$example : '');
    }

    private function backgroundSystem(): string
    {
        return "Kamu ilustrator latar kartun 2D untuk film anak SMK Informatika (gaya: bersih, warna lembut, tanpa orang).\n"
            ."Buat SATU latar lokasi sebagai SVG: <svg viewBox=\"0 0 1280 720\">, memenuhi seluruh kanvas (langit/dinding/lantai), perspektif datar sederhana, area lantai di bawah y=520 agar karakter berdiri di atasnya.\n"
            ."Balas HANYA elemen <svg>. Elemen boleh: g, path, rect, circle, ellipse, line, polyline, polygon, linearGradient, radialGradient, stop, clipPath. DILARANG: script, style, image, text, foreignObject, href, atribut on*. Garis tepi tipis stroke=\"#26262e\" stroke-width=\"2\".";
    }

    private function example(AssetCategory $c): ?string
    {
        $a = LibraryAsset::where('category_id', $c->id)->whereNull('user_id')->where('mime', 'image/svg+xml')->orderBy('id')->first();
        if (! $a || ! Storage::disk($a->disk)->exists($a->path)) {
            return null;
        }
        $svg = Storage::disk($a->disk)->get($a->path);

        return strlen($svg) > 5000 ? null : $svg; // keep the prompt small
    }

    private function extractSvg(string $text): string
    {
        $text = preg_replace('/^```(?:svg|xml)?\s*|\s*```$/im', '', trim($text));
        $s = stripos($text, '<svg');
        $e = strripos($text, '</svg>');
        if ($s === false || $e === false || $e <= $s) {
            throw new RuntimeException('tidak ada elemen <svg> pada jawaban.');
        }

        return substr($text, $s, $e - $s + 6);
    }
}

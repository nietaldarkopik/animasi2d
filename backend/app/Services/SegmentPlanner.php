<?php

namespace App\Services;

use App\Models\Asset;
use Illuminate\Support\Facades\Storage;
use RuntimeException;

/**
 * AI-assisted part separation: a vision model proposes body parts (box, parent, joint) for a character image.
 * The proposal is validated and clamped here and then REVIEWED and corrected by the user before anything is cut.
 */
class SegmentPlanner
{
    private const MAX_PARTS = 16;

    private const SEND_PX = 640; // base64 of larger JPEGs can exceed the gateway token limit (65536)

    /** @return array{asset: array, parts: list<array>, notes: string, warnings: list<string>, model: string} */
    public function plan(Asset $asset): array
    {
        $ai = new AiClient;
        $messages = [
            ['role' => 'system', 'content' => $this->systemPrompt()],
            ['role' => 'user', 'content' => [
                ['type' => 'text', 'text' => 'Pisahkan gambar karakter ini menjadi bagian-bagian untuk rig cutout. Balas hanya JSON.'],
                ['type' => 'image_url', 'image_url' => ['url' => $this->dataUrl($asset)]],
            ]],
        ];

        $lastError = null;
        for ($attempt = 0; $attempt < 2; $attempt++) {
            $content = $ai->chat($messages, 0.2);
            try {
                return $this->sanitize(AiClient::extractJson($content), $asset) + ['model' => config('services.ai.model')];
            } catch (\InvalidArgumentException $e) {
                $lastError = $e->getMessage();
                $messages[] = ['role' => 'assistant', 'content' => $content];
                $messages[] = ['role' => 'user', 'content' => 'Respons tidak valid ('.$lastError.'). Balas ULANG hanya dengan satu objek JSON sesuai skema.'];
            }
        }

        throw new RuntimeException('Model tidak mengembalikan pemisahan bagian yang valid: '.$lastError);
    }

    private function systemPrompt(): string
    {
        $max = self::MAX_PARTS;

        return <<<PROMPT
Kamu membantu menyiapkan rig animasi 2D "cutout" dari sebuah gambar karakter kartun/sketsa.
Identifikasi bagian tubuh yang bisa digerakkan sendiri (mis. kepala, badan, lengan atas, lengan bawah/tangan, paha, betis/kaki, ekor, aksesori).
Balas HANYA dengan satu objek JSON (tanpa teks lain, tanpa code fence):
{"notes":"<satu kalimat>","parts":[{"name":"<nama singkat unik>","box":{"x":<0-1000>,"y":<0-1000>,"w":<0-1000>,"h":<0-1000>},"parent":"<nama bagian induk atau null>","joint":{"x":<0-1000>,"y":<0-1000>}}]}
Aturan:
- Semua koordinat dinormalisasi 0..1000 terhadap lebar (x,w) dan tinggi (y,h) gambar; x,y adalah pojok KIRI-ATAS kotak.
- box harus melingkupi bagian itu saja, serapat mungkin (boleh sedikit tumpang tindih di sambungan).
- joint = titik sendi tempat bagian itu menempel/berputar terhadap induknya (mis. bahu untuk lengan atas, pinggul untuk paha). Untuk bagian akar (badan) joint = titik pusat rotasi, mis. pinggang.
- Tepat satu akar (parent null), biasanya badan/torso. Bagian lain menunjuk induknya lewat nama. Rantai: badan -> kepala; badan -> lengan atas -> lengan bawah; badan -> paha -> betis.
- Urutkan dari paling belakang ke paling depan. Nama kiri/kanan menurut sudut pandang gambar ("kiri gambar").
- 3 sampai {$max} bagian. Jangan mengarang bagian yang tidak terlihat (mis. tangan/topi/ekor yang tidak ada di gambar).
PROMPT;
    }

    /** Downscaled (≤640px), flattened-on-white JPEG as a data URL: smaller upload, no alpha surprises. */
    private function dataUrl(Asset $asset): string
    {
        $src = $asset;
        $temp = null;
        if (max($asset->width, $asset->height) > self::SEND_PX) {
            try {
                ['asset' => $temp] = app(ImageWorker::class)->run($asset, [['op' => 'resize', 'width' => (int) round($asset->width * self::SEND_PX / max($asset->width, $asset->height))]], 'tmp-ai-preview');
            } catch (ImageWorkerException $e) {
                throw new RuntimeException('Gagal menyiapkan gambar untuk AI: '.$e->getMessage());
            }
            $src = $temp;
        }

        try {
            $bin = Storage::disk($src->disk)->get($src->path);
            $im = @imagecreatefromstring($bin);
            if (! $im) {
                throw new RuntimeException('Gambar tidak dapat dibaca.');
            }
            $w = imagesx($im);
            $h = imagesy($im);
            $flat = imagecreatetruecolor($w, $h);
            imagefill($flat, 0, 0, imagecolorallocate($flat, 255, 255, 255));
            imagealphablending($im, true);
            imagecopy($flat, $im, 0, 0, 0, 0, $w, $h);
            ob_start();
            imagejpeg($flat, null, 72);
            $jpeg = ob_get_clean();

            return 'data:image/jpeg;base64,'.base64_encode($jpeg);
        } finally {
            if ($temp) {
                Storage::disk($temp->disk)->delete($temp->path);
                $temp->delete();
            }
        }
    }

    private function sanitize(array $data, Asset $asset): array
    {
        $raw = $data['parts'] ?? null;
        if (! is_array($raw) || $raw === []) {
            throw new \InvalidArgumentException('field "parts" kosong atau hilang');
        }
        $W = $asset->width;
        $H = $asset->height;
        $clamp = fn ($v, $lo, $hi) => max($lo, min($hi, $v));
        $parts = [];
        $warnings = [];
        $names = [];

        foreach (array_slice($raw, 0, self::MAX_PARTS) as $i => $p) {
            $b = $p['box'] ?? null;
            if (! is_array($b) || ! isset($b['x'], $b['y'], $b['w'], $b['h']) || ! is_numeric($b['x']) || ! is_numeric($b['y']) || ! is_numeric($b['w']) || ! is_numeric($b['h'])) {
                $warnings[] = 'bagian #'.($i + 1).' dibuang: kotak tidak valid';

                continue;
            }
            $x0 = $clamp((float) $b['x'], 0, 1000);
            $y0 = $clamp((float) $b['y'], 0, 1000);
            $x1 = $clamp((float) $b['x'] + (float) $b['w'], 0, 1000);
            $y1 = $clamp((float) $b['y'] + (float) $b['h'], 0, 1000);
            $px = (int) round($x0 / 1000 * $W);
            $py = (int) round($y0 / 1000 * $H);
            $pw = (int) round(($x1 - $x0) / 1000 * $W);
            $ph = (int) round(($y1 - $y0) / 1000 * $H);
            if ($pw < max(4, $W * 0.01) || $ph < max(4, $H * 0.01)) {
                $warnings[] = 'bagian "'.($p['name'] ?? '?').'" dibuang: terlalu kecil';

                continue;
            }
            $name = trim(is_string($p['name'] ?? null) ? $p['name'] : 'Bagian '.($i + 1));
            $name = mb_substr($name === '' ? 'Bagian '.($i + 1) : $name, 0, 40);
            $base = $name;
            for ($n = 2; isset($names[mb_strtolower($name)]); $n++) {
                $name = "$base $n";
            }
            $names[mb_strtolower($name)] = true;

            $joint = null;
            if (isset($p['joint']['x'], $p['joint']['y']) && is_numeric($p['joint']['x']) && is_numeric($p['joint']['y'])) {
                $joint = [
                    'x' => (int) round($clamp((float) $p['joint']['x'], 0, 1000) / 1000 * $W),
                    'y' => (int) round($clamp((float) $p['joint']['y'], 0, 1000) / 1000 * $H),
                ];
            }
            $parts[] = [
                'name' => $name,
                'parent' => is_string($p['parent'] ?? null) ? trim($p['parent']) : null,
                'box' => ['x' => $px, 'y' => $py, 'w' => min($pw, $W - $px), 'h' => min($ph, $H - $py)],
                'joint' => $joint,
            ];
        }
        if (count($parts) < 1) {
            throw new \InvalidArgumentException('tidak ada bagian yang valid ('.implode('; ', $warnings).')');
        }

        // resolve parent names (case-insensitive); unknown/self parents become roots; break cycles
        $byName = [];
        foreach ($parts as $k => $p) {
            $byName[mb_strtolower($p['name'])] = $k;
        }
        foreach ($parts as $k => &$p) {
            $pn = $p['parent'] !== null ? mb_strtolower($p['parent']) : null;
            if ($pn !== null && (! isset($byName[$pn]) || $byName[$pn] === $k)) {
                if ($p['parent'] !== '' && strtolower($p['parent']) !== 'null') {
                    $warnings[] = '"'.$p['name'].'": induk "'.$p['parent'].'" tidak ditemukan, dijadikan akar';
                }
                $pn = null;
            }
            $p['parent'] = $pn === null ? null : $parts[$byName[$pn]]['name'] ?? null;
        }
        unset($p);
        foreach (array_keys($parts) as $k) {
            $seen = [$k => true];
            for ($cur = $parts[$k]['parent'] !== null ? $byName[mb_strtolower($parts[$k]['parent'])] : null; $cur !== null;) {
                if (isset($seen[$cur])) {
                    $warnings[] = '"'.$parts[$k]['name'].'": induk melingkar, dijadikan akar';
                    $parts[$k]['parent'] = null;
                    break;
                }
                $seen[$cur] = true;
                $cur = $parts[$cur]['parent'] !== null ? $byName[mb_strtolower($parts[$cur]['parent'])] : null;
            }
        }

        return [
            'asset' => ['id' => $asset->id, 'width' => $W, 'height' => $H],
            'parts' => array_values($parts),
            'notes' => mb_substr(is_string($data['notes'] ?? null) ? $data['notes'] : '', 0, 300),
            'warnings' => $warnings,
        ];
    }
}
<?php

namespace App\Services\Library;

use App\Models\AssetCategory;
use App\Services\Enhancement\RemoteImageProvider;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use RuntimeException;

/**
 * Raster (image-model) asset generation. A FIXED art-style block + modular-asset rules are wrapped around the user's
 * variation text so every generated part keeps the same look as the uploaded anime assets. The result is a transparent PNG.
 * Uses an OpenAI-compatible POST {AI_BASE_URL}/images/generations; only the prompt text (no user images) leaves the server.
 */
class RasterAssetGenerator
{
    public const STYLE = <<<'TXT'
FIXED ART STYLE - MUST REMAIN IDENTICAL FOR EVERY GENERATION:
Polished 2D anime-inspired cartoon illustration, matching a consistent school-life webcomic aesthetic. Bold, clean, dark brown-black outlines with consistent line thickness. Smooth, carefully controlled linework. Rich colors, subtle warm highlights, cel-shaded shadows, soft glossy reflections, and detailed but clean shapes. Attractive, natural shapes with professional game-asset quality. Soft lighting, refined contours, and consistent visual proportions. Front-facing orthographic view, no perspective distortion.
TXT;

    /** English description of each component, used as {COMPONENT} in the template. */
    private const COMPONENT = [
        'hair_back' => 'back hair (the part behind the head and shoulders)',
        'hair_front' => 'front hair (bangs and side locks framing the face)',
        'hijab' => 'hijab / headscarf with an open oval face window',
        'top' => 'upper garment (shirt/jacket) with sleeves',
        'bottom' => 'lower garment (trousers/skirt)',
        'shoes' => 'pair of shoes',
        'face' => 'face shape with neck and ears, without eyes, brows or mouth',
        'eyes' => 'pair of eyes only',
        'brows' => 'pair of eyebrows only',
        'mouth' => 'mouth only',
        'glasses' => 'eyeglasses',
        'hat' => 'hat',
        'headphone' => 'headphones',
        'bag' => 'backpack',
        'accessory' => 'small accessory (tie, name tag, etc.)',
        'body' => 'bare skin body (neck, arms, hands, legs) without clothes',
        'torso' => 'bare upper body with short arm stubs',
        'arm_l' => 'single arm (viewer left)',
        'arm_r' => 'single arm (viewer right)',
    ];

    public static function available(): bool
    {
        return RemoteImageProvider::available();
    }

    public function prompt(AssetCategory $category, string $variation): string
    {
        $part = self::COMPONENT[$category->slug] ?? mb_strtolower($category->name);
        $isBg = $category->kind === 'background';

        if ($isBg) {
            return self::STYLE."\n\nCreate a 2D cartoon background scene for a school-life animation: {$variation}.\nNo characters, no text, no watermark. Wide 16:9 composition, a clear floor area in the lower third where characters can stand. Same art direction as all previous backgrounds.";
        }

        return "Create a high-quality modular 2D cartoon {$part} asset for a professional character creator application.\n\n".self::STYLE."\n\n"
            ."MODULAR ASSET RULES:\n"
            ."- Generate ONLY the requested {$part} component.\n"
            ."- It must fit the same standardized character template across all variations.\n"
            ."- Any area that belongs to other parts (face interior, eyes, nose, mouth, body) must stay completely transparent.\n"
            ."- Do not generate a complete character, other body parts, clothes (unless requested), or a background.\n"
            ."- Keep a clean, recognizable silhouette suitable for mixing and matching, centered on the canvas.\n"
            ."- Genuine transparent alpha background, not black, white, or checkerboard pixels.\n"
            ."- No text, labels, watermark, extra objects, or decorative elements.\n"
            ."- Keep outline style, shading, highlights, color treatment and rendering quality identical across all assets.\n\n"
            ."VARIATION:\n{$variation}\n\n"
            ."OUTPUT: single isolated asset, high-resolution PNG with transparent alpha channel, full item visible, clean edges, production-ready for a layered 2D cartoon character builder.";
    }

    /** @return array{png: string, width: int, height: int, model: string, prompt: string} */
    public function generate(AssetCategory $category, string $variation): array
    {
        if (! self::available()) {
            throw new RuntimeException('Provider gambar AI belum dikonfigurasi.');
        }
        $isBg = $category->kind === 'background';
        $prompt = $this->prompt($category, $variation);

        try {
            $body = [
                'model' => config('services.ai_image.model'),
                'prompt' => $prompt,
                'n' => 1,
                'size' => $isBg ? '1536x1024' : '1024x1536',
            ];
            if (! $isBg) {
                $body += ['background' => 'transparent', 'output_format' => 'png'];
            }
            $res = Http::withToken((string) config('services.ai.api_key'))
                ->timeout((int) config('services.ai_image.timeout'))
                ->post(rtrim((string) config('services.ai.base_url'), '/').'/images/generations', $body);
        } catch (ConnectionException) {
            throw new RuntimeException('Tidak dapat terhubung ke provider gambar AI.');
        }
        if ($res->failed()) {
            throw new RuntimeException('Provider gambar mengembalikan error: '.mb_substr((string) ($res->json('error.message') ?? 'HTTP '.$res->status()), 0, 300));
        }
        $b64 = $res->json('data.0.b64_json');
        $url = $res->json('data.0.url');
        $bytes = is_string($b64) ? base64_decode($b64, true) : (is_string($url) && str_starts_with($url, 'https://') ? Http::timeout(60)->get($url)->body() : false);
        $img = is_string($bytes) ? @imagecreatefromstring($bytes) : false;
        if ($img === false) {
            throw new RuntimeException('Provider tidak mengembalikan gambar yang valid.');
        }

        if (! $isBg) {
            $img = $this->cutOut($img);
            $img = $this->trim($img);
        }
        imagesavealpha($img, true);
        ob_start();
        imagepng($img);
        $png = (string) ob_get_clean();

        return ['png' => $png, 'width' => imagesx($img), 'height' => imagesy($img), 'model' => (string) config('services.ai_image.model'), 'prompt' => $prompt];
    }

    /** If the provider returned an opaque backdrop, flood-fill it from the borders to transparent. */
    private function cutOut(\GdImage $src): \GdImage
    {
        $w = imagesx($src);
        $h = imagesy($src);
        $img = imagecreatetruecolor($w, $h);
        imagealphablending($img, false);
        imagesavealpha($img, true);
        imagefill($img, 0, 0, imagecolorallocatealpha($img, 0, 0, 0, 127));
        imagecopy($img, $src, 0, 0, 0, 0, $w, $h);

        $corners = [[0, 0], [$w - 1, 0], [0, $h - 1], [$w - 1, $h - 1]];
        $opaque = 0;
        foreach ($corners as [$x, $y]) {
            $opaque += ((imagecolorat($img, $x, $y) >> 24) & 0x7F) < 20 ? 1 : 0;
        }
        if ($opaque < 3) {
            return $img; // already transparent
        }
        [$br, $bg, $bb] = $this->rgb(imagecolorat($img, 0, 0));
        $clear = imagecolorallocatealpha($img, 0, 0, 0, 127);
        $seen = new \SplFixedArray($w * $h);
        $stack = [];
        for ($x = 0; $x < $w; $x++) {
            $stack[] = [$x, 0];
            $stack[] = [$x, $h - 1];
        }
        for ($y = 0; $y < $h; $y++) {
            $stack[] = [0, $y];
            $stack[] = [$w - 1, $y];
        }
        while ($stack) {
            [$x, $y] = array_pop($stack);
            if ($x < 0 || $y < 0 || $x >= $w || $y >= $h || $seen[$y * $w + $x]) {
                continue;
            }
            $seen[$y * $w + $x] = 1;
            [$r, $g, $b] = $this->rgb(imagecolorat($img, $x, $y));
            if (abs($r - $br) + abs($g - $bg) + abs($b - $bb) > 60) {
                continue;
            }
            imagesetpixel($img, $x, $y, $clear);
            array_push($stack, [$x + 1, $y], [$x - 1, $y], [$x, $y + 1], [$x, $y - 1]);
        }

        return $img;
    }

    private function rgb(int $c): array
    {
        return [($c >> 16) & 0xFF, ($c >> 8) & 0xFF, $c & 0xFF];
    }

    /** Crop to the visible pixels (small margin) so the Builder anchors the real artwork. */
    private function trim(\GdImage $img): \GdImage
    {
        $w = imagesx($img);
        $h = imagesy($img);
        $x0 = $w;
        $y0 = $h;
        $x1 = -1;
        $y1 = -1;
        for ($y = 0; $y < $h; $y += 2) {
            for ($x = 0; $x < $w; $x += 2) {
                if (((imagecolorat($img, $x, $y) >> 24) & 0x7F) < 100) {
                    $x0 = min($x0, $x);
                    $y0 = min($y0, $y);
                    $x1 = max($x1, $x);
                    $y1 = max($y1, $y);
                }
            }
        }
        if ($x1 < 0) {
            throw new RuntimeException('Gambar hasil AI kosong (tidak ada piksel terlihat).');
        }
        $m = 4;
        $x0 = max(0, $x0 - $m);
        $y0 = max(0, $y0 - $m);
        $x1 = min($w - 1, $x1 + $m);
        $y1 = min($h - 1, $y1 + $m);
        $out = imagecrop($img, ['x' => $x0, 'y' => $y0, 'width' => $x1 - $x0 + 1, 'height' => $y1 - $y0 + 1]);

        return $out === false ? $img : $out;
    }
}

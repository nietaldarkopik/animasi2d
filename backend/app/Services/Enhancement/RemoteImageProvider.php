<?php

namespace App\Services\Enhancement;

use App\Models\Asset;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use RuntimeException;

/**
 * Optional adapter to an OpenAI-compatible image-editing endpoint (POST {AI_BASE_URL}/images/edits).
 * Disabled unless AI_IMAGE_ENABLED=true and a model + key are set. Written against the public API shape; it has NOT been
 * verified against a live provider in this repository, and different providers may reject parameters.
 */
class RemoteImageProvider
{
    private const PROMPTS = [
        'colorize' => 'Colorize this hand-drawn cartoon character with flat, clean cartoon colors. Keep every line, shape, proportion and facial expression exactly as drawn. Do not add, remove or move anything. Plain white background.',
        'ai_redraw' => 'Redraw this hand-drawn cartoon character as clean digital 2D artwork with crisp outlines. Stay as faithful as possible to the original design, proportions, pose and expression. Plain white background.',
    ];

    public static function available(): bool
    {
        return (bool) config('services.ai_image.enabled') && config('services.ai_image.model') && config('services.ai.api_key');
    }

    /**
     * @return string PNG bytes
     *
     * @throws RuntimeException user-facing message
     */
    public function run(Asset $asset, string $mode): string
    {
        if (! self::available()) {
            throw new RuntimeException('Provider gambar AI belum dikonfigurasi.');
        }
        $src = Storage::disk($asset->disk)->get($asset->path);
        $img = @imagecreatefromstring($src);
        if ($img === false) {
            throw new RuntimeException('Gambar sumber tidak dapat dibaca.');
        }
        // cap what leaves the server (cost + privacy): longest side 1536px, flattened on white, PNG
        $w = imagesx($img);
        $h = imagesy($img);
        $k = min(1, 1536 / max($w, $h));
        $nw = max(1, (int) round($w * $k));
        $nh = max(1, (int) round($h * $k));
        $flat = imagecreatetruecolor($nw, $nh);
        imagefill($flat, 0, 0, imagecolorallocate($flat, 255, 255, 255));
        imagecopyresampled($flat, $img, 0, 0, 0, 0, $nw, $nh, $w, $h);
        ob_start();
        imagepng($flat);
        $png = (string) ob_get_clean();

        try {
            $res = Http::withToken((string) config('services.ai.api_key'))
                ->timeout((int) config('services.ai_image.timeout'))
                ->attach('image', $png, 'image.png')
                ->post(config('services.ai.base_url').'/images/edits', [
                    'model' => config('services.ai_image.model'),
                    'prompt' => self::PROMPTS[$mode],
                    'n' => 1,
                    'response_format' => 'b64_json',
                ]);
        } catch (ConnectionException) {
            throw new RuntimeException('Tidak dapat terhubung ke provider gambar AI.');
        }
        if ($res->status() === 401 || $res->status() === 403) {
            throw new RuntimeException('API key provider gambar ditolak.');
        }
        if ($res->failed()) {
            throw new RuntimeException('Provider gambar mengembalikan error: '.mb_substr((string) ($res->json('error.message') ?? 'HTTP '.$res->status()), 0, 300));
        }

        $b64 = $res->json('data.0.b64_json');
        $url = $res->json('data.0.url');
        $bytes = is_string($b64) ? base64_decode($b64, true) : (is_string($url) && str_starts_with($url, 'https://') ? Http::timeout(60)->get($url)->body() : false);
        if (! is_string($bytes) || @imagecreatefromstring($bytes) === false) {
            throw new RuntimeException('Provider tidak mengembalikan gambar yang valid.');
        }

        return $bytes;
    }
}

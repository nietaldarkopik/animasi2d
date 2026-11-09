<?php

namespace App\Services\Library;

/**
 * The standard format of a character part. Every body part lives on ONE shared canvas (400x800 units, stored at 2x = 800x1600 px)
 * and sits at a fixed place for its slot, so a face, hairstyle or garment can be swapped for another one without resizing or moving.
 *
 * Art that is not drawn on that canvas yet (an upload, an AI result trimmed to its pixels) is CONFORMED here: scaled into the slot's
 * standard frame and placed at its anchor. The anchors/limits mirror SLOT_ANCHORS in frontend/src/builder/spec.ts, so a conformed asset
 * looks exactly like the same asset did when the Builder placed it on the fly.
 */
class SlotTemplate
{
    public const W = 400;

    public const H = 800;

    /** pixels per canvas unit of a stored asset */
    public const PX = 2;

    /** slot => centre and maximum width (canvas units). Keep in sync with SLOT_ANCHORS (frontend/src/builder/spec.ts). */
    public const ANCHORS = [
        'hair_back' => ['cx' => 200, 'cy' => 200, 'maxW' => 320], 'body' => ['cx' => 200, 'cy' => 520, 'maxW' => 260], 'shoes' => ['cx' => 200, 'cy' => 765, 'maxW' => 200],
        'bottom' => ['cx' => 200, 'cy' => 650, 'maxW' => 220], 'top' => ['cx' => 200, 'cy' => 440, 'maxW' => 240], 'bag' => ['cx' => 200, 'cy' => 430, 'maxW' => 260],
        'face' => ['cx' => 200, 'cy' => 190, 'maxW' => 170], 'hair_front' => ['cx' => 200, 'cy' => 150, 'maxW' => 300], 'hijab' => ['cx' => 200, 'cy' => 230, 'maxW' => 260],
        'eyes' => ['cx' => 200, 'cy' => 196, 'maxW' => 160], 'brows' => ['cx' => 200, 'cy' => 165, 'maxW' => 160], 'mouth' => ['cx' => 200, 'cy' => 250, 'maxW' => 70],
        'glasses' => ['cx' => 200, 'cy' => 196, 'maxW' => 190], 'hat' => ['cx' => 200, 'cy' => 95, 'maxW' => 260], 'headphone' => ['cx' => 200, 'cy' => 200, 'maxW' => 300],
        'accessory' => ['cx' => 200, 'cy' => 420, 'maxW' => 60],
        'torso' => ['cx' => 200, 'cy' => 415, 'maxW' => 240], 'arm_l' => ['cx' => 110, 'cy' => 460, 'maxW' => 60], 'arm_r' => ['cx' => 290, 'cy' => 460, 'maxW' => 60],
    ];

    /** the directions a part can face (parts without a view are "front") */
    public const VIEWS = ['front', 'right', 'left', 'back'];

    public static function has(string $slot): bool
    {
        return isset(self::ANCHORS[$slot]);
    }

    /** drawn on the full canvas already (a raster at 1x/2x/3x counts: only the aspect matters) */
    public static function isFullCanvas(int $w, int $h): bool
    {
        return $h > 0 && $w >= self::W && abs($w / $h - self::W / self::H) < 0.005;
    }

    /** where the art lands on the canvas, in canvas units */
    public static function frame(string $slot, int $w, int $h): array
    {
        $a = self::ANCHORS[$slot];
        $k = min($a['maxW'] / max(1, $w), 600 / max(1, $h));

        return ['x' => $a['cx'] - $w * $k / 2, 'y' => $a['cy'] - $h * $k / 2, 'w' => $w * $k, 'h' => $h * $k];
    }

    /**
     * Put art of any size into the standard format of `$slot`.
     *
     * @return array{content: string, mime: string, ext: string, width: int, height: int}|null null = nothing to do (not a part, or already standard)
     */
    public static function conform(string $slot, string $content, string $mime, int $w, int $h): ?array
    {
        if (! self::has($slot) || self::isFullCanvas($w, $h) || $w < 1 || $h < 1) {
            return null;
        }
        $f = self::frame($slot, $w, $h);

        if ($mime === 'image/svg+xml') {
            $svg = self::wrapSvg($content, $f, $w, $h);

            return $svg === null ? null : ['content' => $svg, 'mime' => $mime, 'ext' => 'svg', 'width' => self::W, 'height' => self::H];
        }

        $src = @imagecreatefromstring($content);
        if ($src === false) {
            return null;
        }
        $out = imagecreatetruecolor(self::W * self::PX, self::H * self::PX);
        imagealphablending($out, false);
        imagesavealpha($out, true);
        imagefill($out, 0, 0, imagecolorallocatealpha($out, 0, 0, 0, 127));
        imagealphablending($out, true);
        imagecopyresampled($out, $src, (int) round($f['x'] * self::PX), (int) round($f['y'] * self::PX), 0, 0,
            max(1, (int) round($f['w'] * self::PX)), max(1, (int) round($f['h'] * self::PX)), imagesx($src), imagesy($src));
        imagesavealpha($out, true);
        ob_start();
        imagepng($out);
        $png = (string) ob_get_clean();

        return ['content' => $png, 'mime' => 'image/png', 'ext' => 'png', 'width' => self::W * self::PX, 'height' => self::H * self::PX];
    }

    /** nest the (already sanitised) SVG in a 400x800 one at the slot frame; data-tint regions keep working */
    private static function wrapSvg(string $svg, array $f, int $w, int $h): ?string
    {
        $svg = preg_replace('/^\s*(<\?xml[^>]*\?>\s*)?(<!--.*?-->\s*)*/is', '', $svg);
        if (! preg_match('/<svg\b[^>]*>/i', $svg, $m)) {
            return null;
        }
        $root = $m[0];
        $hasBox = preg_match('/\bviewBox\s*=/i', $root) === 1;
        $inner = preg_replace('/\s(?:x|y|width|height)\s*=\s*("[^"]*"|\'[^\']*\')/i', '', $root);
        $add = sprintf(' x="%s" y="%s" width="%s" height="%s" preserveAspectRatio="none"%s', round($f['x'], 2), round($f['y'], 2), round($f['w'], 2), round($f['h'], 2), $hasBox ? '' : " viewBox=\"0 0 $w $h\"");
        $inner = preg_replace_callback('/<svg\b/i', fn () => '<svg'.$add, $inner, 1);
        $svg = preg_replace_callback('/<svg\b[^>]*>/i', fn () => $inner, $svg, 1);

        return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 800" width="400" height="800">'.$svg.'</svg>';
    }
}

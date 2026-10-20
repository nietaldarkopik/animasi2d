<?php

namespace App\Services\Enhancement;

/**
 * Enhancement modes and the local (Pillow) pipeline each one maps to.
 * Colorize / AI Redraw have NO honest local equivalent (flat auto-colouring or redrawing needs a generative model),
 * so they are only offered when an image provider is configured; the UI shows that status instead of faking them.
 */
class EnhancementPlanner
{
    public const MODES = ['preserve', 'clean_sketch', 'clean_line_art', 'colorize', 'ai_redraw', 'upscale_ai'];

    public const REMOTE_MODES = ['colorize', 'ai_redraw'];

    public static function isRemote(string $mode): bool
    {
        return in_array($mode, self::REMOTE_MODES, true);
    }

    /** Runs through the queue (slow): provider modes and the local AI upscaler. */
    public static function isQueued(string $mode): bool
    {
        return self::isRemote($mode) || $mode === 'upscale_ai';
    }

    public static function describe(): array
    {
        $remote = RemoteImageProvider::available();
        $up = Upscaler::available();

        return [
            ['id' => 'preserve', 'label' => 'Preserve Original', 'engine' => 'local', 'available' => true, 'default' => true,
                'summary' => 'Meratakan bayangan & warna kertas, mengurangi noise. Warna, bentuk, dan goresan tetap asli.'],
            ['id' => 'clean_sketch', 'label' => 'Clean Sketch', 'engine' => 'local', 'available' => true, 'default' => false,
                'summary' => 'Sketsa pensil/tinta jadi garis bersih transparan dengan warna goresan asli.'],
            ['id' => 'clean_line_art', 'label' => 'Clean Line Art', 'engine' => 'local', 'available' => true, 'default' => false,
                'summary' => 'Garis tegas hitam pekat di atas latar transparan.'],
            ['id' => 'colorize', 'label' => 'Colorize', 'engine' => 'ai', 'available' => $remote, 'default' => false,
                'summary' => 'Pewarnaan otomatis oleh model AI. Butuh provider gambar.',
                'unavailable_reason' => $remote ? null : 'Provider gambar AI belum dikonfigurasi (AI_IMAGE_ENABLED, AI_IMAGE_MODEL, AI_API_KEY).'],
            ['id' => 'ai_redraw', 'label' => 'AI Redraw', 'engine' => 'ai', 'available' => $remote, 'default' => false,
                'summary' => 'Menggambar ulang secara digital. BISA mengubah bentuk karakter; opsional.',
                'unavailable_reason' => $remote ? null : 'Provider gambar AI belum dikonfigurasi (AI_IMAGE_ENABLED, AI_IMAGE_MODEL, AI_API_KEY).'],
            ['id' => 'upscale_ai', 'label' => 'Tingkatkan resolusi (AI lokal)', 'engine' => 'local-ai', 'available' => $up, 'default' => false,
                'summary' => 'Super-resolusi Real-ESRGAN (model anime/kartun) yang berjalan di komputer ini; tidak mengirim gambar keluar. Atur faktor di slider “Perbesar resolusi” (maks. gambar sumber 1100 px).',
                'unavailable_reason' => Upscaler::unavailableReason()],
        ];
    }

    /**
     * @param  array{perspective?: list<array{0: float, 1: float}>, rotate?: float, deskew?: bool, crop?: array, strength?: float, upscale?: float, remove_bg?: bool, tolerance?: float}  $o
     * @return list<array> worker ops, in execution order
     */
    public static function localOps(string $mode, array $o): array
    {
        $ops = [];
        if (! empty($o['perspective'])) { // first: every other step assumes an upright sheet
            $ops[] = ['op' => 'perspective', 'points' => array_map(fn ($p) => [(float) $p[0], (float) $p[1]], $o['perspective'])];
        }
        if (! empty($o['rotate'])) {
            $ops[] = ['op' => 'rotate', 'angle' => (float) $o['rotate']];
        }
        if (! empty($o['deskew'])) {
            $ops[] = ['op' => 'deskew'];
        }
        if (! empty($o['crop'])) {
            $ops[] = ['op' => 'crop'] + array_map('intval', $o['crop']);
        }
        $ops[] = ['op' => 'flatten'];
        $ops[] = ['op' => 'denoise'];

        $strength = (float) ($o['strength'] ?? 50);
        match ($mode) {
            'clean_sketch' => $ops[] = ['op' => 'sketch', 'strength' => $strength],
            'clean_line_art' => $ops[] = ['op' => 'lineart', 'strength' => $strength],
            default => null, // preserve: keep colours and strokes as they are
        };

        if (! empty($o['remove_bg']) && $mode === 'preserve') { // the sketch/line modes are already transparent
            $ops[] = ['op' => 'remove_bg', 'tolerance' => (float) ($o['tolerance'] ?? 30)];
        }
        if (($o['upscale'] ?? 1) > 1) {
            $ops[] = ['op' => 'upscale', 'factor' => (float) $o['upscale']];
        }

        return $ops;
    }
}

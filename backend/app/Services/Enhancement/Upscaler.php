<?php

namespace App\Services\Enhancement;

/** Local AI super-resolution (Real-ESRGAN ncnn/Vulkan). Runs on this machine; images are never sent anywhere. */
class Upscaler
{
    public static function available(): bool
    {
        $bin = (string) config('services.upscaler.bin');

        return $bin !== '' && is_file($bin);
    }

    public static function unavailableReason(): ?string
    {
        return self::available() ? null : 'Upscaler AI lokal belum terpasang. Letakkan Real-ESRGAN ncnn-vulkan di tools/realesrgan (atau isi REALESRGAN_BIN di backend/.env).';
    }

    /** @return list<array> worker ops */
    public static function ops(float $factor): array
    {
        return [['op' => 'upscale_ai', 'factor' => $factor, 'bin' => (string) config('services.upscaler.bin'), 'model' => (string) config('services.upscaler.model')]];
    }
}

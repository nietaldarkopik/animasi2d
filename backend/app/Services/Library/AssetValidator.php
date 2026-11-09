<?php

namespace App\Services\Library;

/**
 * Checks a body-part image against the design template before it may join the approved library.
 * Errors are things that make the part unusable as it is (wrong canvas, no transparency, art outside the part's region, empty);
 * warnings are suspicious but allowed (unusual size, a duplicate). Nothing here changes the asset: the report tells the author
 * what is wrong and the Library offers to re-generate, replace or approve anyway.
 */
class AssetValidator
{
    /**
     * @return array{ok: bool, template: string, errors: list<array{code: string, message: string}>, warnings: list<array{code: string, message: string}>, metrics: array}
     */
    public function validate(string $content, string $mime, int $width, int $height, string $slot, string $view = 'front', ?DesignTemplate $tpl = null, ?int $ignoreId = null, ?string $hash = null, ?string $family = null): array
    {
        $tpl ??= DesignTemplate::load();
        $errors = [];
        $warnings = [];
        $metrics = [];
        $err = function (string $code, string $msg) use (&$errors) { $errors[] = ['code' => $code, 'message' => $msg]; };
        $warn = function (string $code, string $msg) use (&$warnings) { $warnings[] = ['code' => $code, 'message' => $msg]; };

        if (! $tpl->hasSlot($slot)) {
            $err('slot', "Kategori \"$slot\" bukan bagian karakter pada template {$tpl->id()}.");

            return $this->report($tpl, $errors, $warnings, $metrics);
        }
        if (! in_array($view, $tpl->data['views'], true)) {
            $err('view', "Arah \"$view\" tidak dikenal (depan, kanan, kiri, belakang).");
        }

        // canvas: every part lives on the shared canvas (raster 2x, SVG 1x)
        if (! SlotTemplate::isFullCanvas($width, $height)) {
            $err('canvas', "Ukuran {$width}x{$height} bukan kanvas standar {$tpl->canvasWidth()}x{$tpl->canvasHeight()} (atau kelipatannya).");
        }

        if ($mime === 'image/svg+xml') {
            $warn('vector', 'SVG: ukuran dan posisi seni tidak diukur otomatis, periksa secara visual.');
        } elseif (SlotTemplate::isFullCanvas($width, $height)) {
            $this->checkRaster($content, $width, $height, $slot, $view, $tpl, $err, $warn, $metrics, $family);
        }

        if ($hash !== null) {
            $dup = \App\Models\LibraryAsset::whereNull('archived_at')->where('hash', $hash)->when($ignoreId, fn ($q) => $q->where('id', '!=', $ignoreId))->first();
            if ($dup) {
                $warn('duplicate', "Isi gambar sama persis dengan aset #{$dup->id} \"{$dup->name}\".");
            }
        }

        return $this->report($tpl, $errors, $warnings, $metrics);
    }

    private function checkRaster(string $content, int $width, int $height, string $slot, string $view, DesignTemplate $tpl, callable $err, callable $warn, array &$metrics, ?string $family = null): void
    {
        $im = @imagecreatefromstring($content);
        if ($im === false) {
            $err('image', 'File gambar tidak bisa dibaca.');

            return;
        }
        $w = imagesx($im);
        $h = imagesy($im);
        $k = $w / $tpl->canvasWidth(); // pixels per unit
        [$x0, $y0, $x1, $y1] = [$w, $h, -1, -1];
        $visible = 0;
        $transparent = 0;
        $total = 0;
        for ($y = 0; $y < $h; $y += 2) {
            for ($x = 0; $x < $w; $x += 2) {
                $total++;
                $a = (imagecolorat($im, $x, $y) >> 24) & 0x7F; // 0 opaque .. 127 transparent
                if ($a < 100) {
                    $visible++;
                    [$x0, $y0, $x1, $y1] = [min($x0, $x), min($y0, $y), max($x1, $x), max($y1, $y)];
                }
                if ($a > 120) {
                    $transparent++;
                }
            }
        }
        if ($visible === 0) {
            $err('empty', 'Gambar kosong: tidak ada piksel yang terlihat.');

            return;
        }
        if ($transparent === 0) {
            $err('alpha', 'Tidak ada area transparan: latar belakang harus transparan (alpha), bukan putih/hitam.');
        }
        $box = [(int) round($x0 / $k), (int) round($y0 / $k), (int) round(($x1 + 1) / $k), (int) round(($y1 + 1) / $k)];
        $metrics = ['bbox' => $box, 'width' => $box[2] - $box[0], 'height' => $box[3] - $box[1], 'center_x' => ($box[0] + $box[2]) / 2];

        $spec = $tpl->view($slot, $view);
        if (! $spec) {
            $warn('unmeasured', "Template belum punya contoh \"$slot\" arah $view yang disetujui: posisi tidak bisa dibandingkan.");

            return;
        }
        $metrics['region'] = $spec['region'];
        [$rx0, $ry0, $rx1, $ry1] = $spec['region'];
        if ($box[0] < $rx0 || $box[1] < $ry0 || $box[2] > $rx1 || $box[3] > $ry1) {
            $err('region', sprintf('Gambar (x %d-%d, y %d-%d) keluar dari area %s arah %s (x %d-%d, y %d-%d). Geser/skala bagian ini ke area standar.', $box[0], $box[2], $box[1], $box[3], $slot, $view, $rx0, $rx1, $ry0, $ry1));
        }
        // anchors: where the neck / eyes / shoulder / ankle of THIS part are, against where the template expects them
        $found = AnchorExtractor::extract($content, $slot);
        $metrics['anchors'] = $found;
        $tol = $tpl->data['anchor_tolerance'] ?? ['warn' => 14, 'error' => 40];
        $expected = $tpl->expectedAnchors($slot, $view, $family);
        $metrics['family'] = $family;
        foreach ($found as $name => $p) {
            $want = $expected[$name] ?? null;
            if (! $want) {
                continue;
            }
            $dx = round($want['x'] - $p['x'], 1);
            $dy = round($want['y'] - $p['y'], 1);
            $off = hypot($dx, $dy);
            $aligned = in_array($name, AnchorExtractor::ALIGN_BY[$slot] ?? [], true);
            $msg = sprintf('Titik %s ada di (%s, %s), template mengharapkan sekitar (%s, %s): geser %s%s, %s%s unit.', $name, $p['x'], $p['y'], $want['x'], $want['y'], $dx >= 0 ? '+' : '', $dx, $dy >= 0 ? '+' : '', $dy);
            if ($aligned && $off >= $tol['error']) {
                $err('anchor', $msg);
            } elseif ($aligned && $off >= $tol['warn']) {
                $warn('anchor', $msg);
            }
        }
        foreach (['w' => 'lebar', 'h' => 'tinggi'] as $key => $label) {
            $range = $spec[$key];
            $v = $key === 'w' ? $metrics['width'] : $metrics['height'];
            if ($range && ($v < $range[0] || $v > $range[1])) {
                $warn('size', sprintf('%s %d unit di luar kisaran %s arah %s (%d-%d).', ucfirst($label), $v, $slot, $view, $range[0], $range[1]));
            }
        }
    }

    private function report(DesignTemplate $tpl, array $errors, array $warnings, array $metrics): array
    {
        return ['ok' => $errors === [], 'template' => $tpl->id(), 'errors' => $errors, 'warnings' => $warnings, 'metrics' => $metrics, 'checked_at' => now()->toIso8601String()];
    }
}

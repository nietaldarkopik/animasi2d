<?php

namespace App\Console\Commands;

use App\Models\LibraryAsset;
use App\Services\Library\AnchorExtractor;
use App\Services\Library\DesignFamily;
use App\Services\Library\DesignTemplate;
use App\Services\Library\SlotTemplate;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;

/**
 * (Re)measures the design template from the approved raster parts of the library: per slot and view the area the art occupies, the
 * size range, and the median position of every named anchor. Run after adding a new family of approved parts; the numbers are what the
 * validator and the Builder's auto-alignment compare against.
 */
class MeasureDesignTemplate extends Command
{
    protected $signature = 'design:measure {template=anime-v1} {--dry-run : print instead of writing the file}';

    protected $description = 'Measure slot areas, size ranges and anchor positions of the design template from the approved parts';

    /** slots whose art is a pose / any size and place: only a loose area applies */
    private const LOOSE = ['arm_l' => [0, 60, 400, 640], 'arm_r' => [0, 60, 400, 640], 'accessory' => [0, 60, 400, 700], 'hijab' => [0, 0, 400, 680]];

    private function median(array $v): float
    {
        sort($v);
        $n = count($v);

        return $n % 2 ? $v[intdiv($n, 2)] : ($v[$n / 2 - 1] + $v[$n / 2]) / 2;
    }

    public function handle(): int
    {
        $id = (string) $this->argument('template');
        $tpl = DesignTemplate::load($id)->data;

        $boxes = [];
        $anchors = [];
        $byFamily = [];
        foreach (LibraryAsset::with('category')->whereNull('archived_at')->where('status', 'approved')->where('mime', 'image/png')->get() as $a) {
            if ($a->category->kind !== 'part' || ($a->meta['template'] ?? DesignTemplate::DEFAULT) !== $id || ! SlotTemplate::isFullCanvas($a->width, $a->height)) {
                continue;
            }
            $png = Storage::disk($a->disk)->get($a->path);
            $found = AnchorExtractor::extract($png, $a->category->slug);
            if (! $found) {
                continue;
            }
            $im = imagecreatefromstring($png);
            $k = imagesx($im) / SlotTemplate::W;
            [$x0, $y0, $x1, $y1] = [PHP_INT_MAX, PHP_INT_MAX, -1, -1];
            for ($y = 0; $y < imagesy($im); $y += 2) {
                for ($x = 0; $x < imagesx($im); $x += 2) {
                    if (((imagecolorat($im, $x, $y) >> 24) & 0x7F) < 100) {
                        [$x0, $y0, $x1, $y1] = [min($x0, $x), min($y0, $y), max($x1, $x), max($y1, $y)];
                    }
                }
            }
            $view = $a->meta['view'] ?? 'front';
            $family = $a->meta['family'] ?? DesignFamily::infer($a->name, $a->key);
            $boxes[$a->category->slug][$view][] = [$x0 / $k, $y0 / $k, ($x1 + 1) / $k, ($y1 + 1) / $k];
            foreach ($found as $name => $p) {
                $anchors[$a->category->slug][$view][$name][] = $p;
                $byFamily[$a->category->slug][$view][$family][$name][] = $p;
            }
        }

        $slots = [];
        foreach (SlotTemplate::ANCHORS as $slug => $a) {
            $views = [];
            foreach ($tpl['views'] as $v) {
                if (isset(self::LOOSE[$slug])) {
                    $views[$v] = ['region' => self::LOOSE[$slug], 'w' => null, 'h' => null, 'anchors' => $this->medians($anchors[$slug][$v] ?? []), 'families' => $this->families($byFamily[$slug][$v] ?? [])];

                    continue;
                }
                $b = $boxes[$slug][$v] ?? null;
                if (! $b) {
                    continue; // no approved example: only the canvas rules apply to this view
                }
                $w = array_map(fn ($r) => $r[2] - $r[0], $b);
                $h = array_map(fn ($r) => $r[3] - $r[1], $b);
                $m = (int) ($tpl['region_margin'] ?? 14);
                [$wmin, $wmax] = $tpl['size_range'] ?? [0.55, 1.35];
                $views[$v] = [
                    'region' => [max(0, (int) floor(min(array_column($b, 0)) - $m)), max(0, (int) floor(min(array_column($b, 1)) - $m)), min(400, (int) ceil(max(array_column($b, 2)) + $m)), min(800, (int) ceil(max(array_column($b, 3)) + $m))],
                    'w' => [(int) floor(min($w) * $wmin), (int) ceil(max($w) * $wmax)],
                    'h' => [(int) floor(min($h) * $wmin), (int) ceil(max($h) * $wmax)],
                    'anchors' => $this->medians($anchors[$slug][$v] ?? []),
                    'families' => $this->families($byFamily[$slug][$v] ?? []),
                ];
            }
            $slots[$slug] = ['anchor' => ['x' => $a['cx'], 'y' => $a['cy']], 'max_width' => $a['maxW'], 'align_by' => AnchorExtractor::ALIGN_BY[$slug] ?? [], 'views' => $views];
        }
        $tpl['slots'] = $slots;
        $tpl['families'] = DesignFamily::all();
        $tpl['anchor_tolerance'] = ['warn' => 14, 'error' => 40]; // canvas units a part's anchor may be away from the template's
        $json = json_encode($tpl, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);

        if ($this->option('dry-run')) {
            $this->line($json);
        } else {
            file_put_contents(resource_path("design/$id.json"), $json."\n");
            $n = array_sum(array_map(fn ($s) => count($s['views']), $slots));
            $this->info("Template $id diukur ulang: ".count($slots)." slot, $n kombinasi slot-arah.");
        }

        return self::SUCCESS;
    }

    /** Per family: the median anchors, only for families with at least two measured parts (one example is not a standard). */
    private function families(array $byFamily): array
    {
        $out = [];
        foreach ($byFamily as $family => $byName) {
            $n = max(array_map('count', $byName));
            if ($n >= 2) {
                $out[$family] = ['n' => $n, 'anchors' => $this->medians($byName)];
            }
        }

        return $out;
    }

    /** @param array<string, list<array{x: float, y: float}>> $byName */
    private function medians(array $byName): array
    {
        $out = [];
        foreach ($byName as $name => $pts) {
            $out[$name] = ['x' => round($this->median(array_column($pts, 'x')), 1), 'y' => round($this->median(array_column($pts, 'y')), 1)];
        }

        return $out;
    }
}

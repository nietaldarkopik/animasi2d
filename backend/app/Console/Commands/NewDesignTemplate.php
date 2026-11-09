<?php

namespace App\Console\Commands;

use App\Services\Library\DesignTemplate;
use Illuminate\Console\Command;

/** Starts a new design template (another proportion preset / character family) from an existing one; `design:measure` then fills it from the parts made for it. */
class NewDesignTemplate extends Command
{
    protected $signature = 'design:new {id : e.g. vrm-vroid} {--from=anime-v1} {--label=} {--preset=} {--margin=14 : region margin, canvas units} {--min=0.55} {--max=1.35}';

    protected $description = 'Create a design template file from an existing one (slots, anchors, tolerances) to be measured with design:measure';

    public function handle(): int
    {
        $id = (string) $this->argument('id');
        if (DesignTemplate::exists($id)) {
            $this->error("Template $id sudah ada.");

            return self::FAILURE;
        }
        if (! preg_match('/^[a-z0-9_-]+$/', $id)) {
            $this->error('Id hanya huruf kecil, angka, - dan _.');

            return self::FAILURE;
        }
        $d = DesignTemplate::load((string) $this->option('from'))->data;
        $d['id'] = $id;
        $d['label'] = $this->option('label') ?: $id;
        $d['preset'] = $this->option('preset') ?: $id;
        $d['region_margin'] = (int) $this->option('margin');
        $d['size_range'] = [(float) $this->option('min'), (float) $this->option('max')];
        foreach ($d['slots'] as &$slot) { // nothing measured yet: only the canvas rules apply until design:measure has seen parts of this template
            $slot['views'] = [];
        }
        file_put_contents(resource_path("design/$id.json"), json_encode($d, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES)."\n");
        $this->info("Template $id dibuat. Impor bagiannya (meta.template=$id), lalu jalankan: php artisan design:measure $id");

        return self::SUCCESS;
    }
}

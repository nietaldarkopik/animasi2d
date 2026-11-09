<?php

namespace App\Console\Commands;

use App\Models\LibraryAsset;
use App\Services\Library\AssetValidator;
use App\Services\Library\DesignTemplate;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;

/** Audits the body parts of the library against the design template and prints what does not fit. */
class ValidateLibraryParts extends Command
{
    protected $signature = 'library:validate {--category= : only this category slug} {--save : store the report on each asset (shown in the Library)} {--all : also list parts that only have warnings}';

    protected $description = 'Check every body part of the library against the design template (canvas, transparency, region, size, duplicates)';

    public function handle(AssetValidator $validator): int
    {
        $count = ['ok' => 0, 'warn' => 0, 'error' => 0];
        $q = LibraryAsset::with('category')->whereNull('archived_at')->whereHas('category', fn ($c) => $c->where('kind', 'part')->when($this->option('category'), fn ($x) => $x->where('slug', $this->option('category'))));
        foreach ($q->orderBy('category_id')->orderBy('id')->get() as $a) {
            $disk = Storage::disk($a->disk);
            if (! $disk->exists($a->path)) {
                $this->warn("#{$a->id} {$a->name}: file hilang");
                $count['error']++;

                continue;
            }
            $r = $validator->validate($disk->get($a->path), $a->mime, $a->width, $a->height, $a->category->slug, $a->meta['view'] ?? 'front', DesignTemplate::exists($a->meta['template'] ?? '') ? DesignTemplate::load($a->meta['template']) : null, $a->id, $a->hash, $a->meta['family'] ?? null);
            $bad = ! $r['ok'];
            $count[$bad ? 'error' : ($r['warnings'] && array_diff(array_column($r['warnings'], 'code'), ['vector']) ? 'warn' : 'ok')]++;
            if ($bad || ($this->option('all') && array_diff(array_column($r['warnings'], 'code'), ['vector']))) {
                $this->line(sprintf('%s #%d %s [%s/%s]', $bad ? '✗' : '!', $a->id, $a->name, $a->category->slug, $a->meta['view'] ?? 'front'));
                foreach ($r['errors'] as $e) {
                    $this->line('     ✗ '.$e['message']);
                }
                if ($this->option('all') || $bad) {
                    foreach ($r['warnings'] as $w) {
                        if ($w['code'] !== 'vector') {
                            $this->line('     ! '.$w['message']);
                        }
                    }
                }
            }
            if ($this->option('save')) {
                $a->update(['meta' => ($a->meta ?? []) + ['validation' => $r]]);
            }
        }
        $this->info(sprintf('Lolos: %d · peringatan saja: %d · gagal: %d', $count['ok'], $count['warn'], $count['error']));

        return self::SUCCESS;
    }
}

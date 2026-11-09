<?php

namespace App\Console\Commands;

use App\Models\LibraryAsset;
use App\Services\Library\DesignFamily;
use Illuminate\Console\Command;

/** Gives every body part of the library a design family (`meta.family`), guessed from its name; existing labels are kept unless --force. */
class LabelLibraryFamilies extends Command
{
    protected $signature = 'library:families {--force : relabel parts that already have a family} {--dry-run : only count}';

    protected $description = 'Label every body part with its design family (male, female, kit-l1, kit-p2, kit-p3, legacy, general)';

    public function handle(): int
    {
        $count = [];
        foreach (LibraryAsset::with('category')->whereNull('archived_at')->whereHas('category', fn ($c) => $c->where('kind', 'part'))->get() as $a) {
            $had = $a->meta['family'] ?? null;
            if ($had && ! $this->option('force')) {
                $count[$had] = ($count[$had] ?? 0) + 1;

                continue;
            }
            $fam = DesignFamily::infer($a->name, $a->key);
            $count[$fam] = ($count[$fam] ?? 0) + 1;
            if (! $this->option('dry-run')) {
                $a->update(['meta' => ($a->meta ?? []) + ['family' => $fam]]);
            }
        }
        ksort($count);
        foreach ($count as $fam => $n) {
            $this->line(sprintf('%-8s %3d  %s', $fam, $n, DesignFamily::FAMILIES[$fam]['label']));
        }

        return self::SUCCESS;
    }
}

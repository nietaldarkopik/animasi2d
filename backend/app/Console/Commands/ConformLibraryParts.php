<?php

namespace App\Console\Commands;

use App\Http\Controllers\LibraryController;
use App\Models\LibraryAsset;
use App\Services\Library\SlotTemplate;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Brings library parts that are not on the standard 400x800 part canvas (old crops, uploads) into the standard format, so every
 * face/hair/garment of a slot swaps without resizing. An asset a saved character version uses is never changed: it is archived
 * (still served) and a conformed copy takes its place in the library, exactly like LibraryController::replace().
 * Also tags the side/back body assets with their view.
 */
class ConformLibraryParts extends Command
{
    protected $signature = 'library:conform {--dry-run : only list what would change}';

    protected $description = 'Put every library body part in the standard part format (shared canvas, fixed slot frame)';

    public function handle(): int
    {
        $n = ['in_place' => 0, 'copied' => 0, 'skipped' => 0];
        foreach (LibraryAsset::with('category')->whereNull('archived_at')->get() as $a) {
            $slot = $a->category?->slug;
            if (! $a->category || $a->category->kind !== 'part' || ! SlotTemplate::has($slot) || SlotTemplate::isFullCanvas($a->width, $a->height)) {
                continue;
            }
            $disk = Storage::disk($a->disk);
            $c = $disk->exists($a->path) ? SlotTemplate::conform($slot, $disk->get($a->path), $a->mime, $a->width, $a->height) : null;
            if (! $c) {
                $n['skipped']++;
                $this->warn("#{$a->id} {$a->name}: dilewati (file tak terbaca)");

                continue;
            }
            $used = DB::table('character_version_assets')->where('library_asset_id', $a->id)->exists();
            $this->line(sprintf('#%d %-40s %s %dx%d -> %dx%d %s', $a->id, Str::limit($a->name, 40, ''), $slot, $a->width, $a->height, $c['width'], $c['height'], $used ? '(dipakai karakter: salinan baru)' : '(diganti langsung)'));
            if ($this->option('dry-run')) {
                continue;
            }
            if ($used) {
                DB::transaction(function () use ($a, $c) {
                    $a->update(['archived_at' => now()]);
                    LibraryController::persistAsset($a->user_id, $a->category, $a->name, $a->tags ?? [], $a->source, $a->status, $c['content'], $c['mime'], $c['ext'], $c['width'], $c['height'], $a->tintable, null,
                        ($a->meta ?? []) + ['replaces' => $a->id]);
                });
                $n['copied']++;
            } else {
                $path = 'library/'.($a->user_id ? 'u'.$a->user_id : 'system').'/'.Str::uuid().'.'.$c['ext'];
                $disk->put($path, $c['content']);
                $old = $a->path;
                $a->update(['path' => $path, 'mime' => $c['mime'], 'width' => $c['width'], 'height' => $c['height'], 'hash' => hash('sha256', $c['content']), 'meta' => ($a->meta ?? []) + ['conformed' => true]]);
                $disk->delete($old);
                $n['in_place']++;
            }
        }

        // side / back body assets ("Badan laki-laki - kanan", ...) get their view
        foreach (LibraryAsset::whereNull('archived_at')->where('name', 'like', 'Badan %')->get() as $a) {
            $view = str_contains($a->name, '- kanan') ? 'right' : (str_contains($a->name, '- kiri') ? 'left' : (str_contains($a->name, '- belakang') ? 'back' : null));
            if ($view && ($a->meta['view'] ?? null) !== $view && ! $this->option('dry-run')) {
                $a->update(['meta' => ($a->meta ?? []) + ['view' => $view]]);
                $this->line("#{$a->id} {$a->name}: view = $view");
            }
        }
        $this->info(sprintf('Selesai: %d diganti langsung, %d disalin (karakter lama tetap utuh), %d dilewati.', $n['in_place'], $n['copied'], $n['skipped']));

        return self::SUCCESS;
    }
}

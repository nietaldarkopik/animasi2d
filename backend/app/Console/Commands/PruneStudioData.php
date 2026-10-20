<?php

namespace App\Console\Commands;

use App\Models\AiJob;
use App\Models\ExportJob;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;

/** Keeps disk and tables bounded: old exports (files + rows) and finished AI jobs are removed. */
class PruneStudioData extends Command
{
    protected $signature = 'studio:prune {--export-days=7 : delete exports older than N days} {--ai-days=30 : delete AI job rows older than N days}';

    protected $description = 'Delete old export files/rows and old AI job rows';

    public function handle(): int
    {
        $disk = Storage::disk('local');
        $exports = 0;
        ExportJob::where('created_at', '<', now()->subDays((int) $this->option('export-days')))
            ->orderBy('id')->chunkById(100, function ($chunk) use ($disk, &$exports) {
                foreach ($chunk as $e) {
                    $disk->delete(array_filter([$e->source_path, $e->output_path]));
                    $e->delete();
                    $exports++;
                }
            });

        $ai = AiJob::where('created_at', '<', now()->subDays((int) $this->option('ai-days')))->delete();

        $this->info("Removed {$exports} export(s) and {$ai} AI job(s).");

        return self::SUCCESS;
    }
}

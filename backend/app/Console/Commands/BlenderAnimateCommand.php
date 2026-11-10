<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Symfony\Component\Process\Process;

class BlenderAnimateCommand extends Command
{
    protected $signature = 'cartoon:blender 
                            {--script= : Path file JSON naskah (misal: naskah/uki-kesiangan.json)}
                            {--prompt= : Teks deskripsi adegan atau dialog (misal: "Arum: Hah?! | Uki: Tenang!")}
                            {--save-blend= : Path untuk menyimpan file .blend}
                            {--render-still= : Path untuk render pratinjau JPG frame}
                            {--render-video= : Path untuk render video MP4}
                            {--no-exec : Hanya buat script Python tanpa mengeksekusi Blender}';

    protected $description = 'Gerakkan dan render karakter 2.5D di Blender berdasarkan naskah atau prompt teks via MCP/CLI';

    public function handle(): int
    {
        $script = $this->option('script');
        $prompt = $this->option('prompt');

        if (!$script && !$prompt) {
            $this->error('Harap tentukan --script=<file.json> atau --prompt="<teks adegan>".');
            return self::FAILURE;
        }

        $baseDir = base_path('..');
        $pythonScript = $baseDir . DIRECTORY_SEPARATOR . 'tools' . DIRECTORY_SEPARATOR . 'blender' . DIRECTORY_SEPARATOR . 'script_to_blender.py';

        if (!file_exists($pythonScript)) {
            $this->error("Script animator tidak ditemukan di: {$pythonScript}");
            return self::FAILURE;
        }

        $cmd = ['python', $pythonScript];

        if ($script) {
            $scriptPath = file_exists($script) ? $script : base_path('../' . ltrim($script, '/\\'));
            $cmd[] = "--script={$scriptPath}";
        }

        if ($prompt) {
            $cmd[] = "--prompt={$prompt}";
        }

        if ($blend = $this->option('save-blend')) {
            $cmd[] = "--save-blend={$blend}";
        }

        if ($still = $this->option('render-still')) {
            $cmd[] = "--render-still={$still}";
        }

        if ($video = $this->option('render-video')) {
            $cmd[] = "--render-video={$video}";
        }

        if ($this->option('no-exec')) {
            $cmd[] = '--no-exec';
        }

        $this->info("=== Blender 2.5D Character Animator ===");
        $this->line("Target: " . ($script ? "Naskah ({$script})" : "Prompt (\"{$prompt}\")"));

        $process = new Process($cmd, $baseDir);
        $process->setTimeout(600); // 10 minutes timeout for rendering
        $process->run(function ($type, $buffer) {
            $this->output->write($buffer);
        });

        if (!$process->isSuccessful()) {
            $this->error('Gagal mengeksekusi animasi di Blender.');
            return self::FAILURE;
        }

        $this->info("✓ Selesai!");
        return self::SUCCESS;
    }
}


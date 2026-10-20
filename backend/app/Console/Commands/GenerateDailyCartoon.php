<?php

namespace App\Console\Commands;

use App\Models\User;
use App\Services\DailyCartoonService;
use Illuminate\Console\Command;
use Symfony\Component\Process\Process;

class GenerateDailyCartoon extends Command
{
    protected $signature = 'cartoon:generate-daily 
                            {--user=1 : ID User pemilik project} 
                            {--topic= : Topik atau ide cerita kartun} 
                            {--characters=Sekar,Uki : Nama karakter dipisah koma} 
                            {--export : Jalankan headless render untuk menghasilkan video MP4}';

    protected $description = 'Otomatis membuat film kartun harian lengkap dengan naskah, suara TTS, dan adegan';

    public function handle(DailyCartoonService $service): int
    {
        $userId = (int) $this->option('user');
        $user = User::find($userId) ?? User::first();
        if (!$user) {
            $this->error('User tidak ditemukan. Jalankan registrasi atau seeder terlebih dahulu.');
            return self::FAILURE;
        }

        $topic = $this->option('topic') ?: null;
        $characters = array_filter(array_map('trim', explode(',', (string) $this->option('characters'))));
        if (empty($characters)) {
            $characters = ['Sekar', 'Uki'];
        }

        $this->info("=== Membuat Film Kartun Harian ===");
        $this->info("User: {$user->name} (#{$user->id})");
        $this->info("Karakter: " . implode(' & ', $characters));
        if ($topic) {
            $this->info("Topik: {$topic}");
        }

        $this->line("1. Menyusun naskah cerita...");
        $res = $service->createDailyCartoon($user->id, $topic, $characters);

        $this->info("✓ Project berhasil dibuat: {$res['title']} (ID: {$res['project_id']})");
        $this->line("  - Tema: {$res['theme']}");
        $this->line("  - Total Adegan: {$res['scenes_count']} scene");
        $this->line("  - Total Audio TTS: {$res['audio_count']} klip suara");
        $this->line("  - Estimasi Durasi: {$res['duration']} detik");
        $this->line("  - URL Web: http://localhost:5173/projects/{$res['project_id']}");

        if ($this->option('export')) {
            $this->info("2. Menjalankan Headless Renderer (Export MP4)...");
            $runnerScript = base_path('../tools/daily_cartoon_runner.js');
            if (!file_exists($runnerScript)) {
                $this->warn("Script headless runner tools/daily_cartoon_runner.js belum tersedia.");
                return self::SUCCESS;
            }

            $nodeProcess = new Process([
                'node',
                $runnerScript,
                '--projectId', (string) $res['project_id'],
                '--userId', (string) $user->id
            ], base_path('..'));
            $nodeProcess->setTimeout(1200);

            $nodeProcess->run(function ($type, $buffer) {
                $this->output->write($buffer);
            });

            if ($nodeProcess->isSuccessful()) {
                $this->info("✓ Video MP4 kartun harian berhasil dibuat dan disimpan!");
            } else {
                $this->error("Gagal melakukan export otomatis: " . $nodeProcess->getErrorOutput());
            }
        }

        $this->info("Selesai!");
        return self::SUCCESS;
    }
}

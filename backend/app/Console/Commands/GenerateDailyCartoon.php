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
                            {--topic= : Topik atau ide cerita kartun (butuh AI; tanpa AI memakai cerita katalog)}
                            {--script= : File JSON naskah buatan sendiri {title, character_ids?, scenes:[{name, location, time, cast?, dialog:[{who,text}]}]}; menggantikan topik} 
                            {--characters=Sekar,Uki : Nama karakter dipisah koma} 
                            {--export : Jalankan headless render untuk menghasilkan video MP4}
                            {--slot=0 : Cerita ke berapa hari ini (0, 1, ...): cerita katalog berganti per slot}
                            {--publish : Setelah MP4 jadi, unggah ke YouTube lewat clipper-tool (butuh --export)}
                            {--privacy= : private | unlisted | public untuk --publish (default: CLIPPER_PRIVACY, awalnya private)}';

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

        $custom = null;
        if ($file = $this->option('script')) {
            $raw = is_file($file) ? json_decode((string) file_get_contents($file), true) : null;
            if (! is_array($raw)) {
                $this->error("Naskah tidak bisa dibaca sebagai JSON: {$file}");

                return self::FAILURE;
            }
            $custom = $raw;
        }

        $service->slot = max(0, (int) $this->option('slot'));
        $this->line($custom ? '1. Memakai naskah buatan sendiri...' : '1. Menyusun naskah cerita...');
        try {
            // a script may name the exact Builder character of each name ({"character_ids": {"uki": 64}}): two characters can share a name
            $ids = array_filter(array_change_key_case((array) ($custom['character_ids'] ?? []), CASE_LOWER), fn ($v) => is_numeric($v));
            $res = $service->createDailyCartoon($user->id, $topic, $characters, $custom, $ids);
        } catch (\InvalidArgumentException $e) {
            $this->error($e->getMessage());

            return self::FAILURE;
        }
        if (($res['script']['source'] ?? null) === 'catalog' && $topic) {
            $this->warn("AI tidak tersedia, jadi topik \"{$topic}\" TIDAK dipakai (memakai cerita katalog). Nyalakan 9router atau pakai --script=naskah.json.");
        }

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
            $nodeProcess->setTimeout(3000);

            $nodeProcess->run(function ($type, $buffer) {
                $this->output->write($buffer);
            });

            if ($nodeProcess->isSuccessful()) {
                $this->info("✓ Video MP4 kartun harian berhasil dibuat dan disimpan!");
                if ($this->option('publish')) {
                    return $this->publish($res);
                }
            } else {
                $this->error("Gagal melakukan export otomatis: " . $nodeProcess->getErrorOutput());
            }
        }

        $this->info("Selesai!");
        return self::SUCCESS;
    }

    /** Hands the finished MP4 to clipper-tool (`clips:publish-file`), which uploads it to the configured YouTube account. */
    private function publish(array $res): int
    {
        $cfg = config('services.clipper');
        $file = base_path('../daily_output/kartun_'.date('Y-m-d').'_project_'.$res['project_id'].'.mp4');
        if (! $cfg['path'] || ! $cfg['account'] || ! is_file($file)) {
            $this->error('Unggah dilewati: isi CLIPPER_PATH dan CLIPPER_YOUTUBE_ACCOUNT di .env, dan pastikan MP4-nya ada.');

            return self::FAILURE;
        }
        $privacy = $this->option('privacy') ?: $cfg['privacy'];
        $title = mb_substr($res['script']['title'] ?? $res['title'], 0, 95);
        $this->info("3. Mengunggah ke YouTube (clipper-tool, akun #{$cfg['account']}, privasi: {$privacy})...");
        $p = new Process([PHP_BINARY, 'artisan', 'clips:publish-file', $file, '--account='.$cfg['account'], '--title='.$title,
            '--caption='.($res['theme'] ?? '')."

Film kartun dibuat otomatis dengan Cartoon Maker AI.",
            '--tags=kartun,animasi,kartunindonesia,ceritaanak,buttudesign', '--privacy='.$privacy], $cfg['path'].'/backend');
        $p->setTimeout(1800);
        $p->run(fn ($t, $b) => $this->output->write($b));
        $p->isSuccessful() ? $this->info('✓ Terunggah.') : $this->error('Unggahan gagal.');

        return $p->isSuccessful() ? self::SUCCESS : self::FAILURE;
    }
}

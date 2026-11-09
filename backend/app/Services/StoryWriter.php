<?php

namespace App\Services;

use App\Models\StoryEpisode;
use App\Models\StorySeries;
use InvalidArgumentException;
use RuntimeException;

/**
 * Writes the episodes of a story series with the AI model: an outline (title + synopsis per episode) and the full script of
 * an episode (scenes with dialogue and narration), always in line with the author's plot, characters, narration style and the
 * episodes before it. The result is checked and cleaned so it can go straight into DailyCartoonService::createDailyCartoon().
 */
class StoryWriter
{
    /** locations the film maker has a background (and a floor line) for */
    public const LOCATIONS = ['Halaman sekolah', 'Ruang kelas', 'Lab komputer', 'Kantin sekolah', 'Perpustakaan', 'Lapangan upacara', 'Ruang tamu', 'Kamar tidur', 'Dapur', 'Taman', 'Jalan raya'];

    public function __construct(private readonly AiClient $ai, private readonly DailyCartoonService $film) {}

    public static function available(): bool
    {
        return AiClient::isReachable();
    }

    private function brief(StorySeries $s): string
    {
        $chars = collect($s->characters ?? [])->map(fn ($c) => '- '.$c['name'].(! empty($c['role']) ? ' ('.$c['role'].')' : '').(! empty($c['traits']) ? ': '.$c['traits'] : ''))->implode("\n");
        $out = "JUDUL SERI: {$s->title}\nALUR / PREMIS CERITA:\n{$s->premise}\n\nKARAKTER (hanya mereka yang boleh berbicara):\n{$chars}\n";
        if ($s->genre) {
            $out .= "GENRE: {$s->genre}\n";
        }
        if ($s->tone) {
            $out .= "NADA CERITA: {$s->tone}\n";
        }
        if ($s->use_narrator) {
            $out .= 'NARATOR: ada, tuliskan sebagai pembicara "Narator"'.($s->narration_style ? ". Gaya narasi: {$s->narration_style}" : '').".\n";
        }
        if ($s->notes) {
            $out .= "CATATAN PENULIS:\n{$s->notes}\n";
        }

        return $out;
    }

    /** @return list<array{title: string, synopsis: string}> */
    public function outline(StorySeries $series, int $count): array
    {
        $count = max(1, min(30, $count));
        $done = $series->episodes()->get();
        $prev = $done->map(fn ($e) => "Episode {$e->number}: {$e->title} - {$e->synopsis}")->implode("\n");
        $start = ($done->max('number') ?? 0) + 1;
        $prompt = $this->brief($series)."\nBuatlah rencana {$count} episode berikutnya (mulai dari episode {$start}) untuk seri ini. Tiap episode berdiri sendiri tetapi cerita bersambung dan bergerak maju sesuai alur; episode terakhir yang direncanakan boleh menutup alur."
            .($prev ? "\n\nEPISODE YANG SUDAH ADA:\n{$prev}" : '')
            ."\n\nBalas HANYA JSON murni: {\"episodes\":[{\"title\":\"judul singkat\",\"synopsis\":\"2-4 kalimat isi episode\"}]}";
        $json = $this->ask('Kamu penulis skenario seri kartun berbahasa Indonesia yang rapi dan konsisten. Balas hanya JSON murni.', $prompt, 0.6);
        $eps = [];
        foreach ($json['episodes'] ?? [] as $e) {
            $title = trim((string) ($e['title'] ?? ''));
            if ($title !== '') {
                $eps[] = ['title' => mb_substr($title, 0, 160), 'synopsis' => mb_substr(trim((string) ($e['synopsis'] ?? '')), 0, 1500)];
            }
        }
        if ($eps === []) {
            throw new RuntimeException('AI tidak menghasilkan daftar episode yang bisa dibaca. Coba lagi.');
        }

        return array_slice($eps, 0, $count);
    }

    /** The full script of one episode (validated, speakers restricted to the cast). */
    public function script(StorySeries $series, StoryEpisode $episode): array
    {
        $allowed = $series->characterNames();
        if ($series->use_narrator) {
            $allowed[] = 'Narator';
        }
        $before = $series->episodes()->where('number', '<', $episode->number)->get()->map(fn ($e) => "Episode {$e->number} \"{$e->title}\": {$e->synopsis}")->implode("\n");
        $loc = implode(' / ', self::LOCATIONS);
        $prompt = $this->brief($series)."\n"
            .($before ? "EPISODE SEBELUMNYA (jaga kesinambungan):\n{$before}\n\n" : '')
            ."TULISKAN NASKAH LENGKAP EPISODE {$episode->number}: \"{$episode->title}\"\nRINGKASAN EPISODE: {$episode->synopsis}\n\n"
            ."Aturan: 4 sampai 7 scene; tiap scene 2 sampai 7 dialog; kalimat santai maksimal 20 kata; lokasi HARUS salah satu dari: {$loc}; waktu: pagi, siang, sore, atau malam. "
            .'Pembicara HANYA: '.implode(', ', $allowed).'. Sesuaikan lokasi dan waktu dengan cerita. Akhiri episode dengan penutup yang memancing episode berikutnya (kecuali episode terakhir).'
            ."\n\nBalas HANYA JSON murni: {\"title\":\"judul\",\"theme\":\"pesan/tema\",\"scenes\":[{\"name\":\"nama scene\",\"location\":\"lokasi\",\"time\":\"pagi\",\"dialog\":[{\"who\":\"nama\",\"text\":\"kalimat\"}]}]}";
        $json = $this->ask('Kamu penulis skenario seri kartun berbahasa Indonesia. Patuhi daftar pembicara dan lokasi. Balas hanya JSON murni.', $prompt, 0.5);

        return $this->clean($json, $allowed, $episode->title);
    }

    /**
     * Checks a script (from the AI or typed by the author): only cast members speak (names are matched ignoring case), unknown speakers are
     * dropped, empty scenes vanish, and the shape is the one the film maker needs.
     *
     * @param  list<string>  $allowed
     */
    public function clean(array $json, array $allowed, string $fallbackTitle = 'Episode'): array
    {
        $canon = [];
        foreach ($allowed as $n) {
            $canon[mb_strtolower($n)] = $n;
        }
        if (isset($canon['narator'])) {
            $canon['narrator'] = $canon['narator'];
        }
        $scenes = [];
        foreach ($json['scenes'] ?? [] as $sc) {
            $dialog = [];
            $carried = []; // the actions before a line that is dropped still happen
            foreach ($sc['dialog'] ?? [] as $d) {
                $who = $canon[mb_strtolower(trim((string) ($d['who'] ?? '')))] ?? null;
                $text = trim((string) ($d['text'] ?? ''));
                $carried = [...$carried, ...DailyCartoonService::cleanBeats($d['before'] ?? [])];
                if ($who !== null && $text !== '') {
                    $dialog[] = ['who' => $who, 'text' => $text] + ($carried ? ['before' => $carried] : []);
                    $carried = [];
                }
            }
            $after = DailyCartoonService::cleanBeats([...$carried, ...(is_array($sc['after'] ?? null) ? $sc['after'] : [])]);
            if ($dialog || $after) {
                $given = trim((string) ($sc['location'] ?? ''));
                $loc = collect(self::LOCATIONS)->first(fn ($l) => mb_strtolower($l) === mb_strtolower($given)) ?? $given;
                $scenes[] = ['name' => (string) ($sc['name'] ?? ''), 'location' => $loc, 'time' => (string) ($sc['time'] ?? 'siang'), 'dialog' => $dialog, 'cast' => $sc['cast'] ?? [], 'after' => $after];
            }
        }
        if ($scenes === []) {
            throw new RuntimeException('Naskah tidak punya dialog dari karakter yang terdaftar.');
        }
        try {
            return $this->film->validateScript(['title' => $json['title'] ?? $fallbackTitle, 'theme' => $json['theme'] ?? '', 'scenes' => $scenes]);
        } catch (InvalidArgumentException $e) {
            throw new RuntimeException($e->getMessage());
        }
    }

    private function ask(string $system, string $user, float $temperature): array
    {
        $last = null;
        foreach ([0, 1] as $try) { // one retry: models sometimes wrap the JSON badly
            try {
                return AiClient::extractJson($this->ai->chat([['role' => 'system', 'content' => $system], ['role' => 'user', 'content' => $user]], $temperature));
            } catch (InvalidArgumentException $e) {
                $last = $e;
            }
        }
        throw new RuntimeException('Balasan AI bukan JSON yang valid ('.$last?->getMessage().'). Coba lagi.');
    }
}

<?php

namespace App\Services;

use App\Models\Asset;
use App\Models\Character;
use App\Models\LibraryAsset;
use App\Models\Project;
use App\Support\DocumentMigrator;
use App\Support\SvgSanitizer;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Symfony\Component\Process\Process;

class DailyCartoonService
{
    protected AiClient $ai;

    public function __construct(AiClient $ai)
    {
        $this->ai = $ai;
    }

    /**
     * Curated catalog of episodic Indonesian cartoon stories.
     * Used when AI is not configured or as fallback.
     */
    /** which story of the day this is (0, 1, ...): the catalog fallback rotates so two stories a day are never the same */
    public int $slot = 0;

    /** the narrator speaks over the film: a voice and a caption, but no character and no speech balloon */
    public const NARRATORS = ['narator', 'narrator'];

    /** lower-case speaker => edge-tts voice id, for speakers whose voice is chosen by a story series (the rest use the worker's name map) */
    public array $voices = [];

    public static function isNarrator(string $who): bool
    {
        return in_array(mb_strtolower(trim($who)), self::NARRATORS, true);
    }

    protected array $catalog = [
        [
            'title' => 'Sarapan Pagi dan Semangat Sekolah',
            'theme' => 'Kesehatan & Kebiasaan Baik',
            'scenes' => [
                [
                    'name' => 'Tiba di Halaman Sekolah',
                    'location' => 'Halaman sekolah',
                    'time' => 'pagi',
                    'dialog' => [
                        ['who' => 'Uki', 'text' => 'Halo Sekar! Wah, wajahmu cerah sekali pagi ini!'],
                        ['who' => 'Sekar', 'text' => 'Pagi juga Uki! Tentu saja, tadi ibu masak nasi goreng telur kesukaanku.'],
                        ['who' => 'Uki', 'text' => 'Pantas saja bertenaga. Kalau aku tadi cuma sempat minum air putih karena bangun kesiangan!'],
                        ['who' => 'Sekar', 'text' => 'Aduh Uki, sarapan itu penting lho biar konsentrasi belajar di kelas!']
                    ]
                ],
                [
                    'name' => 'Belajar di Ruang Kelas',
                    'location' => 'Ruang kelas',
                    'time' => 'siang',
                    'dialog' => [
                        ['who' => 'Sekar', 'text' => 'Bagaimana Uki? Perutmu sudah bunyi keroncongan belum?'],
                        ['who' => 'Uki', 'text' => 'Hehehe, iya Sekar, kamu benar. Nanti saat istirahat kita langsung ke kantin ya!'],
                        ['who' => 'Sekar', 'text' => 'Siap! Tapi perhatikan penjelasan guru dulu ya, jangan melamun!']
                    ]
                ]
            ]
        ],
        [
            'title' => 'Trik Cepat Matematika',
            'theme' => 'Pendidikan & Tips Belajar',
            'scenes' => [
                [
                    'name' => 'Diskusi di Ruang Kelas',
                    'location' => 'Ruang kelas',
                    'time' => 'pagi',
                    'dialog' => [
                        ['who' => 'Uki', 'text' => 'Sekar, rumus perkalian sembilan kok susah sekali dihafal ya?'],
                        ['who' => 'Sekar', 'text' => 'Sebenarnya ada trik mudahnya lho Uki! Mau tahu rahasianya?'],
                        ['who' => 'Uki', 'text' => 'Wah, tentu saja mau! Bagaimana caranya?'],
                        ['who' => 'Sekar', 'text' => 'Coba lihat jari tanganmu. Kalau dilipat satu per satu dari kiri, hasilnya langsung terlihat!']
                    ]
                ],
                [
                    'name' => 'Istirahat di Taman',
                    'location' => 'Taman',
                    'time' => 'siang',
                    'dialog' => [
                        ['who' => 'Uki', 'text' => 'Hebat sekali! Sembilan kali empat jarinya dilipat, sisanya tiga dan enam, jadi tiga puluh enam!'],
                        ['who' => 'Sekar', 'text' => 'Betul kan? Matematika itu seru kalau kita tahu polanya!'],
                        ['who' => 'Uki', 'text' => 'Terima kasih Sekar, nilai ulanganku nanti pasti memuaskan!']
                    ]
                ]
            ]
        ],
        [
            'title' => 'Misteri Suara di Lab Komputer',
            'theme' => 'Petualangan & Teknologi',
            'scenes' => [
                [
                    'name' => 'Meneliti di Lab Komputer',
                    'location' => 'Lab komputer',
                    'time' => 'siang',
                    'dialog' => [
                        ['who' => 'Sekar', 'text' => 'Uki, kamu dengar suara aneh dari pojok ruangan tidak?'],
                        ['who' => 'Uki', 'text' => 'Ssst... pelan-pelan Sekar. Seperti suara ketikan tombol keyboard sendiri!'],
                        ['who' => 'Sekar', 'text' => 'Jangan-jangan ada robot yang sedang membuat animasi kartun otomatis!']
                    ]
                ],
                [
                    'name' => 'Misteri Terpecahkan',
                    'location' => 'Lab komputer',
                    'time' => 'siang',
                    'dialog' => [
                        ['who' => 'Uki', 'text' => 'Aha! Ternyata itu suara kipas pendingin server yang berputar kencang!'],
                        ['who' => 'Sekar', 'text' => 'Haha, kukira ada hantu teknologi. Bikin kaget saja kamu ini, Uki!']
                    ]
                ]
            ]
        ],
        [
            'title' => 'Kucing Lucu di Halaman Sekolah',
            'theme' => 'Kasih Sayang Terhadap Hewan',
            'scenes' => [
                [
                    'name' => 'Menemukan Kucing di Halaman',
                    'location' => 'Halaman sekolah',
                    'time' => 'pagi',
                    'dialog' => [
                        ['who' => 'Sekar', 'text' => 'Uki, lihat di bawah pohon! Ada anak kucing belang tiga yang sangat lucu!'],
                        ['who' => 'Uki', 'text' => 'Wah, imut sekali! Matanya bulat dan bulunya bersih. Sedang cari makan sepertinya.'],
                        ['who' => 'Sekar', 'text' => 'Untung aku bawa sedikit potongan ikan dari bekal sarapan. Ayo kita beri makan!']
                    ]
                ],
                [
                    'name' => 'Kucing Bermain Riang',
                    'location' => 'Taman',
                    'time' => 'siang',
                    'dialog' => [
                        ['who' => 'Uki', 'text' => 'Lihat Sekar, dia mendengkur senang sambil mengusapkan kepalanya ke sepatumu!'],
                        ['who' => 'Sekar', 'text' => 'Menyayangi binatang itu membawa kebahagiaan ya Uki. Nanti pulang sekolah kita tengok lagi ya!']
                    ]
                ]
            ]
        ]
    ];

    /**
     * Generates a script either via AI or from curated templates.
     */
    public function generateScript(?string $topic = null, array $characters = ['Sekar', 'Uki']): array
    {
        $char1 = $characters[0] ?? 'Sekar';
        $char2 = $characters[1] ?? 'Uki';

        if (AiClient::isReachable()) {
            try {
                $prompt = "Buatlah naskah film kartun 2D pendek berbahasa Indonesia yang mendidik, lucu, dan hangat untuk karakter {$char1} dan {$char2}.\n";
                if ($topic) {
                    $prompt .= "Topik cerita hari ini: \"{$topic}\".\n";
                } else {
                    $prompt .= "Pilihlah tema cerita menarik seputar persahabatan, sekolah, tips belajar, kebaikan, atau sains ringan.\n";
                }
                $prompt .= "Format balasan WAJIB berupa objek JSON murni tanpa markdown dengan struktur berikut:\n";
                $prompt .= "{\n";
                $prompt .= '  "title": "Judul Kartun Singkat",'."\n";
                $prompt .= '  "theme": "Tema Cerita",'."\n";
                $prompt .= '  "scenes": ['."\n";
                $prompt .= "    {\n";
                $prompt .= '      "name": "Nama Scene 1",'."\n";
                $prompt .= '      "location": "Pilih salah satu: Halaman sekolah / Ruang kelas / Lab komputer / Taman / Kantin sekolah / Ruang tamu",'."\n";
                $prompt .= '      "time": "pagi atau siang atau sore atau malam",'."\n";
                $prompt .= '      "dialog": ['."\n";
                $prompt .= '        {"who": "'.$char1.'", "text": "kalimat santai maksimal 15 kata"},'."\n";
                $prompt .= '        {"who": "'.$char2.'", "text": "kalimat santai maksimal 15 kata"}'."\n";
                $prompt .= "      ]\n";
                $prompt .= "    },\n";
                $prompt .= "    {\n";
                $prompt .= '      "name": "Nama Scene 2",'."\n";
                $prompt .= '      "location": "Pilih salah satu lokasi yang berbeda",'."\n";
                $prompt .= '      "time": "siang",'."\n";
                $prompt .= '      "dialog": ['."\n";
                $prompt .= '        {"who": "'.$char1.'", "text": "kalimat penutup"},'."\n";
                $prompt .= '        {"who": "'.$char2.'", "text": "kalimat penutup"}'."\n";
                $prompt .= "      ]\n";
                $prompt .= "    }\n";
                $prompt .= "  ]\n";
                $prompt .= "}\n";

                $messages = [
                    ['role' => 'system', 'content' => 'Kamu adalah penulis skenario kartun anak-anak dan remaja profesional. Balas hanya dengan JSON murni.'],
                    ['role' => 'user', 'content' => $prompt]
                ];

                $response = $this->ai->chat($messages, 0.4);
                $json = AiClient::extractJson($response);

                if (!empty($json['scenes']) && is_array($json['scenes'])) {
                    $json['source'] = 'ai';

                    return $json;
                }
            } catch (\Throwable $e) {
                report($e);
            }
        }

        // Fallback: pick from catalog
        $index = $topic ? abs(crc32($topic)) % count($this->catalog) : (((int) date('z')) * 2 + $this->slot) % count($this->catalog);
        $story = $this->catalog[$index];
        if ($topic) {
            // AI is not reachable: the requested topic CANNOT be written. Say so instead of pretending the catalog story is about it.
            $story['theme'] = 'Cerita katalog (topik "'.$topic.'" tidak dipakai karena AI tidak tersedia)';
        }
        $story['source'] = 'catalog';

        // Adjust character names
        foreach ($story['scenes'] as &$sc) {
            foreach ($sc['dialog'] as &$d) {
                if ($d['who'] === 'Sekar') $d['who'] = $char1;
                elseif ($d['who'] === 'Uki') $d['who'] = $char2;
            }
        }

        return $story;
    }

    /**
     * Synthesize speech using Python edge-tts worker and store as Project Asset.
     */
    public function synthesizeDialogue(int $userId, int $projectId, string $who, string $text): array
    {
        $uuid = (string) Str::uuid();
        $relPath = 'projects/'.$projectId.'/assets/'.$uuid.'.mp3';
        $fullPath = Storage::disk('local')->path($relPath);
        File::ensureDirectoryExists(dirname($fullPath));

        $pythonBin = config('services.python.bin', 'python');
        $scriptPath = base_path('../worker/tts_generator.py');

        // Edge-TTS is an online service: a request can fail for a moment (network, rate limit). Retry a few times, and only
        // keep an asset when a real, non-empty audio file exists; otherwise the film is made without that line's voice.
        $duration = max(1.5, round(mb_strlen($text) * 0.07 + 0.6, 2)); // reading-time estimate when there is no audio
        $made = false;
        foreach ([0, 1, 3] as $attempt => $wait) {
            if ($wait) {
                sleep($wait);
            }
            $voice = $this->voices[mb_strtolower($who)] ?? null;
            $process = new Process([$pythonBin, $scriptPath, '--text', $text, '--who', $who, '--out', $fullPath, ...($voice ? ['--voice', $voice] : [])]);
            $process->setTimeout(240);
            $process->run();
            if ($process->isSuccessful() && File::exists($fullPath) && File::size($fullPath) > 0) {
                $out = json_decode($process->getOutput(), true);
                if (isset($out['duration']) && $out['duration'] > 0) {
                    $duration = (float) $out['duration'];
                }
                $made = true;
                break;
            }
            File::delete($fullPath);
        }
        if (! $made) {
            \Illuminate\Support\Facades\Log::warning("TTS gagal untuk \"{$who}: {$text}\" setelah 3 percobaan: ".trim(substr($process->getErrorOutput().$process->getOutput(), 0, 300)));

            return ['asset_id' => null, 'duration' => $duration, 'path' => null, 'who' => $who, 'text' => $text];
        }

        // Save Asset in database
        $asset = Asset::create([
            'user_id' => $userId,
            'project_id' => $projectId,
            'disk' => 'local',
            'path' => $relPath,
            'original_name' => "dialog-{$who}-{$uuid}.mp3",
            'mime' => 'audio/mpeg',
            'size' => File::exists($fullPath) ? File::size($fullPath) : 0,
            'duration' => $duration
        ]);

        return [
            'asset_id' => $asset->id,
            'duration' => $duration,
            'path' => $relPath,
            'who' => $who,
            'text' => $text
        ];
    }

    /**
     * Finds the best matching background library asset.
     */
    public function findBackground(string $location): ?LibraryAsset
    {
        $words = array_filter(preg_split('/[^a-zA-Z0-9]+/', strtolower($location)), fn($w) => strlen($w) > 2);
        $bgs = LibraryAsset::whereHas('category', fn($q) => $q->where('slug', 'like', 'bg_%'))->get();

        $best = null;
        $bestScore = -1;
        foreach ($bgs as $bg) {
            $hay = strtolower($bg->name . ' ' . implode(' ', $bg->tags ?? []));
            $score = 0;
            foreach ($words as $w) {
                if (str_contains($hay, $w)) $score++;
            }
            if ($score > $bestScore) {
                $bestScore = $score;
                $best = $bg;
            }
        }

        return $best ?? $bgs->first();
    }

    /**
     * Prepares a background as a project asset.
     */
    public function ensureProjectBg(int $userId, int $projectId, LibraryAsset $libBg): Asset
    {
        $existing = Asset::where('project_id', $projectId)
            ->where('original_name', 'latar-'.$libBg->id.'.png')
            ->first();
        if ($existing) {
            return $existing;
        }

        $uuid = (string) Str::uuid();
        $ext = $libBg->mime === 'image/svg+xml' ? 'svg' : 'png';
        $relPath = 'projects/'.$projectId.'/assets/'.$uuid.'.'.$ext;
        $fullPath = Storage::disk('local')->path($relPath);
        File::ensureDirectoryExists(dirname($fullPath));

        $libPath = Storage::disk($libBg->disk)->path($libBg->path);
        if (File::exists($libPath)) {
            File::copy($libPath, $fullPath);
        } else {
            // Write a fallback 1280x720 canvas
            File::put($fullPath, '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="100%" height="100%" fill="#e8f0fe"/></svg>');
        }

        return Asset::create([
            'user_id' => $userId,
            'project_id' => $projectId,
            'disk' => 'local',
            'path' => $relPath,
            'original_name' => 'latar-'.$libBg->id.'.png',
            'mime' => $libBg->mime ?? 'image/png',
            'size' => File::exists($fullPath) ? File::size($fullPath) : 100,
            'width' => 1280,
            'height' => 720
        ]);
    }

    /** @return list<array{action?: string, sfx?: string}> */
    public static function cleanBeats(mixed $beats): array
    {
        $out = [];
        foreach (is_array($beats) ? $beats : [] as $b) {
            $action = trim((string) ($b['action'] ?? ''));
            $sfx = trim((string) ($b['sfx'] ?? ''));
            if ($action !== '') {
                $out[] = ['action' => mb_substr($action, 0, 200)];
            } elseif ($sfx !== '') {
                $out[] = ['sfx' => mb_substr($sfx, 0, 40)];
            }
        }

        return array_slice($out, 0, 20);
    }

    /**
     * A script written by hand (or by another tool): {title, theme?, scenes: [{name, location, time?, cast?: [name], dialog: [{who, text, before?: [beat]}], after?: [beat]}]}.
     * `cast` = who else is in the scene without speaking (a crowd of students, teachers...): they stand behind the speakers.
     * A beat is {action: "Uki melambai"} or {sfx: "bel"}: `before` happens just before that line, `after` at the end of the scene.
     * Returns it cleaned up, or throws with a message that says what is wrong.
     */
    public function validateScript(array $s): array
    {
        $scenes = $s['scenes'] ?? null;
        if (! is_array($scenes) || $scenes === [] || count($scenes) > 12) {
            throw new \InvalidArgumentException('Naskah harus punya 1–12 scene ("scenes").');
        }
        $out = ['title' => mb_substr(trim((string) ($s['title'] ?? 'Film Kartun')), 0, 80) ?: 'Film Kartun', 'theme' => mb_substr((string) ($s['theme'] ?? 'Naskah buatan sendiri'), 0, 120), 'source' => 'custom', 'scenes' => []];
        foreach (array_values($scenes) as $i => $sc) {
            $n = $i + 1;
            $dialog = [];
            foreach ($sc['dialog'] ?? [] as $d) {
                $who = trim((string) ($d['who'] ?? ''));
                $text = trim((string) ($d['text'] ?? ''));
                if ($who === '' || $text === '') {
                    throw new \InvalidArgumentException("Scene $n: setiap dialog butuh \"who\" dan \"text\".");
                }
                $before = self::cleanBeats($d['before'] ?? []);
                $dialog[] = ['who' => mb_substr($who, 0, 40), 'text' => mb_substr($text, 0, 300)] + ($before ? ['before' => $before] : []);
            }
            $after = self::cleanBeats($sc['after'] ?? []);
            if ($dialog === [] && $after === []) {
                throw new \InvalidArgumentException("Scene $n: dialog kosong.");
            }
            $time = in_array($sc['time'] ?? null, ['pagi', 'siang', 'sore', 'malam'], true) ? $sc['time'] : 'siang';
            $cast = array_values(array_unique(array_filter(array_map(fn ($c) => mb_substr(trim((string) $c), 0, 60), (array) ($sc['cast'] ?? [])), fn ($c) => $c !== '' && ! self::isNarrator($c))));
            if (count($cast) > 16) {
                throw new \InvalidArgumentException("Scene $n: paling banyak 16 pemeran latar (\"cast\").");
            }
            $out['scenes'][] = ['name' => mb_substr(trim((string) ($sc['name'] ?? "Scene $n")), 0, 80) ?: "Scene $n", 'location' => (string) ($sc['location'] ?? ''), 'time' => $time, 'dialog' => $dialog] + ($cast ? ['cast' => $cast] : []) + ($after ? ['after' => $after] : []);
        }

        return $out;
    }

    public function createDailyCartoon(int $userId, ?string $topic = null, array $characterNames = ['Sekar', 'Uki'], ?array $customScript = null, array $characterIds = []): array
    {
        $dateStr = date('d F Y');
        $script = $customScript !== null ? $this->validateScript($customScript) : $this->generateScript($topic, $characterNames);
        $title = 'Kartun Harian: ' . ($script['title'] ?? 'Petualangan Seru') . ' (' . date('Y-m-d') . ')';

        $project = Project::create([
            'user_id' => $userId,
            'name' => $title,
            'revision' => 1,
            'document' => DocumentMigrator::blank()
        ]);

        $projectAudioClips = [];
        $scenes = [];
        $globalTimeline = 0.0;
        $W = 1280;
        $H = 720;
        $fps = 24;

        foreach ($script['scenes'] as $sIndex => $sc) {
            $sceneId = 'sc_' . Str::random(10);
            $bgLib = $this->findBackground($sc['location'] ?? 'Halaman sekolah');
            $bgAsset = $bgLib ? $this->ensureProjectBg($userId, $project->id, $bgLib) : null;

            $layers = [];

            // 1. Background layer
            if ($bgAsset) {
                $layers[] = [
                    'id' => 'l_bg_' . Str::random(8),
                    'type' => 'image',
                    'name' => 'Latar: ' . ($bgLib->name ?? 'Latar Belakang'),
                    'assetId' => $bgAsset->id,
                    'x' => $W / 2,
                    'y' => $H / 2,
                    'scaleX' => 1,
                    'scaleY' => 1,
                    'rotation' => 0,
                    'opacity' => 1,
                    'visible' => true,
                    'locked' => true
                ];
            }

            // 2. Process dialogue & audio
            $sceneLocalTime = 0.5; // initial silence/entry buffer
            $subtitles = [];
            $beats = []; // actions and sound effects, on the timeline of the scene (the auto-director acts them out)
            $hold = function (array $list) use (&$beats, &$sceneLocalTime) {
                foreach ($list as $b) {
                    $beats[] = ['at' => round($sceneLocalTime, 2)] + $b;
                    $sceneLocalTime += isset($b['action']) ? 2.0 : 1.2; // the moment needs its own time on screen
                }
            };

            foreach ($sc['dialog'] as $dIndex => $dlg) {
                $hold($dlg['before'] ?? []);
                $who = $dlg['who'];
                $text = $dlg['text'];

                // Generate audio
                $audioData = $this->synthesizeDialogue($userId, $project->id, $who, $text);
                $duration = max(1.5, $audioData['duration']);

                // Track in project audio list (for full movie playback and FFmpeg mixing); a line whose voice could not be made stays silent
                if ($audioData['asset_id']) {
                    $projectAudioClips[] = [
                        'id' => 'aud_' . Str::random(8),
                        'assetId' => $audioData['asset_id'],
                        'name' => mb_substr("{$who}: {$text}", 0, 120), // (the document allows 120 characters; the "Who: " prefix is what the lip-sync looks for)
                        'start' => round($globalTimeline + $sceneLocalTime, 2),
                        'volume' => 1.0,
                        'kind' => 'voice',
                        'fadeIn' => 0.05,
                        'fadeOut' => 0.05
                    ];
                }

                // Subtitle
                $subtitles[] = [
                    'id' => 'sub_' . Str::random(8),
                    'start' => round($sceneLocalTime, 2),
                    'end' => round($sceneLocalTime + $duration, 2),
                    'text' => self::isNarrator($who) ? $text : "{$who}: {$text}" // narration is a plain caption
                ];

                if (self::isNarrator($who)) {
                    $sceneLocalTime += $duration + 0.3;

                    continue;
                }

                // Speech Balloon at character position
                // Left character (Sekar) at x: 380, Right character (Uki) at x: 900
                $isLeft = (strtolower($who) === 'sekar' || $dIndex % 2 === 0);
                $balloonX = $isLeft ? 380 : 900;
                $balloonY = 220;

                $startFrame = (int) round($sceneLocalTime * $fps);
                $endFrame = (int) round(($sceneLocalTime + $duration) * $fps);

                $layers[] = [
                    'id' => 'l_bal_' . Str::random(8),
                    'type' => 'balloon',
                    'name' => "Balon: {$who}",
                    'text' => $text,
                    'fontSize' => 28,
                    'fill' => '#111111',
                    'width' => min(420, max(200, strlen($text) * 12 + 60)),
                    'height' => 100,
                    'bubble' => 'speech',
                    'bubbleFill' => '#ffffff',
                    'tailX' => $isLeft ? -40 : 40,
                    'tailY' => 50,
                    'x' => $balloonX,
                    'y' => $balloonY,
                    'scaleX' => 1,
                    'scaleY' => 1,
                    'rotation' => 0,
                    'opacity' => 0,
                    'visible' => true,
                    'locked' => false,
                    'keyframes' => [
                        'opacity' => [
                            ['f' => max(0, $startFrame - 4), 'v' => 0, 'e' => 'linear'],
                            ['f' => $startFrame, 'v' => 1, 'e' => 'linear'],
                            ['f' => $endFrame, 'v' => 1, 'e' => 'linear'],
                            ['f' => min($endFrame + 4, 10000), 'v' => 0, 'e' => 'linear']
                        ]
                    ]
                ];

                $sceneLocalTime += $duration + 0.3; // brief pause between dialogue lines
            }

            $hold($sc['after'] ?? []);
            $sceneDuration = max(4.0, round($sceneLocalTime + 0.8, 1));
            $globalTimeline += $sceneDuration;

            // Time tint effect
            $effects = [];
            $timePreset = $sc['time'] ?? 'siang';
            if ($timePreset === 'pagi') {
                $effects[] = ['id' => 'eff_pagi', 'kind' => 'tint', 'intensity' => 0.22, 'color' => '#ffe3a8', 'blend' => 'normal', 'label' => 'Pagi'];
            } elseif ($timePreset === 'sore') {
                $effects[] = ['id' => 'eff_sore', 'kind' => 'tint', 'intensity' => 0.55, 'color' => '#ff9a52', 'blend' => 'multiply', 'label' => 'Sore'];
            } elseif ($timePreset === 'malam') {
                $effects[] = ['id' => 'eff_malam', 'kind' => 'tint', 'intensity' => 0.6, 'color' => '#27377a', 'blend' => 'multiply', 'label' => 'Malam'];
            }

            // Cinematic subtle camera push-in, in the editor's camera format: one key list per property (x | y | zoom | rot)
            $camera = [
                'zoom' => [
                    ['f' => 0, 'v' => 1.0, 'e' => 'easeOut'],
                    ['f' => max(1, (int) round($sceneDuration * $fps)), 'v' => 1.05, 'e' => 'linear'],
                ],
            ];

            $scenes[] = [
                'id' => $sceneId,
                'name' => $sc['name'] ?? ('Scene ' . ($sIndex + 1)),
                'duration' => $sceneDuration,
                'background' => '#ffffff',
                'transition' => $sIndex < count($script['scenes']) - 1 ? ['type' => 'fade', 'duration' => 0.6] : null,
                'layers' => $layers,
                'subtitles' => $subtitles,
                'effects' => $effects,
                'camera' => $camera,
                'board' => [
                    'location' => $sc['location'] ?? '',
                    'summary' => $sc['name'] ?? '',
                    'dialog' => array_map(fn($d) => ['id' => Str::random(8), 'who' => $d['who'], 'text' => $d['text']], $sc['dialog']),
                    ...(! empty($sc['cast']) ? ['cast' => $sc['cast']] : []), // in the scene without speaking (placed behind the speakers by the auto-director)
                    ...($beats ? ['beats' => $beats] : []),
                ]
            ];
        }

        $document = [
            'schema' => 2,
            'settings' => [
                'width' => $W,
                'height' => $H,
                'fps' => $fps
            ],
            'scenes' => $scenes,
            'audio' => $projectAudioClips,
            'auto_generated' => true,
            'characters' => $characterNames,
            ...($characterIds ? ['character_ids' => array_map('intval', $characterIds)] : []),
        ];

        $project->update(['document' => $document]);

        return [
            'project_id' => $project->id,
            'title' => $title,
            'theme' => $script['theme'] ?? '',
            'duration' => round($globalTimeline, 2),
            'scenes_count' => count($scenes),
            'audio_count' => count($projectAudioClips),
            'script' => $script
        ];
    }
}

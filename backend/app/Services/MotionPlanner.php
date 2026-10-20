<?php

namespace App\Services;

use App\Models\Project;
use App\Support\DocumentMigrator;
use RuntimeException;

/**
 * Prompt-to-Motion: asks an OpenAI-compatible LLM (9router) to turn a text request into keyframes for the
 * project's rig, then validates/sanitises everything the model returns. The output is a *plan* of ordinary,
 * editable keyframes — never trusted blindly, and never applied without the user confirming.
 */
class MotionPlanner
{
    public const PROPS = ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'opacity'];

    public const EASES = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'step'];

    private const MAX_TRACKS = 40;

    private const MAX_KEYS = 40;

    private const MAX_DURATION = 60.0;

    private const RANGE = ['x' => [-10000, 10000], 'y' => [-10000, 10000], 'rotation' => [-1440, 1440], 'scaleX' => [-20, 20], 'scaleY' => [-20, 20], 'opacity' => [0, 1]];

    public static function configured(): bool
    {
        return AiClient::configured();
    }

    /** @return array{duration: float, tracks: list<array>, notes: string, dropped: list<string>, model: string} */
    public function plan(Project $project, string $prompt, ?string $sceneId = null): array
    {
        if (! self::configured()) {
            throw new RuntimeException('AI belum dikonfigurasi: isi AI_API_KEY (API key dari dashboard 9router) di backend/.env.');
        }

        $doc = DocumentMigrator::toV2($project->document);
        $scene = collect($doc['scenes'])->firstWhere('id', $sceneId) ?? $doc['scenes'][0];
        $layers = $this->layerContext($scene);
        if (count($layers) === 0) {
            throw new RuntimeException('Project belum punya layer untuk digerakkan. Tambahkan layer atau bone dulu.');
        }
        $ids = array_column($layers, 'id');

        $messages = [
            ['role' => 'system', 'content' => $this->systemPrompt()],
            ['role' => 'user', 'content' => json_encode([
                'request' => $prompt,
                'scene' => ['name' => $scene['name'], 'width' => $doc['settings']['width'], 'height' => $doc['settings']['height'], 'fps' => $doc['settings']['fps']],
                'layers' => $layers,
            ], JSON_UNESCAPED_UNICODE)],
        ];

        $lastError = null;
        for ($attempt = 0; $attempt < 2; $attempt++) {
            $content = (new AiClient)->chat($messages);
            try {
                return $this->sanitize(AiClient::extractJson($content), $layers, $ids) + ['model' => config('services.ai.model')];
            } catch (\InvalidArgumentException $e) {
                $lastError = $e->getMessage();
                // one corrective retry
                $messages[] = ['role' => 'assistant', 'content' => $content];
                $messages[] = ['role' => 'user', 'content' => 'Respons tidak valid ('.$lastError.'). Balas ULANG hanya dengan satu objek JSON sesuai skema, tanpa teks lain.'];
            }
        }

        throw new RuntimeException('Model tidak mengembalikan rencana gerak yang valid: '.$lastError);
    }

    private function systemPrompt(): string
    {
        $max = (int) self::MAX_DURATION;

        return <<<PROMPT
Kamu adalah animator untuk alat animasi 2D cutout berbasis rig. Ubah permintaan pengguna menjadi keyframe.
Balas HANYA dengan satu objek JSON (tanpa teks lain, tanpa code fence) dengan skema:
{"duration": <detik>, "notes": "<satu kalimat tentang gerakan>", "tracks": [{"layer": "<id layer persis dari daftar>", "prop": "rotation|x|y|scaleX|scaleY|opacity", "keys": [{"t": <detik dari 0>, "v": <angka>, "e": "linear|easeIn|easeOut|easeInOut|step"}]}]}
Aturan:
- Nilai v adalah nilai AKHIR ABSOLUT: rotation dalam derajat (positif = searah jarum jam), x/y dalam piksel scene (y bertambah ke bawah), scaleX/scaleY pengali (1 = normal), opacity 0..1.
- Gunakan hanya id layer dari daftar. Bone berputar di sendinya dan turunannya ikut (FK): gerakkan bone induk untuk gerak besar, bone anak untuk detail. Jangan beri track rotation pada layer ber-flag ik_locked; untuk menggerakkan anggota badan ber-IK, animasikan x/y layer targetnya (ik_target_of).
- Key pertama tiap track sebaiknya di t=0 sama dengan nilai saat ini. Untuk gerakan berulang, nilai key terakhir = key pertama.
- Easing e berlaku untuk segmen yang dimulai di key itu; utamakan easeInOut agar alami.
- Maksimum 40 track, 40 key per track, durasi 0.5 sampai {$max} detik.
PROMPT;
    }

    /** Compact, safe description of the rig for the model. */
    private function layerContext(array $doc): array
    {
        $ikLocked = [];
        $ikTargetOf = [];
        foreach ($doc['layers'] as $l) {
            if (! empty($l['ik']['target']) && ! empty($l['parentId'])) {
                $ikLocked[$l['id']] = true;
                $ikLocked[$l['parentId']] = true;
                $ikTargetOf[$l['ik']['target']] = $l['id'];
            }
        }
        $out = [];
        foreach (array_slice($doc['layers'], 0, 80) as $l) {
            $row = [
                'id' => $l['id'],
                'name' => $l['name'],
                'type' => $l['type'],
                'parent' => $l['parentId'] ?? null,
                'x' => $l['x'], 'y' => $l['y'], 'rotation' => $l['rotation'],
                'scaleX' => $l['scaleX'], 'scaleY' => $l['scaleY'], 'opacity' => $l['opacity'],
            ];
            if ($l['type'] === 'bone') {
                $row['length'] = $l['length'] ?? 100;
            }
            if (isset($ikLocked[$l['id']])) {
                $row['ik_locked'] = true;
            }
            if (isset($ikTargetOf[$l['id']])) {
                $row['ik_target_of'] = $ikTargetOf[$l['id']];
            }
            $out[] = $row;
        }

        return $out;
    }

    /** @return array{duration: float, tracks: list<array>, notes: string, dropped: list<string>} */
    private function sanitize(array $data, array $layers, array $ids): array
    {
        if (! isset($data['tracks']) || ! is_array($data['tracks']) || $data['tracks'] === []) {
            throw new \InvalidArgumentException('field "tracks" kosong atau hilang');
        }
        $byId = array_column($layers, null, 'id');
        $dropped = [];
        $tracks = [];

        foreach (array_slice($data['tracks'], 0, self::MAX_TRACKS) as $t) {
            $id = $t['layer'] ?? null;
            $prop = $t['prop'] ?? null;
            if (! is_string($id) || ! isset($byId[$id])) {
                $dropped[] = 'layer tidak dikenal: '.(is_string($id) ? $id : '?');

                continue;
            }
            if (! in_array($prop, self::PROPS, true)) {
                $dropped[] = "properti tidak valid untuk {$byId[$id]['name']}";

                continue;
            }
            if ($prop === 'rotation' && ! empty($byId[$id]['ik_locked'])) {
                $dropped[] = "rotasi {$byId[$id]['name']} dikendalikan IK (dilewati)";

                continue;
            }
            $keys = [];
            foreach (array_slice(is_array($t['keys'] ?? null) ? $t['keys'] : [], 0, self::MAX_KEYS) as $k) {
                if (! isset($k['t'], $k['v']) || ! is_numeric($k['t']) || ! is_numeric($k['v'])) {
                    continue;
                }
                [$lo, $hi] = self::RANGE[$prop];
                $keys[] = [
                    't' => round(max(0, min(self::MAX_DURATION, (float) $k['t'])), 3),
                    'v' => round(max($lo, min($hi, (float) $k['v'])), 3),
                    'e' => in_array($k['e'] ?? null, self::EASES, true) ? $k['e'] : 'easeInOut',
                ];
            }
            usort($keys, fn ($a, $b) => $a['t'] <=> $b['t']);
            $keys = array_values(array_reduce($keys, function ($acc, $k) { // one key per time
                $acc[(string) $k['t']] = $k;

                return $acc;
            }, []));
            if (count($keys) < 2) {
                $dropped[] = "track {$byId[$id]['name']}.$prop kurang dari 2 key";

                continue;
            }
            $tracks["$id|$prop"] = ['layer' => $id, 'name' => $byId[$id]['name'], 'prop' => $prop, 'keys' => $keys]; // last wins on duplicates
        }

        if ($tracks === []) {
            throw new \InvalidArgumentException('tidak ada track yang valid ('.implode('; ', $dropped).')');
        }
        $tracks = array_values($tracks);
        $maxT = max(array_map(fn ($t) => end($t['keys'])['t'], $tracks));
        $duration = is_numeric($data['duration'] ?? null) ? (float) $data['duration'] : $maxT;
        $duration = round(max(0.5, min(self::MAX_DURATION, max($duration, $maxT))), 3);

        return [
            'duration' => $duration,
            'tracks' => $tracks,
            'notes' => mb_substr(is_string($data['notes'] ?? null) ? $data['notes'] : '', 0, 300),
            'dropped' => $dropped,
        ];
    }
}
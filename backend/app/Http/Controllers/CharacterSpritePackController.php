<?php

namespace App\Http\Controllers;

use App\Models\Character;
use App\Models\CharacterSpritePack;
use App\Models\CharacterVersion;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\URL;
use Symfony\Component\HttpFoundation\StreamedResponse;

class CharacterSpritePackController extends Controller
{
    private const FRAME = 1024;
    private const MAX_CELLS = 256;

    public function index(Request $request, Character $character): JsonResponse
    {
        $this->own($request, $character);

        return response()->json(['data' => CharacterSpritePack::where('user_id', $request->user()->id)
            ->where('character_id', $character->id)->latest()->get()->map(fn ($pack) => $this->present($pack))]);
    }

    public function store(Request $request, Character $character): JsonResponse
    {
        $this->own($request, $character);
        $data = $request->validate([
            'file' => 'required|file|mimetypes:image/png|max:51200',
            'name' => 'nullable|string|max:120',
            'character_version' => 'nullable|integer|min:1',
            'columns' => 'required|integer|min:1|max:16',
            'rows' => 'required|integer|min:1|max:16',
            'fps' => 'nullable|integer|min:1|max:60',
            'facing' => 'required|in:front,right,left,back',
            'animation_name' => 'nullable|string|max:40|regex:/^[a-zA-Z0-9_-]+$/',
            'loop' => 'nullable|boolean',
            'manifest' => 'nullable|string|max:200000',
        ]);

        if (isset($data['character_version']) && ! CharacterVersion::where('character_id', $character->id)->where('number', $data['character_version'])->exists()) {
            return response()->json(['message' => 'Versi karakter yang dipilih tidak ditemukan.'], 422);
        }

        $file = $request->file('file');
        $image = @getimagesize($file->getRealPath());
        if (! $image || ($image['mime'] ?? null) !== 'image/png') {
            return response()->json(['message' => 'File harus PNG yang valid.'], 422);
        }
        $content = (string) file_get_contents($file->getRealPath());
        // PNG color type 6 is RGBA; transparent character atlases are required.
        if (strlen($content) < 26 || substr($content, 0, 8) !== "\\x89PNG\\r\\n\\x1a\\n" || ord($content[25]) !== 6) {
            return response()->json(['message' => 'Sprite sheet harus PNG RGBA dengan channel transparansi.'], 422);
        }

        [$width, $height] = [(int) $image[0], (int) $image[1]];
        $columns = (int) $data['columns'];
        $rows = (int) $data['rows'];
        if ($width !== $columns * self::FRAME || $height !== $rows * self::FRAME) {
            return response()->json(['message' => 'Ukuran atlas harus tepat sama dengan jumlah kolom/baris × 1024 px tanpa gutter atau margin.', 'errors' => ['file' => ['Ukuran atlas tidak cocok dengan grid 1024 × 1024.']]], 422);
        }
        if ($columns * $rows > self::MAX_CELLS) {
            return response()->json(['message' => 'Maksimal 256 frame per atlas page.'], 422);
        }

        $manifest = null;
        if (! empty($data['manifest'])) {
            $manifest = json_decode($data['manifest'], true);
            if (! is_array($manifest) || json_last_error() !== JSON_ERROR_NONE) {
                return response()->json(['message' => 'Manifest JSON tidak valid.'], 422);
            }
            if (isset($manifest['character']['id']) && (int) $manifest['character']['id'] !== (int) $character->id) {
                return response()->json(['message' => 'Character ID pada manifest tidak cocok dengan karakter yang sedang dibuka.'], 422);
            }
            if (isset($manifest['facing']) && $manifest['facing'] !== $data['facing']) {
                return response()->json(['message' => 'Arah pada manifest tidak cocok dengan pilihan import.'], 422);
            }
            $errors = $this->validateManifest($manifest, $width, $height, $columns, $rows);
            if ($errors !== []) {
                return response()->json(['message' => $errors[0], 'errors' => ['manifest' => $errors]], 422);
            }
        } else {
            $animation = $data['animation_name'] ?? 'idle';
            $frames = [];
            for ($row = 0; $row < $rows; $row++) {
                for ($col = 0; $col < $columns; $col++) {
                    $index = $row * $columns + $col;
                    $frames[] = ['id' => sprintf('%s_%04d', $animation, $index + 1), 'x' => $col * self::FRAME, 'y' => $row * self::FRAME, 'width' => self::FRAME, 'height' => self::FRAME];
                }
            }
            $manifest = [
                'format' => 'animasi2d.character-sprite-atlas',
                'format_version' => 1,
                'character' => ['id' => $character->id, 'name' => $character->name, 'version' => $data['character_version'] ?? $character->current_version],
                'frame' => ['width' => self::FRAME, 'height' => self::FRAME, 'pivot' => ['x' => 512, 'y' => 1024]],
                'atlas' => ['width' => $width, 'height' => $height, 'columns' => $columns, 'rows' => $rows],
                'facing' => $data['facing'],
                'animations' => [$animation => ['fps' => (int) ($data['fps'] ?? 12), 'loop' => (bool) ($data['loop'] ?? true), 'frames' => $frames]],
                'outfit' => ['id' => 'base', 'type' => 'base-character'],
                'verification' => 'unverified',
            ];
        }

        $sha = hash('sha256', $content);
        $existing = CharacterSpritePack::where('character_id', $character->id)->where('sha256', $sha)->first();
        if ($existing) {
            return response()->json(['data' => $this->present($existing), 'duplicate' => true], 200);
        }

        $path = 'character-sprite-packs/'.$character->id.'/'.$sha.'.png';
        Storage::disk('local')->put($path, $content);
        $pack = CharacterSpritePack::create([
            'user_id' => $request->user()->id,
            'character_id' => $character->id,
            'character_version' => $data['character_version'] ?? $character->current_version,
            'name' => ($data['name'] ?? '') ?: pathinfo($file->getClientOriginalName(), PATHINFO_FILENAME),
            'disk' => 'local',
            'path' => $path,
            'mime' => 'image/png',
            'image_width' => $width,
            'image_height' => $height,
            'frame_width' => self::FRAME,
            'frame_height' => self::FRAME,
            'columns' => $columns,
            'rows' => $rows,
            'frame_count' => array_sum(array_map(fn ($a) => count($a['frames'] ?? []), $manifest['animations'] ?? [])),
            'fps' => (int) ($data['fps'] ?? 12),
            'facing' => $data['facing'],
            'manifest' => $manifest,
            'sha256' => $sha,
            'status' => 'pending_review',
        ]);

        return response()->json(['data' => $this->present($pack)], 201);
    }

    public function file(CharacterSpritePack $pack): StreamedResponse
    {
        abort_unless(Storage::disk($pack->disk)->exists($pack->path), 404);

        return Storage::disk($pack->disk)->response($pack->path, basename($pack->path), [
            'Content-Type' => 'image/png',
            'Cache-Control' => 'private, max-age=3600',
        ], 'inline');
    }

    private function validateManifest(array $manifest, int $width, int $height, int $columns, int $rows): array
    {
        $errors = [];
        if (($manifest['format'] ?? null) !== 'animasi2d.character-sprite-atlas' || ($manifest['format_version'] ?? null) !== 1) {
            $errors[] = 'Format manifest harus animasi2d.character-sprite-atlas versi 1.';
        }
        $frameSpec = is_array($manifest['frame'] ?? null) ? $manifest['frame'] : [];
        $atlasSpec = is_array($manifest['atlas'] ?? null) ? $manifest['atlas'] : [];
        if (($frameSpec['width'] ?? null) !== self::FRAME || ($frameSpec['height'] ?? null) !== self::FRAME) {
            $errors[] = 'Ukuran frame pada manifest harus 1024 × 1024.';
        }
        if (($atlasSpec['width'] ?? null) !== $width || ($atlasSpec['height'] ?? null) !== $height
            || ($atlasSpec['columns'] ?? null) !== $columns || ($atlasSpec['rows'] ?? null) !== $rows) {
            $errors[] = 'Dimensi atlas pada manifest tidak cocok dengan gambar yang diunggah.';
        }
        $animations = $manifest['animations'] ?? null;
        if (! is_array($animations) || $animations === []) {
            $errors[] = 'Manifest harus memiliki minimal satu animasi.';
            return $errors;
        }
        $total = 0;
        $frameIds = [];
        foreach ($animations as $name => $animation) {
            if (! preg_match('/^[a-zA-Z0-9_-]{1,40}$/', (string) $name) || ! is_array($animation) || ! is_array($animation['frames'] ?? null) || $animation['frames'] === []) {
                $errors[] = "Definisi animasi $name tidak valid.";
                continue;
            }
            if (! is_numeric($animation['fps'] ?? null) || (int) $animation['fps'] < 1 || (int) $animation['fps'] > 60) {
                $errors[] = "FPS animasi $name harus 1–60.";
            }
            foreach ($animation['frames'] as $frame) {
                $total++;
                if (! is_array($frame) || ($frame['width'] ?? null) !== self::FRAME || ($frame['height'] ?? null) !== self::FRAME
                    || ! is_numeric($frame['x'] ?? null) || ! is_numeric($frame['y'] ?? null)
                    || (int) $frame['x'] < 0 || (int) $frame['y'] < 0
                    || (int) $frame['x'] + self::FRAME > $width || (int) $frame['y'] + self::FRAME > $height
                    || empty($frame['id'])) {
                    $errors[] = "Frame pada animasi $name berada di luar atlas atau tidak valid.";
                    break;
                }
                $frameId = (string) $frame['id'];
                if (isset($frameIds[$frameId])) $errors[] = "Frame ID duplikat: $frameId.";
                $frameIds[$frameId] = true;
            }
        }
        if ($total < 1 || $total > 4096) {
            $errors[] = 'Jumlah referensi frame manifest harus 1–4096.';
        }

        return $errors;
    }

    private function present(CharacterSpritePack $pack): array
    {
        return [
            'id' => $pack->id, 'name' => $pack->name, 'character_id' => $pack->character_id,
            'character_version' => $pack->character_version, 'image_width' => $pack->image_width, 'image_height' => $pack->image_height,
            'frame_width' => $pack->frame_width, 'frame_height' => $pack->frame_height,
            'columns' => $pack->columns, 'rows' => $pack->rows, 'frame_count' => $pack->frame_count,
            'fps' => $pack->fps, 'facing' => $pack->facing, 'status' => $pack->status,
            'sha256' => $pack->sha256, 'manifest' => $pack->manifest,
            'file_url' => URL::temporarySignedRoute('builder.sprite-packs.file', \App\Models\Asset::urlExpiry(), ['pack' => $pack->id], absolute: false),
            'created_at' => $pack->created_at,
        ];
    }

    private function own(Request $request, Character $character): void
    {
        abort_unless($character->user_id === $request->user()->id && $character->kind === 'builder', 404);
    }
}

<?php

namespace App\Services;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use RuntimeException;

/** Thin client for the OpenAI-compatible gateway (9router). The API key never leaves the server. */
class AiClient
{
    public static function configured(): bool
    {
        return (bool) config('services.ai.api_key');
    }

    /** Fast check (max 1.5s) to see if AI server is actually reachable */
    public static function isReachable(): bool
    {
        if (! self::configured()) {
            return false;
        }
        $url = config('services.ai.base_url');
        $parts = parse_url($url);
        $host = $parts['host'] ?? '127.0.0.1';
        $port = $parts['port'] ?? 80;
        $fp = @fsockopen($host, (int) $port, $errno, $errstr, 1.5);
        if ($fp) {
            fclose($fp);
            return true;
        }

        return false;
    }

    /**
     * @param  list<array>  $messages  OpenAI-style messages (content may contain image_url parts)
     *
     * @throws RuntimeException with a user-facing (key-free) message
     */
    public function chat(array $messages, float $temperature = 0.3): string
    {
        if (! self::configured()) {
            throw new RuntimeException('AI belum dikonfigurasi: isi AI_API_KEY (API key dari dashboard 9router) di backend/.env.');
        }
        try {
            $res = Http::withToken((string) config('services.ai.api_key'))
                ->acceptJson()
                ->timeout((int) config('services.ai.timeout'))
                ->post(config('services.ai.base_url').'/chat/completions', [
                    'model' => config('services.ai.model'),
                    'messages' => $messages,
                    'temperature' => $temperature,
                    'stream' => false,
                ]);
        } catch (ConnectionException) {
            throw new RuntimeException('Tidak dapat terhubung ke 9router di '.config('services.ai.base_url').'. Pastikan 9router sedang berjalan.');
        }

        if ($res->status() === 401 || $res->status() === 403) {
            throw new RuntimeException('API key 9router ditolak. Periksa AI_API_KEY di backend/.env.');
        }
        if ($res->failed()) {
            $msg = $res->json('error.message') ?? ('HTTP '.$res->status());
            throw new RuntimeException('9router/model mengembalikan error: '.mb_substr((string) $msg, 0, 300));
        }

        $content = $res->json('choices.0.message.content');
        if (is_array($content)) { // content-part arrays
            $content = implode('', array_map(fn ($p) => is_array($p) ? ($p['text'] ?? '') : (string) $p, $content));
        }
        if (! is_string($content) || trim($content) === '') {
            throw new RuntimeException('Model mengembalikan respons kosong.');
        }

        return $content;
    }

    /** @throws \InvalidArgumentException when no JSON object can be read */
    public static function extractJson(string $text): array
    {
        $text = trim($text);
        $text = preg_replace('/^```(?:json)?\s*|\s*```$/i', '', $text);
        $start = strpos($text, '{');
        $end = strrpos($text, '}');
        if ($start === false || $end === false || $end <= $start) {
            throw new \InvalidArgumentException('tidak ada objek JSON');
        }
        $data = json_decode(substr($text, $start, $end - $start + 1), true);
        if (! is_array($data)) {
            throw new \InvalidArgumentException('JSON tidak dapat dibaca');
        }

        return $data;
    }
}
<?php

namespace App\Services\CardBuilder;

use Symfony\Component\Process\Process;

/**
 * Runs tools/card_builder (Python) through its JSON facade: `python -m card_builder api <op>` reads {"root", ...args} on stdin and answers
 * {"ok": true, "data": ...} or {"ok": false, "error": "message for the user"}. Arguments are an array (no shell), the folder root is fixed here,
 * and every slug is validated again inside the tool.
 */
class CardBuilderRunner
{
    /** The karakter/ folder every operation works in. */
    public function root(): string
    {
        return rtrim((string) (config('services.card_builder.root') ?: base_path('..'.DIRECTORY_SEPARATOR.'karakter')), '\\/');
    }

    public function toolsDir(): string
    {
        return base_path('..'.DIRECTORY_SEPARATOR.'tools');
    }

    /**
     * @return array the "data" of a successful answer
     *
     * @throws CardBuilderException user-facing when the tool refused the request, otherwise a server problem (tool missing, crashed, bad output)
     */
    public function run(string $op, array $args = []): array
    {
        if (! preg_match('/^[a-z_]+$/', $op)) {
            throw new CardBuilderException('Operasi tidak valid.');
        }
        $process = new Process(
            [(string) config('services.card_builder.python'), '-m', 'card_builder', 'api', $op],
            $this->toolsDir(),
            ['PYTHONIOENCODING' => 'utf-8', 'PYTHONUTF8' => '1'],
            json_encode(['root' => $this->root()] + $args, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            (float) config('services.card_builder.timeout', 240),
        );
        try {
            $process->run();
        } catch (\Throwable $e) {
            throw new CardBuilderException('Alat card_builder tidak bisa dijalankan: '.$e->getMessage(), false);
        }
        $answer = json_decode($process->getOutput(), true);
        if (! $process->isSuccessful() || ! is_array($answer) || ! array_key_exists('ok', $answer)) {
            $why = trim($process->getErrorOutput()) ?: trim($process->getOutput());
            throw new CardBuilderException('Alat card_builder gagal ('.$process->getExitCode().'): '.mb_substr($why, -400).' Pastikan Python, Pillow, dan numpy terpasang (tools/card_builder/requirements.txt).', false);
        }
        if (! $answer['ok']) {
            throw new CardBuilderException((string) ($answer['error'] ?? 'Permintaan ditolak.'));
        }

        return (array) ($answer['data'] ?? []);
    }
}

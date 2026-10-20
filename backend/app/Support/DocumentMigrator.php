<?php

namespace App\Support;

/**
 * Project document versions.
 *  schema 1: {settings:{width,height,fps,duration,background}, layers:[...]}              (single scene)
 *  schema 2: {settings:{width,height,fps}, scenes:[{id,name,duration,background,transition,layers}], audio:[...]}
 */
class DocumentMigrator
{
    public static function blank(): array
    {
        return [
            'schema' => 2,
            'settings' => ['width' => 1280, 'height' => 720, 'fps' => 24],
            'scenes' => [self::scene('scene1', 'Scene 1')],
            'audio' => [],
        ];
    }

    public static function scene(string $id, string $name, float $duration = 5, string $background = '#ffffff', array $layers = []): array
    {
        return ['id' => $id, 'name' => $name, 'duration' => $duration, 'background' => $background, 'transition' => null, 'layers' => $layers];
    }

    public static function toV2(array $doc): array
    {
        if (isset($doc['scenes']) && is_array($doc['scenes'])) {
            $doc['audio'] = is_array($doc['audio'] ?? null) ? $doc['audio'] : [];
            $doc['schema'] = 2;

            return $doc;
        }
        $s = is_array($doc['settings'] ?? null) ? $doc['settings'] : [];

        return [
            'schema' => 2,
            'settings' => ['width' => $s['width'] ?? 1280, 'height' => $s['height'] ?? 720, 'fps' => $s['fps'] ?? 24],
            'scenes' => [self::scene('scene1', 'Scene 1', (float) ($s['duration'] ?? 5), $s['background'] ?? '#ffffff', array_values($doc['layers'] ?? []))],
            'audio' => [],
        ];
    }

    /** True when a request body is a (valid-looking) schema 1 document that should be converted before validation. */
    public static function isV1(mixed $doc): bool
    {
        return is_array($doc) && ! isset($doc['scenes']) && is_array($doc['settings'] ?? null) && is_array($doc['layers'] ?? null);
    }
}
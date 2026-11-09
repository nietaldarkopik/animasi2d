<?php

namespace App\Services\Library;

use RuntimeException;

/**
 * The design standard of one character family / art-style preset (resources/design/<id>.json): the master canvas, the named landmarks,
 * and for every slot (category of body part) its anchor, maximum width and, per view, the region its art may occupy and its size range.
 * The regions and size ranges were measured from the approved library, so "valid" means "fits in with what is already approved".
 */
class DesignTemplate
{
    public const DEFAULT = 'anime-v1';

    /** @var array<string, array> */
    private static array $cache = [];

    public function __construct(public readonly array $data) {}

    public static function load(string $id = self::DEFAULT): self
    {
        if (! preg_match('/^[a-z0-9_-]+$/', $id)) {
            throw new RuntimeException("Template tidak dikenal: $id");
        }
        $path = resource_path("design/$id.json");
        if (! isset(self::$cache[$id])) {
            if (! is_file($path)) {
                throw new RuntimeException("Template tidak dikenal: $id");
            }
            self::$cache[$id] = json_decode((string) file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);
        }

        return new self(self::$cache[$id]);
    }

    public static function exists(string $id): bool
    {
        return (bool) preg_match('/^[a-z0-9_-]+$/', $id) && is_file(resource_path("design/$id.json"));
    }

    public function id(): string
    {
        return $this->data['id'];
    }

    public function canvasWidth(): int
    {
        return (int) $this->data['canvas']['width'];
    }

    public function canvasHeight(): int
    {
        return (int) $this->data['canvas']['height'];
    }

    public function hasSlot(string $slot): bool
    {
        return isset($this->data['slots'][$slot]);
    }

    /** @return array{x: int, y: int} */
    public function anchor(string $slot): array
    {
        return $this->data['slots'][$slot]['anchor'];
    }

    /** @return array{region: array<int>, w: ?array<int>, h: ?array<int>}|null null = nothing measured for this slot/view */
    public function view(string $slot, string $view): ?array
    {
        return $this->data['slots'][$slot]['views'][$view] ?? null;
    }

    /**
     * The anchor positions a part of `family` is expected to have: its family's (measured from at least two approved parts), else - for the
     * slots fixed by the head - the library-wide ones, else nothing (no comparison is meaningful).
     *
     * @return array<string, array{x: float, y: float}>
     */
    public function expectedAnchors(string $slot, string $view, ?string $family): array
    {
        $v = $this->view($slot, $view);
        if (! $v) {
            return [];
        }
        // 'general' and 'legacy' mix unrelated designs (trousers with skirts, hoodies with shirts): their median says nothing about any one part
        if ($family && ! in_array($family, ['general', 'legacy'], true) && isset($v['families'][$family]['anchors'])) {
            return $v['families'][$family]['anchors'];
        }

        return in_array($slot, AnchorExtractor::GLOBAL, true) ? ($v['anchors'] ?? []) : [];
    }

    /** the views this template has measured examples for (a part may still be declared for fewer) */
    public function viewsOf(string $slot): array
    {
        return array_keys($this->data['slots'][$slot]['views'] ?? []);
    }

    public function landmark(string $name): mixed
    {
        return $this->data['landmarks'][$name] ?? null;
    }
}

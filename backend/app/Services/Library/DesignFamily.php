<?php

namespace App\Services\Library;

/**
 * Design families: groups of parts that were drawn together on the same body geometry (the male sheet, the female sheet, each body kit,
 * the first sheet, generic parts). Positions that vary BY DESIGN (the collar of a shirt, the neck of a face, the waist of a skirt) are only
 * comparable inside a family, and parts of different families do not necessarily fit one another.
 */
class DesignFamily
{
    public const GENERAL = 'general';

    /** all families; `compatible` lists the families a part may be combined with without a warning */
    public const FAMILIES = [
        'male' => ['label' => 'Laki-laki (lembar v2)', 'compatible' => ['male', 'kit-l1', 'general', 'legacy']],
        'female' => ['label' => 'Perempuan (lembar v2)', 'compatible' => ['female', 'kit-p', 'kit-p2', 'kit-p3', 'general', 'legacy']],
        'kit-l1' => ['label' => 'Kit SMA L1 (laki-laki)', 'compatible' => ['male', 'kit-l1', 'general', 'legacy']],
        'kit-p' => ['label' => 'Kit SMA P (perempuan)', 'compatible' => ['female', 'kit-p', 'kit-p2', 'kit-p3', 'general', 'legacy']],
        'kit-p2' => ['label' => 'Kit SMA P2 (perempuan, rok panjang)', 'compatible' => ['female', 'kit-p', 'kit-p2', 'kit-p3', 'general', 'legacy']],
        'kit-p3' => ['label' => 'Kit SMA P3 (perempuan, rok pendek)', 'compatible' => ['female', 'kit-p', 'kit-p2', 'kit-p3', 'general', 'legacy']],
        'legacy' => ['label' => 'Lembar pertama', 'compatible' => ['male', 'female', 'kit-l1', 'kit-p', 'kit-p2', 'kit-p3', 'general', 'legacy']],
        'general' => ['label' => 'Umum', 'compatible' => ['male', 'female', 'kit-l1', 'kit-p', 'kit-p2', 'kit-p3', 'general', 'legacy']],
    ];

    /** Families of parts rendered from a VRM avatar are made up as avatars are imported: `vrm-<avatar>`. */
    public static function isVrm(string $family): bool
    {
        return (bool) preg_match('/^vrm-[a-z0-9-]+$/', $family);
    }

    public static function valid(string $family): bool
    {
        return isset(self::FAMILIES[$family]) || self::isVrm($family);
    }

    /** Label and compatibility of any family, including the VRM ones: those fit their own avatar (and generic parts) only: a 3D render does not mix with hand-drawn art. */
    public static function describe(string $family): array
    {
        if (self::isVrm($family)) {
            return ['label' => 'VRM: '.substr($family, 4), 'compatible' => [$family, 'general']];
        }

        return self::FAMILIES[$family] ?? ['label' => $family, 'compatible' => [$family]];
    }

    /** Every family in use: the fixed ones and the VRM avatars imported so far. */
    public static function all(): array
    {
        $out = self::FAMILIES;
        $vrm = \App\Models\LibraryAsset::whereNull('archived_at')->where('meta->family', 'like', 'vrm-%')->get()->map(fn ($a) => $a->meta['family'])->unique();
        foreach ($vrm as $f) {
            $out[$f] = self::describe($f);
        }
        // generic parts fit every VRM avatar too
        foreach ($vrm as $f) {
            $out['general']['compatible'][] = $f;
        }

        return $out;
    }

    /** Best guess from what the library knows about a part: its name, and whether it is one of the seeded vector parts (key). */
    public static function infer(string $name, ?string $key = null): string
    {
        $n = mb_strtolower($name);
        if (preg_match('/kit sma l1/', $n)) {
            return 'kit-l1';
        }
        if (preg_match('/kit sma p3/', $n)) {
            return 'kit-p3';
        }
        if (preg_match('/kit sma p2/', $n)) {
            return 'kit-p2';
        }
        if (preg_match('/kit sma p\b/', $n)) {
            return 'kit-p';
        }
        if (str_contains($n, 'laki-laki')) {
            return 'male';
        }
        if (str_contains($n, 'perempuan')) {
            return 'female';
        }
        if ($key === null && preg_match('/^(wajah|mata|alis|mulut|rambut depan|rambut belakang) \d+$|^(kerudung|hoodie|jaket|kemeja smk|rok plisa biru|seragam smk)\b/', $n)) {
            return 'legacy';
        }

        return self::GENERAL;
    }

    /** Whether two families may be combined in one character without a warning. */
    public static function compatible(string $a, string $b): bool
    {
        return in_array($b, self::describe($a)['compatible'], true) && in_array($a, self::describe($b)['compatible'], true) || ($a === 'general' && self::isVrm($b)) || ($b === 'general' && self::isVrm($a));
    }
}

<?php

namespace App\Services\Library;

/**
 * Finds the named attachment points of a body part from its own artwork (canvas units, the part drawn on the standard canvas):
 * where the neck of a face is, where the two eyes are, where a sleeve starts at the shoulder, the ankle of a shoe...
 * The same names are measured on every approved part to build the template's expected positions, so a new part can be compared
 * with them (AssetValidator) and shifted onto them when it is picked (the Builder, `align`).
 */
class AnchorExtractor
{
    /** slot => the anchors its art has, in the order they are listed */
    public const ANCHORS = [
        'face' => ['head.neck_anchor', 'head.top_anchor'],
        'hair_front' => ['head.top_anchor', 'part.center'],
        'hair_back' => ['head.top_anchor', 'part.center'],
        'hijab' => ['head.top_anchor', 'part.center'],
        'eyes' => ['face.left_eye_anchor', 'face.right_eye_anchor'],
        'brows' => ['face.left_brow_anchor', 'face.right_brow_anchor'],
        'mouth' => ['face.mouth_anchor'],
        'glasses' => ['face.glasses_anchor'],
        'hat' => ['head.top_anchor', 'part.center'],
        'headphone' => ['head.top_anchor', 'part.center'],
        'top' => ['torso.neck_anchor', 'torso.waist_anchor'],
        'torso' => ['torso.neck_anchor', 'torso.waist_anchor'],
        'body' => ['torso.neck_anchor', 'foot.ground_anchor'],
        'bottom' => ['torso.waist_anchor', 'leg.ankle_anchor'],
        'shoes' => ['foot.ankle_anchor', 'foot.ground_anchor'],
        'arm_l' => ['arm.shoulder_anchor', 'arm.hand_anchor'],
        'arm_r' => ['arm.shoulder_anchor', 'arm.hand_anchor'],
        'bag' => ['part.center'],
        'accessory' => ['part.center'],
    ];

    /** Garments and shoes are only aligned UP/DOWN: how far a collar or waistband sits is a design fact, but the left/right centre of a top edge is not. */
    public const VERTICAL_ONLY = ['top', 'bottom', 'shoes'];

    /** Slots whose anchors are the same for every design (fixed by the head): the library-wide median is a fair expectation for them. */
    public const GLOBAL = ['face', 'eyes', 'brows', 'mouth', 'glasses'];

    /**
     * The anchors compared with the template and used to shift a freshly picked part onto it. The face parts (top of the head, eyes, brows,
     * mouth, glasses) are fixed by the head and measured to within a few units across the whole library. The collar of a top, the waist of a
     * bottom and the ankle of a shoe vary BY DESIGN (a kit shirt starts at y 191, a sheet shirt at 306), so they are only compared with parts
     * of the same design family (DesignFamily), and only when the family has at least two measured examples. What varies for other reasons
     * (the neck of a face depends on the chin, hair on its volume, an arm on its pose) is never forced onto one number.
     */
    public const ALIGN_BY = [
        'top' => ['torso.neck_anchor'],
        'bottom' => ['torso.waist_anchor'],
        'shoes' => ['foot.ankle_anchor'],
        'face' => ['head.top_anchor'],
        'eyes' => ['face.left_eye_anchor', 'face.right_eye_anchor'],
        'brows' => ['face.left_brow_anchor', 'face.right_brow_anchor'],
        'mouth' => ['face.mouth_anchor'],
        'glasses' => ['face.glasses_anchor'],
    ];

    /**
     * @return array<string, array{x: float, y: float}> anchor name => canvas units; empty when the image has no visible pixels or no anchors for the slot
     */
    public static function extract(string $png, string $slot): array
    {
        $names = self::ANCHORS[$slot] ?? null;
        $im = $names ? @imagecreatefromstring($png) : false;
        if ($im === false) {
            return [];
        }
        $w = imagesx($im);
        $h = imagesy($im);
        $k = $w / SlotTemplate::W; // pixels per unit
        $pts = []; // visible pixels (x, y in pixels, sampled every 2nd pixel)
        for ($y = 0; $y < $h; $y += 2) {
            for ($x = 0; $x < $w; $x += 2) {
                if (((imagecolorat($im, $x, $y) >> 24) & 0x7F) < 100) {
                    $pts[] = [$x, $y];
                }
            }
        }
        if (! $pts) {
            return [];
        }
        $y0 = min(array_column($pts, 1));
        $y1 = max(array_column($pts, 1));
        $x0 = min(array_column($pts, 0));
        $x1 = max(array_column($pts, 0));
        $band = max(4, (int) round(6 * $k)); // the rows within 6 units of an edge are "the top" / "the bottom"
        $meanX = fn (array $p) => array_sum(array_column($p, 0)) / max(1, count($p));
        $meanY = fn (array $p) => array_sum(array_column($p, 1)) / max(1, count($p));
        $topRows = array_values(array_filter($pts, fn ($p) => $p[1] <= $y0 + $band));
        $bottomRows = array_values(array_filter($pts, fn ($p) => $p[1] >= $y1 - $band));
        $mid = ($x0 + $x1) / 2;
        $left = array_values(array_filter($pts, fn ($p) => $p[0] < $mid));
        $right = array_values(array_filter($pts, fn ($p) => $p[0] >= $mid));
        $u = fn (float $px, float $py) => ['x' => round($px / $k, 1), 'y' => round($py / $k, 1)];

        $all = [
            'head.top_anchor' => $u($meanX($topRows), $y0),
            'head.neck_anchor' => $u($meanX($bottomRows), $y1),
            'part.center' => $u($meanX($pts), $meanY($pts)),
            'face.left_eye_anchor' => $left ? $u($meanX($left), $meanY($left)) : null,
            'face.right_eye_anchor' => $right ? $u($meanX($right), $meanY($right)) : null,
            'face.left_brow_anchor' => $left ? $u($meanX($left), $meanY($left)) : null,
            'face.right_brow_anchor' => $right ? $u($meanX($right), $meanY($right)) : null,
            'face.mouth_anchor' => $u($meanX($pts), $meanY($pts)),
            'face.glasses_anchor' => $u($meanX($pts), $meanY($pts)),
            'torso.neck_anchor' => $u($meanX($topRows), $y0),
            'torso.waist_anchor' => in_array($slot, ['bottom'], true) ? $u($meanX($topRows), $y0) : $u($meanX($bottomRows), $y1),
            'leg.ankle_anchor' => $u($meanX($bottomRows), $y1),
            'foot.ankle_anchor' => $u($meanX($topRows), $y0),
            'foot.ground_anchor' => $u($meanX($bottomRows), $y1),
            'arm.shoulder_anchor' => $u($meanX($topRows), $y0),
            'arm.hand_anchor' => $u($meanX($bottomRows), $y1),
        ];

        return array_filter(array_intersect_key($all, array_flip($names)));
    }

    /**
     * How far (canvas units) the part has to move so its alignment anchors land on the template's; null when the slot is not aligned, an
     * anchor is missing, or the move is not worth it (< 2 units). Limited to ±30 so a wrongly measured part never throws a piece across the figure.
     *
     * @param  array<string, array{x: float, y: float}>  $anchors  the part's own
     * @param  array<string, array{x: float, y: float}>  $expected  the template's for this slot and view
     * @return array{dx: float, dy: float}|null
     */
    public static function alignment(string $slot, array $anchors, array $expected): ?array
    {
        $by = self::ALIGN_BY[$slot] ?? null;
        if (! $by) {
            return null;
        }
        $dx = $dy = 0.0;
        foreach ($by as $name) {
            if (! isset($anchors[$name], $expected[$name])) {
                return null;
            }
            $dx += $expected[$name]['x'] - $anchors[$name]['x'];
            $dy += $expected[$name]['y'] - $anchors[$name]['y'];
        }
        if (in_array($slot, self::VERTICAL_ONLY, true)) {
            $dx = 0.0;
        }
        $dx = (float) max(-30, min(30, round($dx / count($by), 1)));
        $dy = (float) max(-30, min(30, round($dy / count($by), 1)));

        return abs($dx) < 2 && abs($dy) < 2 ? null : ['dx' => $dx, 'dy' => $dy];
    }
}

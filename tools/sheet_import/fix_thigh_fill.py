#!/usr/bin/env python3
"""Recolour the flat pink "filler" of kit legs to skin tone.

The kit bodies ("kaki & leher", kit thigh pieces) were cut from a turnaround where the upper thighs hide under the kit's own skirt, so
that part was filled in automatically with a flat pink. When a character wears another (shorter) skirt, or the body is moved/scaled,
the filler shows as pink boxes. Here each column's pink run is repainted with the skin pixel just below it, which keeps the shading
at the edges and makes the thigh look like a thigh.

usage: fix_thigh_fill.py file.png [file.png ...]   (files are rewritten in place; prints how many pixels changed)
"""
import sys

from PIL import Image


def is_pink(p) -> bool:
    r, g, b, a = p
    return a > 40 and r > 215 and g < 200 and b < 205 and r - g > 38


def fix(path: str) -> int:
    im = Image.open(path).convert('RGBA')
    px = im.load()
    w, h = im.size
    # 1) where the filler ends: the row where the pink run of a column turns into skin (median over the columns that have a filler)
    ends = []
    for x in range(w):
        y = 0
        while y < h and px[x, y][3] < 40:
            y += 1
        top = y
        while y < h and is_pink(px[x, y]):
            y += 1
        if y - top >= 30 and y < h and px[x, y][3] > 200:
            ends.append(y)
    if not ends:
        return 0
    ends.sort()
    limit = ends[len(ends) // 2] + 4  # nothing below the filler (the knee blush is pinkish too) is touched
    # 2) every pinkish pixel above that row takes the skin colour found further down the same column
    changed = 0
    for x in range(w):
        yy = limit + 4
        while yy < h - 1 and (is_pink(px[x, yy]) or px[x, yy][3] < 200) and yy - limit < 200:
            yy += 1
        src = px[x, min(yy, h - 1)]
        if is_pink(src) or src[3] < 200:
            continue
        for y in range(0, limit):
            r, g, b, a = px[x, y]
            if a > 40 and is_pink((r, g, b, a)):
                px[x, y] = (src[0], src[1], src[2], a)
                changed += 1
    if changed:
        im.save(path)
    return changed


if __name__ == '__main__':
    for f in sys.argv[1:]:
        print(f'{fix(f):7d}  {f}')

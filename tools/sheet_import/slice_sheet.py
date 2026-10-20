#!/usr/bin/env python3
"""Slice a 'Rakit Karaktermu' style asset sheet into canvas-aligned, AI-upscaled PNG parts for the Character Builder.

    python slice_sheet.py SHEET.png OUT_DIR [--no-upscale] [--only face,mouth]

Panel rectangles below are for the 1536x1024 reference sheet; they are scaled to the sheet you pass (so a higher
resolution sheet with the same layout works unchanged). Every item is:
  1. cut out of its grid cell (tile colour removed -> transparency),
  2. upscaled x4 with the local Real-ESRGAN model (worker/imagetool.py op 'upscale_ai'),
  3. placed on a transparent 800x1600 canvas (= the builder's 400x800 canvas at 2px/unit) at the slot's anchor,
so it lines up with the other parts without manual positioning (fine-tune with the sliders in the builder).

Writes OUT_DIR/items/<key>.png and OUT_DIR/manifest.json (consumed by `php artisan library:import-sheet`).
Items that cannot work on a front-facing character (side-view shoes, backpack/watch/clip crops) are skipped on purpose.
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile
from collections import Counter

from PIL import Image, ImageChops, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
IMAGETOOL = os.path.join(ROOT, "worker", "imagetool.py")
ESRGAN = os.path.join(ROOT, "tools", "realesrgan", "realesrgan-ncnn-vulkan" + (".exe" if os.name == "nt" else ""))

REF = (1536, 1024)
HEADER = 34
PANELS = {  # slug: (x0, y0, x1, y1, cols, rows)
    "hair_front": (18, 125, 313, 360, 4, 2), "hair_back": (323, 125, 634, 362, 4, 2), "face": (648, 125, 963, 362, 4, 2),
    "eyes": (977, 125, 1263, 362, 4, 3), "brows": (1277, 125, 1518, 362, 4, 3), "mouth": (20, 380, 263, 642, 3, 3),
    "top": (276, 380, 597, 642, 3, 2), "jacket": (610, 380, 886, 642, 3, 2), "pants": (901, 380, 1087, 642, 2, 2),
    "skirt": (1101, 380, 1288, 642, 2, 2), "hijab": (1299, 380, 1517, 642, 3, 2), "accessory": (20, 661, 313, 962, 4, 2),
}
CANVAS_PX = 2  # pixels per builder unit

# placement per kind: (category, anchor 'top'|'center', y, width, extra)
SPEC = {
    "hair_front": ("hair_front", "top", 72, 192), "hair_back": ("hair_back", "top", 84, 214), "face": ("face", "top", 98, 182),
    "mouth": ("mouth", "center", 250, 46), "top": ("top", "top", 312, 246), "jacket": ("top", "top", 306, 268),
    "pants": ("bottom", "box", 546, 170), "skirt": ("bottom", "top", 546, 190), "hijab": ("hijab", "top", 74, 262),
    "glasses": ("glasses", "center", 196, 172), "hat": ("hat", "top", 50, 196), "headphone": ("headphone", "center", 200, 212),
}
EYE = {"y": 196, "dx": 35, "w": 50}
BROW = {"y": 166, "dx": 35, "w": 54}

NAMES = {
    "hair_front": [f"Rambut depan {i}" for i in range(1, 9)], "hair_back": [f"Rambut belakang {i}" for i in range(1, 9)],
    "face": [f"Wajah {i}" for i in range(1, 9)], "mouth": [f"Mulut {i}" for i in range(1, 10)],
    "top": ["Kemeja SMK lengan pendek", "Kemeja SMK + dasi", "Kemeja SMK saku", "Kemeja SMK + dasi 2", "Kemeja SMK kerah", "Kemeja SMK lengan panjang"],
    "jacket": ["Hoodie biru", "Hoodie hitam", "Jaket abu", "Jaket zip biru", "Jaket hitam oranye", "Jaket varsity"],
    "pants": ["Celana jeans", "Celana cargo", "Celana chino", "Celana pendek"], "skirt": ["Rok plisa biru 1", "Rok plisa biru 2", "Rok plisa biru 3", "Rok kotak-kotak"],
    "hijab": ["Kerudung putih", "Kerudung navy", "Kerudung hitam", "Kerudung abu", "Kerudung pink", "Kerudung ungu-abu"],
}


def dist(a, b):
    return max(abs(a[0] - b[0]), abs(a[1] - b[1]), abs(a[2] - b[2]))


def mode_color(img):
    return Counter(img.get_flattened_data() if hasattr(img, "get_flattened_data") else img.getdata()).most_common(1)[0][0]


def ring_color(t, w=3):
    """Most common colour along ALL four borders (an item that touches one edge cannot dominate the ring)."""
    strips = [t.crop((0, 0, t.width, w)), t.crop((0, t.height - w, t.width, t.height)), t.crop((0, 0, w, t.height)), t.crop((t.width - w, 0, t.width, t.height))]
    c = Counter()
    for st in strips:
        c.update(st.get_flattened_data() if hasattr(st, "get_flattened_data") else st.getdata())
    return c.most_common(1)[0][0]


def keep_main(a, min_frac=0.06):
    """Drop small detached specks (leftovers of neighbouring tiles) from an alpha mask; keep every component that is
    at least min_frac of the largest one."""
    m = a.point(lambda v: 255 if v > 60 else 0)
    comps, work = [], m.copy()
    w, h = m.size
    wp = work.load()
    for y in range(h):
        for x in range(w):
            if wp[x, y] == 255:
                ImageDraw.floodfill(work, (x, y), 128)
                comp = work.point(lambda v: 255 if v == 128 else 0)
                work = ImageChops.subtract(work, comp.point(lambda v: 128 if v else 0))
                work = work.point(lambda v: 0 if v == 128 else v)
                wp = work.load()
                comps.append((sum(i * c for i, c in enumerate(comp.histogram())) / 255, comp))
    if not comps:
        return a
    biggest = max(c[0] for c in comps)
    keep = Image.new("L", a.size, 0)
    for area, comp in comps:
        if area >= biggest * min_frac:
            keep = ImageChops.lighter(keep, comp)
    return ImageChops.multiply(a, keep.filter(ImageFilter.MaxFilter(5)).point(lambda v: 255 if v else 0))


def cut_item(cell, thresh=34, despeckle=True):
    """Remove the tile colour: flood from every border pixel that looks like the tile -> transparent."""
    inset = max(3, round(min(cell.size) * 0.05))
    t = cell.crop((inset, inset, cell.width - inset, cell.height - inset)).convert("RGB")
    bgc = ring_color(t)
    work = t.copy()
    MARK = (255, 0, 255)
    border = [(x, 0) for x in range(t.width)] + [(x, t.height - 1) for x in range(t.width)] + [(0, y) for y in range(t.height)] + [(t.width - 1, y) for y in range(t.height)]
    for seed in border:
        if work.getpixel(seed) != MARK and dist(work.getpixel(seed), bgc) <= thresh:
            ImageDraw.floodfill(work, seed, MARK, thresh=thresh)
    wp = work.load()
    a = Image.new("L", t.size, 255)
    ap = a.load()
    for y in range(t.height):
        for x in range(t.width):
            if wp[x, y] == MARK:
                ap[x, y] = 0
    # background trapped INSIDE the item (headphone band, hood opening): only pixels that equal the tile colour almost exactly,
    # so white shirts (slightly different white) are never eaten
    near = Image.new("L", t.size, 0)
    npx, tp = near.load(), t.load()
    for y in range(t.height):
        for x in range(t.width):
            if ap[x, y] and dist(tp[x, y], bgc) <= 5:
                npx[x, y] = 255
    for y in range(t.height):
        for x in range(t.width):
            if npx[x, y] == 255:
                tmp = near.copy()
                ImageDraw.floodfill(tmp, (x, y), 128)
                comp = tmp.point(lambda v: 255 if v == 128 else 0)
                near = ImageChops.subtract(near, comp)
                area = sum(i * c for i, c in enumerate(comp.histogram())) / 255
                if 30 <= area <= 0.15 * t.width * t.height:
                    for yy in range(t.height):
                        for xx in range(t.width):
                            if comp.getpixel((xx, yy)):
                                ap[xx, yy] = 0
    a = a.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(0.6))  # opening: drops specks and 1px halo
    if despeckle:
        a = keep_main(a)
    out = t.convert("RGBA")
    out.putalpha(a)
    box = a.point(lambda v: 255 if v > 60 else 0).getbbox()
    return out.crop(box) if box else out


def punch_face_hole(item):
    """The sheet shows each hijab on a plain 'mannequin' head. Make that oval transparent so a face can show through:
    flood from the middle of the opening (similar colour only) and accept it only if it has a plausible size."""
    rgb = item.convert("RGB")
    seed = (round(item.width * 0.5), round(item.height * 0.40))
    work = rgb.copy()
    MARK = (255, 0, 255)
    ImageDraw.floodfill(work, seed, MARK, thresh=26)
    mask = Image.new("L", item.size, 0)
    wp, mp = work.load(), mask.load()
    for y in range(item.height):
        for x in range(item.width):
            if wp[x, y] == MARK:
                mp[x, y] = 255
    area = sum(i * c for i, c in enumerate(mask.histogram())) / 255 / (item.width * item.height)
    if not 0.05 <= area <= 0.40:
        print("   ! face opening not detected (area %.2f); left as is" % area)
        return item, None
    mask = mask.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(0.8))  # grow 1px: remove the grey rim, soften
    out = item.copy()
    out.putalpha(ImageChops.multiply(item.getchannel("A"), ImageChops.invert(mask)))
    return out, mask.point(lambda v: 255 if v > 128 else 0).getbbox()


def upscale(img, enabled):
    if not enabled:
        return img.resize((img.width * 4, img.height * 4), Image.LANCZOS)
    with tempfile.TemporaryDirectory() as td:
        src, dst = os.path.join(td, "in.png"), os.path.join(td, "out.png")
        img.save(src)
        ops = [{"op": "upscale_ai", "factor": 4, "bin": ESRGAN, "model": "realesrgan-x4plus-anime"}]
        r = subprocess.run([sys.executable, "-I", IMAGETOOL, "--in", src, "--out", dst, "--ops", json.dumps(ops)], capture_output=True, text=True, timeout=600)
        if r.returncode != 0:
            raise SystemExit("upscale failed: " + r.stdout + r.stderr)
        out = Image.open(dst)
        out.load()
        return out


def place(canvas, item, anchor, y, width, cx=200):
    """Scale `item` to `width` builder units and composite it on the canvas (units -> px).
    anchor: 'top' = y is the top edge, 'center' = y is the vertical centre, 'box' = like top, but tall garments (pants
    drawn for a taller body than the skeleton) are fitted into a 236-unit-high box with a mild horizontal stretch."""
    if anchor == "box":
        k = min(width / item.width, 236 / item.height)
        w_u, h_u = min(width, item.width * k * 1.35), item.height * k
    else:
        k = width / item.width
        w_u, h_u = width, item.height * k
    w, h = max(1, round(w_u * CANVAS_PX)), max(1, round(h_u * CANVAS_PX))
    it = item.resize((w, h), Image.LANCZOS)
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    layer.paste(it, (round(cx * CANVAS_PX - w / 2), round((y - h_u / 2 if anchor == "center" else y) * CANVAS_PX)))
    canvas.alpha_composite(layer)


def new_canvas():
    return Image.new("RGBA", (400 * CANVAS_PX, 800 * CANVAS_PX), (0, 0, 0, 0))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("sheet")
    ap.add_argument("out")
    ap.add_argument("--no-upscale", action="store_true")
    ap.add_argument("--only", default="")
    a = ap.parse_args()
    only = set(filter(None, a.only.split(",")))
    sheet = Image.open(a.sheet).convert("RGB")
    sx, sy = sheet.width / REF[0], sheet.height / REF[1]
    os.makedirs(os.path.join(a.out, "items"), exist_ok=True)
    items = []

    def save(key, category, name, tags, canvas):
        canvas.save(os.path.join(a.out, "items", key + ".png"), optimize=True)
        items.append({"key": key, "category": category, "name": name, "tags": ["smk", "sheet"] + tags, "file": f"items/{key}.png"})
        print("  +", key, "->", category)

    for kind, (x0, y0, x1, y1, cols, rows) in PANELS.items():
        if only and kind not in only and not (kind == "accessory" and only & {"glasses", "hat", "headphone"}):
            continue
        if kind == "accessory":  # row 1 (glasses/cap/headphone) is shorter than row 2 (backpack...): explicit tiles
            tiles = [(32, 711, 93, 785), (102, 711, 163, 785), (170, 711, 232, 785), (242, 711, 302, 785), (32, 797, 93, 910), (102, 797, 163, 910), (170, 797, 232, 910), (242, 797, 302, 910)]
            cells = [cut_item(sheet.crop((round(a_ * sx), round(b_ * sy), round(c_ * sx), round(d_ * sy)))) for a_, b_, c_, d_ in tiles]
            cols, rows = 4, 2
            print(kind, len(cells), "cells (explicit tiles)")
        else:
            cells = None
        ix0, iy0, ix1, iy1 = round((x0 + 6) * sx), round((y0 + HEADER) * sy), round((x1 - 6) * sx), round((y1 - 6) * sy)
        cw, ch = (ix1 - ix0) / cols, (iy1 - iy0) / rows
        if cells is None:
            cells = []
            for r in range(rows):
                for c in range(cols):
                    box = (round(ix0 + c * cw), round(iy0 + r * ch), round(ix0 + (c + 1) * cw), round(iy0 + (r + 1) * ch))
                    cells.append(cut_item(sheet.crop(box), despeckle=kind not in ("eyes", "brows")))
            print(kind, len(cells), "cells")

        if kind in ("eyes", "brows"):  # (left, right) pairs side by side: 2 styles per row
            spec, cat, label = (EYE, "eyes", "Mata") if kind == "eyes" else (BROW, "brows", "Alis")
            for n in range(len(cells) // 2):
                row, col = divmod(n, cols // 2)
                left, right = cells[row * cols + col * 2], cells[row * cols + col * 2 + 1]
                lu, ru = upscale(left, not a.no_upscale), upscale(right, not a.no_upscale)
                k = spec["w"] * CANVAS_PX / max(lu.width, ru.width)  # same scale for both eyes of a pair
                cv = new_canvas()
                for img, dx in ((lu, -spec["dx"]), (ru, spec["dx"])):
                    it = img.resize((max(1, round(img.width * k)), max(1, round(img.height * k))), Image.LANCZOS)
                    layer = Image.new("RGBA", cv.size, (0, 0, 0, 0))
                    layer.paste(it, (round((200 + dx) * CANVAS_PX - it.width / 2), round(spec["y"] * CANVAS_PX - it.height / 2)))
                    cv.alpha_composite(layer)
                save(f"sheet_{kind}_{n + 1:02d}", cat, f"{label} {n + 1}", [kind], cv)
            continue

        for n, cell in enumerate(cells):
            key = f"sheet_{kind}_{n + 1:02d}"
            if kind == "accessory":
                # row 1: glasses, glasses, cap, headphone | row 2: (backpack crop), cap, (watch), (clip)
                mapping = {0: ("glasses", "Kacamata bulat tipis"), 1: ("glasses", "Kacamata oval"), 2: ("hat", "Topi biru polos"), 3: ("headphone", "Headphone biru"), 5: ("hat", "Topi biru emblem")}
                if n not in mapping:
                    continue
                skind, name = mapping[n]
                if only and skind not in only:
                    continue
                cat, anchor, y, width = SPEC[skind]
                cv = new_canvas()
                place(cv, upscale(cell, not a.no_upscale), anchor, y, width)
                save(key, cat, name, [skind], cv)
                continue
            cat, anchor, y, width = SPEC[kind]
            names = NAMES[kind]
            cv = new_canvas()
            big = upscale(cell, not a.no_upscale)
            if kind == "hijab":
                big, hole = punch_face_hole(big)
                if hole:  # calibrate: the opening must match the face (172 units wide, centred on the face at y=196)
                    k = 172 / (hole[2] - hole[0])
                    width = big.width * k
                    cx = 200 - ((hole[0] + hole[2]) / 2 - big.width / 2) * k
                    y = 196 - ((hole[1] + hole[3]) / 2) * k
                    place(cv, big, anchor, y, width, cx=cx)
                    save(key, cat, names[n] if n < len(names) else f"{kind} {n + 1}", [kind], cv)
                    continue
            place(cv, big, anchor, y, width)
            save(key, cat, names[n] if n < len(names) else f"{kind} {n + 1}", [kind], cv)

    mpath = os.path.join(a.out, "manifest.json")
    if os.path.isfile(mpath):  # partial re-run (--only): keep the items of the earlier run, replace the ones just redone
        old = json.load(open(mpath, encoding="utf-8")).get("items", [])
        redone = {i["key"] for i in items}
        items = [i for i in old if i["key"] not in redone] + items
    with open(mpath, "w", encoding="utf-8") as f:
        json.dump({"source": os.path.basename(a.sheet), "canvas": [400 * CANVAS_PX, 800 * CANVAS_PX], "items": sorted(items, key=lambda i: i["key"])}, f, ensure_ascii=False, indent=1)
    print(len(items), "items written to", a.out)


if __name__ == "__main__":
    main()

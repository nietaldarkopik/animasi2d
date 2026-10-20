#!/usr/bin/env python3
"""Prepare the 'master-assets' folders (v1 extras + v2 kit) for the Character Builder library.

    python import_master.py MASTER_DIR OUT_DIR [--only v2|v1]
    php artisan library:import-sheet OUT_DIR --user=<id>

Output: OUT_DIR/items/*.png + manifest.json (same format as slice_sheet.py, so `library:import-sheet` imports it).
Parts are placed on the builder's canvas (800x1600 px = 400x800 units at 2 px/unit) so they line up without manual work.

What is calibrated (the kits were drawn as separate files, each cropped to its own bounding box, so the placement
has to be recovered from the artwork):
  * faces       - one scale per gender so heads are the same size (female heads are drawn ~15% smaller); top of head at y=98
  * hair        - same gender scale; vertical position from the BANGS: the lowest hair pixel in the middle of the head is put at
                  the brow line, so the face opening is where the face is
  * hijab       - scale and position from the transparent FACE OPENING so the opening matches the face
  * tops        - same gender scale, neckline at the shoulders
  * eyes        - a pair is 2 eyes drawn far apart: split, each eye scaled to the same width and put at the eye positions
  * v1 extras   - shoes (mirrored into a pair), watch, hair clip; poses/expressions are whole figures, stored as references
Items that cannot work on a front-facing character (backpack drawn flat) are skipped.
"""
import argparse
import json
import os
import re

from PIL import Image, ImageChops, ImageDraw, ImageFilter

PX = 2  # pixels per builder unit
CANVAS = (400 * PX, 800 * PX)

# units per source pixel, chosen so that the HEAD (top -> chin) is 179 units tall for both genders
# (measured: mean chin row 875 px for male faces, 742 px for female faces)
K = {"laki": 179 / 875, "perempuan": 179 / 742}
FACE_TOP = 98
BROW_LINE = 168       # lowest bang pixel goes here
EYE_Y, EYE_DX, EYE_W = 192, 35, 46
HOLE_H, HOLE_C = 185, (200, 190)  # hijab opening: height (head top to chin) and centre
HAIR_HOLE_W, HAIR_HOLE_TOP = 108, 166  # hair 'face window': its width, and its top edge on the brow line
TOP_Y = 306

NAME = {"wajah": "Wajah", "rambut": "Rambut", "kerudung": "Kerudung", "atasan": "Atasan", "mata": "Mata"}
GENDER = {"laki": "laki-laki", "perempuan": "perempuan"}


def alpha_mask(im, t=20):
    return im.getchannel("A").point(lambda v: 255 if v > t else 0)


def trim(im):
    b = alpha_mask(im).getbbox()
    return im.crop(b) if b else im


def new_canvas():
    return Image.new("RGBA", CANVAS, (0, 0, 0, 0))


def place(canvas, im, k, cx, top=None, cy=None):
    """Scale by k units/px and composite so that the horizontal centre is cx and the top (or vertical centre) is top (cy)."""
    w, h = max(1, round(im.width * k * PX)), max(1, round(im.height * k * PX))
    it = im.resize((w, h), Image.LANCZOS)
    y = round((top if top is not None else cy - im.height * k / 2) * PX)
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    layer.paste(it, (round(cx * PX - w / 2), y))
    canvas.alpha_composite(layer)
    return canvas


def bangs_bottom(im):
    """Lowest opaque row (px) of the hair in the middle of the head, before the face opening starts."""
    a = alpha_mask(im)
    w, h = a.size
    band = a.crop((round(w * 0.42), 0, round(w * 0.58), h))
    px = band.load()
    last, gap = None, 0
    for y in range(h):
        opaque = any(px[x, y] for x in range(0, band.width, 2))
        if opaque:
            last, gap = y, 0
        elif last is not None:
            gap += 1
            if gap > h * 0.06:
                break
    return last


def face_opening(im, seeds=((0.5, 0.40), (0.5, 0.5), (0.5, 0.3), (0.5, 0.6))):
    """Bounding box of the ENCLOSED transparent region around the middle of the item (a hijab's / hair's face opening)."""
    a = alpha_mask(im, 24)
    w, h = a.size
    inv = a.point(lambda v: 0 if v else 255)  # transparent = 255
    for sx, sy in seeds:
        seed = (round(w * sx), round(h * sy))
        if inv.getpixel(seed) != 255:
            continue
        work = inv.copy()
        ImageDraw.floodfill(work, seed, 128)
        comp = work.point(lambda v: 255 if v == 128 else 0)
        b = comp.getbbox()
        # touching the border = not an enclosed opening; tiny = a gap between strands
        if b and b[0] > 2 and b[2] < w - 2 and b[1] > 2 and b[3] < h - 2 and (b[2] - b[0]) > w * 0.2 and (b[3] - b[1]) > h * 0.08:
            return b
    return None


def split_eyes(im):
    """Left and right eye (each trimmed) of a pair file: split in the widest empty vertical gap."""
    a = alpha_mask(im)
    w, h = a.size
    cols = [a.crop((x, 0, x + 1, h)).getbbox() is not None for x in range(w)]
    best, start = (0, w // 2), None
    for x in range(w):
        if not cols[x] and start is None:
            start = x
        if (cols[x] or x == w - 1) and start is not None:
            if x - start > best[0]:
                best = (x - start, (start + x) // 2)
            start = None
    mid = best[1]
    return trim(im.crop((0, 0, mid, h))), trim(im.crop((mid, 0, w, h)))


# ---- body kit (aset_badan): torso (anime, 4 views, both genders) + arm poses ----------------------------------------
TORSO_WIDTH = {"laki": 0.92, "perempuan": 1.0}  # male torsos are ~10% wider than the male shirts of the v2 kit: without this the bare shoulders show beside the sleeves
K_BODY = 275 / 1344          # torsos are 1344 px tall for both genders: neck stub top -> waist = 275 units
TORSO_TOP = 277              # neck-stub top; puts the shoulder line at ~335 and the hem at the hip (552)
SHOULDER = {"l": (106, 345), "r": (294, 345)}  # where the arm's shoulder joint goes (screen left / right)

# pose -> (display name, joint of the shoulder in the image as fractions, orientation of the ORIGINAL drawing, extra tags)
#   'l' = original is a screen-left arm (the right one is its mirror); 'r' = original is a screen-right arm;
#   'pair' = both arms in one image (placed in the left-arm slot, centred on the chest).
ARMS = {
    "lengan_01_lurus_bawah": ("Lurus ke bawah", (0.45, 0.04), "l", []),
    "lengan_02_angkat_ke_atas": ("Angkat ke atas", (0.45, 0.95), "l", []),
    "lengan_03_tangan_di_pinggang": ("Tangan di pinggang", (0.60, 0.04), "l", ["di-depan-baju"]),
    "lengan_04_menunjuk": ("Menunjuk", (0.08, 0.12), "r", []),
    "lengan_05_melambai": ("Melambai", (0.10, 0.30), "r", []),
    "lengan_06_kepal_ditekuk": ("Kepal ditekuk", (0.13, 0.15), "r", []),
    "lengan_07_rentang_samping": ("Rentang ke samping", (0.03, 0.45), "r", []),
    "lengan_08_silang_dada": ("Silang di dada (kedua lengan)", (0.5, 0.5), "pair", ["di-depan-baju"]),
    "lengan_09_lurus_samping": ("Lurus di samping", (0.5, 0.04), "l", []),
    "lengan_10_ayun_jalan": ("Ayun jalan (kedua lengan)", (0.5, 0.5), "pair", []),
}
PAIR_CENTER = {"lengan_08_silang_dada": (200, 440), "lengan_10_ayun_jalan": (200, 480)}


def fit_scale(im, k, joint, target, margin=6):
    """Factor (<= 1) that keeps the whole arm inside the 400x800 canvas when it is anchored at `target` (units)."""
    w, h = im.width * k, im.height * k
    room = [(target[0] - margin) / max(1e-6, joint[0] * w), (400 - margin - target[0]) / max(1e-6, (1 - joint[0]) * w),
            (target[1] - margin) / max(1e-6, joint[1] * h), (800 - margin - target[1]) / max(1e-6, (1 - joint[1]) * h)]
    return min(1.0, *room)


def place_joint(canvas, im, k, joint, target):
    """Scale by k and composite so that the image point `joint` (fractions) lands on `target` (units)."""
    w, h = max(1, round(im.width * k * PX)), max(1, round(im.height * k * PX))
    it = im.resize((w, h), Image.LANCZOS)
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    layer.paste(it, (round(target[0] * PX - joint[0] * w), round(target[1] * PX - joint[1] * h)))
    canvas.alpha_composite(layer)


def body_items(root):
    out = []
    base = os.path.join(root, "aset_badan")
    d = os.path.join(base, "badan")
    if os.path.isdir(d):
        for fn in sorted(os.listdir(d)):
            m = re.match(r"^badan_(\d+)_(laki|perempuan)_(depan|kanan|kiri|belakang)\.png$", fn)
            if not m:
                continue
            idx, g, view = m.groups()
            canvas = new_canvas()
            im = trim(Image.open(os.path.join(d, fn)).convert("RGBA"))
            sx = TORSO_WIDTH[g] if view == "depan" or view == "belakang" else 1.0
            if sx != 1.0:  # horizontal squeeze only (the views from the side keep their depth)
                im = im.resize((round(im.width * sx), im.height), Image.LANCZOS)
            place(canvas, im, K_BODY, 200, top=TORSO_TOP)
            out.append({"key": f"v3_{fn[:-4]}", "category": "torso", "name": f"Badan {GENDER[g]} - {view}", "tags": ["smk", "v3", "badan", g, view], "canvas": canvas, "note": ""})
    d = os.path.join(base, "lengan")
    if os.path.isdir(d):
        for fn in sorted(os.listdir(d)):
            stem = fn[:-4]
            if stem not in ARMS:
                continue
            name, joint, orient, extra = ARMS[stem]
            im = trim(Image.open(os.path.join(d, fn)).convert("RGBA"))
            if orient == "pair":
                canvas = new_canvas()
                place(canvas, im, K_BODY, PAIR_CENTER[stem][0], cy=PAIR_CENTER[stem][1])
                out.append({"key": f"v3_{stem}", "category": "arm_l", "name": f"Lengan {name}", "tags": ["smk", "v3", "lengan", "dua-lengan"] + extra, "canvas": canvas, "note": "dua lengan dalam satu gambar (slot kiri)"})
                continue
            flipped = im.transpose(Image.FLIP_LEFT_RIGHT)
            fj = (1 - joint[0], joint[1])
            # which version belongs to which slot
            left_im, left_j, right_im, right_j = (im, joint, flipped, fj) if orient == "l" else (flipped, fj, im, joint)
            for slot, img, j in (("l", left_im, left_j), ("r", right_im, right_j)):
                canvas = new_canvas()
                f = fit_scale(img, K_BODY, j, SHOULDER[slot])
                place_joint(canvas, img, K_BODY * f, j, SHOULDER[slot])
                label = "kiri" if slot == "l" else "kanan"
                shrunk = f < 0.97
                out.append({"key": f"v3_{stem}_{slot}", "category": f"arm_{slot}", "name": f"Lengan {name} ({label})" + (" - diperkecil" if shrunk else ""),
                            "tags": ["smk", "v3", "lengan"] + extra + (["diperkecil"] if shrunk else []), "canvas": canvas,
                            "note": f"diperkecil {round(f * 100)}% agar muat kanvas" if shrunk else ""})
    return out


def descr(fn):
    m = re.match(r"^[a-z_]+?_(\d+)_(.+)\.png$", fn)
    return (m.group(1), m.group(2).replace("_", " ")) if m else ("", fn[:-4])


def gender_of(folder):
    return "perempuan" if folder.endswith("perempuan") else "laki"


def v2_items(root, only=None):
    out = []
    base = os.path.join(root, "assets-v2")
    cfg = [("wajah_laki", "face", "wajah"), ("wajah_perempuan", "face", "wajah"), ("rambut_laki", "hair_front", "rambut"), ("rambut_perempuan", "hair_front", "rambut"),
           ("kerudung_depan", "hijab", "kerudung"), ("atasan_laki", "top", "atasan"), ("atasan_perempuan", "top", "atasan"), ("mata_baru", "eyes", "mata")]
    for folder, cat, label in cfg:
        d = os.path.join(base, folder)
        if not os.path.isdir(d) or (only and folder not in only):
            continue
        for fn in sorted(os.listdir(d)):
            if not fn.endswith(".png"):
                continue
            g = gender_of(folder) if folder != "kerudung_depan" and folder != "mata_baru" else "perempuan"
            idx, desc = descr(fn)
            canvas = new_canvas()
            im = trim(Image.open(os.path.join(d, fn)).convert("RGBA"))
            k = K[g]
            note = ""
            if cat == "face":
                place(canvas, im, k, 200, top=FACE_TOP)
            elif cat == "hair_front":
                hole = face_opening(im)
                if hole:  # hair with a closed face window (long hair, hime...): fit the window between brow line and chin
                    hk = HAIR_HOLE_W / (hole[2] - hole[0])
                    cx = 200 - ((hole[0] + hole[2]) / 2 - im.width / 2) * hk
                    top = HAIR_HOLE_TOP - hole[1] * hk
                    place(canvas, im, hk, cx, top=top)
                    note = "disejajarkan dari lubang wajah"
                else:     # open hair (short styles): gender scale, bangs on the brow line
                    bb = bangs_bottom(im)
                    top = BROW_LINE - bb * k if bb else FACE_TOP - 14
                    place(canvas, im, k, 200, top=top)
                    note = "" if bb else "poni tidak terdeteksi: disejajarkan dari atas"
            elif cat == "hijab":
                hole = face_opening(im)
                if hole:
                    hk = HOLE_H / (hole[3] - hole[1])  # opening = head height (98 -> 283)
                    cx = HOLE_C[0] - ((hole[0] + hole[2]) / 2 - im.width / 2) * hk
                    top = HOLE_C[1] - ((hole[1] + hole[3]) / 2) * hk
                    place(canvas, im, hk, cx, top=top)
                else:
                    place(canvas, im, K["perempuan"], 200, top=FACE_TOP - 24)
                    note = "lubang wajah tidak terdeteksi"
            elif cat == "top":
                place(canvas, im, k, 200, top=TOP_Y)
            elif cat == "eyes":
                left, right = split_eyes(im)
                ek = EYE_W / ((left.width + right.width) / 2)
                for eye, dx in ((left, -EYE_DX), (right, EYE_DX)):
                    place(canvas, eye, ek, 200 + dx, cy=EYE_Y)
            name = f"{label} {GENDER.get(g, g)} {idx} - {desc}" if folder not in ("kerudung_depan", "mata_baru") else f"{label} {idx} - {desc}"
            key = f"v2_{os.path.splitext(fn)[0]}"
            out.append({"key": key, "category": cat, "name": name.capitalize(), "tags": ["smk", "v2", g if folder not in ("kerudung_depan", "mata_baru") else "semua"] + desc.split(), "canvas": canvas, "note": note})
    return out


def v1_items(root):
    out = []
    base = os.path.join(root, "assets-v1")

    def load(sub, fn):
        return trim(Image.open(os.path.join(base, sub, fn)).convert("RGBA"))

    # shoes: single 3/4 shoes -> a pair (mirrored), toes pointing outward
    sub = os.path.join(base, "sepatu")
    if os.path.isdir(sub):
        for fn in sorted(os.listdir(sub)):
            if not fn.endswith(".png"):
                continue
            s = load("sepatu", fn)
            k = 84 / s.width
            canvas = new_canvas()
            place(canvas, s, k, 158, top=788 - s.height * k)
            place(canvas, s.transpose(Image.FLIP_LEFT_RIGHT), k, 242, top=788 - s.height * k)
            idx = re.search(r"(\d+)", fn).group(1)
            out.append({"key": f"v1_{fn[:-4]}", "category": "shoes", "name": f"Sepatu {idx} (sepasang)", "tags": ["smk", "v1", "sepatu"], "canvas": canvas, "note": "tampak 3/4 dicerminkan menjadi sepasang"})
    # watch on the left wrist, hair clip at the side of the head
    for fn, name, w, cx, cy in (("aksesoris_07.png", "Jam tangan", 30, 104, 585), ("aksesoris_08.png", "Jepit rambut", 40, 262, 122)):
        if os.path.isfile(os.path.join(base, "aksesoris", fn)):
            im = load("aksesoris", fn)
            canvas = new_canvas()
            place(canvas, im, w / im.width, cx, cy=cy)
            out.append({"key": f"v1_{fn[:-4]}", "category": "accessory", "name": name, "tags": ["smk", "v1", "aksesoris"], "canvas": canvas, "note": ""})
    # references: whole figures, not parts
    refs = []
    for sub, cat, label in (("pose", "pose", "Pose"), ("ekspresi", "expression_ref", "Ekspresi")):
        d = os.path.join(base, sub)
        if not os.path.isdir(d):
            continue
        for fn in sorted(os.listdir(d)):
            if fn.endswith(".png"):
                refs.append({"key": f"v1_{fn[:-4]}", "category": cat, "name": f"{label}: {fn[len(sub) + 1:-4].replace('_', ' ')}", "tags": ["smk", "v1", "referensi", sub], "raw": os.path.join(d, fn), "note": "karakter utuh (referensi)"})
    return out, refs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("master")
    ap.add_argument("out")
    ap.add_argument("--only", default="")
    a = ap.parse_args()
    os.makedirs(os.path.join(a.out, "items"), exist_ok=True)
    manifest = []

    def emit(it):
        path = os.path.join(a.out, "items", it["key"] + ".png")
        if "canvas" in it:
            it["canvas"].save(path, optimize=True)
        else:
            Image.open(it["raw"]).convert("RGBA").save(path, optimize=True)
        manifest.append({k: it[k] for k in ("key", "category", "name", "tags")} | {"file": f"items/{it['key']}.png"})
        print("  +", it["key"], "->", it["category"], ("(" + it["note"] + ")") if it.get("note") else "")

    if a.only in ("", "v2"):
        for it in v2_items(a.master):
            emit(it)
    if a.only in ("", "body"):
        for it in body_items(a.master):
            emit(it)
    if a.only in ("", "v1"):
        items, refs = v1_items(a.master)
        for it in items + refs:
            emit(it)
    with open(os.path.join(a.out, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump({"source": "master-assets", "canvas": list(CANVAS), "items": manifest}, f, ensure_ascii=False, indent=1)
    print(len(manifest), "items ->", a.out)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Image clean-up worker (Pillow only). Called by Laravel via Symfony Process.

    python -I imagetool.py --in SRC --out DST.png --ops '[{"op":"crop","x":0,"y":0,"w":100,"h":100}, ...]'

Prints one JSON object to stdout: {"width":..,"height":..,"notes":[..]} or {"error":".."} (exit code 2).
Ops run in order, in the coordinates of the image as it is at that step:
  crop        x, y, w, h
  resize      width (px; height follows) | scale (0.05..4)
  remove_bg   tolerance 0..100  [color "#rrggbb" optional]   -> edge-connected background becomes transparent
  sketch      strength 0..100                               -> paper photo / scan -> transparent line art
  trim                                                       -> crop away transparent borders
  enhance                                                    -> auto-contrast + light sharpen
  rotate      angle [fill white|transparent]
  deskew                                                     -> auto-straighten a tilted scan
  flatten                                                    -> remove shadows / uneven paper tone
  denoise                                                    -> median 3x3
  upscale     factor 1..4                                    -> Lanczos + unsharp (no new detail)
  upscale_ai  factor 1<..4, bin (Real-ESRGAN exe), model                -> local AI super-resolution
  perspective points [[x,y]x4: TL,TR,BR,BL]                  -> flatten a photographed sheet
  lineart     strength 0..100                                -> clean near-black lines on transparency
"""
import argparse
import json
import os
import sys

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageOps

Image.MAX_IMAGE_PIXELS = 60_000_000
MAX_WORK = 2400  # longest side for the heavy per-pixel ops
MAX_OUT = 4096


class OpError(Exception):
    pass


# Geometry bookkeeping so the editor can keep a replaced layer visually in place:
#   s      = current pixels per INPUT pixel
#   ox, oy = input-pixel coordinates of the current image's top-left corner
GEO = {"s": 1.0, "ox": 0.0, "oy": 0.0}


def fit_work(img, notes):
    w, h = img.size
    m = max(w, h)
    if m > MAX_WORK:
        k = MAX_WORK / m
        img = img.resize((max(1, round(w * k)), max(1, round(h * k))), Image.LANCZOS)
        GEO["s"] *= img.size[0] / w
        notes.append(f"Gambar diperkecil ke {img.size[0]}x{img.size[1]} untuk pemrosesan.")
    return img


def op_crop(img, o, notes):
    x, y, w, h = (int(o[k]) for k in ("x", "y", "w", "h"))
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(img.width, x + w), min(img.height, y + h)
    if x1 - x0 < 1 or y1 - y0 < 1:
        raise OpError("Area crop di luar gambar.")
    GEO["ox"] += x0 / GEO["s"]
    GEO["oy"] += y0 / GEO["s"]
    return img.crop((x0, y0, x1, y1))


def op_resize(img, o, notes):
    if o.get("width"):
        k = float(o["width"]) / img.width
    elif o.get("scale"):
        k = float(o["scale"])
    else:
        raise OpError("resize membutuhkan width atau scale.")
    nw, nh = max(1, round(img.width * k)), max(1, round(img.height * k))
    if max(nw, nh) > MAX_OUT or min(nw, nh) < 1:
        raise OpError(f"Ukuran hasil harus antara 1 dan {MAX_OUT}px.")
    GEO["s"] *= nw / img.width
    return img.resize((nw, nh), Image.LANCZOS)


def border_median_color(rgb):
    w, h = rgb.size
    px = rgb.load()
    pts = [px[x, 0] for x in range(0, w, max(1, w // 200))] + [px[x, h - 1] for x in range(0, w, max(1, w // 200))]
    pts += [px[0, y] for y in range(0, h, max(1, h // 200))] + [px[w - 1, y] for y in range(0, h, max(1, h // 200))]
    return tuple(sorted(p[c] for p in pts)[len(pts) // 2] for c in range(3))


def op_remove_bg(img, o, notes):
    img = fit_work(img.convert("RGBA"), notes)
    rgb = img.convert("RGB")
    if o.get("color"):
        c = o["color"].lstrip("#")
        bg = tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))
    else:
        bg = border_median_color(rgb)
    tol = round(float(o.get("tolerance", 30)) * 1.2)
    r, g, b = ImageChops.difference(rgb, Image.new("RGB", rgb.size, bg)).split()
    dmax = ImageChops.lighter(ImageChops.lighter(r, g), b)
    close = dmax.point(lambda v: 255 if v <= tol else 0)

    # Only background that touches the border is removed (holes inside the subject stay).
    # Connectivity is solved on a coarse grid (pure-Python flood fill is slow), then refined at full
    # resolution: a block counts as background only if *every* pixel in it is close to the background,
    # so thin subject features survive; the region is dilated one block and ANDed with the exact mask.
    w, h = close.size
    f = max(1, -(-max(w, h) // 700))
    lw, lh = max(1, -(-w // f)), max(1, -(-h // f))
    low = close.resize((lw, lh), Image.BOX).point(lambda v: 255 if v == 255 else 0)
    seeds = [(x, 0) for x in range(lw)] + [(x, lh - 1) for x in range(lw)] + [(0, y) for y in range(lh)] + [(lw - 1, y) for y in range(lh)]
    for s in seeds:
        if low.getpixel(s) == 255:
            ImageDraw.floodfill(low, s, 128)
    region = low.point(lambda v: 255 if v == 128 else 0).filter(ImageFilter.MaxFilter(3))
    region = region.resize((w, h), Image.NEAREST)
    bgmask = ImageChops.multiply(region, close)  # both are 0/255 masks
    removed = sum(i * c for i, c in enumerate(bgmask.histogram())) / 255 / (w * h)
    if removed < 0.002:
        raise OpError("Latar tidak terdeteksi. Naikkan toleransi atau pastikan latar menyentuh tepi gambar.")
    if removed > 0.995:
        raise OpError("Hampir seluruh gambar terdeteksi sebagai latar. Turunkan toleransi.")
    alpha = ImageChops.invert(bgmask).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.8))
    img.putalpha(ImageChops.multiply(img.getchannel("A"), alpha))
    notes.append(f"Latar dihapus ({removed * 100:.0f}% area), warna latar {'#%02x%02x%02x' % bg}.")
    return img


def op_sketch(img, o, notes):
    img = fit_work(img.convert("RGBA"), notes)
    w, h = img.size
    gray = img.convert("L")
    # estimate the (possibly unevenly lit) paper level: dilate dark lines away at low resolution, smooth, scale back up
    small = gray.resize((max(1, w // 8), max(1, h // 8)), Image.BOX)
    paper = small.filter(ImageFilter.MaxFilter(7)).filter(ImageFilter.GaussianBlur(3)).resize((w, h), Image.BICUBIC)
    ink = ImageChops.subtract(paper, gray)  # how much darker than the local paper
    strength = float(o.get("strength", 50))
    hi = max(30.0, 160.0 - 1.2 * strength)
    lo = hi * 0.2
    alpha = ink.point(lambda v: 0 if v <= lo else (255 if v >= hi else int((v - lo) * 255 / (hi - lo))))
    cover = sum(i * c for i, c in enumerate(alpha.histogram())) / 255 / (w * h)
    if cover < 0.0005:
        raise OpError("Tidak ada garis terdeteksi. Naikkan kekuatan.")
    rgb = img.convert("RGB")
    color = ImageChops.multiply(rgb, rgb)  # deepen anti-aliased pen colours that blended with white paper
    out = color.convert("RGBA")
    out.putalpha(ImageChops.multiply(alpha, img.getchannel("A")))
    notes.append(f"Garis terdeteksi pada {cover * 100:.1f}% area.")
    return out


def op_trim(img, o, notes):
    img = img.convert("RGBA")
    box = img.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    if not box:
        raise OpError("Gambar sepenuhnya transparan.")
    m = 2
    x0, y0 = max(0, box[0] - m), max(0, box[1] - m)
    GEO["ox"] += x0 / GEO["s"]
    GEO["oy"] += y0 / GEO["s"]
    return img.crop((x0, y0, min(img.width, box[2] + m), min(img.height, box[3] + m)))


def op_enhance(img, o, notes):
    img = img.convert("RGBA")
    a = img.getchannel("A")
    rgb = ImageOps.autocontrast(img.convert("RGB"), cutoff=1).filter(ImageFilter.UnsharpMask(radius=1.2, percent=80, threshold=2))
    rgb.putalpha(a)
    return rgb


def paper_level(gray):
    """Estimate the (unevenly lit) paper brightness: dilate dark lines away at low resolution, smooth, scale back up."""
    w, h = gray.size
    small = gray.resize((max(1, w // 8), max(1, h // 8)), Image.BOX)
    return small.filter(ImageFilter.MaxFilter(7)).filter(ImageFilter.GaussianBlur(3)).resize((w, h), Image.BICUBIC)


def op_rotate(img, o, notes):
    ang = float(o.get("angle", 0))
    if abs(ang) > 360:
        raise OpError("Sudut rotasi harus antara -360 dan 360.")
    img = img.convert("RGBA")
    bg = (255, 255, 255, 255) if o.get("fill", "white") == "white" else (0, 0, 0, 0)
    flat = Image.new("RGBA", img.size, bg)
    flat.paste(img, (0, 0), img)
    out = (flat if bg[3] else img).rotate(ang, resample=Image.BICUBIC, expand=True, fillcolor=bg)
    notes.append(f"Diputar {ang:g} derajat.")
    return out


def estimate_skew(gray):
    """Projection-profile method: the right angle makes text/ink rows the sparsest-and-densest. Returns degrees to rotate (CCW)."""
    small = gray.copy()
    small.thumbnail((500, 500))
    ink = ImageChops.invert(small).point(lambda v: 255 if v > 60 else 0)
    if sum(i * c for i, c in enumerate(ink.histogram())) / 255 < 20:
        return 0.0

    def score(a):
        r = ink.rotate(a, resample=Image.BILINEAR, expand=True)
        prof = list(r.resize((1, r.height), Image.BOX).tobytes())
        return sum((prof[i + 1] - prof[i]) ** 2 for i in range(len(prof) - 1))

    best = max((score(a / 2), a / 2) for a in range(-30, 31))[1]  # -15..15 deg, 0.5 step
    fine = max((score(best + d / 10), best + d / 10) for d in range(-5, 6))[1]
    return fine


def op_deskew(img, o, notes):
    img = img.convert("RGBA")
    bgw = Image.new("RGBA", img.size, (255, 255, 255, 255))
    bgw.paste(img, (0, 0), img)
    ang = estimate_skew(bgw.convert("L"))
    if abs(ang) < 0.3:
        notes.append("Kemiringan tidak terdeteksi (tidak diubah).")
        return img
    notes.append(f"Kemiringan dikoreksi {ang:.1f} derajat.")
    return op_rotate(img, {"angle": ang, "fill": "white"}, [])


def op_flatten(img, o, notes):
    """Remove shadows / uneven paper tone: lift every pixel by how far the local paper is from white."""
    img = fit_work(img.convert("RGBA"), notes)
    a = img.getchannel("A")
    rgb = img.convert("RGB")
    lift = ImageChops.invert(paper_level(rgb.convert("L")))
    out = ImageChops.add(rgb, Image.merge("RGB", (lift, lift, lift)))
    out = ImageOps.autocontrast(out, cutoff=0.5)
    out = out.convert("RGBA")
    out.putalpha(a)
    notes.append("Bayangan dan warna latar kertas diratakan.")
    return out


def op_denoise(img, o, notes):
    img = img.convert("RGBA")
    a = img.getchannel("A")
    rgb = img.convert("RGB").filter(ImageFilter.MedianFilter(3))
    rgb = rgb.convert("RGBA")
    rgb.putalpha(a)
    notes.append("Noise dikurangi (median 3x3).")
    return rgb


def op_upscale(img, o, notes):
    k = float(o.get("factor", 2))
    if not 1 <= k <= 4:
        raise OpError("Faktor upscale harus antara 1 dan 4.")
    nw, nh = round(img.width * k), round(img.height * k)
    if max(nw, nh) > MAX_OUT:
        k = MAX_OUT / max(img.size)
        nw, nh = round(img.width * k), round(img.height * k)
        notes.append(f"Upscale dibatasi ke {MAX_OUT}px sisi terpanjang.")
    if k <= 1.001:
        return img
    GEO["s"] *= nw / img.width
    out = img.convert("RGBA").resize((nw, nh), Image.LANCZOS).filter(ImageFilter.UnsharpMask(radius=1.5, percent=60, threshold=2))
    notes.append(f"Resolusi dinaikkan {k:g}x dengan interpolasi Lanczos (bukan super-resolusi AI: tidak menambah detail baru).")
    return out


def op_lineart(img, o, notes):
    """Sketch -> clean, near-black line art on transparency with crisp edges (binary-ish alpha, light anti-aliasing)."""
    img = fit_work(img.convert("RGBA"), notes)
    gray = img.convert("L")
    ink = ImageChops.subtract(paper_level(gray), gray)
    strength = float(o.get("strength", 50))
    cut = max(12, int(80 - 0.6 * strength))
    alpha = ink.point(lambda v: 255 if v >= cut else 0).filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.6))
    cover = sum(i * c for i, c in enumerate(alpha.histogram())) / 255 / (img.width * img.height)
    if cover < 0.0005:
        raise OpError("Tidak ada garis terdeteksi. Naikkan kekuatan.")
    out = Image.new("RGBA", img.size, (20, 20, 24, 255))
    out.putalpha(ImageChops.multiply(alpha, img.getchannel("A")))
    notes.append(f"Line art bersih dibuat ({cover * 100:.1f}% area berisi garis).")
    return out


def solve_linear(a, b):
    """Gauss-Jordan with partial pivoting (8x8 here); avoids a numpy dependency."""
    n = len(b)
    m = [row[:] + [b[i]] for i, row in enumerate(a)]
    for c in range(n):
        piv = max(range(c, n), key=lambda r: abs(m[r][c]))
        if abs(m[piv][c]) < 1e-9:
            raise OpError("Keempat titik sudut tidak membentuk segi empat yang valid.")
        m[c], m[piv] = m[piv], m[c]
        for r in range(n):
            if r != c:
                f = m[r][c] / m[c][c]
                m[r] = [x - f * y for x, y in zip(m[r], m[c])]
    return [m[i][n] / m[i][i] for i in range(n)]


def cross(o, a, b):
    return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])


def op_perspective(img, o, notes):
    """Flatten a photographed sheet: 4 corners (TL, TR, BR, BL) in current pixel coords -> upright rectangle."""
    pts = o.get("points")
    if not (isinstance(pts, list) and len(pts) == 4 and all(isinstance(p, (list, tuple)) and len(p) == 2 for p in pts)):
        raise OpError("perspective membutuhkan 4 titik [x, y]: kiri-atas, kanan-atas, kanan-bawah, kiri-bawah.")
    pts = [(float(x), float(y)) for x, y in pts]
    if any(not (0 <= x <= img.width and 0 <= y <= img.height) for x, y in pts):
        raise OpError("Titik sudut berada di luar gambar.")
    # convex, consistently ordered quadrilateral
    signs = [cross(pts[i], pts[(i + 1) % 4], pts[(i + 2) % 4]) for i in range(4)]
    if not (all(v > 0 for v in signs) or all(v < 0 for v in signs)):
        raise OpError("Urutan titik harus mengelilingi kertas: kiri-atas, kanan-atas, kanan-bawah, kiri-bawah (segi empat cembung).")
    dist = lambda a, b: ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5
    w = max(1, round(max(dist(pts[0], pts[1]), dist(pts[3], pts[2]))))
    h = max(1, round(max(dist(pts[0], pts[3]), dist(pts[1], pts[2]))))
    if max(w, h) > MAX_OUT:
        k = MAX_OUT / max(w, h)
        w, h = max(1, round(w * k)), max(1, round(h * k))
    # Pillow maps OUTPUT -> INPUT: for each output corner (u,v) the input point (x,y)
    dst = [(0, 0), (w, 0), (w, h), (0, h)]
    a, b = [], []
    for (u, v), (x, y) in zip(dst, pts):
        a.append([u, v, 1, 0, 0, 0, -x * u, -x * v]); b.append(x)
        a.append([0, 0, 0, u, v, 1, -y * u, -y * v]); b.append(y)
    coeffs = solve_linear(a, b)
    img = img.convert("RGBA")
    flat = Image.new("RGBA", img.size, (255, 255, 255, 255))
    flat.paste(img, (0, 0), img)
    out = flat.transform((w, h), Image.PERSPECTIVE, coeffs, Image.BICUBIC)
    GEO["s"] = 1.0
    GEO["ox"] = GEO["oy"] = 0.0  # the result is a re-projection: no meaningful in-place mapping
    notes.append(f"Perspektif kertas dikoreksi menjadi {w}x{h}px.")
    return out


def op_upscale_ai(img, o, notes):
    """Real-ESRGAN (ncnn/Vulkan, runs locally) super-resolution. The network ignores alpha, so colour and alpha are
    upscaled separately (colour on white, alpha as a grey image) and recombined."""
    import subprocess
    import tempfile

    exe, model = o.get("bin"), o.get("model") or "realesrgan-x4plus-anime"
    if not exe or not os.path.isfile(exe):
        raise OpError("Upscaler AI lokal (Real-ESRGAN) belum terpasang.")
    factor = float(o.get("factor", 2))
    if not 1 < factor <= 4:
        raise OpError("Faktor upscale AI harus lebih dari 1 dan maksimal 4.")
    img = img.convert("RGBA")
    if max(img.size) > 1100:
        raise OpError("Gambar terlalu besar untuk upscale AI (maks. 1100 px sisi terpanjang).")
    out_w, out_h = round(img.width * factor), round(img.height * factor)
    if max(out_w, out_h) > MAX_OUT:
        raise OpError(f"Hasil melebihi {MAX_OUT}px; pilih faktor lebih kecil.")

    rgb = Image.new("RGB", img.size, (255, 255, 255))
    rgb.paste(img, (0, 0), img)
    alpha = img.getchannel("A")
    has_alpha = alpha.getextrema()[0] < 250
    exe_dir = os.path.dirname(os.path.abspath(exe))
    with tempfile.TemporaryDirectory() as td:
        jobs = [("rgb", rgb)] + ([("alpha", Image.merge("RGB", (alpha, alpha, alpha)))] if has_alpha else [])
        res = {}
        for name, im in jobs:
            src, dst = os.path.join(td, name + "_in.png"), os.path.join(td, name + "_out.png")
            im.save(src)
            r = subprocess.run([exe, "-i", src, "-o", dst, "-n", model, "-s", "4", "-m", os.path.join(exe_dir, "models")], capture_output=True, text=True, timeout=int(o.get("timeout", 500)), cwd=exe_dir)
            if r.returncode != 0 or not os.path.isfile(dst):
                raise OpError("Real-ESRGAN gagal dijalankan (butuh GPU dengan driver Vulkan). " + (r.stderr or "").strip()[-200:])
            up = Image.open(dst)
            up.load()
            res[name] = up
    big_rgb = res["rgb"].convert("RGB")
    if big_rgb.size != (out_w, out_h):
        big_rgb = big_rgb.resize((out_w, out_h), Image.LANCZOS)
    out = big_rgb.convert("RGBA")
    if has_alpha:
        a = res["alpha"].convert("L")
        if a.size != (out_w, out_h):
            a = a.resize((out_w, out_h), Image.LANCZOS)
        a = a.point(lambda v: 0 if v < 40 else (255 if v > 215 else int((v - 40) * 255 / 175))).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.6))
        out.putalpha(a)
    GEO["s"] *= factor
    notes.append(f"Resolusi dinaikkan {factor:g}x dengan model AI lokal {model} ({img.width}x{img.height} -> {out_w}x{out_h}).")
    return out


OPS = {"crop": op_crop, "resize": op_resize, "remove_bg": op_remove_bg, "sketch": op_sketch, "trim": op_trim, "enhance": op_enhance,
       "rotate": op_rotate, "deskew": op_deskew, "flatten": op_flatten, "denoise": op_denoise, "upscale": op_upscale, "lineart": op_lineart, "perspective": op_perspective, "upscale_ai": op_upscale_ai}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="src", required=True)
    ap.add_argument("--out", dest="dst", required=True)
    ap.add_argument("--ops", required=True)
    a = ap.parse_args()
    notes = []
    try:
        ops = json.loads(a.ops)
        img = Image.open(a.src)
        img.load()
        img = ImageOps.exif_transpose(img).convert("RGBA")  # phone photos carry rotation in EXIF
        input_size = img.size
        for o in ops:
            fn = OPS.get(o.get("op"))
            if not fn:
                raise OpError(f"Operasi tidak dikenal: {o.get('op')}")
            img = fn(img, o, notes)
        img.save(a.dst, "PNG", optimize=True)
        print(json.dumps({"width": img.width, "height": img.height, "notes": notes, "pixel_scale": GEO["s"], "origin": [GEO["ox"], GEO["oy"]], "input_size": list(input_size)}))
    except OpError as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(2)
    except Exception as e:  # bad/corrupt image, bad ops JSON, ...
        print(json.dumps({"error": f"Gagal memproses gambar: {type(e).__name__}: {e}"}))
        sys.exit(2)


if __name__ == "__main__":
    main()

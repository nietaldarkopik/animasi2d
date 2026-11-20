"""Importer lembar hasil generate: kunci hijau, deteksi sel otomatis, skala dari sel acuan, penempatan ke kanvas kartu, dan titik tempel kepala.

Menggantikan koordinat sel dan faktor skala yang dulu diukur tangan di proses.py: sel dicari dari isi gambar, skala dihitung dengan membandingkan
sel acuan (sel 1, aset depan yang digambar ulang) dengan aset asli yang sudah ada.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from . import spec


class SheetError(ValueError):
    """Lembar tidak bisa diproses; pesan menjelaskan apa yang harus diperbaiki."""


# ------------------------------------------------------------------ kunci hijau

def chroma_key(img: Image.Image) -> Image.Image:
    """Hijau murni -> transparan (port kunci.py: despill + kikis 1 px). Gambar yang sudah bertransparansi dipakai apa adanya."""
    rgba = img.convert('RGBA')
    a = np.asarray(rgba)[..., 3]
    if (a < 250).mean() > .05:
        return rgba
    f = np.asarray(img.convert('RGB')).astype(np.float32)
    r, g, b = f[..., 0], f[..., 1], f[..., 2]
    k = g - np.maximum(r, b)
    al = 1 - np.clip((k - 30) / 90, 0, 1)
    f[..., 1] = np.minimum(g, (r + b) / 2 + 2)
    al = np.asarray(Image.fromarray((al * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(3)), dtype=np.float32) / 255.0
    return Image.fromarray(np.dstack([f, al * 255]).clip(0, 255).astype(np.uint8), 'RGBA')


# ------------------------------------------------------------------ deteksi sel

def runs(mask: np.ndarray, minlen: int = 6, gap: int = 6) -> list[tuple[int, int]]:
    idx = np.where(mask)[0]
    if len(idx) == 0:
        return []
    out, s, p = [], int(idx[0]), int(idx[0])
    for i in idx[1:]:
        i = int(i)
        if i - p > gap:
            if p - s >= minlen:
                out.append((s, p + 1))
            s = i
        p = i
    if p - s >= minlen:
        out.append((s, p + 1))
    return out


def split_axis(mask: np.ndarray, n: int, minlen: int = 6) -> list[tuple[int, int]] | None:
    """n segmen berisi pada sumbu ini; celah ditoleransi makin lebar sampai jumlahnya pas. None bila tidak mungkin."""
    for gap in (3, 6, 10, 16, 24, 36, 56, 80, 120):
        rs = runs(mask, minlen, gap)
        if len(rs) == n:
            return rs
        if len(rs) < n:
            return None
    return None


def _equal(lo: int, hi: int, n: int) -> list[tuple[int, int]]:
    step = (hi - lo) / n
    return [(int(round(lo + i * step)), int(round(lo + (i + 1) * step))) for i in range(n)]


def _open_keyed(path) -> Image.Image:
    """Buka lembar dan kunci hijaunya; berkas rusak atau bukan gambar menjadi galat yang jelas."""
    try:
        with Image.open(path) as im:
            im.load()
            return chroma_key(im)
    except (OSError, ValueError) as e:
        raise SheetError(f'{Path(path).name} bukan gambar yang bisa dibaca (unggah PNG atau JPG hasil Flow): {e}') from e


def find_cells(rgba: Image.Image, cols: int, rows: int, equal: bool = False, count: int | None = None) -> tuple[list[tuple[int, int, int, int]], list[str]]:
    """Kotak (x0,y0,x1,y1) tiap sel urutan baca. Jumlah sel harus pas; `equal` membagi rata isi lembar (untuk sel yang bersentuhan).
    count = jumlah sel sebenarnya bila baris terakhir tidak penuh."""
    al = np.asarray(rgba)[..., 3] > 128
    notes: list[str] = []
    ys = np.where(al.any(1))[0]
    if not len(ys):
        raise SheetError('lembar kosong setelah kunci hijau (latar bukan hijau murni?)')
    count = count or cols * rows
    if equal:
        rr = _equal(int(ys.min()), int(ys.max()) + 1, rows)
        notes.append('dibagi rata (--equal)')
    else:
        rr = split_axis(al.any(1), rows)
        if rr is None:
            raise SheetError(f'terdeteksi {len(runs(al.any(1), 6, 3))} baris sel, seharusnya {rows}')
    cells = []
    for i, (y0, y1) in enumerate(rr):
        want = cols if i < len(rr) - 1 else count - cols * (len(rr) - 1)
        band = al[y0:y1]
        if equal:
            bx = np.where(band.any(0))[0]
            cc = _equal(int(bx.min()), int(bx.max()) + 1, want)
        else:
            cc = split_axis(band.any(0), want)
            if cc is None:
                raise SheetError(f'baris y={y0}-{y1}: terdeteksi {len(runs(band.any(0), 6, 3))} sel, seharusnya {want} '
                                 f'(jumlah salah, atau sel bersentuhan: coba --equal)')
        cells += [(x0, y0, x1, y1) for (x0, x1) in cc]
    return cells, notes


def trim(img: Image.Image, box: tuple[int, int, int, int], pad: int = 2) -> Image.Image:
    """Potong sel lalu rapatkan ke isi (alfa > 128)."""
    x0, y0, x1, y1 = box
    sub = img.crop((max(0, x0 - pad), max(0, y0 - pad), min(img.width, x1 + pad), min(img.height, y1 + pad)))
    a = np.asarray(sub)[..., 3] > 128
    rows = np.where(a.sum(1) >= 2)[0]
    cols = np.where(a.sum(0) >= 2)[0]
    if not len(rows) or not len(cols):
        raise SheetError('sel kosong')
    return sub.crop((int(cols[0]), int(rows[0]), int(cols[-1]) + 1, int(rows[-1]) + 1))


# ------------------------------------------------------------------ ukuran dan titik jangkar

def _span(a_row: np.ndarray) -> tuple[float, float] | None:
    c = np.where(a_row)[0]
    return (float(c.min()), float(c.max())) if len(c) else None


def neck_anchor(img: Image.Image) -> tuple[float, float]:
    """(y atas leher, x tengah leher) pada gambar yang sudah dirapatkan.
    Sumbu badan = tengah rentang terisi pada 62-78% tinggi (rok/kaki, tidak terganggu lengan terangkat); leher = baris terisi pertama pada pita sempit
    di sumbu itu, jadi tangan di pelipis atau lengan yang naik di samping leher tidak dikira leher."""
    a = np.asarray(img)[..., 3] > 128
    h, w = a.shape
    centers = [(sp[0] + sp[1]) / 2 for sp in (_span(a[y]) for y in range(int(h * .62), int(h * .78))) if sp]
    axis = float(np.median(centers)) if centers else w / 2
    half = max(6, int(w * .06))
    x0, x1 = max(0, int(axis - half)), min(w, int(axis + half) + 1)
    rows = np.where(a[:, x0:x1].any(1))[0]
    top = int(rows[0])
    sp = _span(a[top:top + 6, x0:x1].any(0))
    return float(top), float(x0 + (sp[0] + sp[1]) / 2)


def stub_anchor(img: Image.Image) -> float:
    """x tengah tunggul leher: rentang terisi pada 6 baris terbawah."""
    a = np.asarray(img)[..., 3] > 128
    sp = _span(a[-6:].any(0))
    return float((sp[0] + sp[1]) / 2)


def canvas_bbox(img: Image.Image) -> tuple[int, int, int, int]:
    a = np.asarray(img)[..., 3] > 128
    ys, xs = np.where(a)
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def _resize(img: Image.Image, s: float) -> Image.Image:
    return img.resize((max(1, round(img.width * s)), max(1, round(img.height * s))), Image.LANCZOS)


@dataclass
class Reference:
    """Ukuran dan jangkar aset depan yang sudah ada, pembanding sel acuan."""
    kind: str
    size: float                      # tinggi (badan/kepala) atau lebar (mulut) bbox pada kanvas
    top: float = 0.0                 # y jangkar pada kanvas
    cx: float = 0.0                  # x jangkar pada kanvas
    top_y: float = 0.0               # y atas bbox pada kanvas (kepala)


def load_reference(folder: Path, meta: dict, ref: str) -> Reference:
    group, sid = ref.split(':')
    ent = {(e.slot.group, e.slot.id): e.filename for e in spec.entries(meta, ['dasar'])}
    f = folder / ent[(group, sid)]
    if not f.is_file():
        raise SheetError(f'aset acuan {f.name} tidak ada')
    with Image.open(f) as im:
        full = im.convert('RGBA')
    x0, y0, x1, y1 = canvas_bbox(full)
    crop = full.crop((x0, y0, x1, y1))
    if group == 'body':
        top, cx = neck_anchor(crop)
        return Reference('body', float(y1 - y0), top + y0, cx + x0)
    if group == 'head':
        return Reference('head', float(y1 - y0), 0, stub_anchor(crop) + x0, float(y0))
    return Reference('mouth', float(x1 - x0))


def sheet_scale(kind: str, ref_cell: Image.Image, ref: Reference) -> float:
    size = ref_cell.width if kind == 'mouth' else ref_cell.height
    return ref.size / float(size)


# ------------------------------------------------------------------ pemrosesan sel

def place_body(cell: Image.Image, scale: float, meta: dict, ref: Reference, fit: bool = False) -> tuple[Image.Image, list[int], dict]:
    cw, ch = spec.canvas_of(meta, 'body') or (800, 1400)
    body = meta.get('body') or {}
    feet, center = int(body.get('feet_y', ch - 25)), int(body.get('center_x', cw // 2))
    note = {}
    for attempt in range(3):
        im = _resize(cell, scale)
        ntop, ncx = neck_anchor(im)
        x0, y0 = round(center - ncx), feet - im.height
        if x0 >= 0 and y0 >= 0 and x0 + im.width <= cw:
            break
        if not fit or attempt == 2:
            raise SheetError(f'badan {im.width}x{im.height} px tidak muat di kanvas {cw}x{ch} pada skala {scale:.3f} (kiri {x0}, atas {y0}, kanan {x0 + im.width}); periksa sel acuan atau pakai --fit')
        need = min(1.0, (center - 1) / max(1.0, ncx), (cw - 1 - center) / max(1.0, im.width - ncx), (feet - 1) / im.height)
        scale *= need * .98
        note['dikecilkan'] = round(scale, 3)
    canvas = Image.new('RGBA', (cw, ch), (0, 0, 0, 0))
    canvas.alpha_composite(im, (x0, y0))
    px, py = (meta.get('head') or {}).get('paste_on_body', [0, 0])
    dx = int(((meta.get('body') or {}).get('head_dx') or {}).get('diam', 0))
    head_at = [int(px + dx + round((center - ref.cx))), int(py + round(y0 + ntop - ref.top))]
    note.update({'skala': round(scale, 4), 'leher': [round(center, 1), round(y0 + ntop, 1)], 'bbox': [x0, y0, x0 + im.width, y0 + im.height]})
    return canvas, head_at, note


def place_head(cell: Image.Image, scale: float, meta: dict, ref: Reference) -> tuple[Image.Image, dict]:
    cw, ch = spec.canvas_of(meta, 'head') or (400, 500)
    im = _resize(cell, scale)
    ncx = stub_anchor(im)
    x0, y0 = round(ref.cx - ncx), round(ref.top_y)
    if x0 < 0 or y0 < 0 or x0 + im.width > cw or y0 + im.height > ch:
        raise SheetError(f'kepala {im.width}x{im.height} px tidak muat di kanvas {cw}x{ch} pada skala {scale:.3f} (kiri {x0}, atas {y0}, kanan {x0 + im.width}, bawah {y0 + im.height})')
    canvas = Image.new('RGBA', (cw, ch), (0, 0, 0, 0))
    canvas.alpha_composite(im, (x0, y0))
    return canvas, {'skala': round(scale, 4), 'bbox': [x0, y0, x0 + im.width, y0 + im.height]}


def place_mouth(cell: Image.Image, scale: float, meta: dict) -> tuple[Image.Image, dict]:
    cw, ch = spec.canvas_of(meta, 'mouth') or (120, 80)
    im = _resize(cell, scale)
    if im.width > cw or im.height > ch:
        raise SheetError(f'mulut {im.width}x{im.height} px lebih besar dari kanvas {cw}x{ch} (skala {scale:.3f})')
    canvas = Image.new('RGBA', (cw, ch), (0, 0, 0, 0))
    canvas.alpha_composite(im, (cw // 2 - im.width // 2, ch // 2 - im.height // 2))
    return canvas, {'skala': round(scale, 4)}


# ------------------------------------------------------------------ orkestrasi

@dataclass
class Imported:
    slot: str
    file: str
    info: dict
    skipped: str | None = None


@dataclass
class Result:
    imported: list[Imported] = field(default_factory=list)
    head_at: dict = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)
    previews: list[str] = field(default_factory=list)
    meta_changed: bool = False


def _debug_overlay(sheet: Image.Image, cells, path: Path, labels: list[str]) -> None:
    bg = Image.new('RGBA', sheet.size, (236, 236, 240, 255))
    bg.alpha_composite(sheet)
    d = ImageDraw.Draw(bg)
    for (x0, y0, x1, y1), lb in zip(cells, labels):
        d.rectangle([x0, y0, x1, y1], outline=(220, 40, 40, 255), width=3)
        d.text((x0 + 6, y0 + 6), lb, fill=(220, 40, 40, 255))
    bg.convert('RGB').save(path)


def import_sheets(folder: Path, manifest: dict, files: dict[str, Path], overwrite: bool = False, equal: bool = False,
                  scale_override: dict[str, float] | None = None, fit: bool = False, dry_run: bool = False) -> Result:
    folder = Path(folder)
    meta = spec.load_meta(folder)
    prefix = manifest['prefix']
    scale_override = scale_override or {}
    res = Result()
    mentah = folder / '_mentah'
    refs: dict[str, Reference] = {}
    out_files: dict[str, Image.Image] = {}

    for sh in manifest['sheets']:
        path = files.get(sh['id'])
        if path is None:
            continue
        if not Path(path).is_file():
            raise SheetError(f'berkas lembar {sh["id"]} tidak ada: {path}')
        keyed = _open_keyed(path)
        want = len(sh['cells'])
        try:
            cells, notes = find_cells(keyed, sh['cols'], sh['rows'], equal, want)
        except SheetError as e:
            raise SheetError(f'lembar {sh["id"]} ({Path(path).name}): {e}') from e
        mentah.mkdir(exist_ok=True)
        _debug_overlay(keyed, cells, mentah / f'_cek_{sh["id"]}.png', [('ACUAN' if c['role'] == 'ref' else c['id']) for c in sh['cells']])
        res.notes += [f'{sh["id"]}: {n}' for n in notes]
        trimmed = [trim(keyed, b) for b in cells]
        if sh['ref'] not in refs:
            refs[sh['ref']] = load_reference(folder, meta, sh['ref'])
        ref = refs[sh['ref']]
        scale = scale_override.get(sh['id'], sheet_scale(sh['group'], trimmed[0], ref))
        res.notes.append(f'{sh["id"]}: skala lembar {scale:.4f}' + (' (manual)' if sh['id'] in scale_override else ' (dari sel acuan)'))
        if not .15 < scale < 6:
            raise SheetError(f'lembar {sh["id"]}: skala {scale:.3f} tidak masuk akal; sel acuan salah dikenali? Lihat {mentah / ("_cek_" + sh["id"] + ".png")}')

        for cell, spec_cell in zip(trimmed[1:], sh['cells'][1:]):
            group, sid = spec_cell['group'], spec_cell['id']
            slot = spec.Slot(manifest['pack'], group, sid, sid)
            fname = slot.filename(prefix)
            target = folder / fname
            if target.exists() and not overwrite:
                res.imported.append(Imported(f'{group}:{sid}', fname, {}, skipped='sudah ada (pakai --overwrite)'))
                continue
            if group == 'body':
                img, head_at, info = place_body(cell, scale, meta, ref, fit)
                info['head_at'] = head_at
                res.head_at[sid] = head_at
            elif group == 'head':
                img, info = place_head(cell, scale, meta, ref)
            else:
                img, info = place_mouth(cell, scale, meta)
            out_files[fname] = img
            res.imported.append(Imported(f'{group}:{sid}', fname, info))

    mouth_views = sorted({spec_cell['id'].split('_', 1)[1] for sh in manifest['sheets'] if sh['id'] in files for spec_cell in sh['cells'][1:]
                          if spec_cell['group'] == 'mouth' and '_' in spec_cell['id']})
    have_at = (meta.get('mouth') or {}).get('at') or {}
    for v in mouth_views:
        if v not in have_at:
            res.notes.append(f'mulut tampak {v}: isi mouth.at["{v}"] = [x, y] (kiri-atas kanvas mulut pada kanvas kepala {v}) di character.json agar posisinya benar')
    if not dry_run:
        for fname, img in out_files.items():
            img.save(folder / fname, format='PNG')
        if res.head_at:
            body = meta.setdefault('body', {})
            body.setdefault('head_at', {}).update(res.head_at)
        spec_meta = meta.get('spec') if isinstance(meta.get('spec'), dict) else {}
        packs = list(spec_meta.get('packs', spec.DEFAULT_PACKS))
        have = {e.filename for e in spec.entries(meta, [manifest['pack']], prefix) if (folder / e.filename).is_file() or e.filename in out_files}
        required_ok = all(e.filename in have for e in spec.entries(meta, [manifest['pack']], prefix) if e.slot.required)
        if required_ok and manifest['pack'] not in packs:
            packs.append(manifest['pack'])
            res.notes.append(f'paket {manifest["pack"]} lengkap dan diaktifkan di character.json')
        elif not required_ok:
            res.notes.append(f'paket {manifest["pack"]} belum lengkap (slot wajib masih ada yang kosong); belum diaktifkan')
        meta['spec'] = {'version': spec.SPEC_VERSION, 'packs': packs, 'mirror_ok': spec_meta.get('mirror_ok', True)}
        extra = spec.build_extra(meta, folder, prefix)
        if extra:
            meta['extra'] = extra
        else:
            meta.pop('extra', None)
        spec.write_meta(folder, meta)
        res.meta_changed = True
        res.previews = contact_sheet(folder, meta, manifest, res)
    return res


NECK_PIVOT = (200, 379)      # tunggul leher pada kanvas kepala 400x500 (newchar.CANON: head_cx, head_top + head_h)


def tilt_head(head: Image.Image, rot: float, pivot: tuple[int, int] = NECK_PIVOT) -> tuple[Image.Image, int]:
    """Kepala dimiringkan `rot` derajat (+ = searah jarum jam) mengelilingi leher. Mengembalikan (gambar berbingkai lebih besar, margin):
    tempel di (x - margin, y - margin) agar titik leher tetap di tempatnya."""
    if not rot:
        return head, 0
    m = 120
    pad = Image.new('RGBA', (head.width + 2 * m, head.height + 2 * m), (0, 0, 0, 0))
    pad.alpha_composite(head, (m, m))
    return pad.rotate(-rot, resample=Image.BICUBIC, center=(pivot[0] + m, pivot[1] + m)), m


def head_for_slot(folder: Path, meta: dict, sid: str, fallback: Path | None) -> Path | None:
    """Kepala yang dipakai untuk badan `sid`: badan tampak 3/4 (…_34) atau samping (…_sisi) memakai kepala netral tampak itu bila ada, kalau tidak kepala depan."""
    prefix = spec.prefix_of(meta, Path(folder).name)
    for tag in ('34', 'sisi'):
        if sid.endswith('_' + tag):
            f = Path(folder) / f'{prefix}_kepala_netral_{tag}.png'
            if f.is_file():
                return f
    return fallback


def contact_sheet(folder: Path, meta: dict, manifest: dict, res: Result) -> list[str]:
    """Badan baru dengan kepala netral di titik head_at, dan kepala baru di atas badan diam, untuk pemeriksaan mata."""
    ent = {(e.slot.group, e.slot.id): e.filename for e in spec.entries(meta, ['dasar'])}
    head_ref = folder / ent[('head', 'netral')] if ('head', 'netral') in ent else None
    rots = (meta.get('body') or {}).get('head_rot') or {}
    diam = folder / ent[('body', 'diam')] if ('body', 'diam') in ent else None
    tiles: list[tuple[str, Image.Image]] = []
    prefix = manifest['prefix']
    px, py = (meta.get('head') or {}).get('paste_on_body', [0, 0])
    dx = int(((meta.get('body') or {}).get('head_dx') or {}).get('diam', 0))
    for it in res.imported:
        if it.skipped or not (folder / it.file).is_file():
            continue
        group, sid = it.slot.split(':')
        with Image.open(folder / it.file) as src:
            img = src.convert('RGBA')
        if group == 'body' and head_ref and head_ref.is_file() and sid in res.head_at:
            hf = head_for_slot(folder, meta, sid, head_ref)
            with Image.open(hf) as h:
                hh, mg = tilt_head(h.convert('RGBA'), float(rots.get(sid, 0) or 0))
                x, y = res.head_at[sid]
                img.alpha_composite(hh, (max(0, x - mg), max(0, y - mg)), (max(0, mg - x), max(0, mg - y)) if mg else (0, 0))
        elif group == 'head' and diam and diam.is_file():
            with Image.open(diam) as b:
                base = b.convert('RGBA')
            base.alpha_composite(img, (int(px + dx), int(py)))
            img = base
        elif group == 'mouth':
            bg = Image.new('RGBA', img.size, (236, 236, 240, 255)); bg.alpha_composite(img); img = bg
        box = img.getbbox()
        tiles.append((sid, img.crop(box) if box else img))
    if not tiles:
        return []
    h = 420
    tiles = [(s, t.resize((max(1, round(t.width * h / t.height)), h), Image.LANCZOS)) for s, t in tiles]
    sheet = Image.new('RGBA', (sum(t.width for _, t in tiles) + 16 * (len(tiles) + 1), h + 50), (236, 236, 240, 255))
    d = ImageDraw.Draw(sheet)
    x = 16
    for sid, t in tiles:
        sheet.alpha_composite(t, (x, 16))
        d.text((x, h + 24), sid, fill=(60, 60, 70, 255))
        x += t.width + 16
    out = folder / '_mentah' / f'_cek_{manifest["pack"]}.png'
    sheet.convert('RGB').save(out)
    return [str(out)]

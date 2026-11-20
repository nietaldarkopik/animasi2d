"""Karakter kartu BARU dari lembar Flow (paket "dasar": 9 pose badan, 10 ekspresi, 5 mulut, kelopak).

Menggantikan _proses/proses.py yang berisi koordinat sel dan faktor skala hasil ukur tangan per karakter. Semua ukuran dinormalkan ke STANDAR yang diukur dari
Arum, Riska, dan Seni (satu standar; Uki memakai template lama yang berbeda):
  badan polos berdiri setinggi 1099 px, leher di y=275, kaki di y=1375, tengah x=400
  kepala setinggi 304 px (puncak rambut sampai bawah leher/kerah) mulai y=75, tunggul leher di x=200 pada kanvas 400x500
Tiga hal tidak bisa dideteksi dari gambar dan dikalibrasi manusia (klik pada kepala netral): dagu, pusat mulut, dan posisi kedua mata.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from . import prompts as P
from . import sheets as S
from . import spec

CANON = {
    'body_canvas': (800, 1400), 'feet_y': 1375, 'center_x': 400, 'char_height_px': 1300, 'hair_top': 75,
    'body_h': 1099, 'neck_top': 275,
    'head_canvas': (400, 500), 'head_top': 75, 'head_h': 304, 'head_cx': 200, 'paste_on_body': (200, 0),
    'mouth_canvas': (120, 80), 'mouth_mask_w': 33,
    # tambalan kulit mulut (px kanvas, diukur dari overlay Arum): elips 28x13 + pelebaran 4 + blur 1,4, dipotong persegi 35x18 di sekitar mulut
    'patch_rx': 14.3, 'patch_ry': 6.4, 'patch_dilate': 3.9, 'patch_blur': 1.4, 'patch_half': (17.3, 9.2),
    'lid_w_ratio': 0.493,
}
DEFAULT_CALIB = {'chin_y': 284, 'mouth': [199, 258], 'eyes': [[163, 215], [232, 215]], 'mouth_scale': 1.0, 'lid_scale': 1.0,
                 'head_dx': 0, 'head_dy': 0, 'head_rot': 0.0}
POSES = ['diam', 'tunjuk', 'angkat', 'lambai', 'pinggang', 'pelipis', 'dagu', 'jempol', 'silang']
EXPRESSIONS = ['netral', 'senang', 'kaget', 'sinis', 'sedih', 'marah', 'bingung', 'mengantuk', 'sombong', 'malu']
VOWELS = ['a', 'i', 'u', 'e', 'o']
BLINK_SKIP = ['mengantuk', 'sinis', 'sombong', 'malu']
BODY_TEXT = {
    'diam': 'standing with arms relaxed beside the body, front view',
    'tunjuk': 'right arm pointing up and sideways with the index finger extended',
    'angkat': 'both hands raised up',
    'lambai': 'right hand waving at head height',
    'pinggang': 'both hands on the hips',
    'pelipis': 'right hand touching the temple, with the hand shown beside the top of the neck and shoulder',
    'dagu': 'right hand at chin level and the left arm across the stomach',
    'jempol': 'right thumbs-up',
    'silang': 'arms crossed over the chest',
}
HEAD_TEXT = {
    'netral': 'neutral', 'senang': 'happy (gentle smile)', 'kaget': 'surprised (wide eyes, small round mouth)', 'sinis': 'smug (smirk, one brow raised)', 'sedih': 'sad',
    'marah': 'angry', 'bingung': 'confused (tilted brow, wavy mouth)', 'mengantuk': 'sleepy (heavy half-closed lids)', 'sombong': 'proud (chin up)',
    'malu': 'embarrassed (blush, eyes looking aside)',
}
MOUTH_TEXT = {'a': 'A (wide open)', 'i': 'I (flat and wide with teeth showing)', 'u': 'U (small round pucker)', 'e': 'E (medium open)', 'o': 'O (round open)'}

ACUAN_TEXT = ('CHARACTER REFERENCE: Use the attached reference image as the PRIMARY and AUTHORITATIVE source for the character\'s identity and appearance. Reproduce the exact character '
              'shown, including apparent gender, age appearance, face, hairstyle, hair color, eye shape, eye color, skin tone, body proportions, accessories, glasses, clothing, outfit design, '
              'footwear, and all visible details. Do not assume or change the character\'s gender. Do not invent, remove, replace, or redesign any physical characteristics or accessories. '
              'Apply only the specified Japanese anime art style while preserving the reference character\'s original identity.\n\n'
              'BACKGROUND - STRICT CHROMA KEY GREEN: Completely replace the original background with a perfectly solid, uniform, pure chroma key green background, exact RGB(0,255,0) / HEX #00FF00, '
              'edge to edge. No original background, no white or transparent areas, no scenery, no objects, no floor, no shadows, no gradients, no textures. Do not apply green tint or reflections '
              'to any part of the character.\n\n'
              'OUTPUT: ONE full-body image of the reference character standing upright, arms relaxed naturally beside the body, neutral expression, mouth closed, eyes open, facing the camera, '
              'entire body visible from head to feet, centered and displayed large, with sufficient empty green space around the character. No text, labels, numbers, borders, panels, or watermark.')


def draft_dir(karakter_root: Path, slug: str) -> Path:
    return Path(karakter_root) / '_draf' / slug


# ------------------------------------------------------------------ rencana lembar dan prompt

def plan(slug: str) -> list[dict]:
    """Lembar yang dibutuhkan. `ref` = sel pertama adalah acuan ukuran (dibuang kecuali bila ia juga slot)."""
    def body(sid, poses, ref_extra):
        cells = ([{'role': 'ref', 'group': 'body', 'id': 'diam', 'text': 'SIZE REFERENCE: standing with arms relaxed beside the body, front view'}] if ref_extra else [])
        cells += [{'role': 'slot', 'group': 'body', 'id': p, 'text': BODY_TEXT[p]} for p in poses]
        return {'id': sid, 'group': 'body', 'cols': len(cells), 'rows': 1, 'cells': cells, 'required': True}
    sheets = [
        {'id': 'acuan', 'group': 'acuan', 'cols': 1, 'rows': 1, 'cells': [], 'required': False},
        {'id': 'kepala', 'group': 'head', 'cols': 5, 'rows': 2, 'required': True,
         'cells': [{'role': 'slot', 'group': 'head', 'id': e, 'text': HEAD_TEXT[e]} for e in EXPRESSIONS]},
        body('badan_a', ['diam', 'tunjuk', 'angkat'], False),
        body('badan_b', ['lambai', 'pinggang', 'pelipis'], True),
        body('badan_c', ['dagu', 'jempol', 'silang'], True),
        {'id': 'mulut', 'group': 'mouth', 'cols': 5, 'rows': 1, 'required': True,
         'cells': [{'role': 'slot', 'group': 'mouth', 'id': v, 'text': MOUTH_TEXT[v]} for v in VOWELS]},
        {'id': 'kelopak', 'group': 'blink', 'cols': 2, 'rows': 1, 'required': False,
         'cells': [{'role': 'slot', 'group': 'blink', 'id': 'kiri', 'text': 'closed left eyelid'}, {'role': 'slot', 'group': 'blink', 'id': 'kanan', 'text': 'closed right eyelid'}]},
    ]
    for sh in sheets:
        sh['file'] = f'{slug}_{sh["id"]}.png' if sh['id'] != 'acuan' else f'{slug}_acuan.png'
    return sheets


def _sheet_text(sh: dict, appearance: str, name: str) -> str:
    n = len(sh['cells'])
    order = ' '.join(f'({i + 1}) {c["text"]};' for i, c in enumerate(sh['cells']))
    head = f'{P.STYLE} {P.BACKGROUND} {P.REFERENCE} Character: {appearance}. Match the attached reference image exactly: same colors, face shape, outfit and outline weight. '
    if sh['id'] == 'kepala':
        return head + (f'ONE image: grid of 5 columns x 2 rows with 10 HEAD-ONLY items (head, ears, hair, glasses and accessories if any, face, short neck stub) in square cells with clear green '
                       f'space between them, identical head size and position, eyes open, mouth closed or small natural mouth. Order left to right, top to bottom: {order} Smug and sleepy must look clearly different.')
    if sh['group'] == 'body':
        return head + (f'ONE image. Body only, NO HEAD, stop at the neck base and collar: shoulders, torso, both arms, hands, legs, shoes. Feet on the same horizontal level, same body size and '
                       f'same horizontal center in each cell. Hands clear with 5 fingers. {n} tall portrait cells side by side, {n} columns x 1 row, with clear green space between cells. '
                       f'No sitting, running or dynamic poses. {P.BODY_RULES} Poses left to right: {order}')
    if sh['id'] == 'mulut':
        return head + (f'ONE image: 1 row x 5 cells with MOUTH-ONLY close-ups on a small patch of the skin color, no face, no head, with clear green space between cells. Simple anime style: '
                       f'dark opening, small teeth hint, tongue only in A. Same size and same center in all cells. Same lip and skin colors as {name}. Vowel shapes left to right: {order}')
    return head + (f'ONE image: only {name}\'s two closed eyelids (skin-colored lids with a curved lash line), as if laid over open eyes, same eye spacing and size as in the reference head, '
                   f'side by side with clear green space between them. NO glasses, NO head, NO other face parts.')


def build_prompts(folder: Path, slug: str, name: str, appearance: str, style: str = '') -> dict:
    """Tulis _mentah/prompt_dasar.txt dan manifest_dasar.json (juga character.json awal berisi nama dan appearance)."""
    folder = Path(folder)
    if not spec.SLUG_RE.match(slug):
        raise ValueError('nama folder hanya boleh huruf/angka/_/- dan diawali huruf atau angka')
    if not appearance.strip():
        raise ValueError('appearance (deskripsi penampilan dalam bahasa Inggris) wajib diisi')
    mentah = folder / '_mentah'
    mentah.mkdir(parents=True, exist_ok=True)
    sheets = plan(slug)
    lines = [f'PROMPT GOOGLE FLOW - KARAKTER BARU - {name} ({len(sheets)} generate). Salin SELURUH teks di bawah tiap judul; tidak ada yang perlu diganti.',
             f'Hasil tiap generate: unduh resolusi tertinggi, simpan di {mentah}\\ dengan nama yang disebut.', 'Generate 1 (ACUAN) dimulai dari gambar/lembar karakter Anda sendiri: lampirkan sebagai referensi.',
             'Generate berikutnya melampirkan hasil ACUAN. Kelopak mata boleh dilewati (karakter tanpa kedip).', '']
    for i, sh in enumerate(sheets, 1):
        if sh['id'] == 'acuan':
            text, attach = f'{P.STYLE}\n\n{ACUAN_TEXT}', ['(gambar karakter Anda)']
        else:
            text, attach = _sheet_text(sh, appearance, name), [f'{slug}_acuan.png']
        sh['attach'], sh['text'] = attach, text
        lines += [f'##### GENERATE {i} - {sh["id"].upper()} | LAMPIRKAN: {", ".join(attach)} | simpan: {sh["file"]}' + ('  (opsional)' if not sh['required'] else ''), text, '']
    lines += ['##### JIKA HASIL SALAH (tambahkan 1 kalimat ke prompt lalu generate ulang)'] + [f'- {f}' for f in P.FIXES]
    (mentah / 'prompt_dasar.txt').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    manifest = {'version': 1, 'pack': 'dasar', 'character': slug, 'prefix': slug, 'name': name, 'appearance': appearance, 'style': style, 'sheets': sheets}
    (mentah / 'manifest_dasar.json').write_text(json.dumps(manifest, indent=1, ensure_ascii=False), encoding='utf-8')
    return manifest


# ------------------------------------------------------------------ pemrosesan

def _skin_of_head(head: Image.Image, calib: dict) -> np.ndarray:
    """Warna kulit wajah: median piksel padat di antara mata dan mulut (area hidung dan pipi)."""
    a = np.asarray(head.convert('RGBA'))
    (lx, ly), (rx, ry) = calib['eyes']
    mx, my = calib['mouth']
    x0, x1 = int(min(lx, rx)), int(max(lx, rx))
    y0, y1 = int(max(ly, ry) + 14), int(my - 12)
    if y1 - y0 < 4 or x1 - x0 < 4:
        y0, y1, x0, x1 = int(my - 40), int(my - 14), int(mx - 30), int(mx + 30)
    px = a[y0:y1, x0:x1].reshape(-1, 4)
    px = px[px[:, 3] > 240][:, :3]
    return np.median(px, axis=0) if len(px) else np.array([240.0, 214.0, 200.0])


def _odd(n: float) -> int:
    k = max(3, int(round(n)))
    return k if k % 2 else k + 1


def build_mouth(cell: Image.Image, skin_head: np.ndarray, scale: float, canvas: tuple[int, int] = (120, 80)) -> tuple[Image.Image, float]:
    """Satu bentuk mulut: mulut digambar di atas tambalan kulit lembut berwarna kulit kepala, supaya menutup mulut bawaan kepala tanpa pinggiran.
    Skala dihitung dari lebar mulut sel A (bila `scale` None pada pemanggil); di sini `scale` sudah pasti. Mengembalikan (gambar, lebar mask sel)."""
    arr = np.asarray(cell.convert('RGBA')).astype(np.float32)
    h, w = arr.shape[:2]
    alpha = arr[..., 3] / 255.0
    ring = np.zeros((h, w), bool)
    ring[: max(2, int(.12 * h))] = ring[-max(2, int(.12 * h)):] = True
    ring[:, : max(2, int(.12 * w))] = ring[:, -max(2, int(.12 * w)):] = True
    ring_px = arr[ring & (alpha > .8)][:, :3]
    skin_c = np.median(ring_px, axis=0) if len(ring_px) > 40 else skin_head
    diff = np.abs(arr[..., :3] - skin_c).sum(2)
    inner = np.zeros((h, w), bool)
    inner[int(.18 * h): int(.88 * h), int(.1 * w): int(.9 * w)] = True
    mask = (diff > 70) & inner & (alpha > .5)
    if mask.sum() < 8:
        mask = (alpha > .5) & inner
    ys, xs = np.where(mask)
    cx, cy = (xs.min() + xs.max()) / 2, (ys.min() + ys.max()) / 2
    mask_w = float(xs.max() - xs.min() + 1)
    k = max(scale, 1e-3)
    m = Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(_odd(CANON['patch_dilate'] / k)))
    yy, xx = np.mgrid[:h, :w]
    ell = (((xx - cx) / (CANON['patch_rx'] / k)) ** 2 + ((yy - cy) / (CANON['patch_ry'] / k)) ** 2) <= 1
    base = (np.maximum(np.asarray(m) > 0, ell)).astype(np.uint8) * 255
    soft = np.asarray(Image.fromarray(base).filter(ImageFilter.GaussianBlur(max(1.0, CANON['patch_blur'] / k))))
    rgb = np.where(mask[..., None], arr[..., :3], np.asarray(skin_head, dtype=np.float32)[None, None, :]).clip(0, 255).astype(np.uint8)
    patch = Image.fromarray(np.dstack([rgb, soft]), 'RGBA')
    hx, hy = CANON['patch_half']
    patch = patch.crop((int(round(cx - hx / k)), int(round(cy - hy / k)), int(round(cx + hx / k)), int(round(cy + hy / k))))
    patch = patch.resize((max(1, round(patch.width * k)), max(1, round(patch.height * k))), Image.LANCZOS)
    out = Image.new('RGBA', canvas, (0, 0, 0, 0))
    _paste_clipped(out, patch, canvas[0] / 2, canvas[1] / 2)
    return out, mask_w


MIN_MOUTH_INK = 20       # piksel mulut/garis bibir minimal; karakter yang baik punya >= 50 pada tiap bentuk (diukur dari arum, uki, riska, seni)


def mouth_ink(img: Image.Image, skin) -> int:
    """Jumlah piksel padat yang warnanya jelas berbeda dari kulit: bukaan mulut, bibir, gigi. 0 = tambalan kulit polos (mulut tidak terdeteksi)."""
    a = np.asarray(img.convert('RGBA')).astype(int)
    d = np.abs(a[..., :3] - np.asarray(skin, dtype=int)).sum(2)
    return int(((a[..., 3] > 200) & (d > 70)).sum())


def build_lids(cells: list[Image.Image], eyes: list[list[float]], skin_head: np.ndarray, size_mult: float, canvas: tuple[int, int]) -> Image.Image:
    """Kedua kelopak tertutup ditempatkan di kedua mata. Skala dari LEBAR kelopak (bukan jarak di lembar, yang tidak dijaga AI):
    lebar kelopak = 0,493 x jarak antar mata (diukur dari Arum), dikali `size_mult`."""
    spacing_eyes = abs(eyes[1][0] - eyes[0][0])
    mean_w = float(np.mean([c.width for c in cells]))
    k = size_mult * CANON['lid_w_ratio'] * spacing_eyes / max(mean_w, 1.0)
    out = Image.new('RGBA', canvas, (0, 0, 0, 0))
    for cell, (ex, ey) in zip(cells, eyes):
        a = np.asarray(cell.convert('RGBA')).astype(np.float32)
        solid = a[a[..., 3] > 200][:, :3]
        if len(solid):
            skin_l = np.median(solid, axis=0)
            near = (np.abs(a[..., :3] - skin_l).sum(2) < 60)[..., None]
            a[..., :3] = np.where(near, (a[..., :3] * (np.asarray(skin_head) / np.maximum(skin_l, 1))).clip(0, 255), a[..., :3])
        p = Image.fromarray(a.astype(np.uint8), 'RGBA')
        p = p.resize((max(1, round(p.width * k)), max(1, round(p.height * k))), Image.LANCZOS)
        _paste_clipped(out, p, ex, ey)
    return out


def _paste_clipped(canvas: Image.Image, im: Image.Image, cx: float, cy: float) -> None:
    x, y = round(cx - im.width / 2), round(cy - im.height / 2)
    cw, ch = canvas.size
    sx, sy = max(0, -x), max(0, -y)
    ex, ey = min(im.width, cw - x), min(im.height, ch - y)
    if ex > sx and ey > sy:
        canvas.alpha_composite(im.crop((sx, sy, ex, ey)), (x + sx, y + sy))


def _place_body_dasar(cell: Image.Image, scale: float, fit: bool) -> tuple[Image.Image, dict]:
    """Badan polos ditempatkan dengan lehernya di (center_x, neck_top); kaki jatuh sesuai tinggi pose itu."""
    cw, ch = CANON['body_canvas']
    cx, nt = CANON['center_x'], CANON['neck_top']
    for attempt in range(2):
        im = S._resize(cell, scale)
        ntop, ncx = S.neck_anchor(im)
        left, right, up, down = ncx, im.width - ncx, ntop, im.height - ntop
        if left <= cx and right <= cw - cx and up <= nt and down <= ch - nt:
            break
        if not fit or attempt == 1:
            raise S.SheetError(f'badan {im.width}x{im.height} px tidak muat di kanvas {cw}x{ch} dengan leher di ({cx},{nt}) '
                               f'(kiri {left:.0f}/{cx}, kanan {right:.0f}/{cw - cx}, atas {up:.0f}/{nt}, bawah {down:.0f}/{ch - nt}); periksa sel acuan atau pakai --fit')
        scale *= min(1.0, cx / max(1.0, left), (cw - cx) / max(1.0, right), nt / max(1.0, up), (ch - nt) / max(1.0, down)) * .98
    x0, y0 = round(cx - ncx), round(nt - ntop)
    out = Image.new('RGBA', (cw, ch), (0, 0, 0, 0))
    out.alpha_composite(im, (x0, y0))
    return out, {'skala': round(scale, 4), 'bbox': [x0, y0, x0 + im.width, y0 + im.height]}


def _place_head_dasar(cell: Image.Image, scale: float, dx: float = 0, dy: float = 0, rot: float = 0.0) -> tuple[Image.Image, dict]:
    """Kepala ditempatkan dengan tunggul lehernya di (head_cx, head_top + tinggi). `rot` (derajat, + = searah jarum jam) memutar kepala
    mengelilingi titik leher itu (untuk kepala yang miring); `dx`/`dy` menggeser hasilnya. Tanpa ketiganya hasil sama seperti sebelumnya."""
    cw, ch = CANON['head_canvas']
    im = S._resize(cell, scale)
    sx = S.stub_anchor(im)
    if not (dx or dy or rot):
        x0, y0 = round(CANON['head_cx'] - sx), CANON['head_top']
        if x0 < 0 or x0 + im.width > cw or y0 + im.height > ch:
            raise S.SheetError(f'kepala {im.width}x{im.height} px tidak muat di kanvas {cw}x{ch} (kiri {x0}, kanan {x0 + im.width}, bawah {y0 + im.height})')
        out = Image.new('RGBA', (cw, ch), (0, 0, 0, 0))
        out.alpha_composite(im, (x0, y0))
        return out, {'skala': round(scale, 4), 'bbox': [x0, y0, x0 + im.width, y0 + im.height]}
    m = max(im.width, im.height) // 2 + 2
    pad = Image.new('RGBA', (im.width + 2 * m, im.height + 2 * m), (0, 0, 0, 0))
    pad.alpha_composite(im, (m, m))
    if rot:
        pad = pad.rotate(-rot, resample=Image.BICUBIC, center=(sx + m, im.height + m))
    out = Image.new('RGBA', (cw, ch), (0, 0, 0, 0))
    ox, oy = round(CANON['head_cx'] + dx - (sx + m)), round(CANON['head_top'] + dy - m)
    cx0, cy0 = max(0, -ox), max(0, -oy)
    cx1, cy1 = min(pad.width, cw - ox), min(pad.height, ch - oy)
    if cx1 > cx0 and cy1 > cy0:
        out.alpha_composite(pad.crop((cx0, cy0, cx1, cy1)), (ox + cx0, oy + cy0))
    bb = out.getbbox()
    if bb is None or bb[0] <= 0 or bb[2] >= cw or bb[3] >= ch:
        raise S.SheetError('kepala keluar dari kanvas setelah digeser/diputar; kurangi geseran atau putaran')
    return out, {'skala': round(scale, 4), 'bbox': list(bb), 'rot': rot, 'dx': dx, 'dy': dy}


def build_meta(slug: str, name: str, appearance: str, style: str, calib: dict, has_blink: bool, existing: dict | None = None) -> dict:
    mx, my = calib['mouth']
    meta = dict(existing or {})
    meta.update({
        'name': name, 'style': style or 'japanese-anime cel-shade', 'appearance': appearance,
        'source': 'Flow, diimpor oleh tools/card_builder (kunci hijau, deteksi sel, skala dari sel acuan)',
        'body': {'canvas': list(CANON['body_canvas']), 'feet_y': CANON['feet_y'], 'center_x': CANON['center_x'], 'hair_top_y_when_headed': CANON['hair_top'],
                 'char_height_px': CANON['char_height_px'], 'poses': POSES, 'file': f'{slug}_badan_<pose>.png', 'head_dx': {p: 0 for p in POSES}},
        'head': {'canvas': list(CANON['head_canvas']), 'paste_on_body': list(CANON['paste_on_body']), 'chin_y': int(calib['chin_y']), 'expressions': EXPRESSIONS,
                 'file': f'{slug}_kepala_<ekspresi>.png', 'note': 'kepala utuh termasuk leher dan kerah dari lembar (menyatu dengan badan); bukan hair-only'},
        'mouth': {'canvas': list(CANON['mouth_canvas']), 'center_on_head': [int(mx), int(my)], 'paste_on_head_topleft': [int(mx - CANON['mouth_canvas'][0] / 2), int(my - CANON['mouth_canvas'][1] / 2)],
                  'shapes': VOWELS, 'file': f'{slug}_mulut_<bentuk>.png', 'note': 'tutup = mulut bawaan kepala; a/i/u/e/o ditimpa saat bicara'},
        'blender_card': 'bidang 800x1400 px; kepala/mulut/kelopak = bidang anak yang ditempel pada koordinat di atas (z sedikit di depan badan)',
        'calibration': {k: calib[k] for k in ('chin_y', 'mouth', 'eyes', 'mouth_scale', 'lid_scale', 'head_dx', 'head_dy', 'head_rot')},
    })
    if has_blink:
        meta['blink'] = {'file': f'{slug}_kelopak.png', 'canvas': list(CANON['head_canvas']), 'paste_on_head_topleft': [0, 0], 'eyes_on_head': [list(map(int, e)) for e in calib['eyes']],
                         'blink_ok': [e for e in EXPRESSIONS if e not in BLINK_SKIP], 'skip': BLINK_SKIP}
    else:
        meta.pop('blink', None)
    meta.setdefault('spec', {'version': spec.SPEC_VERSION, 'packs': ['dasar'], 'mirror_ok': True})
    return meta


def _merge_calib(calib: dict | None, saved: dict | None) -> dict:
    out = json.loads(json.dumps(DEFAULT_CALIB))
    for src in (saved or {}, calib or {}):
        for k in out:
            if k in src and src[k] is not None:
                out[k] = src[k]
    return out


def import_dasar(folder: Path, manifest: dict, files: dict[str, Path] | None = None, calib: dict | None = None, fit: bool = False, equal: bool = False) -> dict:
    """Memproses semua lembar dasar yang ada (di `files` atau _mentah/<berkas>) menjadi 25 berkas kartu + character.json di `folder`.
    Wajib: kepala, badan_a/b/c, mulut. Opsional: kelopak. -> {notes, items, missing, previews, calib}."""
    folder = Path(folder)
    slug = manifest['prefix']
    mentah = folder / '_mentah'
    notes: list[str] = []
    items: list[dict] = []
    files = dict(files or {})
    by_id = {sh['id']: sh for sh in manifest['sheets']}
    for sid, sh in by_id.items():
        p = files.get(sid) or (mentah / sh['file'])
        if Path(p).is_file():
            files[sid] = Path(p)
    missing = [sid for sid, sh in by_id.items() if sh['required'] and sid not in files]
    if missing:
        raise S.SheetError('lembar wajib belum ada: ' + ', '.join(by_id[m]['file'] for m in missing))
    old_meta = spec.load_meta(folder) if (folder / 'character.json').is_file() else {}
    cal = _merge_calib(calib, old_meta.get('calibration'))
    out_imgs: dict[str, Image.Image] = {}

    def keyed(sid):
        return S._open_keyed(files[sid])

    def cells_of(sid, k):
        sh = by_id[sid]
        c, n = S.find_cells(k, sh['cols'], sh['rows'], equal, len(sh['cells']))
        if n:
            notes.extend(f'{sid}: {x}' for x in n)
        S._debug_overlay(k, c, mentah / f'_cek_{sid}.png', [('ACUAN' if x['role'] == 'ref' else x['id']) for x in sh['cells']])
        return [S.trim(k, b) for b in c], c

    # kepala: skala dari kepala netral
    kk = keyed('kepala')
    head_cells, _ = cells_of('kepala', kk)
    hs = CANON['head_h'] / head_cells[0].height
    notes.append(f'kepala: skala {hs:.4f} (dari kepala netral)')
    for sc, cell in zip(by_id['kepala']['cells'], head_cells):
        img, info = _place_head_dasar(cell, hs, cal['head_dx'], cal['head_dy'], cal['head_rot'])
        out_imgs[f'{slug}_kepala_{sc["id"]}.png'] = img
        items.append({'slot': f'head:{sc["id"]}', 'file': f'{slug}_kepala_{sc["id"]}.png', **info})

    # badan: skala per lembar dari sel acuan (badan_a: pose diam itu sendiri)
    for sid in ('badan_a', 'badan_b', 'badan_c'):
        k = keyed(sid)
        cells, _ = cells_of(sid, k)
        s = CANON['body_h'] / cells[0].height
        notes.append(f'{sid}: skala {s:.4f} (dari sel acuan)')
        for sc, cell in zip(by_id[sid]['cells'], cells):
            if sc['role'] == 'ref':
                continue
            img, info = _place_body_dasar(cell, s, fit)
            out_imgs[f'{slug}_badan_{sc["id"]}.png'] = img
            items.append({'slot': f'body:{sc["id"]}', 'file': f'{slug}_badan_{sc["id"]}.png', **info})

    # mulut: skala dari lebar mulut A
    skin = _skin_of_head(out_imgs[f'{slug}_kepala_netral.png'], cal)
    mk = keyed('mulut')
    mouth_cells, _ = cells_of('mulut', mk)
    probe = [build_mouth(c, skin, 1.0, (400, 300))[1] for c in mouth_cells]
    ms = CANON['mouth_mask_w'] / max(probe[0], 1.0) * float(cal['mouth_scale'])
    notes.append(f'mulut: skala {ms:.4f} (dari lebar mulut A)')
    for sc, cell in zip(by_id['mulut']['cells'], mouth_cells):
        img, _w = build_mouth(cell, skin, ms, tuple(CANON['mouth_canvas']))
        out_imgs[f'{slug}_mulut_{sc["id"]}.png'] = img
        if mouth_ink(img, skin) < MIN_MOUTH_INK:
            notes.append(f'mulut {sc["id"].upper()}: tidak ada bukaan atau garis mulut yang terdeteksi (hasilnya tambalan kulit polos, mulut tidak akan berubah saat dipilih). '
                         f'Lihat _cek_mulut.png: sel ke-{VOWELS.index(sc["id"]) + 1} dari kiri harus berisi mulut {sc["id"].upper()} yang jelas (gelap/merah), lalu unggah ulang lembar mulut.')
        items.append({'slot': f'mouth:{sc["id"]}', 'file': f'{slug}_mulut_{sc["id"]}.png', 'skala': round(ms, 4)})

    # kelopak (opsional): skala dari jarak antar mata hasil kalibrasi
    has_blink = 'kelopak' in files
    if has_blink:
        lk = keyed('kelopak')
        lid_cells, _boxes = cells_of('kelopak', lk)
        out_imgs[f'{slug}_kelopak.png'] = build_lids(lid_cells, cal['eyes'], skin, float(cal['lid_scale']), tuple(CANON['head_canvas']))
        items.append({'slot': 'blink:kelopak', 'file': f'{slug}_kelopak.png'})
    else:
        notes.append('kelopak: dilewati (karakter tanpa kedip)')

    for fname, img in out_imgs.items():
        img.save(folder / fname, format='PNG')
    meta = build_meta(slug, manifest['name'], manifest['appearance'], manifest.get('style', ''), cal, has_blink, old_meta)
    spec.write_meta(folder, meta)
    previews = _contact_sheet(folder, meta, slug)
    return {'notes': notes, 'items': items, 'missing': [], 'previews': previews, 'calib': cal, 'has_blink': has_blink}


def _contact_sheet(folder: Path, meta: dict, slug: str) -> list[str]:
    """Semua pose dengan kepala netral di atasnya, lalu semua ekspresi, mulut, dan kelopak di atas kepala netral."""
    def img(name):
        with Image.open(folder / name) as im:
            return im.convert('RGBA')
    head0 = img(f'{slug}_kepala_netral.png')
    px, py = meta['head']['paste_on_body']
    tiles: list[tuple[str, Image.Image]] = []
    for p in POSES:
        b = img(f'{slug}_badan_{p}.png')
        b.alpha_composite(head0, (px, py))
        tiles.append((p, b.crop((0, 0, 800, 1400))))
    mx, my = meta['mouth']['paste_on_head_topleft']
    heads: list[tuple[str, Image.Image]] = []
    for e in EXPRESSIONS:
        heads.append((e, img(f'{slug}_kepala_{e}.png')))
    for v in VOWELS:
        h = head0.copy(); h.alpha_composite(img(f'{slug}_mulut_{v}.png'), (mx, my)); heads.append((f'mulut {v}', h))
    if 'blink' in meta:
        h = head0.copy(); h.alpha_composite(img(f'{slug}_kelopak.png'), (0, 0)); heads.append(('kelopak', h))
    out_dir = folder / '_mentah'
    out_dir.mkdir(exist_ok=True)

    def sheet(items, cols, h, path):
        ims = []
        for label, im in items:
            box = im.getbbox() or (0, 0, im.width, im.height)
            c = im.crop(box)
            ims.append((label, c.resize((max(1, round(c.width * h / c.height)), h), Image.LANCZOS)))
        rows = [ims[i:i + cols] for i in range(0, len(ims), cols)]
        W = max(sum(t.width + 16 for _, t in r) + 16 for r in rows)
        out = Image.new('RGBA', (W, len(rows) * (h + 36) + 16), (236, 236, 240, 255))
        d = ImageDraw.Draw(out)
        y = 16
        for r in rows:
            x = 16
            for label, t in r:
                out.alpha_composite(t, (x, y)); d.text((x, y + h + 6), label, fill=(60, 60, 70, 255)); x += t.width + 16
            y += h + 36
        out.convert('RGB').save(path)
        return str(path)
    return [sheet(tiles, 9, 360, out_dir / '_cek_pose.png'), sheet(heads, 8, 220, out_dir / '_cek_wajah.png')]


def finish(draft: Path, karakter_root: Path, slug: str, update: bool = False) -> Path:
    """Salin karakter selesai dari _draf/<slug>/ ke karakter/<slug>/, siap diimpor ke aplikasi. Lembar mentah (_mentah) IKUT disalin dan
    draf tidak dihapus, supaya revisi (kalibrasi ulang) tidak perlu mengunggah lembar lagi.
    `update`: karakter/<slug> sudah ada -> hanya gambar dasar (kepala, badan, mulut, kelopak) dan bagian meta dasarnya yang diganti; paket gerak lain tetap."""
    import shutil
    draft, target = Path(draft), Path(karakter_root) / slug
    if target.exists() and not update:
        raise ValueError(f'karakter/{slug} sudah ada')
    if update and not target.is_dir():
        raise ValueError(f'karakter/{slug} belum ada; tidak ada yang diperbarui')
    from . import validate as V
    rep = V.validate(draft)
    if rep.verdict != 'pass':
        raise ValueError('karakter belum lolos validasi: ' + '; '.join(c['msg'] for c in rep.checks if c['level'] == 'fail')[:400])
    if update:
        base = [f'{slug}_kepala_*.png', f'{slug}_badan_*.png', f'{slug}_mulut_*.png', f'{slug}_kelopak.png']
        for pat in base:
            for f in draft.glob(pat):
                shutil.copy2(f, target / f.name)
        if not (draft / f'{slug}_kelopak.png').is_file() and (target / f'{slug}_kelopak.png').is_file():
            (target / f'{slug}_kelopak.png').unlink()
        new, old = spec.load_meta(draft), spec.load_meta(target)
        for k in ('body', 'head', 'mouth', 'calibration'):
            if k in new:
                old[k] = new[k]
        if 'blink' in new:
            old['blink'] = new['blink']
        else:
            old.pop('blink', None)
        spec.write_meta(target, old)
        if (draft / '_mentah').is_dir():
            shutil.copytree(draft / '_mentah', target / '_mentah', dirs_exist_ok=True)
        return target
    tmp = target.parent / f'.tmp_{slug}'
    if tmp.exists():
        shutil.rmtree(tmp)
    shutil.copytree(draft, tmp, ignore=shutil.ignore_patterns('owner.json'))
    tmp.rename(target)
    return target

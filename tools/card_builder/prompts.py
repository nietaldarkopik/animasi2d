"""Paket prompt (Google Flow / Gemini) dan manifes lembar untuk slot kartu v2.

Setiap lembar = satu gambar hasil generate berisi beberapa sel pada latar hijau. SEL PERTAMA SELALU ACUAN UKURAN: aset depan yang sudah ada,
digambar ulang di lembar yang sama. Importer membandingkannya dengan aset asli untuk menghitung skala lembar secara otomatis, lalu membuangnya.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

from . import spec

MANIFEST_VERSION = 1
BODY_PER_SHEET = 2        # slot per lembar badan (+1 sel acuan = 3 sel; jangan lebih dari 3 pose per gambar)
HEAD_PER_SHEET = 5
MOUTH_VOWELS = 'aiueo'

STYLE = ("Clean modern Japanese anime character asset, 2D cel-shading with soft flat shadows (maximum 2 tone levels), thin, clear, uniform dark-brown outlines, "
         "large expressive anime-style eyes with highlights when visible, clean polished line art, smooth shapes, consistent rendering quality, and a cohesive modern "
         "Japanese anime aesthetic. Maintain exactly the same art style, outline characteristics, shading technique, and rendering quality across all generated assets. "
         "Not photorealistic, not 3D, not painterly.")
BACKGROUND = ("Background: solid pure flat green RGB(0,255,0), no shadows, no floor, no gradients, and no green elements on the character. "
              "No text, labels, numbers, or watermark.")
REFERENCE = ("Use the attached reference image as the PRIMARY and AUTHORITATIVE source for the character's identity and appearance. Reproduce the exact character shown "
             "in the reference, including apparent gender, age appearance, face, hairstyle, hair color, eye shape, eye color, skin tone, body proportions, accessories, "
             "clothing, outfit design, footwear, and all visible details. Do not impose any hairstyle, facial features, accessories, clothing, or body characteristics that "
             "are not present in the reference. Do not reuse the appearance of characters from previous generations. Apply only the specified Japanese anime art style "
             "while preserving the reference character's original identity.")
BODY_RULES = ("HEADLESS BODY, STRICT: every cell shows ONLY the body from the collar down. The neck is cut off flat at the base of the collar with nothing above it: NO head, NO face, NO hair, "
              "NO ears, NO floating or extra head anywhere in the cell, not even small or in the background. The reference image may show a head: ignore that head completely and do not draw it. "
              "Poses where a hand goes to the head (temple, chin, wave) are drawn with the hand in the air at that height and the head still absent. "
              "SAME BODY IN EVERY CELL: draw exactly the same body as in the reference and in cell 1 - same outfit, same colors, same proportions, same scale. Collar-to-shoes height, shoulder width, "
              "torso length and leg length are identical in all cells; only the arms and hands change between poses. Do not zoom, enlarge, shrink or redraw the body per cell, "
              "and keep the same line weight and shading in every cell.")
FIXES = ['Desain melenceng: Match the attached reference exactly.',
         'Ada teks/kotak/bayangan: Remove all text, boxes, panels and shadows; only flat green background.',
         'Latar bukan hijau murni: Background must be exactly RGB(0,255,0).',
         'Jari salah: generate ulang; jangan minta lebih dari 3 pose per gambar.',
         'Sel acuan (nomor 1) berbeda ukuran dari sel lain: Every cell must use the same scale as cell 1.',
         'Kepala ikut tergambar pada lembar badan: Body only, NO HEAD, stop at the neck base and collar; the reference head must be ignored.',
         'Badan tiap sel beda ukuran/gambar: Draw exactly the same body as cell 1 in every cell; only the arms change.']

VIEW_TEXT = {'depan': 'FRONT view', '34': "3/4 view facing the viewer's right", 'sisi': "right-side profile view facing the viewer's right", 'belakang': 'REAR view (seen from behind)'}
EXPR_TEXT = {'netral': 'neutral expression', 'senang': 'happy (gentle smile)', 'kaget': 'surprised (wide eyes, small round mouth)', 'sedih': 'sad', 'marah': 'angry'}
MOUTH_TEXT = {'a': 'A (wide open)', 'i': 'I (flat and wide with teeth showing)', 'u': 'U (small round pucker)', 'e': 'E (medium open)', 'o': 'O (round open)'}
BODY_TEXT = {
    'diam_34': 'standing with arms relaxed beside the body, 3/4 view facing the viewer\'s right',
    'diam_sisi': 'standing with arms relaxed, right-side profile view facing the viewer\'s right',
    'diam_belakang': 'standing with arms relaxed, REAR view (seen from behind)',
    'duduk_tegak': 'sitting upright, back straight, knees together, both hands resting on the thighs, front view',
    'duduk_condong': 'sitting and leaning forward, both elbows resting on the knees, hands loosely clasped, front view',
    'duduk_sila': 'sitting cross-legged on the floor, hands resting on the knees, front view',
    'duduk_tangan_lutut': 'sitting, slightly leaning forward, both hands placed on the knees, front view',
    'lari_sisi': "running, right-side view facing the viewer's right, mid-stride, one knee raised, arms swinging",
    'lari_sisi_2': "running, right-side view facing the viewer's right, the OPPOSITE stride phase (other leg forward, other arm forward)",
    'kaget': 'startled: both arms flung slightly outward, upper body leaning back, front view',
    'lompat': 'jumping in the air with both feet off the ground, arms raised, front view',
}
BODY_EXTRA = {
    'duduk': ('Draw NO chair, bench, floor, seat or shadow: the figure sits on an invisible seat. Keep exactly the same body size and proportions as the standing '
              'reference in cell 1.'),
    'aksi': 'Draw NO motion lines, speed effects, dust or shadows. Keep exactly the same body size and proportions as the standing reference in cell 1.',
    'dialog': 'Keep exactly the same body size and proportions as the standing reference in cell 1.',
}


BODY_TEXT.update({
    'jalan_sisi': "walking, right-side view facing the viewer's right, mid-step, one leg forward, arms swinging gently, relaxed pace (not running)",
    'jalan_sisi_2': "walking, right-side view facing the viewer's right, the OPPOSITE step phase (other leg forward, other arm forward), relaxed pace",
    'jalan_34': "walking, 3/4 view facing the viewer's right, mid-step, one leg forward, arms swinging gently, relaxed pace (not running)",
    'jalan_34_2': "walking, 3/4 view facing the viewer's right, the OPPOSITE step phase (other leg forward, other arm forward), relaxed pace",
})
BODY_EXTRA['jalan'] = ('Draw NO motion lines, speed effects, dust or shadows. Keep exactly the same body size and proportions as the standing reference in cell 1. '
                       'Cells marked "facing the viewer\'s LEFT" are drawn truly facing left (not a flipped copy): keep the same outfit, with asymmetric details such as the pocket, badge and arm bands on the correct side for that direction.')


def _to_left(text: str) -> str:
    return text.replace("viewer's right", "viewer's LEFT").replace('right-side', 'left-side')


def _body_text(sid: str) -> str:
    if sid.endswith('_kiri'):
        return _to_left(_body_text(sid[:-5]))
    if sid in BODY_TEXT:
        return BODY_TEXT[sid]
    if sid.endswith('_34') and sid[:-3] in BODY_TEXT:
        return BODY_TEXT[sid[:-3]].replace('front view', "3/4 view facing the viewer's right")
    return sid.replace('_', ' ')


def _head_text(sid: str) -> str:
    if sid in ('lirik_kanan', 'lirik_kiri'):
        side = "right" if sid.endswith('kanan') else 'left'
        return f"neutral expression, FRONT view with the head NOT turned, only the eyes looking to the viewer's {side}"
    if sid.endswith('_kiri'):
        return _to_left(_head_text(sid[:-5]))
    expr, _, view = sid.rpartition('_')
    return f'{EXPR_TEXT.get(expr, expr)}, {VIEW_TEXT.get(view, view)}'


def _chunks(items: list, n: int) -> list[list]:
    return [items[i:i + n] for i in range(0, len(items), n)]


def plan(meta: dict, pack: str, required_only: bool = False) -> tuple[list[dict], list[str]]:
    """-> (lembar, slot yang dilewati). Tiap lembar: id, group, cols, rows, ref, cells [{role, group, id, text}]."""
    if pack not in spec.SLOTS or pack == 'dasar':
        raise ValueError(f'paket "{pack}" tidak punya slot baru (pilihan: ' + ', '.join(p for p in spec.SLOTS if p != 'dasar') + ')')
    slots = [s for s in spec.SLOTS[pack] if s.required or not required_only]
    skipped = [f'{s.group}:{s.id}' for s in slots if s.group == 'blink']
    slots = [s for s in slots if s.group != 'blink']
    sheets: list[dict] = []

    bodies = [s for s in slots if s.group == 'body']
    for i, grp in enumerate(_chunks(bodies, BODY_PER_SHEET)):
        sheets.append({'id': f'{pack}_badan_{chr(97 + i)}', 'group': 'body', 'cols': len(grp) + 1, 'rows': 1, 'ref': 'body:diam',
                       'cells': [{'role': 'ref', 'group': 'body', 'id': 'diam', 'text': 'SIZE REFERENCE: standing with arms relaxed, front view, exactly as in the reference'}]
                       + [{'role': 'slot', 'group': 'body', 'id': s.id, 'required': s.required, 'text': _body_text(s.id)} for s in grp]})

    heads = [s for s in slots if s.group == 'head']
    by_view: dict[str, list] = {}
    for s in heads:
        by_view.setdefault('lirik' if s.id.startswith('lirik') else s.view, []).append(s)
    for view, grp in by_view.items():
        for i, part in enumerate(_chunks(grp, HEAD_PER_SHEET)):
            n = len(part) + 1
            cols = 3 if n <= 6 else 5
            sheets.append({'id': f'{pack}_kepala_{view}' + (chr(97 + i) if len(grp) > HEAD_PER_SHEET else ''), 'group': 'head', 'cols': cols, 'rows': math.ceil(n / cols), 'ref': 'head:netral',
                           'cells': [{'role': 'ref', 'group': 'head', 'id': 'netral', 'text': 'SIZE REFERENCE: neutral expression, FRONT view, exactly as in the reference'}]
                           + [{'role': 'slot', 'group': 'head', 'id': s.id, 'required': s.required, 'text': _head_text(s.id)} for s in part]})

    mouths: dict[str, list] = {}
    for s in slots:
        if s.group == 'mouth':
            mouths.setdefault(s.view, []).append(s)
    for view, grp in mouths.items():
        sheets.append({'id': f'{pack}_mulut_{view}', 'group': 'mouth', 'cols': len(grp) + 1, 'rows': 1, 'ref': 'mouth:a',
                       'cells': [{'role': 'ref', 'group': 'mouth', 'id': 'a', 'text': 'SIZE REFERENCE: vowel A (wide open) seen from the FRONT'}]
                       + [{'role': 'slot', 'group': 'mouth', 'id': s.id, 'required': s.required,
                           'text': f'{MOUTH_TEXT.get(s.id.split("_")[0], s.id)} seen from the {VIEW_TEXT.get(view, view)}'} for s in grp]})
    return sheets, skipped


def _sheet_prompt(meta: dict, pack: str, sh: dict, appearance: str, name: str) -> str:
    n = len(sh['cells'])
    order = ' '.join(f'({i + 1}) {c["text"]};' for i, c in enumerate(sh['cells']))
    head = f'{STYLE} {BACKGROUND} {REFERENCE} Character: {appearance}. Match the attached reference image exactly: same colors, face shape, outfit and outline weight. '
    if sh['group'] == 'body':
        body = (f'ONE image. Body only, NO HEAD, stop at the neck base and collar: shoulders, torso, both arms, hands, legs, shoes. Feet (or seat contact) on the same horizontal '
                f'level, same horizontal center in each cell. Hands clear with 5 fingers. {n} equal cells side by side, {n} columns x 1 row, with clear green space between '
                f'cells so that no limb touches the next cell. {BODY_RULES} {BODY_EXTRA[pack]} Poses left to right: {order}')
    elif sh['group'] == 'head':
        body = (f'ONE image: grid of {sh["cols"]} columns x {sh["rows"]} rows with {n} HEAD-ONLY items (head, ears, hair, accessories, face, short neck stub) in square cells with clear '
                f'green space between them, identical head size and position, eyes open, mouth closed or small natural mouth. Every head is drawn at exactly the same scale as cell 1: '
                f'do not enlarge or shrink the 3/4 or side views. Order left to right, top to bottom: {order}')
    else:
        body = (f'ONE image: 1 row x {n} cells with MOUTH-ONLY close-ups, no face, no head, with clear green space between cells. Every mouth is drawn at exactly the same scale '
                f'as cell 1. Same size and same center in all cells. Simple anime style: dark opening, small teeth hint, tongue only in A. Same lip and skin colors as {name}. '
                f'Cells left to right: {order}')
    return head + body


def build(folder: Path, pack: str, required_only: bool = False) -> dict:
    """Tulis _mentah/prompt_<pack>.txt dan _mentah/manifest_<pack>.json. -> ringkasan."""
    meta = spec.load_meta(folder)
    appearance = str(meta.get('appearance') or '').strip()
    if not appearance:
        raise ValueError(f'character.json belum punya "appearance" (deskripsi penampilan dalam bahasa Inggris). Isi dengan: python -m card_builder describe {folder.name} --appearance "..."')
    prefix = spec.prefix_of(meta, folder.name)
    name = str(meta.get('name') or prefix)
    sheets, skipped = plan(meta, pack, required_only)
    if not sheets:
        raise ValueError(f'paket {pack} tidak menghasilkan lembar')
    mentah = folder / '_mentah'
    mentah.mkdir(exist_ok=True)
    for sh in sheets:
        sh['file'] = f'{prefix}_{sh["id"]}.png'
    attach_ref = f'{prefix}_acuan.png'
    lines = [f'PROMPT GOOGLE FLOW - PAKET {pack.upper()} - {name} ({len(sheets)} generate). Salin SELURUH teks di bawah tiap judul; tidak ada yang perlu diganti.',
             f'Hasil tiap generate: unduh resolusi tertinggi, simpan di {mentah}\\ dengan nama yang disebut.',
             'Sel nomor 1 di setiap lembar adalah ACUAN UKURAN (aset depan yang sudah ada); importer memakainya untuk menghitung skala lalu membuangnya.', '']
    for i, sh in enumerate(sheets, 1):
        attach = [attach_ref] + ([f'{prefix}_kepala_netral.png'] if sh['group'] == 'head' else [])
        sh['attach'] = attach
        label = {'body': 'BADAN', 'head': 'KEPALA', 'mouth': 'MULUT'}[sh['group']]
        sh['text'] = _sheet_prompt(meta, pack, sh, appearance, name)
        lines += [f'##### GENERATE {i} - {label} | {sh["id"]} | LAMPIRKAN: {", ".join(attach)} | simpan: {sh["file"]}', sh['text'], '']
    lines += ['##### JIKA HASIL SALAH (tambahkan 1 kalimat ke prompt lalu generate ulang)'] + [f'- {f}' for f in FIXES]
    prompt_file = mentah / f'prompt_{pack}.txt'
    prompt_file.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    manifest = {'version': MANIFEST_VERSION, 'pack': pack, 'character': folder.name, 'prefix': prefix, 'skipped': skipped, 'sheets': sheets}
    manifest_file = mentah / f'manifest_{pack}.json'
    manifest_file.write_text(json.dumps(manifest, indent=1, ensure_ascii=False), encoding='utf-8')
    return {'prompt_file': str(prompt_file), 'manifest_file': str(manifest_file), 'sheets': sheets, 'skipped': skipped,
            'missing_acuan': not (mentah / attach_ref).is_file()}

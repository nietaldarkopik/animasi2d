#!/usr/bin/env python3
"""Compose the turnaround kits (master-assets/kit_badan_sma/<kit>) into standard-format library parts for every view.

Each kit has, per view (depan/kanan/kiri/belakang), one PNG per rig part plus the box (canvas units) where it sits. Here the
parts are grouped into the Builder slots and drawn on the shared 400x800 canvas (800x1600 px, 2 px/unit), exactly like the
front view was imported:  body (neck, bare legs under a skirt) / top (torso, collar, arms, hands) / bottom (trousers or skirt)
/ shoes.  Output: master-assets/kit_badan_sma/<kit>/views/<view>-<slot>.png  (+ views/index.json for `library:import-views`).
"""
import json
import os
import sys

from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'master-assets', 'kit_badan_sma')
PX = 2
W, H = 400 * PX, 800 * PX

# kit folder -> label used in the library, and whether the thigh/shin pieces are the trousers (True) or bare legs (False)
KITS = {
    'laki_laki_anime': ('Kit SMA L1 (anime)', True),
    'perempuan_panjang_anime': ('Kit SMA P2 (anime)', False),
    'perempuan_pendek_anime': ('Kit SMA P3 (anime)', False),
}
VIEWS = {'kanan': 'right', 'kiri': 'left', 'belakang': 'back'}
DESC = {
    'laki_laki_anime': {'body': 'leher (badan laki-laki)', 'top': 'kemeja putih lengan pendek + dasi + badge OSIS', 'bottom': 'celana abu-abu SMA + ikat pinggang', 'shoes': 'sepatu hitam bertali'},
    'perempuan_panjang_anime': {'body': 'kaki & leher', 'top': 'kemeja putih lengan panjang + dasi', 'bottom': 'rok abu-abu panjang', 'shoes': 'sepatu pantofel + kaus kaki'},
    'perempuan_pendek_anime': {'body': 'kaki & leher (rok pendek)', 'top': 'kemeja pelaut lengan pendek + dasi merah', 'bottom': 'rok lipit pendek abu-ungu', 'shoes': 'sepatu pantofel'},
}


def group_of(key: str, trousers: bool) -> str:
    if key == 'neck':
        return 'body'
    if key.startswith('shoe'):
        return 'shoes'
    if key.startswith(('torso', 'collar', 'arm', 'hand')):
        return 'top'
    if key.startswith(('skirt', 'pelvis')):
        return 'bottom'
    if key.startswith(('thigh', 'shin')):
        return 'bottom' if trousers else 'body'
    raise SystemExit(f'unknown part {key}')


def main() -> None:
    index = []
    for kit, (label, trousers) in KITS.items():
        rig = json.load(open(os.path.join(ROOT, kit, 'rig.json'), encoding='utf-8'))
        out = os.path.join(ROOT, kit, 'views')
        os.makedirs(out, exist_ok=True)
        for view, en in VIEWS.items():
            groups: dict[str, list] = {}
            for p in rig[view]['parts']:
                groups.setdefault(group_of(p['key'], trousers), []).append(p)
            for slot, parts in groups.items():
                canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
                for p in sorted(parts, key=lambda q: q['order']):
                    im = Image.open(os.path.join(ROOT, kit, 'parts', p['file'])).convert('RGBA')
                    b = p['box']
                    w, h = round((b['x1'] - b['x0']) * PX), round((b['y1'] - b['y0']) * PX)
                    if im.size != (w, h):
                        im = im.resize((max(1, w), max(1, h)), Image.LANCZOS)
                    canvas.alpha_composite(im, (round(b['x0'] * PX), round(b['y0'] * PX)))
                name = f'{view}-{slot}.png'
                canvas.save(os.path.join(out, name))
                index.append({'kit': kit, 'view': en, 'slot': slot, 'file': f'{kit}/views/{name}', 'name': f"{label} – {DESC[kit][slot]} ({ {'right': 'kanan', 'left': 'kiri', 'back': 'belakang'}[en] })"})
    json.dump(index, open(os.path.join(ROOT, 'views_index.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(len(index), 'parts composed')


if __name__ == '__main__':
    main()

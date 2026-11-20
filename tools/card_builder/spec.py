"""Spesifikasi kartu karakter v2: paket slot (dasar, dialog, duduk, aksi), penamaan berkas, dan pemetaan ke character.json.

Aditif: karakter lama (tanpa kunci "spec") dianggap hanya paket "dasar" dan tetap valid. Slot baru TIDAK menambah
body.poses / head.expressions, jadi CardCharacterController dan char_lib.py tidak melihatnya sampai runtime mendukungnya.
Lihat docs/CARD_SPEC_V2.md.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

SPEC_VERSION = 2
SLUG_RE = re.compile(r'^[a-z0-9][a-z0-9_-]*$', re.I)
FILE_RE = re.compile(r'^[a-z0-9_-]+\.png$', re.I)      # sama dengan CardCharacterController
GROUP_WORD = {'body': 'badan', 'head': 'kepala', 'mouth': 'mulut', 'blink': 'kelopak'}
GROUPS = tuple(GROUP_WORD)
DEFAULT_PACKS = ['dasar']

PACKS = {
    'dasar': 'Berdiri, bicara, 10 ekspresi, 5 bentuk mulut, kedip (25 berkas; didefinisikan oleh character.json)',
    'dialog': 'Hadap 3/4 dan samping (kiri = cermin kanan), menengok, melirik',
    'duduk': 'Duduk tegak, condong (siku di lutut), sila, tangan di lutut',
    'aksi': 'Lari samping (satu pose dinamis), kaget, lompat',
    'jalan': 'Jalan miring (3/4) dan samping ke kanan DAN ke kiri, serta kepala tengok ke kiri (semua opsional; tanpa ini kiri = cermin kanan)',
}


@dataclass(frozen=True)
class Slot:
    pack: str
    group: str            # body | head | mouth | blink
    id: str               # bagian nama berkas setelah kata kelompok: <nama>_badan_<id>.png
    label: str
    required: bool = True
    view: str = 'depan'   # depan | 34 | sisi | belakang

    def filename(self, prefix: str) -> str:
        word = GROUP_WORD[self.group]
        return f'{prefix}_{word}_{self.id}.png' if self.id else f'{prefix}_{word}.png'


def _b(pack, id, label, req=True, view='depan'): return Slot(pack, 'body', id, label, req, view)
def _h(pack, id, label, req=True, view='depan'): return Slot(pack, 'head', id, label, req, view)
def _m(pack, id, label, req=False, view='depan'): return Slot(pack, 'mouth', id, label, req, view)
def _k(pack, id, label, req=False, view='depan'): return Slot(pack, 'blink', id, label, req, view)


def _dialog() -> list[Slot]:
    out = [_b('dialog', 'diam_34', 'Badan diam 3/4', view='34'), _b('dialog', 'diam_sisi', 'Badan diam samping', view='sisi'),
           _b('dialog', 'diam_belakang', 'Badan diam belakang', False, 'belakang')]
    for view, tag in (('34', '3/4'), ('sisi', 'samping')):
        for i, expr in enumerate(('netral', 'senang', 'kaget', 'sedih', 'marah')):
            out.append(_h('dialog', f'{expr}_{view}', f'Kepala {expr} {tag}', i == 0, view))
        out.append(_k('dialog', view, f'Kelopak {tag}', False, view))
        out += [_m('dialog', f'{v}_{view}', f'Mulut {v} {tag}', False, view) for v in 'aiueo']
    out += [_h('dialog', 'lirik_kanan', 'Kepala melirik kanan', False), _h('dialog', 'lirik_kiri', 'Kepala melirik kiri', False)]
    return out


def _duduk() -> list[Slot]:
    base = (('tegak', 'Duduk tegak'), ('condong', 'Duduk condong, siku di lutut'), ('sila', 'Duduk sila'), ('tangan_lutut', 'Duduk, tangan di lutut'))
    return [_b('duduk', f'duduk_{i}', lbl) for i, lbl in base] + [_b('duduk', f'duduk_{i}_34', lbl + ' 3/4', False, '34') for i, lbl in base]


def _aksi() -> list[Slot]:
    return [_b('aksi', 'lari_sisi', 'Lari samping', view='sisi'), _b('aksi', 'lari_sisi_2', 'Lari samping, pose kedua', False, 'sisi'),
            _b('aksi', 'kaget', 'Badan kaget', False), _b('aksi', 'lompat', 'Badan melompat', False)]


def _jalan() -> list[Slot]:
    """Semua opsional. Gambar kanan = menghadap kanan penonton; `_kiri` = digambar menghadap kiri (kalau ada, dipakai ganti cermin)."""
    out = []
    for view, tag in (('sisi', 'samping'), ('34', '3/4')):
        for suffix, lbl in (('', ''), ('_2', ', fase langkah kedua')):
            for kiri in ('', '_kiri'):
                out.append(_b('jalan', f'jalan_{view}{suffix}{kiri}', f'Jalan {tag}{lbl}, menghadap {"kiri" if kiri else "kanan"}', False, view))
    out += [_b('jalan', 'diam_sisi_kiri', 'Badan diam samping, menghadap kiri', False, 'sisi'), _b('jalan', 'diam_34_kiri', 'Badan diam 3/4, menghadap kiri', False, '34'),
            _b('jalan', 'lari_sisi_kiri', 'Lari samping, menghadap kiri', False, 'sisi'), _b('jalan', 'lari_sisi_2_kiri', 'Lari samping kiri, pose kedua', False, 'sisi')]
    for view, tag in (('34', '3/4'), ('sisi', 'samping')):
        for expr in ('netral', 'senang', 'kaget', 'sedih', 'marah'):
            out.append(_h('jalan', f'{expr}_{view}_kiri', f'Kepala {expr} {tag}, menengok kiri', False, f'{view}_kiri'))
    return out


SLOTS: dict[str, list[Slot]] = {'dasar': [], 'dialog': _dialog(), 'duduk': _duduk(), 'aksi': _aksi(), 'jalan': _jalan()}


@dataclass(frozen=True)
class Entry:
    slot: Slot
    filename: str


def prefix_of(meta: dict, fallback: str = '') -> str:
    pat = str((meta.get('body') or {}).get('file') or '')
    return pat.split('_badan_')[0] if '_badan_' in pat else (fallback or str(meta.get('name') or '').lower())


def packs_of(meta: dict) -> list[str]:
    spec = meta.get('spec') or {}
    packs = [p for p in spec.get('packs', DEFAULT_PACKS) if p in PACKS]
    return packs or list(DEFAULT_PACKS)


def _expand(pattern: str | None, token: str, ids) -> list[tuple[str, str]]:
    return [(str(i), str(pattern).replace(token, str(i))) for i in ids] if pattern else []


def entries(meta: dict, packs: list[str] | None = None, prefix: str | None = None) -> list[Entry]:
    """Semua berkas yang diharapkan: paket dasar sesuai pola character.json, paket lain sesuai konvensi nama."""
    packs = packs or packs_of(meta)
    prefix = prefix or prefix_of(meta)
    out: list[Entry] = []
    if 'dasar' in packs:
        b, h, m, k = (meta.get(x) or {} for x in ('body', 'head', 'mouth', 'blink'))
        for i, f in _expand(b.get('file'), '<pose>', b.get('poses', [])): out.append(Entry(Slot('dasar', 'body', i, f'Badan {i}'), f))
        for i, f in _expand(h.get('file'), '<ekspresi>', h.get('expressions', [])): out.append(Entry(Slot('dasar', 'head', i, f'Kepala {i}'), f))
        for i, f in _expand(m.get('file'), '<bentuk>', m.get('shapes', [])): out.append(Entry(Slot('dasar', 'mouth', i, f'Mulut {i}', False), f))
        if k.get('file'): out.append(Entry(Slot('dasar', 'blink', '', 'Kelopak', False), str(k['file'])))
    for p in packs:
        out += [Entry(s, s.filename(prefix)) for s in SLOTS.get(p, [])]
    return out


def build_extra(meta: dict, folder: Path, prefix: str | None = None) -> dict:
    """Peta slot -> berkas untuk paket v2 yang aktif dan berkasnya ada: {"body": {id: file}, "head": {...}, "mouth": {...}}.
    Ditulis ke character.json["extra"] agar backend dan editor tidak perlu tahu aturan penamaan."""
    out: dict[str, dict[str, str]] = {'body': {}, 'head': {}, 'mouth': {}}
    for e in entries(meta, packs_of(meta), prefix or prefix_of(meta, Path(folder).name)):
        if e.slot.pack != 'dasar' and e.slot.group in out and (Path(folder) / e.filename).is_file():
            out[e.slot.group][e.slot.id] = e.filename
    return {g: m for g, m in out.items() if m}


def canvas_of(meta: dict, group: str) -> tuple[int, int] | None:
    c = (meta.get(group) or {}).get('canvas')
    return (int(c[0]), int(c[1])) if c and len(c) == 2 else None


def head_at(meta: dict, slot: Slot) -> list[int] | None:
    """Titik tempel kepala (kiri-atas) pada kanvas badan untuk slot badan v2."""
    v = ((meta.get('body') or {}).get('head_at') or {}).get(slot.id)
    return [int(v[0]), int(v[1])] if isinstance(v, (list, tuple)) and len(v) == 2 else None


def describe() -> str:
    lines = [f'Spesifikasi kartu v{SPEC_VERSION}', '']
    for p, desc in PACKS.items():
        sl = SLOTS[p]
        req = sum(1 for s in sl if s.required)
        lines.append(f'[{p}] {desc}' + (f'  ({len(sl)} slot, {req} wajib)' if sl else ''))
        for s in sl:
            lines.append(f'    {"*" if s.required else " "} {s.group:<5} {s.id:<22} {s.label}')
    lines += ['', '* = wajib bila paket diaktifkan di character.json: "spec": {"version": 2, "packs": ["dasar", "dialog"]}',
              'Nama berkas: <nama>_<badan|kepala|mulut|kelopak>_<id>.png. Arah kiri = cermin kanan (spec.mirror_ok), kecuali ada berkas khusus.',
              'Slot badan baru wajib punya body.head_at[<id>] = [x, y] (titik tempel kepala).']
    return '\n'.join(lines)


def load_meta(folder: Path) -> dict:
    import json
    return json.loads((folder / 'character.json').read_text(encoding='utf-8'))


def write_meta(folder: Path, meta: dict, like: Path | None = None) -> None:
    """Tulis character.json (indent 1) dengan akhir baris dan baris-akhir yang sama seperti berkas yang ada (atau berkas `like`)."""
    import json
    target = Path(folder) / 'character.json'
    ref = target if target.is_file() else (Path(like) / 'character.json' if like else None)
    old = ref.read_bytes() if ref and ref.is_file() else b''
    nl = '\r\n' if b'\r\n' in old else '\n'
    text = json.dumps(meta, indent=1, ensure_ascii=False)
    if old.endswith(b'\n'):
        text += '\n'
    target.write_bytes(text.replace('\n', nl).encode('utf-8'))

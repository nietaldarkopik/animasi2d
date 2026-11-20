"""Validator kartu karakter: berkas, ukuran kanvas, transparansi, sisa kunci hijau, terpotong, posisi kaki, dan kelengkapan paket."""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from PIL import Image

from . import spec

MIN_OPAQUE = {'body': .05, 'head': .05, 'mouth': .01, 'blink': .002}
FEET_TOL = 30


@dataclass
class Report:
    folder: str
    checks: list = field(default_factory=list)
    packs: dict = field(default_factory=dict)

    def add(self, level: str, area: str, msg: str): self.checks.append({'level': level, 'area': area, 'msg': msg})
    def fail(self, area, msg): self.add('fail', area, msg)
    def warn(self, area, msg): self.add('warn', area, msg)
    def ok(self, area, msg): self.add('pass', area, msg)
    def count(self, level): return sum(1 for c in self.checks if c['level'] == level)

    @property
    def verdict(self) -> str: return 'fail' if self.count('fail') else 'pass'

    def as_dict(self) -> dict:
        return {'folder': self.folder, 'verdict': self.verdict, 'fails': self.count('fail'), 'warnings': self.count('warn'), 'packs': self.packs, 'checks': self.checks}


def load_rgba(path: Path) -> tuple[np.ndarray, bool]:
    """-> (array HxWx4 uint8, punya_alfa_asli)"""
    with Image.open(path) as im:
        has_alpha = im.mode in ('RGBA', 'LA') or (im.mode == 'P' and 'transparency' in im.info)
        return np.asarray(im.convert('RGBA')), has_alpha


def check_png(rep: Report, path: Path, group: str, size: tuple[int, int] | None, feet_y: int | None, label: str, standing: bool = True) -> None:
    try:
        a, has_alpha = load_rgba(path)
    except Exception as e:                                           # noqa: BLE001 - file rusak apa pun
        rep.fail('png', f'{label}: tidak bisa dibuka ({e})')
        return
    h, w = a.shape[:2]
    if size and (w, h) != size:
        rep.fail('png', f'{label}: ukuran {w}x{h}, seharusnya {size[0]}x{size[1]}')
        return
    if not has_alpha:
        rep.fail('png', f'{label}: tidak punya transparansi (latar belum dihapus)')
        return
    alpha = a[..., 3]
    solid = alpha > 16
    frac = float(solid.mean())
    if frac < MIN_OPAQUE.get(group, .01):
        rep.fail('png', f'{label}: nyaris kosong ({frac * 100:.2f}% piksel terisi)')
        return
    r, g, b = (a[..., i].astype(int) for i in range(3))
    green = int((solid & (g > 180) & (r < 90) & (b < 90)).sum())
    if green > 30:
        rep.fail('png', f'{label}: {green} piksel sisa kunci hijau (chroma key belum bersih)')
    edges = {'atas': alpha[0, :], 'kiri': alpha[:, 0], 'kanan': alpha[:, -1]}
    if group != 'head':
        edges['bawah'] = alpha[-1, :]
    for name, line in edges.items():
        if (line > 200).mean() > .005:
            rep.warn('png', f'{label}: gambar menyentuh tepi {name} kanvas (kemungkinan terpotong)')
    if group == 'body' and feet_y is not None and standing:
        rows = np.where(solid.any(axis=1))[0]
        bottom = int(rows.max())
        if abs(bottom - feet_y) > FEET_TOL:
            rep.warn('png', f'{label}: dasar gambar di y={bottom}, kaki seharusnya y~{feet_y} (±{FEET_TOL})')


def resolve_legacy(meta: dict, folder: Path) -> list[str]:
    """Tiruan CardCharacterController::readSpec: daftar masalah yang membuat folder tidak bisa diimpor ke editor web."""
    problems = []
    if not (meta.get('body') or {}).get('poses') or not (meta.get('head') or {}).get('expressions'):
        return ['character.json tidak lengkap (perlu body.poses dan head.expressions)']
    for e in spec.entries(meta, ['dasar']):
        if not spec.FILE_RE.match(e.filename):
            problems.append(f'nama berkas tidak valid untuk importer: {e.filename}')
        elif not (folder / e.filename).is_file() and e.slot.required:
            problems.append(f'berkas {e.filename} tidak ada')
    return problems


def _check_mouth_shapes(rep: Report, meta: dict, folder: Path, prefix: str) -> None:
    """Bentuk mulut dasar yang hanya tambalan kulit polos tidak mengubah apa pun saat dipilih (lembar mulut salah dipotong atau mulutnya tidak tergambar jelas)."""
    m = meta.get('mouth') or {}
    head = Path(folder) / f'{prefix}_kepala_netral.png'
    if not (m.get('file') and head.is_file()):
        return
    from . import newchar as N
    cal = {**N.DEFAULT_CALIB, **{k: v for k, v in (meta.get('calibration') or {}).items() if v is not None}}
    try:
        with Image.open(head) as h:
            skin = N._skin_of_head(h, cal)
    except Exception:
        return
    empty = []
    for shape in m.get('shapes', []):
        f = Path(folder) / str(m['file']).replace('<bentuk>', str(shape))
        if f.is_file():
            with Image.open(f) as im:
                if N.mouth_ink(im, skin) < N.MIN_MOUTH_INK:
                    empty.append(str(shape).upper())
    if empty:
        rep.warn('mulut', f'bentuk mulut {", ".join(empty)} kosong (hanya tambalan kulit, tanpa bukaan atau garis mulut), jadi tidak berubah saat dipilih. Unggah ulang lembar mulut dengan mulut yang jelas.')


def validate(folder: Path, packs: list[str] | None = None) -> Report:
    folder = Path(folder)
    rep = Report(str(folder))
    jf = folder / 'character.json'
    if not jf.is_file():
        rep.fail('json', 'tidak ada character.json')
        return rep
    try:
        meta = json.loads(jf.read_text(encoding='utf-8'))
    except ValueError as e:
        rep.fail('json', f'character.json bukan JSON valid: {e}')
        return rep

    for p in resolve_legacy(meta, folder):
        rep.fail('importer', p)
    body = meta.get('body') or {}
    feet_y = body.get('feet_y')
    prefix = spec.prefix_of(meta, folder.name)
    use = packs or spec.packs_of(meta)
    for p in (meta.get('spec') or {}).get('packs', []):
        if p not in spec.PACKS:
            rep.warn('json', f'paket "{p}" tidak dikenal')
    if meta.get('extends') and str(meta['extends']) == folder.name:
        rep.fail('json', 'extends menunjuk ke karakter itu sendiri')

    expected_extra = spec.build_extra(meta, folder, prefix)
    if expected_extra != (meta.get('extra') or {}):
        rep.warn('json', f'character.json "extra" tidak sinkron dengan berkas paket v2 (editor web tidak melihat slot baru); jalankan: python -m card_builder sync {folder.name}')

    seen: set[str] = set()
    for e in spec.entries(meta, use, prefix):
        s = e.slot
        seen.add(e.filename)
        path = folder / e.filename
        label = f'{s.pack}/{s.group}:{s.id or "kelopak"}'
        slot_present = path.is_file()
        if not slot_present:
            counts = rep.packs.setdefault(s.pack, {'ada': 0, 'wajib_hilang': 0, 'opsional_hilang': 0})
            counts['wajib_hilang' if s.required else 'opsional_hilang'] += 1
            continue
        rep.packs.setdefault(s.pack, {'ada': 0, 'wajib_hilang': 0, 'opsional_hilang': 0})['ada'] += 1
        standing = not (s.pack == 'duduk' or s.id in ('lompat',))
        check_png(rep, path, s.group, spec.canvas_of(meta, s.group), feet_y, label, standing)
        if s.pack != 'dasar' and s.group == 'body' and spec.head_at(meta, s) is None:
            rep.fail('json', f'{label}: body.head_at["{s.id}"] belum diisi, kepala tidak bisa dipasang')

    _check_mouth_shapes(rep, meta, folder, prefix)

    mouth_at = (meta.get('mouth') or {}).get('at') or {}
    for e in spec.entries(meta, use, prefix):
        if e.slot.pack != 'dasar' and e.slot.group == 'mouth' and (folder / e.filename).is_file() and e.slot.view not in mouth_at:
            rep.warn('json', f'mulut tampak {e.slot.view}: posisi tempel belum diisi (mouth.at["{e.slot.view}"] = [x, y] pada kanvas kepala)')
            mouth_at = {**mouth_at, e.slot.view: None}
    for p, c in rep.packs.items():
        if c['wajib_hilang']:
            rep.fail('paket', f'paket {p}: {c["wajib_hilang"]} slot wajib belum ada ({c["ada"]} ada, {c["opsional_hilang"]} opsional belum)')
        else:
            rep.ok('paket', f'paket {p}: lengkap ({c["ada"]} berkas, {c["opsional_hilang"]} slot opsional belum ada)')

    orphans = sorted(f.name for f in folder.glob('*.png') if f.name not in seen)
    if orphans:
        rep.warn('berkas', f'{len(orphans)} berkas tidak dipakai character.json: ' + ', '.join(orphans[:6]) + (' ...' if len(orphans) > 6 else ''))
    if not rep.count('fail') and not rep.count('warn'):
        rep.ok('semua', 'semua pemeriksaan lolos')
    return rep


def format_report(rep: Report, verbose: bool = False) -> str:
    tag = {'pass': 'PASS', 'warn': 'WARN', 'fail': 'FAIL'}
    lines = [f'{tag[c["level"]]}  [{c["area"]}] {c["msg"]}' for c in rep.checks if verbose or c['level'] != 'pass' or c['area'] == 'paket']
    lines.append(f'\nKartu {Path(rep.folder).name}: {rep.verdict.upper()}  ({rep.count("fail")} gagal, {rep.count("warn")} peringatan)')
    return '\n'.join(lines)

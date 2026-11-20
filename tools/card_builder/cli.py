"""Antarmuka baris perintah Card Builder.

  cd tools && python -m card_builder <perintah>          (atau: python tools/card_builder <perintah>)

  spec                                   daftar paket dan slot kartu v2
  validate <nama|folder>|--all           periksa kartu; keluar 0 lolos, 1 gagal
  colors <nama|folder>                   keluarga warna dominan (bahan memilih --map)
  duplicate <nama> --as <baru> [--map SUMBER>TUJUAN[;opsi]]... [--groups body,head] [--name "Nama"] [--override badan:diam=file.png]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image

from . import api
from . import duplicate as D
from . import prompts as P
from . import recolor, sheets, spec
from . import validate as V

KARAKTER = Path(__file__).resolve().parents[2] / 'karakter'


def resolve(arg: str) -> Path:
    p = Path(arg)
    return p if (p / 'character.json').is_file() else KARAKTER / arg


def cmd_spec(a) -> int:
    print(spec.describe())
    return 0


def cmd_validate(a) -> int:
    folders = sorted(p for p in KARAKTER.iterdir() if p.is_dir() and not p.name.startswith('_') and (p / 'character.json').is_file()) if a.all else [resolve(a.name)]
    if not folders:
        print('tidak ada karakter', file=sys.stderr)
        return 2
    worst = 0
    reports = []
    for f in folders:
        rep = V.validate(f, a.packs.split(',') if a.packs else None)
        reports.append(rep.as_dict())
        print(V.format_report(rep, a.verbose) + '\n')
        worst = max(worst, 1 if rep.verdict == 'fail' or (a.strict and rep.count('warn')) else 0)
    if a.json:
        Path(a.json).write_text(json.dumps(reports, indent=1, ensure_ascii=False), encoding='utf-8')
    return worst


def cmd_colors(a) -> int:
    folder = resolve(a.name)
    meta = spec.load_meta(folder)
    ent = {(e.slot.group, e.slot.id): e.filename for e in spec.entries(meta, ['dasar'])}
    pick = [('body', 'diam'), ('head', 'netral')]
    named = {}
    for k in pick:
        if k in ent and (folder / ent[k]).is_file():
            with Image.open(folder / ent[k]) as im:
                named[f'{k[0]}:{k[1]}'] = im.copy()
    imgs = list(named.values())
    if not imgs:
        print('badan diam / kepala netral tidak ditemukan', file=sys.stderr)
        return 2
    print(f'Keluarga warna {folder.name} (badan diam + kepala netral). Pakai nilai hex sebagai SUMBER pada --map.\n')
    for c in recolor.analyze(imgs, a.top):
        note = '' if c['kind'] == 'berwarna' else '  [netral: butuh ;box=x0,y0,x1,y1 atau mask]'
        print(f'  {c["hex"]}  {c["share"] * 100:5.1f}%  {c["name"]:<10} sat={c["sat"]:.2f}{note}')
        for label, bx in recolor.cluster_bounds(named, c['hex']).items():
            if bx:
                print(f'      {label:<12} box={bx[0]},{bx[1]},{bx[2]},{bx[3]}')
    return 0


def cmd_sync(a) -> int:
    folder = resolve(a.name)
    meta = spec.load_meta(folder)
    extra = spec.build_extra(meta, folder)
    if extra:
        meta['extra'] = extra
    else:
        meta.pop('extra', None)
    spec.write_meta(folder, meta)
    n = sum(len(v) for v in extra.values())
    print(f'{folder.name}: extra = {n} slot ({", ".join(f"{g} {len(v)}" for g, v in extra.items()) or "kosong"})')
    return 0


def cmd_describe(a) -> int:
    folder = resolve(a.name)
    meta = spec.load_meta(folder)
    if a.appearance:
        meta['appearance'] = a.appearance.strip()
        spec.write_meta(folder, meta)
    print(meta.get('appearance') or '(belum ada appearance)')
    return 0 if meta.get('appearance') else 1


def cmd_prompts(a) -> int:
    folder = resolve(a.name)
    try:
        res = P.build(folder, a.pack, a.required_only)
    except ValueError as e:
        print(f'GAGAL: {e}', file=sys.stderr)
        return 2
    print(f'{len(res["sheets"])} lembar untuk paket {a.pack}:')
    for sh in res['sheets']:
        cells = ', '.join(('ACUAN' if c['role'] == 'ref' else c['id']) for c in sh['cells'])
        print(f'  {sh["file"]:<34} {sh["cols"]}x{sh["rows"]}  [{cells}]')
    if res['skipped']:
        print('Dilewati (belum didukung importer): ' + ', '.join(res['skipped']))
    if res['missing_acuan']:
        print(f'PERINGATAN: _mentah/{folder.name}_acuan.png belum ada; lampiran acuan di prompt merujuk berkas itu.')
    print(f'\nPrompt:   {res["prompt_file"]}\nManifes:  {res["manifest_file"]}')
    print('Setelah generate, simpan hasilnya di _mentah/ dengan nama di atas, lalu: python -m card_builder import-sheet ' + f'{folder.name} --pack {a.pack}')
    return 0


def cmd_import_sheet(a) -> int:
    folder = resolve(a.name)
    mf = folder / '_mentah' / f'manifest_{a.pack}.json'
    if not mf.is_file():
        print(f'GAGAL: {mf} tidak ada; jalankan dulu: python -m card_builder prompts {folder.name} --pack {a.pack}', file=sys.stderr)
        return 2
    manifest = json.loads(mf.read_text(encoding='utf-8'))
    base = Path(a.dir) if a.dir else folder / '_mentah'
    files = {sh['id']: base / sh['file'] for sh in manifest['sheets'] if (base / sh['file']).is_file()}
    for s in a.sheet or []:
        k, _, v = s.partition('=')
        if k not in {sh['id'] for sh in manifest['sheets']} or not v:
            print(f'GAGAL: --sheet harus id=berkas dengan id salah satu dari: ' + ', '.join(sh['id'] for sh in manifest['sheets']), file=sys.stderr)
            return 2
        files[k] = Path(v)
    if not files:
        print('Tidak ada lembar ditemukan. Yang diharapkan di ' + str(base) + ':\n  ' + '\n  '.join(sh['file'] for sh in manifest['sheets']), file=sys.stderr)
        return 2
    scales = {}
    for s in a.scale or []:
        k, _, v = s.partition('=')
        scales[k] = float(v)
    try:
        res = sheets.import_sheets(folder, manifest, files, a.overwrite, a.equal, scales, a.fit, a.dry_run)
    except sheets.SheetError as e:
        print(f'GAGAL: {e}', file=sys.stderr)
        return 2
    for n in res.notes:
        print('  ' + n)
    for it in res.imported:
        if it.skipped:
            print(f'  LEWAT  {it.slot:<26} {it.skipped}')
        else:
            extra = f'  head_at={it.info["head_at"]}' if 'head_at' in it.info else ''
            print(f'  {"(uji)" if a.dry_run else "OK   "}  {it.slot:<26} -> {it.file}  skala {it.info.get("skala")}{extra}')
    for p in res.previews:
        print(f'Pratinjau: {p}')
    if a.dry_run:
        print('--dry-run: tidak ada berkas kartu atau character.json yang ditulis (hanya _mentah/_cek_*.png).')
        return 0
    rep = V.validate(folder)
    print(V.format_report(rep, False))
    return 0 if rep.verdict == 'pass' else 1


def cmd_duplicate(a) -> int:
    src = resolve(a.name)
    regions = [recolor.parse_region(m, a.tol) for m in (a.map or [])]
    over = {}
    for o in a.override or []:
        k, _, v = o.partition('=')
        word, _, sid = k.partition(':')
        inv = {w: g for g, w in spec.GROUP_WORD.items()}
        if word not in inv or not v:
            raise SystemExit(f'--override harus berbentuk kelompok:id=berkas (kelompok: {", ".join(inv)}): {o!r}')
        over[(inv[word], sid)] = Path(v)
    try:
        res = D.duplicate(src, a.as_name, regions, tuple(x for x in a.groups.split(',') if x), Path(a.out_root) if a.out_root else None, a.name_label, over, a.overwrite)
    except ValueError as e:
        print(f'GAGAL: {e}', file=sys.stderr)
        return 2
    print(f'Dibuat: {res["out_dir"]}  (disalin {res["copied"]}, diwarnai ulang {res["recolored"]}, ditimpa {res["overridden"]}, dilewati {len(res["skipped"])})')
    print(V.format_report(res['report'], False))
    print(f'Pratinjau: {Path(res["out_dir"]) / "_resep" / "pratinjau.png"}')
    return 0 if res['report'].verdict == 'pass' else 1


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog='card_builder', description='Alat kartu karakter 2.5D')
    sp = ap.add_subparsers(dest='cmd', required=True)
    sp.add_parser('spec').set_defaults(f=cmd_spec)
    p = sp.add_parser('validate'); p.add_argument('name', nargs='?'); p.add_argument('--all', action='store_true'); p.add_argument('--packs'); p.add_argument('--json')
    p.add_argument('--strict', action='store_true'); p.add_argument('--verbose', action='store_true'); p.set_defaults(f=cmd_validate)
    p = sp.add_parser('colors'); p.add_argument('name'); p.add_argument('--top', type=int, default=8); p.set_defaults(f=cmd_colors)
    p = sp.add_parser('api', help='fasad JSON untuk backend: stdin JSON -> stdout JSON'); p.add_argument('op'); p.set_defaults(f=lambda a: api.main(a.op))
    p = sp.add_parser('sync'); p.add_argument('name'); p.set_defaults(f=cmd_sync)
    p = sp.add_parser('describe'); p.add_argument('name'); p.add_argument('--appearance'); p.set_defaults(f=cmd_describe)
    p = sp.add_parser('prompts'); p.add_argument('name'); p.add_argument('--pack', required=True); p.add_argument('--required-only', action='store_true'); p.set_defaults(f=cmd_prompts)
    p = sp.add_parser('import-sheet'); p.add_argument('name'); p.add_argument('--pack', required=True); p.add_argument('--sheet', action='append'); p.add_argument('--dir')
    p.add_argument('--scale', action='append'); p.add_argument('--overwrite', action='store_true'); p.add_argument('--equal', action='store_true'); p.add_argument('--fit', action='store_true')
    p.add_argument('--dry-run', action='store_true'); p.set_defaults(f=cmd_import_sheet)
    p = sp.add_parser('duplicate'); p.add_argument('name'); p.add_argument('--as', dest='as_name', required=True); p.add_argument('--map', action='append')
    p.add_argument('--tol', type=float, default=25.0); p.add_argument('--groups', default='body,head'); p.add_argument('--name', dest='name_label')
    p.add_argument('--out-root'); p.add_argument('--override', action='append'); p.add_argument('--overwrite', action='store_true'); p.set_defaults(f=cmd_duplicate)
    a = ap.parse_args(argv)
    if a.cmd == 'validate' and not a.all and not a.name:
        ap.error('beri nama karakter atau --all')
    return a.f(a)


if __name__ == '__main__':
    sys.exit(main())

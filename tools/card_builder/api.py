"""Fasad JSON untuk backend (dan siapa pun yang butuh keluaran mesin): `python -m card_builder api <op>` membaca JSON dari stdin, menulis JSON ke stdout.

  stdin : {"root": "<folder karakter/>", ...argumen op}
  stdout: {"ok": true, "data": ...}  atau  {"ok": false, "error": "pesan"}   (kegagalan yang dikenali tetap keluar 0)

Semua jalur dibangun dari `root` + slug yang divalidasi; tidak ada jalur dari pengguna.
"""
from __future__ import annotations

import json
import shutil
import sys
import tempfile
from pathlib import Path

from PIL import Image

from . import duplicate as D
from . import newchar as N
from . import prompts as P
from . import recolor, sheets, spec
from . import validate as V

PACKS_NEW = [p for p in spec.PACKS if p != 'dasar']


class ApiError(ValueError):
    """Kesalahan masukan atau keadaan yang dijelaskan ke pengguna."""


def _slug(v) -> str:
    v = str(v or '')
    if not spec.SLUG_RE.match(v) or len(v) > 64:
        raise ApiError('nama folder karakter tidak valid')
    return v


def _folder(root: Path, slug: str, draft: bool = False) -> Path:
    f = N.draft_dir(root, slug) if draft else root / slug
    if not (f / 'character.json').is_file() and not draft:
        raise ApiError(f'karakter/{slug} tidak punya character.json')
    return f


def _pack(v) -> str:
    if v not in PACKS_NEW:
        raise ApiError('paket harus salah satu dari: ' + ', '.join(PACKS_NEW))
    return v


def _report(rep: V.Report) -> dict:
    return {'verdict': rep.verdict, 'fails': rep.count('fail'), 'warnings': rep.count('warn'),
            'messages': [{'level': c['level'], 'area': c['area'], 'msg': c['msg']} for c in rep.checks if c['level'] != 'pass'][:40]}


def _mentah_list(folder: Path, manifest: dict) -> list[dict]:
    mentah = folder / '_mentah'
    out = []
    for sh in manifest['sheets']:
        f = mentah / sh['file']
        out.append({'id': sh['id'], 'file': sh['file'], 'uploaded': f.is_file(), 'size': f.stat().st_size if f.is_file() else 0})
    return out


def _preview_names(folder: Path, names: list[str]) -> list[str]:
    return [n for n in names if (folder / '_mentah' / n).is_file()]


# ------------------------------------------------------------------ karakter yang ada

def op_status(a: dict) -> dict:
    root = Path(a['root'])
    slug = _slug(a.get('slug'))
    folder = _folder(root, slug)
    meta = spec.load_meta(folder)
    prefix = spec.prefix_of(meta, slug)
    enabled = spec.packs_of(meta)
    packs = {}
    for p in PACKS_NEW:
        slots = []
        for e in spec.entries(meta, [p], prefix):
            slots.append({'group': e.slot.group, 'id': e.slot.id, 'label': e.slot.label, 'required': e.slot.required, 'present': (folder / e.filename).is_file(), 'file': e.filename})
        req = [s for s in slots if s['required']]
        mf = folder / '_mentah' / f'manifest_{p}.json'
        packs[p] = {'label': spec.PACKS[p], 'enabled': p in enabled, 'slots': slots,
                    'required_total': len(req), 'required_present': sum(1 for s in req if s['present']),
                    'optional_total': len(slots) - len(req), 'optional_present': sum(1 for s in slots if not s['required'] and s['present']),
                    'has_prompts': mf.is_file(), 'sheets': _mentah_list(folder, json.loads(mf.read_text(encoding='utf-8'))) if mf.is_file() else []}
    mouth_at = (meta.get('mouth') or {}).get('at') or {}
    views = sorted({e.slot.view for p in enabled for e in spec.entries(meta, [p], prefix) if e.slot.pack != 'dasar' and e.slot.group == 'mouth' and (folder / e.filename).is_file()})
    return {'slug': slug, 'name': meta.get('name') or slug, 'appearance': meta.get('appearance') or '', 'packs_enabled': enabled, 'mirror_ok': (meta.get('spec') or {}).get('mirror_ok', True),
            'packs': packs, 'mouth_views': [{'view': v, 'at': mouth_at.get(v)} for v in views], 'extra_synced': spec.build_extra(meta, folder, prefix) == (meta.get('extra') or {}),
            'validation': _report(V.validate(folder))}


def op_set_appearance(a: dict) -> dict:
    folder = _folder(Path(a['root']), _slug(a.get('slug')))
    text = str(a.get('appearance') or '').strip()
    if not text or len(text) > 1500:
        raise ApiError('appearance wajib diisi (maksimal 1500 huruf), dalam bahasa Inggris')
    meta = spec.load_meta(folder)
    meta['appearance'] = text
    spec.write_meta(folder, meta)
    return {'appearance': text}


def op_prompts(a: dict) -> dict:
    folder = _folder(Path(a['root']), _slug(a.get('slug')))
    pack = _pack(a.get('pack'))
    res = P.build(folder, pack, bool(a.get('required_only')))
    manifest = json.loads(Path(res['manifest_file']).read_text(encoding='utf-8'))
    up = {s['id']: s for s in _mentah_list(folder, manifest)}
    out = []
    for sh in manifest['sheets']:
        out.append({'id': sh['id'], 'file': sh['file'], 'cols': sh['cols'], 'rows': sh['rows'], 'attach': sh['attach'], 'group': sh['group'], 'text': sh['text'],
                    'cells': [c['id'] if c['role'] == 'slot' else 'ACUAN' for c in sh['cells']], 'uploaded': up[sh['id']]['uploaded']})
    return {'pack': pack, 'sheets': out, 'skipped': res['skipped'], 'missing_acuan': res['missing_acuan'], 'fixes': P.FIXES}


def op_import(a: dict) -> dict:
    root = Path(a['root'])
    folder = _folder(root, _slug(a.get('slug')))
    pack = _pack(a.get('pack'))
    mf = folder / '_mentah' / f'manifest_{pack}.json'
    if not mf.is_file():
        raise ApiError('buat prompt paket ini dulu (manifes belum ada)')
    manifest = json.loads(mf.read_text(encoding='utf-8'))
    files = {sh['id']: folder / '_mentah' / sh['file'] for sh in manifest['sheets'] if (folder / '_mentah' / sh['file']).is_file()}
    if not files:
        raise ApiError('belum ada lembar yang diunggah')
    scales = {str(k): float(v) for k, v in (a.get('scales') or {}).items() if str(k) in {s['id'] for s in manifest['sheets']}}
    try:
        res = sheets.import_sheets(folder, manifest, files, bool(a.get('overwrite')), bool(a.get('equal')), scales, bool(a.get('fit')), bool(a.get('dry_run')))
    except sheets.SheetError as e:
        raise ApiError(str(e)) from e
    previews = _preview_names(folder, [f'_cek_{s}.png' for s in files] + [f'_cek_{pack}.png'])
    return {'notes': res.notes, 'imported': [{'slot': i.slot, 'file': i.file, 'skipped': i.skipped, 'scale': i.info.get('skala'), 'head_at': i.info.get('head_at')} for i in res.imported],
            'previews': previews, 'dry_run': bool(a.get('dry_run')), 'validation': None if a.get('dry_run') else _report(V.validate(folder))}


def op_mouth_at(a: dict) -> dict:
    folder = _folder(Path(a['root']), _slug(a.get('slug')))
    view = str(a.get('view'))
    if view not in ('34', 'sisi'):
        raise ApiError('arah mulut harus 34 atau sisi')
    x, y = int(a['x']), int(a['y'])
    if not (-200 <= x <= 600 and -200 <= y <= 700):
        raise ApiError('koordinat di luar kanvas kepala')
    meta = spec.load_meta(folder)
    meta.setdefault('mouth', {}).setdefault('at', {})[view] = [x, y]
    spec.write_meta(folder, meta)
    return {'view': view, 'at': [x, y]}


def op_head_adjust(a: dict) -> dict:
    """Tempat dan kemiringan kepala untuk satu badan paket (duduk, 3/4, samping, lari): body.head_at[slot] = [x, y] (kiri-atas kepala pada kanvas badan)
    dan body.head_rot[slot] = derajat searah jarum jam mengelilingi leher (0 = hapus)."""
    folder = _folder(Path(a['root']), _slug(a.get('slug')))
    slot = str(a.get('slot') or '')
    meta = spec.load_meta(folder)
    known = {s.id for p in spec.SLOTS.values() for s in p if s.group == 'body'}
    if slot not in known:
        raise ApiError(f'badan "{slot}" bukan slot paket gerak')
    try:
        x, y, rot = int(a['x']), int(a['y']), round(float(a.get('rot') or 0), 1)
    except (KeyError, TypeError, ValueError) as e:
        raise ApiError('x, y, dan rot harus angka') from e
    if not (-300 <= x <= 900 and -300 <= y <= 1500):
        raise ApiError('titik kepala di luar kanvas badan')
    if not -35 <= rot <= 35:
        raise ApiError('kemiringan kepala maksimal 35 derajat ke tiap sisi')
    body = meta.setdefault('body', {})
    body.setdefault('head_at', {})[slot] = [x, y]
    rots = body.setdefault('head_rot', {})
    if rot:
        rots[slot] = rot
    else:
        rots.pop(slot, None)
    if not rots:
        body.pop('head_rot', None)
    spec.write_meta(folder, meta)
    return {'slot': slot, 'at': [x, y], 'rot': rot}


def op_sync(a: dict) -> dict:
    folder = _folder(Path(a['root']), _slug(a.get('slug')))
    meta = spec.load_meta(folder)
    extra = spec.build_extra(meta, folder)
    if extra:
        meta['extra'] = extra
    else:
        meta.pop('extra', None)
    spec.write_meta(folder, meta)
    return {'extra': extra}


def op_colors(a: dict) -> dict:
    folder = _folder(Path(a['root']), _slug(a.get('slug')))
    meta = spec.load_meta(folder)
    ent = {(e.slot.group, e.slot.id): e.filename for e in spec.entries(meta, ['dasar'])}
    named = {}
    for k in (('body', 'diam'), ('head', 'netral')):
        if k in ent and (folder / ent[k]).is_file():
            with Image.open(folder / ent[k]) as im:
                named[f'{k[0]}:{k[1]}'] = im.copy()
    if not named:
        raise ApiError('badan diam atau kepala netral tidak ditemukan')
    out = []
    for c in recolor.analyze(list(named.values()), 10):
        out.append({**c, 'boxes': {k: v for k, v in recolor.cluster_bounds(named, c['hex']).items() if v}})
    return {'clusters': out}


def _maps(a: dict) -> list[recolor.Region]:
    maps = a.get('maps') or []
    if not isinstance(maps, list) or not maps or len(maps) > 12:
        raise ApiError('beri 1-12 aturan warna')
    out = []
    for m in maps:
        try:
            r = recolor.parse_region(str(m), 25.0)
        except ValueError as e:
            raise ApiError(str(e)) from e
        if r.mask:
            raise ApiError('opsi mask tidak tersedia lewat antarmuka web; pakai kotak (box/not)')
        out.append(r)
    return out


def op_recolor(a: dict) -> dict:
    """preview=true: salin ke folder sementara, kembalikan pratinjau, lalu hapus. Tanpa preview: tulis karakter/<as>."""
    root = Path(a['root'])
    folder = _folder(root, _slug(a.get('slug')))
    new = _slug(a.get('as'))
    regions = _maps(a)
    groups = tuple(x for x in (a.get('groups') or ['body', 'head']) if x in spec.GROUPS) or ('body', 'head')
    name = (str(a.get('name') or '').strip() or new)[:120]
    try:
        if a.get('preview'):
            tmp = Path(tempfile.mkdtemp(prefix='cb-prev-'))
            try:
                res = D.duplicate(folder, new, regions, groups, tmp, name)
                png = Path(res['out_dir']) / '_resep' / 'pratinjau.png'
                return {'preview_png_base64': _b64(png) if png.is_file() else None, 'validation': _report(res['report'])}
            finally:
                shutil.rmtree(tmp, ignore_errors=True)
        res = D.duplicate(folder, new, regions, groups, root, name)
    except ValueError as e:
        raise ApiError(str(e)) from e
    return {'slug': new, 'out_dir': str(res['out_dir']), 'copied': res['copied'], 'recolored': res['recolored'], 'validation': _report(res['report'])}


def _b64(p: Path) -> str:
    import base64
    return base64.b64encode(p.read_bytes()).decode('ascii')


# ------------------------------------------------------------------ karakter baru (draf di karakter/_draf/<slug>)

def _draft_state(root: Path, slug: str) -> dict:
    d = N.draft_dir(root, slug)
    mf = d / '_mentah' / 'manifest_dasar.json'
    if not mf.is_file():
        raise ApiError('draf belum dibuat')
    manifest = json.loads(mf.read_text(encoding='utf-8'))
    meta = spec.load_meta(d) if (d / 'character.json').is_file() and (d / f'{slug}_kepala_netral.png').is_file() else None
    return {'slug': slug, 'name': manifest['name'], 'appearance': manifest['appearance'], 'style': manifest.get('style', ''), 'sheets': _mentah_list(d, manifest),
            'imported': meta is not None, 'calibration': (meta or {}).get('calibration') or N.DEFAULT_CALIB, 'has_blink': bool(meta and 'blink' in meta),
            'previews': _preview_names(d, ['_cek_pose.png', '_cek_wajah.png']), 'exists_final': (root / slug / 'character.json').is_file(),
            'validation': _report(V.validate(d)) if meta else None, 'standard': {'head_canvas': list(N.CANON['head_canvas']), 'defaults': N.DEFAULT_CALIB}}


def op_new_start(a: dict) -> dict:
    root = Path(a['root'])
    slug = _slug(a.get('slug'))
    if (root / slug).exists():
        raise ApiError(f'karakter/{slug} sudah ada; pilih nama lain')
    name = (str(a.get('name') or '').strip() or slug)[:120]
    try:
        N.build_prompts(N.draft_dir(root, slug), slug, name, str(a.get('appearance') or ''), str(a.get('style') or '')[:200])
    except ValueError as e:
        raise ApiError(str(e)) from e
    return op_new_state({'root': a['root'], 'slug': slug}) | {'sheets_full': _draft_sheets(root, slug)}


def _draft_sheets(root: Path, slug: str) -> list[dict]:
    d = N.draft_dir(root, slug)
    manifest = json.loads((d / '_mentah' / 'manifest_dasar.json').read_text(encoding='utf-8'))
    up = {s['id']: s for s in _mentah_list(d, manifest)}
    return [{'id': sh['id'], 'file': sh['file'], 'cols': sh['cols'], 'rows': sh['rows'], 'attach': sh['attach'], 'text': sh['text'], 'required': sh['required'],
             'cells': [c['id'] if c['role'] == 'slot' else 'ACUAN' for c in sh['cells']], 'uploaded': up[sh['id']]['uploaded']} for sh in manifest['sheets']]


def op_new_state(a: dict) -> dict:
    root = Path(a['root'])
    slug = _slug(a.get('slug'))
    return _draft_state(root, slug) | {'sheets_full': _draft_sheets(root, slug)}


def op_new_import(a: dict) -> dict:
    root = Path(a['root'])
    slug = _slug(a.get('slug'))
    d = N.draft_dir(root, slug)
    st = _draft_state(root, slug)
    manifest = json.loads((d / '_mentah' / 'manifest_dasar.json').read_text(encoding='utf-8'))
    calib = a.get('calib') if isinstance(a.get('calib'), dict) else None
    if calib:
        try:
            calib = _clean_calib(calib)
        except (TypeError, ValueError) as e:
            raise ApiError('kalibrasi tidak valid: ' + str(e)) from e
    try:
        res = N.import_dasar(d, manifest, None, calib, bool(a.get('fit')), bool(a.get('equal')))
    except sheets.SheetError as e:
        raise ApiError(str(e)) from e
    return {'notes': res['notes'], 'has_blink': res['has_blink'], 'calib': res['calib'], 'state': op_new_state({'root': a['root'], 'slug': st['slug']})}


def _clean_calib(c: dict) -> dict:
    out = {}
    if 'chin_y' in c: out['chin_y'] = max(0, min(500, int(c['chin_y'])))
    if 'mouth' in c: out['mouth'] = [max(0, min(400, int(c['mouth'][0]))), max(0, min(500, int(c['mouth'][1])))]
    if 'eyes' in c:
        e = c['eyes']
        out['eyes'] = [[max(0, min(400, int(e[0][0]))), max(0, min(500, int(e[0][1])))], [max(0, min(400, int(e[1][0]))), max(0, min(500, int(e[1][1])))]]
        if out['eyes'][0][0] >= out['eyes'][1][0] - 10:
            raise ValueError('mata kiri harus di kiri mata kanan (jarak minimal 10 px)')
    for k in ('mouth_scale', 'lid_scale'):
        if k in c: out[k] = max(0.3, min(3.0, float(c[k])))
    if 'head_dx' in c: out['head_dx'] = max(-80, min(80, int(c['head_dx'])))
    if 'head_dy' in c: out['head_dy'] = max(-80, min(80, int(c['head_dy'])))
    if 'head_rot' in c: out['head_rot'] = max(-25.0, min(25.0, round(float(c['head_rot']), 1)))
    return out


def op_new_finish(a: dict) -> dict:
    root = Path(a['root'])
    slug = _slug(a.get('slug'))
    try:
        target = N.finish(N.draft_dir(root, slug), root, slug, bool(a.get('update')))
    except ValueError as e:
        raise ApiError(str(e)) from e
    # draf (dan lembar mentahnya) sengaja dibiarkan: revisi tidak perlu unggah ulang. Hapus lewat "Buang draf".
    return {'slug': slug, 'folder': str(target)}


def op_new_discard(a: dict) -> dict:
    root = Path(a['root'])
    shutil.rmtree(N.draft_dir(root, _slug(a.get('slug'))), ignore_errors=True)
    return {}


OPS = {k[3:]: v for k, v in list(globals().items()) if k.startswith('op_')}


def run(op: str, args: dict) -> dict:
    if op not in OPS:
        return {'ok': False, 'error': f'op tidak dikenal: {op}'}
    try:
        return {'ok': True, 'data': OPS[op](args)}
    except ValueError as e:                      # ApiError, SheetError dan galat masukan lain: pesannya untuk pengguna
        return {'ok': False, 'error': str(e)}
    except (KeyError, TypeError) as e:
        return {'ok': False, 'error': f'argumen tidak lengkap atau salah tipe: {e}'}
    except Exception as e:                       # noqa: BLE001 - pengaman terakhir: backend selalu mendapat JSON
        import traceback
        traceback.print_exc(file=sys.stderr)
        return {'ok': False, 'error': f'galat tak terduga ({type(e).__name__}): {e}'}


def main(op: str) -> int:
    try:
        args = json.loads(sys.stdin.read() or '{}')
        if not isinstance(args, dict) or not args.get('root'):
            raise ValueError('stdin harus JSON objek berisi "root"')
    except ValueError as e:
        print(json.dumps({'ok': False, 'error': str(e)}))
        return 0
    print(json.dumps(run(op, args), ensure_ascii=False))
    return 0

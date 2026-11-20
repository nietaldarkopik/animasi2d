"""Duplikasi karakter kartu: salin folder dengan nama baru, ganti warna per wilayah, timpa slot tertentu, tulis resep dan pratinjau."""
from __future__ import annotations

import copy
import datetime as dt
import json
import shutil
from pathlib import Path

from PIL import Image

from . import recolor, spec
from . import validate as V

TOOL_VERSION = 1


def _rename(filename: str, old: str, new: str) -> str:
    if not filename.startswith(old + '_'):
        raise ValueError(f'berkas "{filename}" tidak berawalan "{old}_", tidak bisa diganti namanya')
    return new + filename[len(old):]


def preview_image(meta: dict, folder: Path, height: int = 640) -> Image.Image | None:
    """Badan diam + kepala netral dirakit seperti di character.json, dipotong pada figur."""
    ent = {(e.slot.group, e.slot.id): e.filename for e in spec.entries(meta, ['dasar'])}
    pose = 'diam' if ('body', 'diam') in ent else next((i for g, i in ent if g == 'body'), None)
    expr = 'netral' if ('head', 'netral') in ent else next((i for g, i in ent if g == 'head'), None)
    if pose is None or expr is None or not (folder / ent[('body', pose)]).is_file() or not (folder / ent[('head', expr)]).is_file():
        return None
    with Image.open(folder / ent[('body', pose)]) as b, Image.open(folder / ent[('head', expr)]) as h:
        body, head = b.convert('RGBA'), h.convert('RGBA')
    px, py = (meta.get('head') or {}).get('paste_on_body', [0, 0])
    dx = int(((meta.get('body') or {}).get('head_dx') or {}).get(pose, 0))
    body.alpha_composite(head, (int(px) + dx, int(py)))
    box = body.getbbox()
    if box:
        body = body.crop(box)
    return body.resize((max(1, round(body.width * height / body.height)), height), Image.LANCZOS)


def side_by_side(a: Image.Image | None, b: Image.Image | None) -> Image.Image | None:
    ims = [i for i in (a, b) if i is not None]
    if not ims:
        return None
    sheet = Image.new('RGBA', (sum(i.width for i in ims) + 20 * (len(ims) + 1), ims[0].height + 40), (236, 236, 240, 255))
    x = 20
    for i in ims:
        sheet.alpha_composite(i, (x, 20))
        x += i.width + 20
    return sheet


def duplicate(src_dir: Path, new_slug: str, regions: list[recolor.Region] | None = None, default_groups: tuple[str, ...] = ('body', 'head'),
              out_root: Path | None = None, name: str | None = None, overrides: dict | None = None, overwrite: bool = False) -> dict:
    """-> {'out_dir', 'report', 'copied', 'recolored', 'overridden', 'skipped'}; ValueError bila masukan tidak layak."""
    src_dir = Path(src_dir)
    regions = regions or []
    overrides = overrides or {}
    if not spec.SLUG_RE.match(new_slug):
        raise ValueError('nama baru hanya boleh huruf/angka/_/- dan diawali huruf atau angka')
    meta = spec.load_meta(src_dir)
    src_prefix = spec.prefix_of(meta, src_dir.name)
    packs = spec.packs_of(meta)
    out_root = Path(out_root) if out_root else src_dir.parent
    out_dir = out_root / new_slug
    if out_dir.exists() and not overwrite:
        raise ValueError(f'{out_dir} sudah ada (pakai --overwrite untuk menimpa)')
    if out_dir.resolve() == src_dir.resolve():
        raise ValueError('nama baru sama dengan sumber')

    entries = spec.entries(meta, packs, src_prefix)
    missing = [e.filename for e in entries if e.slot.required and not (src_dir / e.filename).is_file()]
    if missing:
        raise ValueError('sumber belum lengkap, tidak bisa diduplikat: ' + ', '.join(missing[:5]))
    for (grp, sid), p in overrides.items():
        if not any(e.slot.group == grp and e.slot.id == sid for e in entries):
            raise ValueError(f'slot override "{grp}:{sid}" tidak ada di karakter ini')
        if not Path(p).is_file():
            raise ValueError(f'berkas override tidak ada: {p}')
    for r in regions:
        for g in (r.groups or default_groups):
            if g not in spec.GROUPS:
                raise ValueError(f'kelompok "{g}" tidak dikenal ({", ".join(spec.GROUPS)})')
        if not r.chromatic and not r.box and not r.mask:
            print(f'PERINGATAN: {recolor.rgb_to_hex(r.src)} nyaris abu-abu; tanpa box/mask garis tepi dan bayangan gelap ikut berubah.')

    tmp = out_root / f'.tmp_{new_slug}'
    if tmp.exists():
        shutil.rmtree(tmp)
    tmp.mkdir(parents=True)
    stats = {'copied': 0, 'recolored': 0, 'overridden': 0, 'skipped': []}
    try:
        for e in entries:
            src = src_dir / e.filename
            if not src.is_file():
                stats['skipped'].append(e.filename)
                continue
            dst = tmp / _rename(e.filename, src_prefix, new_slug)
            key = (e.slot.group, e.slot.id)
            if key in overrides:
                with Image.open(overrides[key]) as ov:
                    size = ov.size
                want = spec.canvas_of(meta, e.slot.group)
                if want and size != want:
                    raise ValueError(f'override {key[0]}:{key[1]} berukuran {size}, seharusnya {want}')
                shutil.copyfile(overrides[key], dst)
                stats['overridden'] += 1
                continue
            if any(e.slot.group in (r.groups or default_groups) for r in regions):
                with Image.open(src) as img:
                    out = recolor.apply_regions(img, regions, e.slot.group, default_groups, mask_dir=src_dir)
                out.save(dst, format='PNG')
                stats['recolored'] += 1
            else:
                shutil.copyfile(src, dst)
                stats['copied'] += 1

        new_meta = copy.deepcopy(meta)
        for g in spec.GROUPS:
            f = (new_meta.get(g) or {}).get('file')
            if f and str(f).startswith(src_prefix + '_'):
                new_meta[g]['file'] = _rename(str(f), src_prefix, new_slug)
        new_meta['name'] = name or new_slug
        new_meta['extends'] = src_dir.name
        new_meta['recolor'] = [r.describe() for r in regions]
        sp = new_meta.get('spec') if isinstance(new_meta.get('spec'), dict) else {}
        new_meta['spec'] = {'version': spec.SPEC_VERSION, 'packs': packs, 'mirror_ok': sp.get('mirror_ok', True)}
        extra = spec.build_extra(new_meta, tmp, new_slug)
        if extra:
            new_meta['extra'] = extra
        else:
            new_meta.pop('extra', None)
        new_meta['source'] = f'Duplikat dari {src_dir.name} (tools/card_builder)'
        if 'style' in new_meta:
            new_meta['style_note'] = f'"style" disalin dari {src_dir.name}; sesuaikan bila warna/penampilan berubah'
        spec.write_meta(tmp, new_meta, like=src_dir)

        resep = tmp / '_resep'
        resep.mkdir()
        (resep / 'resep.json').write_text(json.dumps({
            'tool': 'card_builder', 'version': TOOL_VERSION, 'created': dt.datetime.now().isoformat(timespec='seconds'),
            'extends': src_dir.name, 'name': new_meta['name'], 'groups': list(default_groups), 'recolor': new_meta['recolor'],
            'overrides': {f'{g}:{i}': str(p) for (g, i), p in overrides.items()}}, indent=1, ensure_ascii=False), encoding='utf-8')
        sheet = side_by_side(preview_image(meta, src_dir), preview_image(new_meta, tmp))
        if sheet is not None:
            sheet.convert('RGB').save(resep / 'pratinjau.png')

        if out_dir.exists():
            shutil.rmtree(out_dir)
        tmp.rename(out_dir)
    except BaseException:
        shutil.rmtree(tmp, ignore_errors=True)
        raise

    return {'out_dir': str(out_dir), 'report': V.validate(out_dir), **stats}

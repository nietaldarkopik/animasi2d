"""Uji Card Builder dengan karakter sintetis kecil (tanpa aset nyata). Jalankan: cd tools && python -m unittest discover -s card_builder/tests -t ."""
from __future__ import annotations

import json
import shutil
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from card_builder import duplicate as D
from card_builder import recolor as R
from card_builder import spec
from card_builder import validate as V

BODY, HEAD, MOUTH = (80, 140), (40, 50), (12, 8)
SKIN, HAIR, HAIR_DARK, TIE, GREY, OUTLINE = (240, 210, 190), (96, 80, 120), (60, 48, 80), (130, 80, 90), (126, 126, 132), (30, 30, 30)


def body_png(shade_hair=False) -> Image.Image:
    im = Image.new('RGBA', BODY, (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rectangle([22, 40, 58, 135], fill=(*GREY, 255))                    # rok/badan abu, dasar y=135 = feet_y
    d.rectangle([36, 44, 44, 70], fill=(*TIE, 255))                      # dasi
    d.rectangle([22, 40, 58, 41], fill=(*OUTLINE, 255))                  # garis tepi
    return im


def head_png(expr: str) -> Image.Image:
    im = Image.new('RGBA', HEAD, (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rectangle([8, 16, 32, 46], fill=(*SKIN, 255))
    d.rectangle([6, 2, 34, 15], fill=(*HAIR, 255))
    d.rectangle([6, 2, 34, 4], fill=(*HAIR_DARK, 255))                   # bayangan rambut: lebih gelap, hue sama
    d.rectangle([8, 16, 32, 17], fill=(*OUTLINE, 255))
    if expr == 'senang':
        d.rectangle([14, 30, 26, 32], fill=(200, 90, 90, 255))
    return im


def make_character(root: Path, slug: str = 'tes') -> Path:
    f = root / slug
    f.mkdir(parents=True)
    meta = {
        'name': slug, 'style': 'uji',
        'body': {'canvas': list(BODY), 'feet_y': 135, 'center_x': 40, 'poses': ['diam', 'tunjuk'], 'file': f'{slug}_badan_<pose>.png', 'head_dx': {'diam': 0, 'tunjuk': 1}},
        'head': {'canvas': list(HEAD), 'paste_on_body': [20, 0], 'expressions': ['netral', 'senang'], 'file': f'{slug}_kepala_<ekspresi>.png'},
        'mouth': {'canvas': list(MOUTH), 'shapes': ['a', 'o'], 'file': f'{slug}_mulut_<bentuk>.png'},
        'blink': {'file': f'{slug}_kelopak.png', 'canvas': list(HEAD)},
    }
    (f / 'character.json').write_text(json.dumps(meta), encoding='utf-8')
    for p in meta['body']['poses']: body_png().save(f / f'{slug}_badan_{p}.png')
    for e in meta['head']['expressions']: head_png(e).save(f / f'{slug}_kepala_{e}.png')
    for s in meta['mouth']['shapes']:
        m = Image.new('RGBA', MOUTH, (0, 0, 0, 0)); ImageDraw.Draw(m).rectangle([2, 2, 9, 5], fill=(200, 90, 90, 255)); m.save(f / f'{slug}_mulut_{s}.png')
    k = Image.new('RGBA', HEAD, (0, 0, 0, 0)); ImageDraw.Draw(k).rectangle([10, 20, 30, 22], fill=(30, 30, 30, 255)); k.save(f / f'{slug}_kelopak.png')
    return f


def levels(rep: V.Report, level: str) -> list[str]:
    return [c['msg'] for c in rep.checks if c['level'] == level]


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix='cardtest-'))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.char = make_character(self.tmp)

    def meta(self) -> dict: return json.loads((self.char / 'character.json').read_text(encoding='utf-8'))
    def save_meta(self, m: dict): (self.char / 'character.json').write_text(json.dumps(m), encoding='utf-8')


class ValidatorTests(Base):
    def test_valid_character_passes(self):
        rep = V.validate(self.char)
        self.assertEqual(rep.verdict, 'pass', levels(rep, 'fail'))
        self.assertEqual(levels(rep, 'warn'), [])

    def test_wrong_canvas_size_fails(self):
        Image.new('RGBA', (41, 50), (0, 0, 0, 0)).save(self.char / 'tes_kepala_netral.png')
        self.assertTrue(any('41x50' in m for m in levels(V.validate(self.char), 'fail')))

    def test_green_key_residue_fails(self):
        im = head_png('netral'); ImageDraw.Draw(im).rectangle([10, 20, 20, 30], fill=(0, 255, 0, 255)); im.save(self.char / 'tes_kepala_netral.png')
        self.assertTrue(any('kunci hijau' in m for m in levels(V.validate(self.char), 'fail')))

    def test_missing_transparency_fails(self):
        head_png('netral').convert('RGB').save(self.char / 'tes_kepala_netral.png')
        self.assertTrue(any('transparansi' in m for m in levels(V.validate(self.char), 'fail')))

    def test_empty_image_fails(self):
        Image.new('RGBA', HEAD, (0, 0, 0, 0)).save(self.char / 'tes_kepala_netral.png')
        self.assertTrue(any('kosong' in m for m in levels(V.validate(self.char), 'fail')))

    def test_missing_required_file_fails(self):
        (self.char / 'tes_kepala_senang.png').unlink()
        self.assertTrue(any('tes_kepala_senang.png' in m for m in levels(V.validate(self.char), 'fail')))

    def test_missing_optional_file_is_not_failure(self):
        (self.char / 'tes_mulut_a.png').unlink()
        self.assertEqual(V.validate(self.char).verdict, 'pass')

    def test_orphan_file_warns(self):
        shutil.copy(self.char / 'tes_mulut_a.png', self.char / 'tes_mulut_a - Copy.png')
        self.assertTrue(any('tidak dipakai' in m for m in levels(V.validate(self.char), 'warn')))

    def test_touching_edge_warns(self):
        im = body_png(); ImageDraw.Draw(im).rectangle([0, 50, 5, 100], fill=(*GREY, 255)); im.save(self.char / 'tes_badan_diam.png')
        self.assertTrue(any('tepi kiri' in m for m in levels(V.validate(self.char), 'warn')))

    def test_feet_off_ground_warns(self):
        im = Image.new('RGBA', BODY, (0, 0, 0, 0)); ImageDraw.Draw(im).rectangle([22, 40, 58, 90], fill=(*GREY, 255)); im.save(self.char / 'tes_badan_diam.png')
        self.assertTrue(any('kaki seharusnya' in m for m in levels(V.validate(self.char), 'warn')))

    def test_importer_filename_rule(self):
        m = self.meta(); m['body']['file'] = 'tes badan <pose>.png'; self.save_meta(m)
        self.assertTrue(any('importer' == c['area'] for c in V.validate(self.char).checks if c['level'] == 'fail'))

    def test_v2_pack_requires_files_and_head_at(self):
        m = self.meta(); m['spec'] = {'version': 2, 'packs': ['dasar', 'duduk']}; self.save_meta(m)
        rep = V.validate(self.char)
        self.assertTrue(any('paket duduk' in x and 'wajib' in x for x in levels(rep, 'fail')))
        for s in spec.SLOTS['duduk']:
            if s.required: body_png().save(self.char / s.filename('tes'))
        rep = V.validate(self.char)
        self.assertTrue(any('head_at' in x for x in levels(rep, 'fail')))
        m['body']['head_at'] = {s.id: [20, 30] for s in spec.SLOTS['duduk']}; self.save_meta(m)
        rep = V.validate(self.char)
        self.assertEqual(rep.verdict, 'pass', levels(rep, 'fail'))

    def test_legacy_character_ignores_v2_slots(self):
        body_png().save(self.char / 'tes_badan_duduk_tegak.png')                  # ada berkas v2 tapi paket tidak diaktifkan
        rep = V.validate(self.char)
        self.assertEqual(rep.verdict, 'pass')
        self.assertTrue(any('tidak dipakai' in m for m in levels(rep, 'warn')))


class RecolorTests(unittest.TestCase):
    def hue(self, rgb) -> float: return float(R.rgb2hsv(np.array(rgb, float) / 255)[0])

    def test_chromatic_region_changes_hue_keeps_alpha_and_shading(self):
        img = head_png('netral')
        region = R.parse_region('#605078>#3f5f9f')
        out = R.apply_regions(img, [region], 'head', ('head',))
        a, b = np.asarray(img), np.asarray(out)
        np.testing.assert_array_equal(a[..., 3], b[..., 3])                       # alfa tidak berubah
        hair, shadow, skin = (10, 10), (3, 10), (30, 20)                           # (baris=y, kolom=x)
        self.assertLess(abs(self.hue(b[hair][:3]) - self.hue((63, 95, 159))), 12)  # rambut menjadi biru
        self.assertLess(abs(self.hue(b[shadow][:3]) - self.hue((63, 95, 159))), 12)
        self.assertLess(b[shadow][:3].mean(), b[hair][:3].mean())                  # bayangan tetap lebih gelap
        np.testing.assert_array_equal(a[skin], b[skin])                            # kulit tidak tersentuh
        np.testing.assert_array_equal(a[16, 10], b[16, 10])                        # garis tepi tidak tersentuh

    def test_neutral_region_needs_box_and_stays_inside_it(self):
        img = body_png()
        region = R.parse_region('#7e7e84>#2a4d7a;box=0,90,80,140')
        out = np.asarray(R.apply_regions(img, [region], 'body', ('body',))); src = np.asarray(img)
        self.assertGreater(abs(int(out[120, 40, 0]) - int(src[120, 40, 0])), 60)   # di dalam kotak: merah turun jauh
        np.testing.assert_array_equal(out[60, 30], src[60, 30])                    # di luar kotak: tetap
        self.assertFalse(region.chromatic)

    def test_exclusion_box_protects_pixels(self):
        img = head_png('netral')
        out = np.asarray(R.apply_regions(img, [R.parse_region('#605078>#3f5f9f;not=0,0,40,6')], 'head', ('head',)))
        np.testing.assert_array_equal(out[3, 10], np.asarray(img)[3, 10])
        self.assertFalse((out[10, 8] == np.asarray(img)[10, 8]).all())

    def test_group_filter(self):
        img = head_png('netral')
        out = R.apply_regions(img, [R.parse_region('#605078>#3f5f9f;groups=body')], 'head', ('head',))
        np.testing.assert_array_equal(np.asarray(out), np.asarray(img))

    def test_mask_size_mismatch_is_error(self):
        d = Path(tempfile.mkdtemp()); self.addCleanup(shutil.rmtree, d, ignore_errors=True)
        Image.new('RGBA', (5, 5), (0, 0, 0, 255)).save(d / 'm.png')
        with self.assertRaises(ValueError):
            R.apply_regions(head_png('netral'), [R.parse_region('#605078>#3f5f9f;mask=m.png')], 'head', ('head',), mask_dir=d)

    def test_parse_region_errors(self):
        for bad in ('#fff', '#zzzzzz>#000000', '#000000>#ffffff;box=1,2,3', '#000000>#ffffff;aneh=1'):
            with self.assertRaises(ValueError, msg=bad):
                R.parse_region(bad)
        self.assertEqual(R.parse_region('#abc>#def').src, (170, 187, 204))

    def test_analyze_finds_hair_family(self):
        found = R.analyze([head_png('netral')])
        self.assertTrue(any(c['name'] == 'ungu' for c in found), found)
        box = R.cluster_bounds({'head': head_png('netral')}, '#605078')['head']
        self.assertIsNotNone(box)
        self.assertLessEqual(box[1], 6)


class DuplicateTests(Base):
    def dup(self, **kw):
        return D.duplicate(self.char, 'kembar', kw.pop('regions', []), out_root=self.tmp, **kw)

    def test_plain_copy_is_byte_identical_and_renamed(self):
        res = self.dup()
        out = Path(res['out_dir'])
        self.assertTrue((out / 'kembar_badan_diam.png').is_file() and (out / 'kembar_kelopak.png').is_file())
        self.assertEqual((out / 'kembar_kepala_senang.png').read_bytes(), (self.char / 'tes_kepala_senang.png').read_bytes())
        self.assertEqual(res['report'].verdict, 'pass', levels(res['report'], 'fail'))
        self.assertFalse((self.tmp / '.tmp_kembar').exists())

    def test_json_rewritten_and_importer_compatible(self):
        out = Path(self.dup(regions=[R.parse_region('#605078>#3f5f9f')], name='Kembar Biru')['out_dir'])
        m = json.loads((out / 'character.json').read_text(encoding='utf-8'))
        self.assertEqual((m['name'], m['extends']), ('Kembar Biru', 'tes'))
        self.assertEqual(m['body']['file'], 'kembar_badan_<pose>.png')
        self.assertEqual(m['recolor'][0]['dst'], '#3f5f9f')
        self.assertEqual(m['spec'], {'version': 2, 'packs': ['dasar'], 'mirror_ok': True})
        self.assertEqual(V.resolve_legacy(m, out), [])                              # tiruan readSpec: tidak ada masalah
        self.assertTrue((out / '_resep' / 'resep.json').is_file() and (out / '_resep' / 'pratinjau.png').is_file())

    def test_source_is_untouched(self):
        before = {p.name: p.read_bytes() for p in self.char.iterdir() if p.is_file()}
        self.dup(regions=[R.parse_region('#605078>#3f5f9f')])
        self.assertEqual(before, {p.name: p.read_bytes() for p in self.char.iterdir() if p.is_file()})

    def test_recolor_applies_to_selected_groups_only(self):
        out = Path(self.dup(regions=[R.parse_region('#605078>#3f5f9f')])['out_dir'])
        head = np.asarray(Image.open(out / 'kembar_kepala_netral.png').convert('RGBA'))
        self.assertGreater(abs(float(R.rgb2hsv(head[10, 8, :3].astype(float) / 255)[0]) - float(R.rgb2hsv(np.array(HAIR, float) / 255)[0])), 20)
        self.assertEqual((out / 'kembar_mulut_a.png').read_bytes(), (self.char / 'tes_mulut_a.png').read_bytes())   # mulut bukan default

    def test_refuses_existing_target_bad_slug_and_same_name(self):
        self.dup()
        with self.assertRaises(ValueError): self.dup()
        self.dup(overwrite=True)
        with self.assertRaises(ValueError): D.duplicate(self.char, 'Nama Salah!', [], out_root=self.tmp)
        with self.assertRaises(ValueError): D.duplicate(self.char, 'tes', [], out_root=self.tmp)        # nama sama dengan sumber

    def test_incomplete_source_is_refused_and_leaves_nothing(self):
        (self.char / 'tes_kepala_netral.png').unlink()
        with self.assertRaises(ValueError): self.dup()
        self.assertFalse((self.tmp / 'kembar').exists() or (self.tmp / '.tmp_kembar').exists())

    def test_override_replaces_slot_and_checks_size(self):
        good = self.tmp / 'baru.png'; Image.new('RGBA', HEAD, (10, 200, 30, 255)).save(good)
        out = Path(self.dup(overrides={('head', 'senang'): good})['out_dir'])
        self.assertEqual((out / 'kembar_kepala_senang.png').read_bytes(), good.read_bytes())
        bad = self.tmp / 'salah.png'; Image.new('RGBA', (9, 9)).save(bad)
        shutil.rmtree(out)
        with self.assertRaises(ValueError): self.dup(overrides={('head', 'senang'): bad})
        with self.assertRaises(ValueError): self.dup(overrides={('head', 'tidak_ada'): good})

    def test_v2_slots_are_copied_with_pack_enabled(self):
        m = self.meta(); m['spec'] = {'version': 2, 'packs': ['dasar', 'duduk']}; m['body']['head_at'] = {s.id: [20, 30] for s in spec.SLOTS['duduk']}; self.save_meta(m)
        for s in spec.SLOTS['duduk']:
            if s.required: body_png().save(self.char / s.filename('tes'))
        res = self.dup()
        out = Path(res['out_dir'])
        self.assertTrue((out / 'kembar_badan_duduk_sila.png').is_file())
        self.assertEqual(res['report'].verdict, 'pass', levels(res['report'], 'fail'))
        self.assertEqual(json.loads((out / 'character.json').read_text())['body']['head_at']['duduk_sila'], [20, 30])
        extra = json.loads((out / 'character.json').read_text())['extra']
        self.assertEqual(extra['body']['duduk_sila'], 'kembar_badan_duduk_sila.png')          # peta ikut dinamai ulang
        self.assertTrue(all((out / f).is_file() for f in extra['body'].values()))

    def test_validator_warns_when_extra_map_is_out_of_sync(self):
        m = self.meta(); m['spec'] = {'version': 2, 'packs': ['dasar', 'duduk']}; m['body']['head_at'] = {s.id: [20, 30] for s in spec.SLOTS['duduk']}; self.save_meta(m)
        for s in spec.SLOTS['duduk']:
            if s.required: body_png().save(self.char / s.filename('tes'))
        rep = V.validate(self.char)
        self.assertTrue(any('"extra" tidak sinkron' in x for x in levels(rep, 'warn')))
        m['extra'] = spec.build_extra(m, self.char); self.save_meta(m)
        self.assertFalse(any('"extra"' in x for x in levels(V.validate(self.char), 'warn')))


class RealCharacterTests(unittest.TestCase):
    ROOT = Path(__file__).resolve().parents[3] / 'karakter'

    def test_existing_characters_have_no_failures(self):
        found = [p for p in sorted(self.ROOT.glob('*')) if p.is_dir() and not p.name.startswith('_') and (p / 'character.json').is_file()]
        if not found:
            self.skipTest('folder karakter/ tidak ada')
        for p in found:
            rep = V.validate(p)
            self.assertEqual(rep.verdict, 'pass', f'{p.name}: {levels(rep, "fail")}')


if __name__ == '__main__':
    unittest.main()

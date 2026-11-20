"""Karakter baru dari lembar Flow. Lembar disimulasikan dari 25 aset Arum yang nyata (Arum = kebenaran dasar): diperkecil, di atas latar hijau,
mulut di atas tambalan kulit seperti hasil AI. Hasil importer dibandingkan dengan Arum asli."""
from __future__ import annotations

import json
import shutil
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from card_builder import newchar as N
from card_builder import sheets as S
from card_builder import spec
from card_builder import validate as V
from card_builder.tests.test_sheets import make_sheet, trimmed

ROOT = Path(__file__).resolve().parents[3] / 'karakter'
ARUM = ROOT / 'arum'
APPEARANCE = 'long straight dark-purple hair with straight bangs, large purple eyes, white sailor-collar school blouse with a maroon tie, long grey pleated skirt'


def arum(name: str) -> Image.Image:
    return Image.open(ARUM / f'arum_{name}.png').convert('RGBA')


def skin_patch_mouth(v: str, k: float = 3.0) -> Image.Image:
    """Mulut Arum di atas tambalan kulit persegi (seperti sel mulut dari AI), diperbesar k kali."""
    head = arum('kepala_netral')
    skin = tuple(int(x) for x in N._skin_of_head(head, N.DEFAULT_CALIB))
    patch = Image.new('RGBA', (150, 90), (*skin, 255))
    mo = arum(f'mulut_{v}')
    patch.alpha_composite(mo, (75 - 60, 45 - 40))
    return patch.resize((round(150 * k), round(90 * k)), Image.LANCZOS)


def lid_cells(k: float = 3.0) -> list[Image.Image]:
    lids = arum('kelopak')
    out = []
    for ex in (163, 232):
        c = lids.crop((ex - 45, 215 - 32, ex + 45, 215 + 32))
        out.append(c.crop(c.getbbox()).resize((round(c.crop(c.getbbox()).width * k), round(c.crop(c.getbbox()).height * k)), Image.LANCZOS))
    return out


def write_sheets(d: Path, slug: str = 'bar', skip: tuple[str, ...] = ()) -> None:
    d.mkdir(parents=True, exist_ok=True)
    def save(name, img): img.convert('RGB').save(d / f'{slug}_{name}.png')
    def body(sid, poses, ref): save(sid, make_sheet([trimmed(ARUM / f'arum_badan_{p}.png') for p in (['diam'] if ref else []) + poses], len(poses) + (1 if ref else 0), 1, .5))
    save('kepala', make_sheet([trimmed(ARUM / f'arum_kepala_{e}.png') for e in N.EXPRESSIONS], 5, 2, .6, gap=70, align='top'))
    body('badan_a', ['diam', 'tunjuk', 'angkat'], False)
    body('badan_b', ['lambai', 'pinggang', 'pelipis'], True)
    body('badan_c', ['dagu', 'jempol', 'silang'], True)
    save('mulut', make_sheet([skin_patch_mouth(v) for v in N.VOWELS], 5, 1, 1.0, gap=60, align='top'))
    save('kelopak', make_sheet(lid_cells(), 2, 1, 1.0, gap=260, align='top'))
    for s in skip:
        (d / f'{slug}_{s}.png').unlink()


@unittest.skipUnless(ARUM.is_dir(), 'karakter/arum tidak ada')
class PromptTests(unittest.TestCase):
    def test_plan_and_prompt_text(self):
        sheets = N.plan('bar')
        self.assertEqual([s['id'] for s in sheets], ['acuan', 'kepala', 'badan_a', 'badan_b', 'badan_c', 'mulut', 'kelopak'])
        self.assertEqual([len(s['cells']) for s in sheets], [0, 10, 3, 4, 4, 5, 2])
        self.assertEqual([c['role'] for c in sheets[3]['cells']], ['ref', 'slot', 'slot', 'slot'])     # sel acuan ukuran pada lembar badan B dan C
        self.assertEqual(sheets[2]['cells'][0]['role'], 'slot')                                          # pada A pose diam itu sendiri acuannya
        self.assertEqual({s['id']: s['required'] for s in sheets}, {'acuan': False, 'kepala': True, 'badan_a': True, 'badan_b': True, 'badan_c': True, 'mulut': True, 'kelopak': False})

    def test_build_prompts_writes_files_and_validates_input(self):
        tmp = Path(tempfile.mkdtemp()); self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        man = N.build_prompts(tmp / 'bar', 'bar', 'Bar', APPEARANCE, 'anime')
        text = (tmp / 'bar' / '_mentah' / 'prompt_dasar.txt').read_text(encoding='utf-8')
        self.assertIn(APPEARANCE, text)
        self.assertEqual(text.split('##### JIKA HASIL SALAH')[0].count('NO HEAD'), 3)
        self.assertIn('bar_badan_b.png', text)
        self.assertIn('(gambar karakter Anda)', text)
        self.assertEqual(json.loads((tmp / 'bar' / '_mentah' / 'manifest_dasar.json').read_text(encoding='utf-8'))['sheets'][1]['file'], 'bar_kepala.png')
        self.assertEqual(man['name'], 'Bar')
        with self.assertRaises(ValueError): N.build_prompts(tmp / 'x', 'x', 'X', '  ')
        with self.assertRaises(ValueError): N.build_prompts(tmp / 'x', 'Nama Salah', 'X', APPEARANCE)


@unittest.skipUnless(ARUM.is_dir(), 'karakter/arum tidak ada')
class ImportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp(prefix='newchar-'))
        cls.folder = cls.tmp / 'karakter' / '_draf' / 'bar'
        cls.manifest = N.build_prompts(cls.folder, 'bar', 'Bar', APPEARANCE, 'japanese-anime cel-shade')
        write_sheets(cls.folder / '_mentah')
        cls.res = N.import_dasar(cls.folder, cls.manifest)
        cls.meta = spec.load_meta(cls.folder)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def png(self, name): return Image.open(self.folder / name).convert('RGBA')

    def test_all_25_files_and_a_valid_character_json(self):
        names = [f'bar_badan_{p}.png' for p in N.POSES] + [f'bar_kepala_{e}.png' for e in N.EXPRESSIONS] + [f'bar_mulut_{v}.png' for v in N.VOWELS] + ['bar_kelopak.png']
        self.assertTrue(all((self.folder / n).is_file() for n in names))
        self.assertEqual(len(names), 25)
        rep = V.validate(self.folder)
        self.assertEqual(rep.verdict, 'pass', [c['msg'] for c in rep.checks if c['level'] == 'fail'])
        self.assertEqual(V.resolve_legacy(self.meta, self.folder), [])                       # CardCharacterController::readSpec menerimanya
        self.assertEqual((self.meta['body']['poses'], self.meta['head']['expressions'], self.meta['mouth']['shapes']), (N.POSES, N.EXPRESSIONS, N.VOWELS))
        self.assertEqual(self.meta['body']['file'], 'bar_badan_<pose>.png')
        self.assertIn('appearance', self.meta)
        self.assertEqual(self.meta['spec']['packs'], ['dasar'])

    def test_bodies_are_placed_by_the_neck_at_the_standard(self):
        for p in N.POSES:
            im = self.png(f'bar_badan_{p}.png')
            self.assertEqual(im.size, (800, 1400))
            orig = Image.open(ARUM / f'arum_badan_{p}.png').convert('RGBA')
            ob, rb = S.canvas_bbox(im), S.canvas_bbox(orig)
            crop = im.crop(ob)
            top, cx = S.neck_anchor(crop)
            self.assertLessEqual(abs(ob[1] + top - 275), 3, f'{p}: leher di y={ob[1] + top:.0f}')
            self.assertLessEqual(abs(ob[0] + cx - 400), 4, f'{p}: leher di x={ob[0] + cx:.0f}')
            self.assertLess(abs((ob[3] - ob[1]) / (rb[3] - rb[1]) - 1), .06, f'{p}: tinggi {ob[3] - ob[1]} vs {rb[3] - rb[1]}')   # ujung jari tipis bisa hilang oleh kunci hijau
        d = S.canvas_bbox(self.png('bar_badan_diam.png'))
        self.assertLessEqual(abs(d[3] - 1374), 6)                                              # standing: kaki di tanah (1375)
        self.assertEqual(self.meta['body']['head_dx'], {p: 0 for p in N.POSES})

    def test_heads_use_the_neutral_head_as_the_size_reference(self):
        for e in N.EXPRESSIONS:
            im = self.png(f'bar_kepala_{e}.png')
            self.assertEqual(im.size, (400, 500))
            ob = S.canvas_bbox(im)
            rb = S.canvas_bbox(Image.open(ARUM / f'arum_kepala_{e}.png').convert('RGBA'))
            self.assertLess(abs((ob[3] - ob[1]) / (rb[3] - rb[1]) - 1), .035, e)
            self.assertLessEqual(abs(ob[1] - rb[1]), 8, f'{e}: puncak {ob[1]} vs {rb[1]}')
            self.assertLessEqual(abs((ob[0] + ob[2]) / 2 - (rb[0] + rb[2]) / 2), 10, e)
        ob = S.canvas_bbox(self.png('bar_kepala_netral.png'))
        self.assertLessEqual(abs(ob[1] - 75), 2)
        self.assertLessEqual(abs((ob[3] - ob[1]) - 304), 4)

    def test_mouths_blend_into_the_face(self):
        head = self.png('bar_kepala_netral.png')
        mx, my = self.meta['mouth']['paste_on_head_topleft']
        self.assertEqual((mx, my), (139, 218))
        for v in N.VOWELS:
            m = self.png(f'bar_mulut_{v}.png')
            self.assertEqual(m.size, (120, 80))
            a = np.asarray(m)[..., 3]
            self.assertGreater((a > 200).mean(), .01)
            ob = S.canvas_bbox(m)
            orig = S.canvas_bbox(Image.open(ARUM / f'arum_mulut_{v}.png').convert('RGBA'))
            self.assertLess(abs((ob[2] - ob[0]) / (orig[2] - orig[0]) - 1), .45, f'{v}: lebar {ob[2] - ob[0]} vs {orig[2] - orig[0]}')
            self.assertLessEqual(abs((ob[0] + ob[2]) / 2 - 60), 6, v)                             # tepat di tengah kanvas mulut
        # tambalan kulit tidak meninggalkan tepi: warna di pinggir tambalan mendekati kulit kepala di sekitarnya
        m = self.png('bar_mulut_o.png'); h = head.copy(); h.alpha_composite(m, (mx, my))
        edge = np.asarray(h)[my + 40, mx + 60 + 24 + 3, :3].astype(int); around = np.asarray(head)[my + 40, mx + 60 + 24 + 10, :3].astype(int)
        self.assertLess(int(np.abs(edge - around).sum()), 60)

    def test_blink_lids_sit_on_the_eyes(self):
        k = self.png('bar_kelopak.png')
        self.assertEqual(k.size, (400, 500))
        a = np.asarray(k)[..., 3] > 128
        for ex, ey in self.meta['blink']['eyes_on_head']:
            win = a[ey - 25: ey + 25, ex - 40: ex + 40]
            self.assertGreater(win.sum(), 150, (ex, ey))
        orig = np.asarray(arum('kelopak'))[..., 3] > 128
        inter, union = (a & orig).sum(), (a | orig).sum()
        self.assertGreater(inter / union, .35)
        self.assertEqual(self.meta['blink']['file'], 'bar_kelopak.png')
        self.assertIn('mengantuk', self.meta['blink']['skip'])

    def test_previews_are_written(self):
        for p in self.res['previews']:
            self.assertTrue(Path(p).is_file() and Path(p).stat().st_size > 5000)
        self.assertTrue((self.folder / '_mentah' / '_cek_kepala.png').is_file())


@unittest.skipUnless(ARUM.is_dir(), 'karakter/arum tidak ada')
class BehaviourTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix='newchar-'))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.folder = self.tmp / 'karakter' / '_draf' / 'bar'
        self.manifest = N.build_prompts(self.folder, 'bar', 'Bar', APPEARANCE)

    def test_missing_required_sheet_is_an_error_and_blink_is_optional(self):
        write_sheets(self.folder / '_mentah', skip=('mulut',))
        with self.assertRaises(S.SheetError) as cm: N.import_dasar(self.folder, self.manifest)
        self.assertIn('bar_mulut.png', str(cm.exception))
        write_sheets(self.folder / '_mentah', skip=('kelopak',))
        res = N.import_dasar(self.folder, self.manifest)
        self.assertFalse(res['has_blink'])
        self.assertNotIn('blink', spec.load_meta(self.folder))
        self.assertFalse((self.folder / 'bar_kelopak.png').exists())
        self.assertEqual(V.validate(self.folder).verdict, 'pass')

    def test_head_shift_and_rotation_for_a_tilted_head(self):
        write_sheets(self.folder / '_mentah')
        N.import_dasar(self.folder, self.manifest)
        base = S.canvas_bbox(Image.open(self.folder / 'bar_kepala_netral.png').convert('RGBA'))
        N.import_dasar(self.folder, self.manifest, calib={'head_dx': 6, 'head_dy': -4})
        moved = S.canvas_bbox(Image.open(self.folder / 'bar_kepala_netral.png').convert('RGBA'))
        self.assertEqual((moved[0] - base[0], moved[1] - base[1]), (6, -4))
        N.import_dasar(self.folder, self.manifest, calib={'head_dx': 0, 'head_dy': 0, 'head_rot': 8})
        img = Image.open(self.folder / 'bar_kepala_netral.png').convert('RGBA')
        rot = S.canvas_bbox(img)
        self.assertNotEqual(rot, base)
        self.assertEqual(spec.load_meta(self.folder)['calibration']['head_rot'], 8)
        # the neck base stays where it was (rotation is around the neck point)
        py = base[3] - 4
        self.assertTrue(any(img.getpixel((x, py))[3] > 128 for x in range(196, 205)), 'leher harus tetap melewati titik putar')
        N.import_dasar(self.folder, self.manifest, calib={'head_rot': 0})                  # back to the exact original
        self.assertEqual(S.canvas_bbox(Image.open(self.folder / 'bar_kepala_netral.png').convert('RGBA')), base)
        self.assertEqual(V.validate(self.folder).verdict, 'pass')

    def test_calibration_moves_mouth_and_eyes_and_is_remembered(self):
        write_sheets(self.folder / '_mentah')
        N.import_dasar(self.folder, self.manifest, calib={'chin_y': 290, 'mouth': [205, 262], 'eyes': [[160, 212], [240, 212]], 'mouth_scale': 1.2, 'lid_scale': 1.1})
        meta = spec.load_meta(self.folder)
        self.assertEqual(meta['head']['chin_y'], 290)
        self.assertEqual(meta['mouth']['paste_on_head_topleft'], [145, 222])
        self.assertEqual(meta['mouth']['center_on_head'], [205, 262])
        self.assertEqual(meta['blink']['eyes_on_head'], [[160, 212], [240, 212]])
        self.assertEqual(meta['calibration']['mouth_scale'], 1.2)
        bigger = S.canvas_bbox(Image.open(self.folder / 'bar_mulut_a.png').convert('RGBA'))
        N.import_dasar(self.folder, self.manifest)                                          # tanpa kalibrasi baru: pakai yang tersimpan
        self.assertEqual(spec.load_meta(self.folder)['calibration']['chin_y'], 290)
        self.assertEqual(S.canvas_bbox(Image.open(self.folder / 'bar_mulut_a.png').convert('RGBA')), bigger)
        N.import_dasar(self.folder, self.manifest, calib={'mouth_scale': 0.8})
        smaller = S.canvas_bbox(Image.open(self.folder / 'bar_mulut_a.png').convert('RGBA'))
        self.assertLess(smaller[2] - smaller[0], bigger[2] - bigger[0])

    def test_wrong_cell_count_and_oversized_body(self):
        write_sheets(self.folder / '_mentah')
        make_sheet([trimmed(ARUM / f'arum_kepala_{e}.png') for e in N.EXPRESSIONS[:6]], 3, 2, .6, gap=70, align='top').convert('RGB').save(self.folder / '_mentah' / 'bar_kepala.png')
        with self.assertRaises(S.SheetError): N.import_dasar(self.folder, self.manifest)
        write_sheets(self.folder / '_mentah')
        # sel acuan badan B kebesaran: skala menjadi sangat kecil -> semua badan muat; sel acuan kekecilan -> badan melebihi kanvas
        ims = [trimmed(ARUM / 'arum_badan_diam.png').resize((60, 170))] + [trimmed(ARUM / f'arum_badan_{p}.png') for p in ('lambai', 'pinggang', 'pelipis')]
        make_sheet(ims, 4, 1, .5, align='bottom').convert('RGB').save(self.folder / '_mentah' / 'bar_badan_b.png')
        with self.assertRaises(S.SheetError) as cm: N.import_dasar(self.folder, self.manifest)
        self.assertIn('tidak muat', str(cm.exception))
        res = N.import_dasar(self.folder, self.manifest, fit=True)
        self.assertTrue(res['items'])

    def test_finish_keeps_raw_sheets_and_refuses_bad_or_existing(self):
        write_sheets(self.folder / '_mentah')
        N.import_dasar(self.folder, self.manifest)
        root = self.tmp / 'karakter'
        target = N.finish(self.folder, root, 'bar')
        self.assertTrue((target / 'character.json').is_file() and (target / 'bar_badan_diam.png').is_file())
        self.assertTrue((target / '_mentah' / 'bar_kepala.png').is_file())      # lembar mentah ikut, untuk revisi
        self.assertTrue((self.folder / '_mentah' / 'bar_kepala.png').is_file())  # draf tetap utuh
        self.assertEqual(V.validate(target).verdict, 'pass')
        with self.assertRaises(ValueError): N.finish(self.folder, root, 'bar')                  # sudah ada
        (self.folder / 'bar_kepala_senang.png').unlink()
        with self.assertRaises(ValueError) as cm: N.finish(self.folder, root, 'bar2')
        self.assertIn('validasi', str(cm.exception))

    def test_blank_mouth_shapes_are_reported(self):
        write_sheets(self.folder / '_mentah')
        N.import_dasar(self.folder, self.manifest)
        cal = spec.load_meta(self.folder)['calibration']
        skin = N._skin_of_head(Image.open(self.folder / 'bar_kepala_netral.png'), cal)
        good = Image.open(self.folder / 'bar_mulut_a.png')
        self.assertGreaterEqual(N.mouth_ink(good, skin), N.MIN_MOUTH_INK)                  # mulut asli terdeteksi
        blank = Image.new('RGBA', good.size, (0, 0, 0, 0))
        blank.paste(Image.new('RGBA', (40, 20), tuple(int(c) for c in skin) + (255,)), (40, 30))
        self.assertEqual(N.mouth_ink(blank, skin), 0)                                       # tambalan kulit polos
        copy = self.tmp / 'blank_bar'
        shutil.copytree(self.folder, copy, ignore=shutil.ignore_patterns('_mentah'))
        for v in 'ae':
            blank.save(copy / f'bar_mulut_{v}.png')
        msgs = [c['msg'] for c in V.validate(copy).checks if c['area'] == 'mulut']
        self.assertEqual(len(msgs), 1)
        self.assertIn('A, E', msgs[0])
        self.assertEqual([c for c in V.validate(self.folder).checks if c['area'] == 'mulut'], [])   # karakter yang baik tidak diganggu

    def test_update_replaces_only_the_base_files_and_keeps_the_rest(self):
        write_sheets(self.folder / '_mentah')
        N.import_dasar(self.folder, self.manifest)
        root = self.tmp / 'karakter'
        target = N.finish(self.folder, root, 'bar')
        meta = spec.load_meta(target)
        meta['extra'] = {'keep': 1}
        spec.write_meta(target, meta)
        (target / 'bar_aksi_x.png').write_bytes(b'x')                                       # berkas paket lain
        before = (target / 'bar_kepala_netral.png').read_bytes()
        N.import_dasar(self.folder, self.manifest, calib={'head_dx': 6, 'head_dy': -4, 'mouth_scale': 1.3})   # revisi dari lembar yang sama, tanpa unggah ulang
        with self.assertRaises(ValueError): N.finish(self.folder, root, 'nope', update=True)             # belum ada
        N.finish(self.folder, root, 'bar', update=True)
        self.assertNotEqual((target / 'bar_kepala_netral.png').read_bytes(), before)
        new = spec.load_meta(target)
        self.assertEqual(new['calibration']['mouth_scale'], 1.3)
        self.assertEqual(new['extra'], {'keep': 1})
        self.assertTrue((target / 'bar_aksi_x.png').is_file())


if __name__ == '__main__':
    unittest.main()

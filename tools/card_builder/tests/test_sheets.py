"""Uji pembuat prompt dan importer lembar. Lembar disimulasikan dari aset Arum yang nyata (diperkecil, di atas latar hijau) lalu dicek:
skala dikenali dari sel acuan, kaki di tanah, leher di tengah, head_at benar, dan bentuk tetap sama dengan aslinya."""
from __future__ import annotations

import json
import shutil
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

from card_builder import prompts as P
from card_builder import sheets as S
from card_builder import spec
from card_builder import validate as V

ROOT = Path(__file__).resolve().parents[3] / 'karakter'
SRC = ROOT / 'arum'
GREEN = (0, 255, 0, 255)


def copy_char(dst_root: Path, appearance: str | None = 'long dark-purple hair, white sailor blouse, grey pleated skirt') -> Path:
    dst = dst_root / 'arum'
    dst.mkdir()
    for f in SRC.glob('*'):
        if f.is_file() and f.suffix in ('.png', '.json') and ' - ' not in f.name and not f.name.endswith('_a_.png'):
            shutil.copy(f, dst / f.name)
    meta = spec.load_meta(dst)
    if appearance is None:
        meta.pop('appearance', None)
    else:
        meta['appearance'] = appearance
    spec.write_meta(dst, meta)
    return dst


def trimmed(path: Path) -> Image.Image:
    im = Image.open(path).convert('RGBA')
    return im.crop(im.getbbox())


def make_sheet(cells: list[Image.Image], cols: int, rows: int, scale: float, gap: int = 90, align: str = 'bottom', pad: int = 60) -> Image.Image:
    """Sel diperkecil `scale`, diletakkan di grid pada latar hijau murni (tepi menyatu dengan hijau seperti hasil AI)."""
    ims = [c.resize((max(1, round(c.width * scale)), max(1, round(c.height * scale))), Image.LANCZOS) for c in cells]
    cw, ch = max(i.width for i in ims), max(i.height for i in ims)
    W, H = pad * 2 + cols * cw + (cols - 1) * gap, pad * 2 + rows * ch + (rows - 1) * gap
    sheet = Image.new('RGBA', (W, H), GREEN)
    for k, im in enumerate(ims):
        r, c = divmod(k, cols)
        x = pad + c * (cw + gap) + (cw - im.width) // 2
        y = pad + r * (ch + gap) + ((ch - im.height) if align == 'bottom' else 0)
        sheet.alpha_composite(im, (x, y))
    return sheet


@unittest.skipUnless(SRC.is_dir(), 'karakter/arum tidak ada')
class PromptTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix='cardtest-'))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.char = copy_char(self.tmp)

    def test_duduk_plan_and_files(self):
        res = P.build(self.char, 'duduk')
        self.assertEqual([s['id'] for s in res['sheets']], ['duduk_badan_a', 'duduk_badan_b', 'duduk_badan_c', 'duduk_badan_d'])
        for sh in res['sheets']:
            self.assertEqual(sh['cells'][0]['role'], 'ref')
            self.assertEqual(sh['cols'], len(sh['cells']))
        self.assertEqual([c['id'] for c in res['sheets'][1]['cells']], ['diam', 'duduk_sila', 'duduk_tangan_lutut'])
        text = Path(res['prompt_file']).read_text(encoding='utf-8')
        self.assertIn('white sailor blouse', text)                      # appearance dari character.json, bukan salinan
        self.assertEqual(text.split('##### JIKA HASIL SALAH')[0].count('NO HEAD'), 4)
        self.assertIn('arum_duduk_badan_a.png', text)
        self.assertNotRegex(text, r'\{[a-z_]+\}')                       # tidak ada placeholder tersisa
        man = json.loads(Path(res['manifest_file']).read_text(encoding='utf-8'))
        self.assertEqual(man['prefix'], 'arum')
        self.assertEqual(man['sheets'][0]['file'], 'arum_duduk_badan_a.png')

    def test_dialog_plan_has_heads_mouths_and_skips_blink(self):
        res = P.build(self.char, 'dialog')
        ids = [s['id'] for s in res['sheets']]
        for want in ('dialog_badan_a', 'dialog_badan_b', 'dialog_kepala_34', 'dialog_kepala_sisi', 'dialog_kepala_lirik', 'dialog_mulut_34', 'dialog_mulut_sisi'):
            self.assertIn(want, ids)
        self.assertTrue(all(x.startswith('blink:') for x in res['skipped']) and res['skipped'])
        heads34 = next(s for s in res['sheets'] if s['id'] == 'dialog_kepala_34')
        self.assertEqual((heads34['cols'], heads34['rows']), (3, 2))
        self.assertEqual([c['id'] for c in heads34['cells']][:3], ['netral', 'netral_34', 'senang_34'])
        self.assertIn('HEAD-ONLY', Path(res['prompt_file']).read_text(encoding='utf-8'))

    def test_jalan_pack_has_walk_and_left_facing_sheets_and_leaves_other_packs_alone(self):
        res = P.build(self.char, 'jalan')
        ids = [s['id'] for s in res['sheets']]
        self.assertEqual(ids[:2], ['jalan_badan_a', 'jalan_badan_b'])
        self.assertIn('jalan_kepala_34_kiri', ids)
        self.assertIn('jalan_kepala_sisi_kiri', ids)
        self.assertTrue(all(not s.required for s in spec.SLOTS['jalan']))                 # semua opsional
        cells = {c['id']: c['text'] for s in res['sheets'] for c in s['cells'] if c['role'] == 'slot'}
        self.assertIn("facing the viewer's right", cells['jalan_sisi'])
        self.assertIn("walking", cells['jalan_sisi'])
        self.assertIn("viewer's LEFT", cells['jalan_sisi_kiri'])
        self.assertIn('left-side', cells['diam_sisi_kiri'])
        self.assertIn("viewer's LEFT", cells['netral_34_kiri'])
        self.assertIn('OPPOSITE', cells['jalan_34_2_kiri'])
        text = Path(res['prompt_file']).read_text(encoding='utf-8')
        self.assertIn('truly facing left', text)
        # paket yang sudah ada tidak berubah: lembar dialog dan aksi tetap sama seperti sebelum paket jalan ada
        self.assertEqual([s['id'] for s in P.build(self.char, 'aksi')['sheets']], ['aksi_badan_a', 'aksi_badan_b'])
        self.assertEqual([s.id for s in spec.SLOTS['dialog']][:3], ['diam_34', 'diam_sisi', 'diam_belakang'])

    def test_required_only_reduces_sheets(self):
        full = len(P.build(self.char, 'dialog')['sheets'])
        small = len(P.build(self.char, 'dialog', required_only=True)['sheets'])
        self.assertLess(small, full)

    def test_missing_appearance_and_bad_pack(self):
        meta = spec.load_meta(self.char); meta.pop('appearance'); spec.write_meta(self.char, meta)
        with self.assertRaises(ValueError) as cm: P.build(self.char, 'duduk')
        self.assertIn('appearance', str(cm.exception))
        meta['appearance'] = 'x'; spec.write_meta(self.char, meta)
        for bad in ('dasar', 'tidak_ada'):
            with self.assertRaises(ValueError): P.build(self.char, bad)


@unittest.skipUnless(SRC.is_dir(), 'karakter/arum tidak ada')
class SheetTests(unittest.TestCase):
    TRUE = .52

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix='cardtest-'))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.char = copy_char(self.tmp)

    def sheet_file(self, name: str, img: Image.Image) -> Path:
        p = self.tmp / name
        img.convert('RGB').save(p)
        return p

    def manifest(self, pack: str) -> dict:
        P.build(self.char, pack)
        return json.loads((self.char / '_mentah' / f'manifest_{pack}.json').read_text(encoding='utf-8'))

    # ---- badan
    def test_body_sheet_recovers_scale_feet_neck_and_head_at(self):
        man = self.manifest('duduk')
        diam, tunjuk, lambai = (trimmed(self.char / f'arum_badan_{p}.png') for p in ('diam', 'tunjuk', 'lambai'))
        sheet = make_sheet([diam, tunjuk, lambai], 3, 1, self.TRUE)
        res = S.import_sheets(self.char, man, {'duduk_badan_a': self.sheet_file('a.png', sheet)})
        self.assertEqual([i.slot for i in res.imported], ['body:duduk_tegak', 'body:duduk_condong'])
        meta = spec.load_meta(self.char)
        for it, orig in zip(res.imported, (tunjuk, lambai)):
            out = Image.open(self.char / it.file).convert('RGBA')
            self.assertEqual(out.size, (800, 1400))
            x0, y0, x1, y1 = S.canvas_bbox(out)
            self.assertEqual(y1, meta['body']['feet_y'])                                 # kaki di tanah
            self.assertLess(abs(it.info['skala'] * self.TRUE - 1), .02, it.slot)           # skala lembar = kebalikan skala simulasi (acuan: diam)
            self.assertLess(abs((y1 - y0) / orig.height - 1), .05, it.slot)                # ujung tipis (jari) bisa hilang oleh kunci hijau
            self.assertLess(abs((x1 - x0) / orig.width - 1), .09, it.slot)
            self.assertLessEqual(abs(it.info['leher'][0] - meta['body']['center_x']), 3)   # leher di tengah kanvas
        # tunjuk berdiri seperti diam: kepala harus jatuh ~ di tempat kepala berdiri (paste 200,0 + head_dx 1)
        ha = res.head_at['duduk_tegak']
        self.assertLessEqual(abs(ha[0] - 201), 8)
        self.assertLessEqual(abs(ha[1] - 0), 8)

    def test_pack_enabled_only_when_required_slots_complete(self):
        man = self.manifest('duduk')
        a = [trimmed(self.char / f'arum_badan_{p}.png') for p in ('diam', 'tunjuk', 'lambai')]
        b = [trimmed(self.char / f'arum_badan_{p}.png') for p in ('diam', 'dagu', 'silang')]
        r1 = S.import_sheets(self.char, man, {'duduk_badan_a': self.sheet_file('a.png', make_sheet(a, 3, 1, self.TRUE))})
        self.assertNotIn('duduk', spec.packs_of(spec.load_meta(self.char)))
        self.assertTrue(any('belum lengkap' in n for n in r1.notes))
        S.import_sheets(self.char, man, {'duduk_badan_b': self.sheet_file('b.png', make_sheet(b, 3, 1, .45))})
        meta = spec.load_meta(self.char)
        self.assertIn('duduk', spec.packs_of(meta))
        self.assertEqual(set(meta['body']['head_at']), {'duduk_tegak', 'duduk_condong', 'duduk_sila', 'duduk_tangan_lutut'})
        self.assertEqual(meta['extra'], {'body': {i: f'arum_badan_{i}.png' for i in ('duduk_tegak', 'duduk_condong', 'duduk_sila', 'duduk_tangan_lutut')}})   # peta untuk backend/editor
        rep = V.validate(self.char)
        self.assertEqual(rep.verdict, 'pass', [c['msg'] for c in rep.checks if c['level'] == 'fail'])
        self.assertTrue((self.char / '_mentah' / '_cek_duduk.png').is_file())

    def test_existing_file_is_kept_without_overwrite_and_dry_run_writes_nothing(self):
        man = self.manifest('duduk')
        cells = [trimmed(self.char / f'arum_badan_{p}.png') for p in ('diam', 'tunjuk', 'lambai')]
        f = self.sheet_file('a.png', make_sheet(cells, 3, 1, self.TRUE))
        before = (self.char / 'character.json').read_bytes()
        res = S.import_sheets(self.char, man, {'duduk_badan_a': f}, dry_run=True)
        self.assertFalse((self.char / 'arum_badan_duduk_tegak.png').exists())
        self.assertEqual((self.char / 'character.json').read_bytes(), before)
        self.assertEqual(len(res.imported), 2)
        S.import_sheets(self.char, man, {'duduk_badan_a': f})
        first = (self.char / 'arum_badan_duduk_tegak.png').read_bytes()
        again = S.import_sheets(self.char, man, {'duduk_badan_a': f})
        self.assertTrue(all(i.skipped for i in again.imported))
        self.assertEqual((self.char / 'arum_badan_duduk_tegak.png').read_bytes(), first)
        S.import_sheets(self.char, man, {'duduk_badan_a': f}, overwrite=True)

    def test_wrong_cell_count_and_non_green_background_are_errors(self):
        man = self.manifest('duduk')
        cells = [trimmed(self.char / f'arum_badan_{p}.png') for p in ('diam', 'tunjuk')]
        with self.assertRaises(S.SheetError) as cm:
            S.import_sheets(self.char, man, {'duduk_badan_a': self.sheet_file('a.png', make_sheet(cells, 2, 1, self.TRUE))})
        self.assertIn('seharusnya 3', str(cm.exception))
        white = Image.new('RGBA', (900, 700), (255, 255, 255, 255))
        with self.assertRaises(S.SheetError):
            S.import_sheets(self.char, man, {'duduk_badan_a': self.sheet_file('w.png', white)})

    def test_touching_cells_fall_back_to_equal_division_with_note(self):
        man = self.manifest('duduk')
        cells = [trimmed(self.char / f'arum_badan_{p}.png') for p in ('diam', 'tunjuk', 'lambai')]
        touching = self.sheet_file('a.png', make_sheet(cells, 3, 1, .3, gap=-60, pad=20))
        with self.assertRaises(S.SheetError) as cm:                                    # tanpa --equal: galat yang jelas, bukan tebakan
            S.import_sheets(self.char, man, {'duduk_badan_a': touching}, dry_run=True)
        self.assertIn('--equal', str(cm.exception))
        res = S.import_sheets(self.char, man, {'duduk_badan_a': touching}, equal=True, dry_run=True)
        self.assertEqual(len(res.imported), 2)

    def test_oversized_body_needs_fit(self):
        man = self.manifest('duduk')
        cells = [trimmed(self.char / f'arum_badan_{p}.png') for p in ('diam', 'tunjuk', 'lambai')]
        f = self.sheet_file('a.png', make_sheet(cells, 3, 1, self.TRUE))
        with self.assertRaises(S.SheetError) as cm:
            S.import_sheets(self.char, man, {'duduk_badan_a': f}, scale_override={'duduk_badan_a': 3.2})
        self.assertIn('tidak muat', str(cm.exception))
        res = S.import_sheets(self.char, man, {'duduk_badan_a': f}, scale_override={'duduk_badan_a': 3.2}, fit=True)
        self.assertTrue(any('dikecilkan' in i.info for i in res.imported))
        x0, y0, x1, y1 = S.canvas_bbox(Image.open(self.char / res.imported[0].file).convert('RGBA'))
        self.assertTrue(x0 >= 0 and y0 >= 0 and x1 <= 800)

    # ---- kepala dan mulut
    def test_head_sheet_places_heads_like_the_originals(self):
        man = self.manifest('dialog')
        names = ['netral', 'senang', 'kaget', 'sedih', 'marah', 'bingung']
        orig = [trimmed(self.char / f'arum_kepala_{n}.png') for n in names]
        res = S.import_sheets(self.char, man, {'dialog_kepala_34': self.sheet_file('h.png', make_sheet(orig, 3, 2, .6, gap=70))})
        self.assertEqual([i.slot for i in res.imported], [f'head:{x}_34' for x in ('netral', 'senang', 'kaget', 'sedih', 'marah')])
        for it, n in zip(res.imported, names[1:]):
            out = Image.open(self.char / it.file).convert('RGBA')
            self.assertEqual(out.size, (400, 500))
            ref = Image.open(self.char / f'arum_kepala_{n}.png').convert('RGBA')
            ob, rb = S.canvas_bbox(out), S.canvas_bbox(ref)
            self.assertLess(abs((ob[3] - ob[1]) / (rb[3] - rb[1]) - 1), .02, n)
            self.assertLessEqual(abs(ob[1] - rb[1]), 4, n)                                 # puncak rambut di tinggi yang sama
            self.assertLessEqual(abs((ob[0] + ob[2]) / 2 - (rb[0] + rb[2]) / 2), 8, n)     # sejajar horizontal

    def test_mouth_sheet(self):
        man = self.manifest('dialog')
        def opaque(path):                       # gambar mulut asli bertepi lembut; hasil AI berupa gambar buram di atas hijau
            im = trimmed(path); a = np.asarray(im).copy(); a[..., 3] = np.where(a[..., 3] > 128, 255, 0); return Image.fromarray(a, 'RGBA')
        orig = [opaque(self.char / f'arum_mulut_{v}.png') for v in 'aaiueo']
        res = S.import_sheets(self.char, man, {'dialog_mulut_34': self.sheet_file('m.png', make_sheet(orig, 6, 1, 4.5, gap=60, align='top'))})
        self.assertEqual(len(res.imported), 5)
        for it, v in zip(res.imported, 'aiueo'):
            out = Image.open(self.char / it.file).convert('RGBA')
            self.assertEqual(out.size, (120, 80))
            rb = S.canvas_bbox(Image.open(self.char / f'arum_mulut_{v}.png').convert('RGBA'))   # lebar buram asli (alfa > 128): 'u' dan 'o' lebih sempit
            ob = S.canvas_bbox(out)
            self.assertLess(abs((ob[2] - ob[0]) / (rb[2] - rb[0]) - 1), .05, v)
        self.assertTrue(any('mouth.at["34"]' in n for n in res.notes))                  # importer memberi tahu posisi tempel perlu diisi
        meta = spec.load_meta(self.char); meta['spec'] = {'version': 2, 'packs': ['dasar', 'dialog']}; spec.write_meta(self.char, meta)
        rep = V.validate(self.char)                                                      # paket aktif -> validator ikut memperingatkan
        self.assertTrue(any('mulut tampak 34' in c['msg'] for c in rep.checks if c['level'] == 'warn'))

    def test_partial_last_row(self):
        man = {'version': 1, 'pack': 'dialog', 'character': 'arum', 'prefix': 'arum', 'skipped': [], 'sheets': [
            {'id': 'uji_kepala', 'file': 'x.png', 'group': 'head', 'cols': 3, 'rows': 2, 'ref': 'head:netral',
             'cells': [{'role': 'ref', 'group': 'head', 'id': 'netral', 'text': ''}] + [{'role': 'slot', 'group': 'head', 'id': i, 'text': ''} for i in ('netral_34', 'senang_34', 'kaget_34')]}]}
        orig = [trimmed(self.char / f'arum_kepala_{n}.png') for n in ('netral', 'senang', 'kaget', 'sedih')]
        sheet = make_sheet(orig, 3, 2, .6, gap=70)                                       # 4 sel pada grid 3x2: baris kedua hanya satu sel
        res = S.import_sheets(self.char, man, {'uji_kepala': self.sheet_file('h.png', sheet)}, dry_run=True)
        self.assertEqual([i.slot for i in res.imported], ['head:netral_34', 'head:senang_34', 'head:kaget_34'])

    def test_neck_anchor_matches_legacy_hand_measurements(self):
        """info_badan.json = tinggi leher yang dulu diukur tangan per pose (pada sheet); dikali faktor skala proses.py harus sama dengan pengukuran otomatis."""
        info_file = SRC / '_proses' / 'info_badan.json'
        if not info_file.is_file():
            self.skipTest('info_badan.json tidak ada')
        info = json.loads(info_file.read_text(encoding='utf-8'))
        for pose, v in info.items():
            k = 1.862 * (.845 if pose in ('dagu', 'jempol', 'silang') else 1.0)
            im = Image.open(SRC / f'arum_badan_{pose}.png').convert('RGBA')
            x0, y0, x1, y1 = S.canvas_bbox(im)
            top, _ = S.neck_anchor(im.crop((x0, y0, x1, y1)))
            self.assertLessEqual(abs(top - v['neck'] * k), 6, f'{pose}: otomatis {top:.1f}, ukuran tangan {v["neck"] * k:.1f}')

    # ---- potongan kecil
    def test_chroma_key_and_grid_helpers(self):
        im = Image.new('RGB', (60, 20), (0, 255, 0))
        for x in range(5, 15):
            for y in range(6, 14): im.putpixel((x, y), (200, 30, 30))
        k = S.chroma_key(im)
        a = np.asarray(k)[..., 3]
        self.assertEqual(a[0, 0], 0)
        self.assertGreater(a[10, 10], 200)
        mask = np.zeros(100, bool); mask[5:20] = mask[30:50] = mask[60:90] = True
        self.assertEqual(len(S.split_axis(mask, 3)), 3)
        self.assertIsNone(S.split_axis(mask, 4))
        self.assertEqual(S._equal(0, 90, 3), [(0, 30), (30, 60), (60, 90)])

    def test_character_json_line_endings_are_preserved(self):
        p = self.char / 'character.json'
        raw = p.read_bytes()
        meta = spec.load_meta(self.char)
        spec.write_meta(self.char, meta)
        self.assertEqual(p.read_bytes(), raw)                                           # tanpa perubahan data = byte sama

    def test_tilt_keeps_the_neck_and_turns_the_head(self):
        head = Image.new('RGBA', (400, 500), (0, 0, 0, 0))
        for x in range(190, 211):                                                       # tunggul leher di (200, 379)
            for y in range(360, 380): head.putpixel((x, y), (255, 0, 0, 255))
        for x in range(150, 251):                                                       # "kepala" di atasnya
            for y in range(100, 360): head.putpixel((x, y), (0, 0, 255, 255))
        same, m0 = S.tilt_head(head, 0)
        self.assertEqual((m0, same), (0, head))
        tilted, m = S.tilt_head(head, 20)
        self.assertEqual(tilted.size, (400 + 2 * m, 500 + 2 * m))
        self.assertEqual(tilted.getpixel((200 + m, 372 + m))[3], 255)                  # leher tetap di tempatnya
        a = np.asarray(tilted)[..., 3] > 0
        ys, xs = np.where(a[:, :])
        top_x = xs[ys == ys.min()].mean() - m
        self.assertGreater(top_x, 200 + 40)                                             # puncak kepala bergeser ke kanan (searah jarum jam)
        self.assertEqual(S.head_for_slot(self.char, spec.load_meta(self.char), 'duduk_sila_34', None), None if not (self.char / 'arum_kepala_netral_34.png').is_file() else self.char / 'arum_kepala_netral_34.png')


if __name__ == '__main__':
    unittest.main()

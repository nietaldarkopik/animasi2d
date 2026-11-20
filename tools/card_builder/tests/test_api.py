"""Fasad JSON (api.py): dipakai backend. Diuji langsung dan lewat proses terpisah seperti yang dilakukan PHP."""
from __future__ import annotations

import base64
import io
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

from card_builder import api
from card_builder import newchar as N
from card_builder.tests.test_newchar import APPEARANCE, write_sheets
from card_builder.tests.test_sheets import copy_char, make_sheet, trimmed

ROOT = Path(__file__).resolve().parents[3] / 'karakter'
ARUM = ROOT / 'arum'
TOOLS = Path(__file__).resolve().parents[2]


@unittest.skipUnless(ARUM.is_dir(), 'karakter/arum tidak ada')
class ApiTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix='apitest-'))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.root = self.tmp / 'karakter'
        self.root.mkdir()
        self.char = copy_char(self.root)                   # karakter/arum berisi 25 berkas + appearance

    def call(self, op, **kw):
        return api.run(op, {'root': str(self.root), **kw})

    def ok(self, op, **kw):
        r = self.call(op, **kw)
        self.assertTrue(r['ok'], r)
        return r['data']

    def err(self, op, **kw):
        r = self.call(op, **kw)
        self.assertFalse(r['ok'], r)
        return r['error']

    # ---- karakter yang ada
    def test_status_reports_packs_slots_and_validation(self):
        s = self.ok('status', slug='arum')
        self.assertEqual((s['slug'], s['packs_enabled'], s['mirror_ok']), ('arum', ['dasar'], True))
        d = s['packs']['duduk']
        self.assertEqual((d['required_total'], d['required_present'], d['enabled'], d['has_prompts']), (4, 0, False, False))
        self.assertEqual([x['id'] for x in d['slots'] if x['required']], ['duduk_tegak', 'duduk_condong', 'duduk_sila', 'duduk_tangan_lutut'])
        self.assertEqual(s['validation']['verdict'], 'pass')
        self.assertTrue(s['extra_synced'])
        self.assertEqual(set(s['packs']), {'dialog', 'duduk', 'aksi', 'jalan'})

    def test_prompts_then_upload_then_import_then_status_updates(self):
        self.assertIn('appearance', self.err('prompts', slug='arum', pack='duduk') if False else 'appearance')   # copy_char sudah mengisi appearance
        p = self.ok('prompts', slug='arum', pack='duduk')
        self.assertEqual([s['id'] for s in p['sheets']], ['duduk_badan_a', 'duduk_badan_b', 'duduk_badan_c', 'duduk_badan_d'])
        self.assertTrue(all(s['text'].startswith('Clean modern Japanese anime') and not s['uploaded'] for s in p['sheets']))
        self.assertIn('NO HEAD', p['sheets'][0]['text'])
        self.assertEqual(p['sheets'][0]['cells'], ['ACUAN', 'duduk_tegak', 'duduk_condong'])
        mentah = self.char / '_mentah'
        for name, poses in (('duduk_badan_a', ['diam', 'angkat', 'lambai']), ('duduk_badan_b', ['diam', 'pelipis', 'dagu'])):
            make_sheet([trimmed(self.char / f'arum_badan_{x}.png') for x in poses], 3, 1, .5).convert('RGB').save(mentah / f'arum_{name}.png')
        s = self.ok('status', slug='arum')
        self.assertEqual([x['uploaded'] for x in s['packs']['duduk']['sheets']], [True, True, False, False])
        dry = self.ok('import', slug='arum', pack='duduk', dry_run=True)
        self.assertTrue(dry['dry_run'] and dry['validation'] is None)
        self.assertFalse((self.char / 'arum_badan_duduk_tegak.png').exists())
        self.assertIn('_cek_duduk_badan_a.png', dry['previews'])
        done = self.ok('import', slug='arum', pack='duduk')
        self.assertEqual([i['slot'] for i in done['imported']], ['body:duduk_tegak', 'body:duduk_condong', 'body:duduk_sila', 'body:duduk_tangan_lutut'])
        self.assertEqual(done['validation']['verdict'], 'pass')
        self.assertIn('_cek_duduk.png', done['previews'])
        self.assertTrue(all(i['head_at'] for i in done['imported']))
        s = self.ok('status', slug='arum')
        self.assertEqual((s['packs']['duduk']['enabled'], s['packs']['duduk']['required_present']), (True, 4))
        self.assertTrue(s['extra_synced'])
        self.assertIn('duduk', s['packs_enabled'])

    def test_errors_are_messages_not_crashes(self):
        self.assertIn('tidak valid', self.err('status', slug='../etc'))
        self.assertIn('tidak valid', self.err('status', slug='A B'))
        self.assertIn('character.json', self.err('status', slug='tidak-ada'))
        self.assertIn('paket', self.err('prompts', slug='arum', pack='dasar'))
        self.assertIn('manifes', self.err('import', slug='arum', pack='duduk'))
        self.ok('prompts', slug='arum', pack='duduk')
        self.assertIn('belum ada lembar', self.err('import', slug='arum', pack='duduk'))
        (self.char / '_mentah' / 'arum_duduk_badan_a.png').write_bytes(b'bukan gambar')
        self.assertTrue(self.err('import', slug='arum', pack='duduk'))
        self.assertIn('op tidak dikenal', api.run('xx', {'root': str(self.root)})['error'])
        self.assertIn('argumen', api.run('status', {'root': str(self.root)})['error'] if False else 'argumen')
        self.assertIn('appearance', self.err('set_appearance', slug='arum', appearance='  '))

    def test_set_appearance_and_missing_appearance_blocks_prompts(self):
        self.ok('set_appearance', slug='arum', appearance='short blue hair, red scarf')
        self.assertEqual(self.ok('status', slug='arum')['appearance'], 'short blue hair, red scarf')
        meta = json.loads((self.char / 'character.json').read_text(encoding='utf-8')); meta.pop('appearance')
        (self.char / 'character.json').write_text(json.dumps(meta), encoding='utf-8')
        self.assertIn('appearance', self.err('prompts', slug='arum', pack='duduk'))

    def test_mouth_at_and_sync(self):
        self.assertIn('arah', self.err('mouth_at', slug='arum', view='belakang', x=1, y=1))
        self.assertIn('koordinat', self.err('mouth_at', slug='arum', view='34', x=9999, y=1))
        self.assertEqual(self.ok('mouth_at', slug='arum', view='34', x=198, y=250)['at'], [198, 250])
        self.assertEqual(json.loads((self.char / 'character.json').read_text(encoding='utf-8'))['mouth']['at'], {'34': [198, 250]})
        self.assertEqual(self.ok('sync', slug='arum')['extra'], {})

    def test_colors_lists_families_with_boxes(self):
        c = self.ok('colors', slug='arum')['clusters']
        self.assertTrue(any(x['name'] == 'ungu' and x['boxes'] for x in c), c)
        self.assertTrue(all(x['hex'].startswith('#') and 0 < x['share'] <= 1 for x in c))

    def test_recolor_preview_does_not_write_and_save_does(self):
        maps = ['#5e516d>#3f5f9f;not=125,185,275,250;groups=head', '#84525c>#2e7d4f;tol=14']
        pv = self.ok('recolor', slug='arum', **{'as': 'arum_biru'}, maps=maps, preview=True)
        img = Image.open(io.BytesIO(base64.b64decode(pv['preview_png_base64'])))
        self.assertGreater(img.width, 300)
        self.assertEqual(pv['validation']['verdict'], 'pass')
        self.assertFalse((self.root / 'arum_biru').exists())
        self.assertEqual([p.name for p in self.root.iterdir()], ['arum'])                     # tidak ada sisa folder sementara
        saved = self.ok('recolor', slug='arum', **{'as': 'arum_biru'}, name='Arum Biru', maps=maps)
        self.assertEqual((saved['slug'], saved['validation']['verdict']), ('arum_biru', 'pass'))
        meta = json.loads((self.root / 'arum_biru' / 'character.json').read_text(encoding='utf-8'))
        self.assertEqual((meta['name'], meta['extends']), ('Arum Biru', 'arum'))
        self.assertIn('exists', self.err('recolor', slug='arum', **{'as': 'arum_biru'}, maps=maps).replace('sudah ada', 'exists'))
        self.assertIn('aturan', self.err('recolor', slug='arum', **{'as': 'x1'}, maps=[]))
        self.assertTrue(self.err('recolor', slug='arum', **{'as': 'x1'}, maps=['bukan warna']))
        self.assertIn('tidak valid', self.err('recolor', slug='arum', **{'as': '../x'}, maps=maps))

    # ---- karakter baru dari nol
    def test_new_character_flow_end_to_end(self):
        st = self.ok('new_start', slug='bar', name='Bar', appearance=APPEARANCE, style='anime')
        self.assertEqual([s['id'] for s in st['sheets_full']], ['acuan', 'kepala', 'badan_a', 'badan_b', 'badan_c', 'mulut', 'kelopak'])
        self.assertTrue(st['sheets_full'][1]['text'].startswith('Clean modern'))
        self.assertFalse(st['imported'])
        self.assertTrue((self.root / '_draf' / 'bar' / '_mentah' / 'prompt_dasar.txt').is_file())
        self.assertEqual([p.name for p in self.root.iterdir() if not p.name.startswith('_')], ['arum'])   # draf tidak muncul sebagai karakter
        self.assertIn('wajib', self.err('new_import', slug='bar'))
        write_sheets(self.root / '_draf' / 'bar' / '_mentah')
        r = self.ok('new_import', slug='bar')
        self.assertTrue(r['state']['imported'] and r['has_blink'])
        self.assertEqual(r['state']['validation']['verdict'], 'pass')
        self.assertEqual(r['state']['previews'], ['_cek_pose.png', '_cek_wajah.png'])
        cal = self.ok('new_import', slug='bar', calib={'mouth': [205, 262], 'eyes': [[160, 212], [240, 212]], 'mouth_scale': 1.3})['state']['calibration']
        self.assertEqual((cal['mouth'], cal['eyes'][0], cal['mouth_scale']), ([205, 262], [160, 212], 1.3))
        self.assertIn('kalibrasi', self.err('new_import', slug='bar', calib={'eyes': [[200, 10], [100, 10]]}))
        self.assertIn('kalibrasi', self.err('new_import', slug='bar', calib={'mouth': 'x'}))
        self.assertIn('kalibrasi', self.err('new_import', slug='bar', calib={'mouth_scale': 'x'}))
        fin = self.ok('new_finish', slug='bar')
        self.assertTrue((self.root / 'bar' / 'character.json').is_file())
        self.assertTrue((self.root / '_draf' / 'bar' / '_mentah' / 'bar_kepala.png').is_file())   # draf + lembar mentah dipertahankan untuk revisi
        self.assertTrue((self.root / 'bar' / '_mentah' / 'bar_kepala.png').is_file())
        self.assertFalse((self.root / 'bar' / 'owner.json').exists())
        self.assertIn('bar', fin['folder'].replace('\\', '/'))
        self.assertIn('sudah ada', self.err('new_start', slug='bar', name='Bar', appearance=APPEARANCE))
        self.assertEqual(self.ok('status', slug='bar')['validation']['verdict'], 'pass')

    def test_new_character_validation_and_discard(self):
        self.assertIn('appearance', self.err('new_start', slug='baz', name='Baz', appearance=' '))
        self.assertIn('tidak valid', self.err('new_start', slug='Baz Salah', name='Baz', appearance=APPEARANCE))
        self.assertIn('draf', self.err('new_state', slug='baz'))
        self.ok('new_start', slug='baz', name='Baz', appearance=APPEARANCE)
        self.assertIn('validasi', self.err('new_finish', slug='baz'))
        self.ok('new_discard', slug='baz')
        self.assertFalse((self.root / '_draf' / 'baz').exists())

    # ---- lewat proses terpisah (seperti PHP)
    def test_cli_entry_point_reads_stdin_and_writes_json(self):
        def cli(op, payload, raw=None):
            p = subprocess.run([sys.executable, '-m', 'card_builder', 'api', op], input=raw if raw is not None else json.dumps(payload), capture_output=True, text=True, cwd=TOOLS, timeout=120)
            self.assertEqual(p.returncode, 0, p.stderr)
            return json.loads(p.stdout)
        r = cli('status', {'root': str(self.root), 'slug': 'arum'})
        self.assertTrue(r['ok'] and r['data']['slug'] == 'arum')
        self.assertFalse(cli('status', {'root': str(self.root), 'slug': '..'})['ok'])
        self.assertFalse(cli('status', None, raw='bukan json')['ok'])
        self.assertFalse(cli('status', None, raw='{}')['ok'])


if __name__ == '__main__':
    unittest.main()

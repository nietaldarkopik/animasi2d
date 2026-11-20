# Spesifikasi kartu karakter v2 dan Card Builder

Kartu karakter (`karakter/<nama>/`, `kind=card`) selama ini 25 berkas tampak depan. Spesifikasi v2 menambah **paket slot** untuk
hadap ¾/samping, menengok/melirik, duduk, dan aksi, serta alat (`tools/card_builder/`) untuk memeriksa dan menduplikasi karakter.

**Aditif dan kompatibel mundur.** Slot baru tidak masuk `body.poses` / `head.expressions`, jadi `CardCharacterController` dan
`tools/blender/char_lib.py` tidak melihatnya. Karakter tanpa kunci `spec` dianggap hanya paket `dasar`.
Pemutar gerak untuk editor web ada (bagian "Pemutar gerak di editor web"); **Blender belum**.

## Paket dan slot

Aktifkan per karakter di `character.json`: `"spec": {"version": 2, "packs": ["dasar", "dialog"], "mirror_ok": true}`.
Daftar lengkap: `cd tools && python -m card_builder spec`. `*` = wajib bila paketnya aktif.

| Paket | Isi | Wajib |
|---|---|---|
| `dasar` | 9 pose badan, 10 ekspresi kepala, 5 mulut, kelopak (didefinisikan `character.json`, tidak berubah) | badan, kepala |
| `dialog` | badan diam ¾ dan samping (+belakang), kepala ¾ dan samping × 5 ekspresi, kelopak dan mulut per arah, kepala melirik kanan/kiri | badan diam ¾ dan samping, kepala netral ¾ dan samping |
| `duduk` | duduk tegak, condong (siku di lutut), sila, tangan di lutut; varian ¾ opsional | 4 pose depan |
| `aksi` | lari samping (1-2 pose), kaget, lompat | lari samping |
| `jalan` | jalan samping dan ¾ (2 fase langkah) menghadap kanan **dan kiri**, badan diam/lari menghadap kiri, kepala ¾ dan samping × 5 ekspresi menengok kiri | tidak ada (semua opsional) |

**Gambar kiri sungguhan (paket `jalan`, akhiran `_kiri`):** `jalan_sisi_kiri`, `diam_34_kiri`, `netral_sisi_kiri`, dan seterusnya.
Bila ada, runtime memakainya saat tokoh menghadap/berjalan/menengok ke kiri dan **tidak** mencerminkan; bila tidak ada, tetap memakai cermin
gambar kanan seperti biasa. Kepala yang tidak punya padanan kiri dicerminkan sendiri. Tiap badan `_kiri` punya `head_at` sendiri.
Kemiringan kepala per pose: `body.head_rot[<slot>]` (derajat searah jarum jam, pivot di leher), diatur dari "Pas-kan kepala per pose".

**Nama berkas:** `<nama>_<badan|kepala|mulut|kelopak>_<id>.png`, contoh `arum_badan_duduk_sila.png`, `arum_kepala_netral_34.png`.
Kode arah: `_34` (tiga perempat kanan), `_sisi` (samping kanan), `_belakang`. **Arah kiri = cermin kanan** (`mirror_ok`); set `false`
bila desain asimetris (belahan rambut, emblem) dan sediakan berkas kiri sendiri.
Hanya karakter `[a-z0-9_-]` yang diterima importer (spasi dan " - Copy" tidak).

**Titik tempel kepala.** Kepala selalu lapisan terpisah. Setiap slot badan baru wajib punya `body.head_at["<id>"] = [x, y]`
(kiri-atas kanvas kepala pada kanvas badan), karena posisi kepala saat duduk berbeda dari saat berdiri. Tanpa itu validator gagal.

## Alat (`tools/card_builder/`)

Butuh Pillow dan numpy (`requirements.txt`). Jalankan dari `tools/`: `python -m card_builder <perintah>`.

| Perintah | Fungsi |
|---|---|
| `validate <nama>` atau `--all` | ukuran kanvas, transparansi, sisa kunci hijau, gambar menyentuh tepi, posisi kaki, kelengkapan paket, `head_at`, kecocokan dengan importer, berkas yatim. Keluar 0 lolos, 1 gagal (`--strict`: peringatan juga) |
| `colors <nama>` | keluarga warna dominan beserta kotak tempatnya (bahan memilih `--map`/`box`) |
| `duplicate <nama> --as <baru> [...]` | salin dengan nama baru; ganti warna; timpa slot; tulis resep dan pratinjau |
| `sync <nama>` | tulis ulang peta `extra` di `character.json` dari berkas yang ada |
| `describe <nama> --appearance "..."` | simpan deskripsi penampilan (bahan prompt) |
| `prompts <nama> --pack <paket>` | paket prompt Google Flow + manifes lembar untuk slot baru |
| `import-sheet <nama> --pack <paket>` | impor lembar hasil generate ke slot (lihat bagian di bawah) |
| `spec` | tampilkan paket dan slot |

### Duplikasi

```
python -m card_builder duplicate arum --as arum_biru --name "Arum Biru" \
  --map "#5e516d>#3f5f9f;not=125,185,275,250;groups=head" \      # rambut ungu -> biru, iris mata dilindungi
  --map "#84525c>#2e7d4f;tol=14" \                                # dasi dan list merah -> hijau
  --map "#7e7e84>#2a4d7a;box=0,520,800,1200;tol=30;groups=body"   # rok abu -> biru tua (hanya area rok)
```

`--map SUMBER>TUJUAN[;opsi]`: `tol` (derajat hue; juga skala untuk abu), `vtol`, `box=x0,y0,x1,y1` (batasi), `not=x0,y0,x1,y1` (kecualikan, boleh
berulang), `groups=body,head,mouth,blink` (default `body,head`), `mask=berkas.png` (PNG sekanvas; alfa = bobot). `--override badan:diam=berkas.png`
mengganti satu slot dengan gambar sendiri (ukuran dicek). Sumber tidak pernah diubah; hasil dibangun di folder sementara lalu dipindah, jadi kegagalan tidak
meninggalkan setengah jadi.

Keluaran: folder `karakter/<baru>/` standar (+ `_resep/resep.json` dan `_resep/pratinjau.png`), `character.json` berisi `extends`, `recolor`, `spec`.

**Batasan jujur penggantian warna**
- Bekerja per keluarga warna dan menjaga bayangan (hue digeser, kecerahan relatif tetap). Tepat untuk wilayah berwarna.
- Hitam, abu, dan putih tidak bisa dipisahkan dari garis tepi dan bayangan hanya dengan warna: wajib `box` atau `mask`.
- Wilayah yang berbagi hue ikut berubah (contoh: iris ungu Arum sewarna rambut ungu; bayangan kulit kemerahan sewarna dasi). Gunakan `not=`, `box=`, atau `tol` kecil.
- Gambar berbasis gradasi halus (AI) lebih sulit dibersihkan daripada warna datar; periksa `pratinjau.png`.
- Field `style` di `character.json` disalin dari induk dan tidak diubah (tertulis di `style_note`).

## Produksi slot baru: prompt dan impor lembar (langkah 2)

Alur lama (`_proses/proses.py` per karakter) memakai koordinat sel dan faktor skala yang diukur tangan. Alur baru otomatis:

```
python -m card_builder describe arum --appearance "long dark-purple hair, ..."   # sekali per karakter; bahan prompt (bahasa Inggris)
python -m card_builder prompts arum --pack duduk          # -> _mentah/prompt_duduk.txt + manifest_duduk.json
#   generate tiap lembar di Google Flow, simpan sebagai _mentah/arum_duduk_badan_a.png, ... (nama tertulis di prompt)
python -m card_builder import-sheet arum --pack duduk --dry-run   # cek deteksi sel dulu (hanya menulis _mentah/_cek_*.png)
python -m card_builder import-sheet arum --pack duduk
```

- **Sel 1 setiap lembar = acuan ukuran**: aset depan yang sudah ada digambar ulang di lembar yang sama. Importer membandingkannya dengan aset asli
  untuk menghitung skala lembar, lalu membuangnya. Karena itu skala tidak perlu diukur tangan.
- **Sel dicari dari isi gambar** (kunci hijau, lalu celah antar gambar). Jumlah sel harus pas, bila tidak: galat yang menyebut berapa yang ditemukan.
  `--equal` membagi rata untuk sel yang bersentuhan; `--scale <id>=1.05` mengganti skala; `--fit` mengecilkan badan yang tidak muat; `--overwrite` menimpa berkas ada.
- **Badan**: kaki di `feet_y`, leher di `center_x`; `body.head_at[<id>]` dihitung otomatis dari posisi leher dibanding pose berdiri. Leher diukur pada sumbu badan
  (62-78% tinggi), bukan puncak gambar, jadi tangan yang terangkat tidak dikira leher (dicek terhadap 9 pose lama: selisih ≤ 4 px).
- **Kepala**: skala dari kepala netral depan, ditempatkan dengan puncak rambut dan tunggul leher sejajar aset asli. **Mulut**: skala dari mulut A depan, dipusatkan.
- `_mentah/_cek_<lembar>.png` menandai sel yang terdeteksi; `_mentah/_cek_<paket>.png` memperlihatkan badan baru dengan kepala netral di `head_at`
  (periksa dengan mata sebelum dipakai). Paket otomatis aktif di `character.json` begitu semua slot wajibnya ada.

**Batasan jujur**
- Alur ini diuji dengan lembar **simulasi** dari aset Arum (skala diketahui, latar hijau), bukan hasil generate AI nyata. Pemulihan skala dan titik leher akurat pada simulasi;
  kualitas lembar AI sungguhan (ukuran sel acuan, jari menyatu, latar tidak hijau murni) belum teruji.
- Kunci hijau mengikis 1 piksel; ujung yang sangat tipis (jari) bisa hilang sedikit.
- `mouth.at["34"|"sisi"]` (posisi mulut pada kepala tampak samping) tidak bisa dihitung otomatis: isi manual; importer dan validator mengingatkan.
- Slot `kelopak` tampak samping belum didukung importer (dilewati saat membuat prompt).
- Slot duduk/aksi memakai badan tanpa kepala; kepala dipasang di `head_at` oleh runtime (belum ada, langkah 3).

## Pemutar gerak di editor web (langkah 3)

Slot paket yang aktif ditulis ke `character.json` sebagai `"extra": {"body": {id: berkas}, "head": {...}, "mouth": {...}}` (otomatis oleh `import-sheet` dan
`duplicate`; manual: `python -m card_builder sync <nama>`). Backend menyajikannya di `urls.extra`, editor mengunggahnya bersama aset kartu, dan tabel tukar-gambar
layer (`expr`) memuatnya dengan kunci slot (`duduk_sila`, `diam_sisi`, `netral_34`, `lirik_kanan` ...). Posisi kepala tiap slot badan disimpan di akar rig
(`rig.card.head`, `rig.card.head0`, `rig.card.mirror`). Sisipkan ulang karakter dari Library agar slot baru ikut.

Panel **Alat film → Karakter** untuk karakter kartu (`builder/cardMotion.ts`), semuanya dipasang di frame playhead sebagai kunci biasa yang bisa diedit di timeline:

| Kontrol | Yang terjadi |
|---|---|
| Pose badan | ganti gambar badan dan pasang kepala di titik `head_at` slot itu |
| Hadap: depan, ¾, samping; kanan atau kiri | badan dan kepala tampak itu; **kiri = seluruh rig dicerminkan** (skala X akar bernilai -1) |
| Tengok (kiri/kanan, tahan, kembali) | hanya kepala: depan → ¾ → samping, ditahan, lalu kembali; kiri = kepala dicerminkan |
| Lirik (kiri/tengah/kanan) | hanya kepala `lirik_*`, tubuh tidak berubah |
| Duduk (tegak, condong, sila, tangan di lutut) + Berdiri | gambar duduk; **Naikkan (px)** mengangkat tubuh untuk duduk di kursi |
| Berjalan, Berlari, Melompat, Mengangguk, Bernapas | versi kartu: jalan/lari memakai gambar samping, menghadap arah gerak, lari bergantian `lari_sisi` dan `lari_sisi_2` dan miring ke depan, lompat memakai pose tangan naik, lalu kembali ke tampilan semula |

Tanpa gambar samping, jalan dan lari tetap bergerak seperti sebelumnya (akar bergeser sambil naik-turun). Karena shot jalan biasanya setinggi lutut, jalan memakai satu gambar
`diam_sisi` dengan gerak naik-turun, tanpa siklus kaki.

**Batasan jujur**
- Diuji dengan seni **simulasi** dari aset Arum (pose dan ekspresi lain dipakai sebagai pengganti tampak samping/duduk), bukan seni AI nyata. Cermin, posisi kepala, pergantian,
  naikkan, lari dan jalan terlihat benar di renderer editor; bagaimana hasilnya dengan gambar samping sungguhan belum diketahui.
- **Lip-sync hanya tampak depan.** Pada ¾/samping mulut dan kelopak depan disembunyikan (skala 0,001): mulut mengikuti gambar kepala. Dialog saat menghadap samping tidak bersinkron bibir.
- Tampak belakang dan kelopak/mulut per arah belum dipakai runtime. Kedip dan lip-sync dari autoDirector mengabaikan arah.
- Kursi digambar sebagai properti terpisah; karakter yang duduk tidak otomatis ditaruh di atasnya.
- Blender (`char_lib.py`) belum membaca slot baru; hanya editor web.
- Batas penyimpanan: `expr` sekarang maksimum 80 gambar per layer (sebelumnya 40).

## Pembangun karakter di web (langkah 4)

Semua alat di atas bisa dipakai dari antarmuka web, tanpa terminal. Alurnya: browser → Laravel (`CardBuilderController`) → `python -m card_builder api <op>` (JSON lewat stdin/stdout) → folder `karakter/`.

**Halaman karakter kartu (`/builder/card/<id>`) → "Pembangun karakter":**
- *Paket gerak*: ciri tampilan, status paket (dialog/duduk/aksi), prompt Flow dengan tombol salin, unggah per lembar, "Cek dulu (uji coba)" dengan gambar deteksi, "Impor + perbarui versi" (impor lalu versi baru otomatis), posisi mulut 3/4 dan samping (`mouth.at`).
- *Duplikat & warna*: klaster warna, aturan peta warna (toleransi, grup, kotak pengecualian), pratinjau, lalu simpan sebagai karakter baru.

**Karakter baru dari nol (`/builder/card-baru`, tombol "+ Karakter 2.5D dari Flow" di daftar karakter):**
1. Nama, folder, ciri tampilan → draf di `karakter/_draf/<slug>` (milik pembuat, `owner.json`; tidak terbaca daftar impor maupun Blender).
2. Tujuh lembar "dasar": acuan (opsional), kepala 5×2, badan a (3), badan b dan c (acuan + 3), mulut (5), kelopak (2, opsional). Salin prompt, buat di Flow, unggah.
3. Rakit: tiap lembar dipotong dari isi gambar (tanpa koordinat tangan), skala otomatis dari sel acuan, badan ditempatkan lewat leher, kepala lewat tunggul leher.
4. Kalibrasi: klik dagu, tengah mulut, kedua mata pada kepala netral; geser skala mulut/kelopak; Terapkan merakit ulang.
5. Selesai: validasi, pindah ke `karakter/<slug>`, impor sebagai karakter kartu.

Standar karakter baru (diukur dari Arum/Riska/Seni): badan tinggi 1099, leher di (400,275), kaki y=1375; kepala tinggi 304 di kanvas 400×500; mulut selebar 33 px; kelopak = 0,493 × jarak mata. Bawaan kalibrasi: dagu y=284, mulut (199,258), mata (163,215) dan (232,215).

**Konfigurasi backend** (`config/services.php` → `card_builder`): `CARD_BUILDER_PYTHON` (atau `PYTHON_BIN`, bawaan `python`), `CARD_BUILDER_ROOT` (bawaan `../karakter`), `CARD_BUILDER_TIMEOUT` (detik, bawaan 240). Perlu Python dengan Pillow dan numpy (`tools/card_builder/requirements.txt`).

**API** (semua di bawah `/api/builder`, terautentikasi kecuali pratinjau yang bertanda tangan): `cards/{id}/builder` (GET status), `.../appearance` (PUT), `.../prompts`, `.../sheets/{pack}/{sheet}`, `.../import`, `.../mouth-at`, `.../colors`, `.../recolor`; `card-drafts` (POST), `card-drafts/{slug}` (GET, DELETE), `.../sheets/{sheet}`, `.../import`, `.../finish`; `card-previews/{kind}/{slug}/{name}` (URL bertanda tangan, 2 jam). Operasi per folder dikunci (`Cache::lock`).

**Batas:** diuji end-to-end di browser dengan lembar simulasi dari aset Arum, belum dengan keluaran Flow sungguhan (kualitas mulut dan kelopak bergantung pada gambar asli; kalibrasi manual disediakan untuk itu). Opsi `mask` peta warna tidak tersedia di web. Blender belum membaca slot baru.

## Uji

`cd tools && python -m unittest discover -s card_builder/tests -t .` (46 uji Python: validator, penggantian warna, duplikasi, pembuat prompt, importer lembar dengan lembar simulasi dari aset Arum, dan keempat karakter nyata). Backend: `php artisan test --filter CardExtraSlotsTest` (5 uji). Frontend: `npx vitest run src/builder/cardMotion.test.ts src/builder/cardBuilder.test.ts`. Pembangun web: `php artisan test --filter CardBuilderApiTest` (8 uji, memakai Python sungguhan)..
Kompatibilitas importer diuji dengan `CardCharacterController::readSpec` pada duplikat Arum.

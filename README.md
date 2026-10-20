# Cartoon Maker AI — studio animasi 2D berbasis web

Aplikasi web untuk membuat animasi kartun 2D dari sketsa tangan (foto/scan) atau gambar digital: pisahkan karakter menjadi bagian, beri rig (bone, FK, IK), animasikan di timeline (manual, preset, atau perintah teks ke AI), susun beberapa scene dengan transisi dan audio, lalu export MP4/WebM/PNG sequence.

- **Frontend** `frontend/` — React + TypeScript + PixiJS (Vite)
- **Backend** `backend/` — Laravel 13 + Sanctum, **MySQL 8+ (InnoDB)**, queue Laravel (database/Redis). Tes berjalan di SQLite dan MySQL
- **Worker** `worker/` — Python + Pillow (pembersihan gambar); FFmpeg untuk export
- **AI** — gateway kompatibel OpenAI (9router); kunci hanya di server
- Dokumentasi: [Panduan pengguna](docs/PANDUAN.md) · [Deployment](docs/DEPLOY.md)

## Status fitur (jujur)

| Area | Fitur | Status |
|---|---|---|
| Akun & project | register/login, buat/buka/gandakan/hapus, autosave, deteksi konflik, riwayat versi + restore | ✅ |
| | tombol `REGISTRATION_ENABLED=false` untuk instalasi privat | ✅ |
| Enhancement Studio | mode **Preserve Original / Clean Sketch / Clean Line Art** (lokal, Pillow): deskew, rotate, ratakan bayangan & warna kertas, denoise, upscale (Lanczos), garis bersih transparan; setiap proses = versi baru, asli tak tersentuh; slider before/after + daftar versi | ✅ |
| | **Colorize / AI Redraw**: adapter provider gambar (`/images/edits`), **nonaktif default**, butuh persetujuan per permintaan, batas harian, berjalan di queue | ⚠️ kode + tes dengan HTTP palsu; **belum diuji ke provider nyata** |
| | **koreksi perspektif kertas**: klik 4 sudut kertas di Enhancement Studio → diluruskan (homografi, Pillow); rasio hasil dari sisi terpanjang, bukan deteksi otomatis | ✅ worker + API + tes; UI klik sudut belum dicoba di browser |
| | deteksi otomatis sudut kertas, upscale super-resolusi AI | ❌ belum |
| Data | tabel relasional `animation_scenes`, `layers`, `keyframes` (FK + unique) disinkronkan dari dokumen JSON di transaksi yang sama dengan setiap simpan; `characters`/`character_parts` untuk **library karakter** (simpan dari scene, sisipkan ke project lain dengan salinan aset) | ✅ API + tes + dialog **Karakter** di editor (simpan pohon layer terpilih, sisipkan ke scene/project lain) |
| Character Builder | halaman **/builder**: pilih bagian (badan, wajah, rambut depan/belakang, kerudung, mata, alis, mulut, seragam/jaket/kaos, bawahan, sepatu, tas, kacamata, topi, headphone, aksesori), warna per bagian, ekspresi preset, geser/skala per bagian, undo/redo, **setengah badan & seluruh badan** (satu kanvas 400×800, beda hanya pemotongan), ekspor PNG transparan + JSON | ✅ diuji end-to-end di browser |
| | **versi karakter immutable**: tiap simpan = versi baru; konfigurasi menyimpan id + hash aset; aset yang dipakai versi hanya diarsipkan, tidak dihapus | ✅ API + tes |
| | **atur posisi & ukuran langsung di kanvas**: klik bagian untuk memilih, seret untuk menggeser, seret handle sudut untuk mengubah ukuran (terhadap pusat gambar yang terlihat), roda mouse untuk skala, tombol panah untuk geser halus (Shift = 5); satu gerakan = satu langkah undo | ✅ diuji di browser |
| | **Area kerja Builder**: panggung lebih luas dari area ekspor (bagian yang digeser keluar bingkai tetap terlihat, redup; bingkai putus-putus = yang diekspor), memenuhi panel tengah. **Zoom** dengan roda mouse (ke arah kursor) atau tombol −/+/Pas/100%, **geser kanvas** dengan Spasi+seret, klik tombol tengah, atau alat ✋. **Pilih banyak**: Shift/Ctrl+klik, seret kotak di ruang kosong, Ctrl+A (Esc membatalkan); geser/ubah ukuran (handle sudut, Shift+roda, panah, +/−) berlaku untuk seluruh pilihan dengan tata letak terjaga; daftar Lapisan juga mendukung Shift/Ctrl+klik. Zoom tidak disetel ulang saat menyimpan | ✅ 19 pemeriksaan di browser |
| | **Rotasi**: handle bulat di atas bingkai seleksi (Shift = kelipatan 15°), slider *Putar* di panel Posisi, Alt+roda (±3°/notch), tombol `[` `]` (Shift = 15°). Berputar terhadap pusat gambar yang terlihat; beberapa bagian berputar bersama sebagai satu benda kaku. Bingkai seleksi satu bagian ikut miring; ikut tersimpan di versi, ekspor, dan rig (rotasi 0 tidak disimpan) | ✅ 12 pemeriksaan di browser + uji unit geometri |
| | **Warna bagian untuk gambar PNG**: aset SVG mengikuti palet *Warna* (area bertanda `data-tint`), tetapi PNG (v2, torso, lengan, sheet) tidak punya area warna, jadi tiap bagian PNG punya panel *Warna bagian*: contoh warna dari panel warna sheet (rambut, kulit, mata, pakaian), warna pilihan, kekuatan, dan kecerahan. Rona/saturasi diganti, bayangan dan garis tetap (blend `color` kanvas, alfa dipulihkan). Ikut tersimpan di versi, ekspor, dan rig. Batas: bukan pewarnaan per area (satu warna untuk seluruh bagian, mis. seluruh baju), dan warna yang jauh lebih terang dari aslinya (rambut hitam → pirang) hanya bisa didekati | ✅ diuji di browser |
| | **Lapisan (layering)**: panel *Lapisan* di Builder menampilkan urutan tumpukan; ▲▼ memajukan/memundurkan satu bagian satu lapis (tiap bagian bisa dikembalikan ke urutan bawaan). **Potong rambut/kerudung di bahu**: bagian bawah diletakkan di *balik* baju dan badan, bagian atas tetap di depan, sehingga baju “masuk di antara” dua lapis rambut dan rambut panjang terpotong oleh baju. Rambut panjang v2 otomatis dipotong saat dipilih; garis potong bisa digeser (terlihat sebagai garis oranye di kanvas) | ✅ diuji di browser (warna piksel dada: baju vs rambut) |
| | **Sisipkan + bone** (tombol di dialog **Karakter** editor): 11 bone (pinggul → badan → kepala; lengan atas/bawah; paha/betis kiri-kanan) + ±15 gambar hasil potongan, tiap gambar menempel pada bone. Bisa langsung diputar, di-keyframe, diberi Preset gerak, atau dipasang IK 2-bone pada lengan/kaki. Rok tetap di pinggul, celana ikut kaki | ✅ geometri diuji dengan fungsi matriks editor; diuji di browser |
| | rig: **rambut belakang** (termasuk salinan belakang dari rambut yang dipotong) **menempel di badan**, tidak ikut miring bersama kepala; urutan bawaan rig tetap (override urutan hanya berlaku di antara bagian kepala), lengan/kaki dipotong dari gambar utuh sehingga ada garis potong saat diputar jauh | ⚠️ keterbatasan |
| | sisipkan sebagai satu gambar utuh (tombol **Gambar saja**) | ✅ |
| Impor `master-assets` | folder `master-assets/` (v1 + v2 dari Figma AI) diimpor dengan `python tools/sheet_import/import_master.py master-assets OUT` lalu `php artisan library:import-sheet OUT --user=<id>`. **v2** (80: wajah & rambut laki/perempuan, kerudung, atasan, mata) dikalibrasi otomatis: skala per jenis kelamin supaya kepala sama besar, rambut dari jendela wajah/poni, kerudung dari lubang wajah, pasangan mata dipotong dan dipasang ulang di posisi mata. **v1**: hanya yang baru (sepatu → dicerminkan jadi sepasang, jam tangan, jepit rambut); sisanya sudah ada dari impor sheet sebelumnya. **Pose** dan **ekspresi** (karakter utuh) masuk kategori **Referensi** di Library, bukan bagian builder | ✅ dicek visual + builder + rig di browser; tas ransel v1 dilewati (gambar datar) |
| Kit badan (`aset_badan`) | kategori baru **Badan atas** (torso anime: laki-laki dan perempuan, depan/kanan/kiri/belakang) dan **Lengan kiri / kanan** (10 pose: lurus, angkat, tangan di pinggang, menunjuk, melambai, kepal, rentang, silang dada, lurus samping, ayun jalan; tiap pose punya versi kiri dan kanan dicerminkan, dua pose berupa sepasang lengan). Karena kit ini belum punya kaki, ditambahkan aset sistem **“Badan: hanya kaki”**. Urutan tumpukan: bawahan → torso → lengan → atasan (lengan di balik lengan baju); pose yang tangannya bertumpu di baju (silang dada, tangan di pinggang) otomatis ditaruh di depan baju. Di rig, torso ikut dipotong bersama badan dan tiap lengan pose menjadi satu bagian kaku pada bone lengan atas. Torso laki-laki dipersempit ±8% agar bahunya tidak menyembul di samping baju v2 | ✅ dicek visual dan di browser; pose yang terlalu panjang (menunjuk 69%, melambai 90%, rentang 50%) **diperkecil agar muat kanvas 400 unit** dan ditandai tag/nama “diperkecil” |
| Library aset | **/library**: 53 aset SVG original (45 bagian + 5 lokasi: halaman sekolah, kelas, lab komputer, ruang tamu, taman), upload SVG/PNG (SVG disanitasi allow-list), cari/filter | ✅ |
| | **Lokasi/latar**: tombol **Latar** di editor memasang lokasi sebagai layer paling bawah (terkunci) | ✅ |
| | **Edit aset** (tombol *edit* pada aset milik Anda; *duplikat* untuk aset sistem): tab **Rapikan gambar** (tongkat ajaib, hapus warna, penghapus, pulihkan, kuas, hapus serpihan, rapikan tepi, undo/redo, zoom, pas ke isi), **Kode SVG** (diedit lalu disanitasi server), **Ganti file** (unggah ulang), dan **Detail** (nama, tag, kategori). Jika aset sudah dipakai versi karakter, versi lama tetap utuh: hasil edit jadi aset baru dan yang lama diarsipkan | ✅ diuji end-to-end di browser |
| | **AI Asset Studio**: model teks (9router) menulis SVG di kanvas yang sama, disanitasi, hasil **pending sampai Anda setujui**; batas harian | ✅ diuji dengan HTTP palsu; **kualitas SVG hasil AI belum dinilai dengan model sungguhan** |
| | provider gambar raster untuk aset AI, ekspresi sebagai tabel DB (sekarang preset di frontend), pose, rig karakter builder | ❌ belum |
| Gambar | upload JPG/PNG/WebP (isi file divalidasi), aset di storage (bukan di DB) | ✅ |
| | crop, resize, hapus latar polos dari tepi, sketsa kertas/foto → garis transparan, perjelas, pangkas | ✅ (worker Pillow, bukan AI) |
| | **Retouch**: kuas Hapus/Pulihkan/Lukis + pipet, perluas kanvas; rig/posisi/keyframe tidak bergeser | ✅ |
| Editor | canvas PixiJS: layer gambar/teks/kotak, drag/skala/rotasi, urutan, kunci, properti numerik, undo/redo | ✅ |
| Rig | bone, parenting hierarkis (FK), pivot/sendi yang bisa diseret, re-parent tanpa menggeser gambar | ✅ |
| | IK 2-bone dengan target yang bisa dianimasikan | ✅ (skala seragam) |
| Animasi | timeline: keyframe 6 properti, auto-key, easing, onion skin, play/loop, FPS & durasi | ✅ |
| | Motion Presets (ayun/lambai, jalan, lari, lompat, naik-turun, goyang, bernapas, putar, fade, mulut buka-tutup) | ✅ |
| Scene (F) | banyak scene, tab + ikhtisar film, gandakan/urutkan/hapus, transisi (fade hitam/putih, geser kiri/kanan) | ✅ |
| | audio: unggah MP3/WAV/OGG/M4A/FLAC, mulai & volume per klip, putar bersama film, dicampur FFmpeg saat export | ✅ |
| Export | **GIF** (palet 256 warna, tanpa audio) dan **sprite sheet** (zip: sheet.png + sheet.json) selain MP4, WebM, PNG sequence — seluruh film atau scene aktif; resolusi/FPS bebas | ✅ |
| AI (9router) | **Prompt-to-Motion**: perintah teks → keyframe pada rig (ditinjau dulu, bisa di-undo) | ✅ diuji live |
| | **AI pisahkan bagian**: usulan bagian + induk + sendi → koreksi manual → layer berhierarki | ✅ diuji live — **akurasi kotak terbatas** |
| Onboarding | contoh karakter ber-rig, tur terpandu, bantuan & pintasan, Esc menutup dialog, banner offline/gagal-simpan | ✅ |
| Operasional | PostgreSQL + Redis, nginx, Compose, systemd, `studio:prune`, token kedaluwarsa | ✅ diuji (Docker: **belum**; lihat DEPLOY) |
| Editor (seleksi) | **Pilih banyak layer**: Shift/Ctrl+klik di kanvas atau daftar Layer, **kotak seret** (boleh dimulai di atas latar terkunci), Ctrl+A (semua layer tak terkunci), Esc membatalkan. Seret salah satu = **geser semuanya**; kotak putih di sudut = **ubah ukuran bersama** (tata letak terjaga); bulatan di atas = **putar bersama**; panah menggeser (Shift = 10); Delete menghapus semuanya; satu langkah undo untuk setiap gestur. Layer terkunci (latar) tidak ikut bergerak; anak yang induknya ikut terpilih tidak digeser dua kali | ✅ 21 pemeriksaan di browser + tes unit |
| | **Zoom dan geser kanvas** di editor: roda mouse = zoom ke arah kursor (10%–800%, titik di bawah kursor tidak bergeser; pinch trackpad juga), Shift+roda = geser kiri-kanan, geser dengan **tombol tengah mouse**, **Alt+seret**, atau **alat tangan ✋**; tombol −, +, **100%**, **Fit**. Saat menggeser, layer di bawah kursor tidak ikut bergeser atau terpilih | ✅ 12 pemeriksaan di browser + tes unit |
| | **Bone selalu di atas objek**: gambar bone dipindah ke lapisan sendiri di atas semua layer (hanya di editor; tidak ikut export, bisa disembunyikan dengan kotak *Bone*), jadi gambar tidak pernah menutupinya; mengklik bone yang tertimbun gambar memilih bone-nya | ✅ warna piksel diukur di browser |
| Gambar → SVG | **Ubah JPG/PNG/WebP menjadi SVG** (pelacakan, bukan konversi ajaib): tombol *Ubah JPG/PNG jadi SVG…* di halaman Library (hasil bisa **disimpan sebagai aset SVG** atau diunduh) dan tombol **SVG** pada tiap gambar di panel Aset editor (unduh). Mode **Berwarna** (8–64 warna) atau **Garis hitam (sketsa)** dengan ambang gelap; opsi **hapus latar polos** (JPG tidak punya transparansi); pratinjau asli vs hasil. Library membatasi SVG 300 KB: bila lebih, tombol **Perkecil agar muat Library** menurunkan detail bertahap. Hasil = aproksimasi (foto/gradasi menjadi pita warna rata) | ✅ 20 pemeriksaan di browser dengan JPG nyata (warna, sketsa, simpan ke Library, batas 300 KB) + tes backend |
| Character Builder (ekspor vektor) | tombol **SVG (vektor)**: satu file SVG **berlapis** (satu layer bernama per bagian: rambut, baju, mata…, urutan, posisi, rotasi, skala, warna palet/tint, dan potongan rambut-di-balik-baju sama seperti kanvas; bisa diedit di Inkscape / Illustrator / Figma / CorelDRAW, dan di sana disimpan sebagai PDF/EPS/AI). Bagian **SVG** tetap vektor asli (id gradien dibuat unik per layer). Bagian **PNG** punya dua mode: **Vektor penuh** (dilacak jadi path berwarna lewat imagetracerjs di Web Worker, 4 tingkat detail 8–64 warna; **aproksimasi**: gradasi menjadi pita warna rata) atau **Sematkan PNG** (persis aslinya, tetapi bukan vektor). Opsi latar transparan/putih dan ZIP berisi file utama + satu SVG per bagian. Tampilan setengah/seluruh badan mengikuti Builder | ✅ SVG murni = render kanvas (selisih rata-rata 0,1/255); karakter anime PNG dilacak 2,3/255 (Sedang), 1,9 (Tinggi); sematan 0,0 — diukur di browser. **Tidak ada ekspor PDF/EPS/AI langsung** |
| Alat film | panel **Alat film** di sisi kanan editor (tab Karakter · Kamera · Efek · Teks · Properti). **Karakter ber-bone** ditandai (`rig.id`/`rig.role` pada tiap layer), jadi beberapa karakter dalam satu scene dikenali terpisah | ✅ 15 tes unit + uji browser |
| | **Pose** (8: berdiri, melambai, tangan di pinggang, menunjuk, berpikir, kaget, kedua tangan naik, kepala miring) = keyframe rotasi seluruh bone di playhead; **Gerakan siap pakai** (berjalan, berlari, melambai, mengangguk, bernapas, melompat; arah, jarak, durasi) = keyframe biasa yang bisa diedit, durasi scene otomatis diperpanjang | ✅ geometri pose diuji (tangan di atas bahu, dst.) |
| | **Ekspresi wajah per frame**: di Character Builder atur mata/alis/mulut → *Simpan ekspresi saat ini* (maks. 12, tersimpan di versi karakter, aset terkunci oleh versi). Saat disisipkan ber-bone, tiap ekspresi jadi gambar varian yang dipotong pada kotak yang SAMA, lalu *Ekspresi* di Alat film memasang **kunci pertukaran gambar** (`swaps`, ditahan sampai kunci berikutnya; tampil di timeline, bisa dihapus). Hanya bagian yang punya varian yang berganti (mis. hanya mulut) | ✅ diuji dengan aset PNG nyata di browser |
| | **Lip-sync dari suara**: pilih klip audio → mulut digerakkan mengikuti **volume** suara (4 tingkat, bergerak cepat, tanpa kedip satu frame; jeda = menutup). **Bukan lip-sync fonem** (tidak membedakan "a" dan "o"); tanpa model AI, bahasa apa pun | ✅ 11 tes unit (sinyal sintetis) + uji browser dengan mikrofon palsu |
| | **Kamera**: keyframe x/y/zoom/putar per scene, preset (zoom in/out, geser, getar, fokus ke layer); aktif selalu saat Putar film dan Export, saat menyunting hanya bila "Lihat lewat kamera" dicentang. **Transisi** baru: tirai (wipe) dan zoom lewat hitam | ✅ |
| | **Efek & waktu**: hujan, salju, vignette, dan *waktu* (pagi / siang / sore / malam = warna seluruh scene, tanpa gambar baru). Dirender deterministik per frame (editor = export) | ✅ gelap/terang & animasi per frame diukur di browser |
| | **Teks**: balon dialog (bicara/pikir/teriak, ekor menunjuk kepala), judul (fade masuk/keluar), **subtitle** per scene (di preview dan export) | ✅ |
| | **Properti**: 15 benda (buku, laptop, tas, kursi, meja, jam, bola, gelas, ponsel, tanaman, lampu, hadiah, payung, bunga) di Library → tab *Properti*; *Pegang di tangan kanan/kiri* menempelkan ke bone lengan bawah (ikut bergerak); *Bayangan di kaki* (elips di belakang karakter) | ✅ |
| | **Latar**: 6 lokasi baru (kantin, perpustakaan, lapangan upacara, kamar tidur, dapur, jalan raya) → 11 lokasi sistem. **Pembuatan latar dengan AI belum bisa**: provider gambar belum tersedia (lihat Asset Studio) | ⚠️ |
| | **Audio**: *● Rekam suara* dari mikrofon (disimpan sebagai WAV, diletakkan di posisi playhead), **10 efek suara** sintetis (ding, pop, klik, ketuk, langkah, whoosh, bel sekolah, tada, sedih, bruk — dibuat di browser, bukan rekaman), jenis klip (suara/efek/musik), **fade in/out** per klip (preview dan export FFmpeg) | ✅ fade diukur dengan `volumedetect` |
| Papan cerita | tombol **Papan cerita**: catatan per scene (lokasi, ringkasan, dialog) dan **Buat dari skrip**: `# Judul | lokasi: Kelas`, `(aksi)`, `Nama: dialog` → scene dengan durasi dari panjang dialog, **latar yang cocok** dengan kata lokasi, **karakter Builder bernama sama ditempatkan ber-bone**, subtitle terjadwal, transisi fade. Nama tanpa karakter dilaporkan | ✅ diuji end-to-end |
| Kartun Harian Otomatis | **Pabrik film kartun otomatis harian**: generator naskah AI/katalog cerita, pengisi suara dialog otomatis (Edge-TTS Bahasa Indonesia: Sekar `id-ID-GadisNeural` & Uki `id-ID-ArdiNeural`), perakitan rig karakter & latar otomatis, animasi gestur bicara, serta export MP4 terjadwal lewat CLI (`php artisan cartoon:generate-daily --export`), batch Windows (`generate_daily.bat`), dan modal Web UI | ✅ |
| — | Image-to-Video, Video-to-Motion | ❌ tidak tersedia (gateway AI tidak punya model video); tidak disimulasikan |
| — | Lip-sync berbasis fonem | ❌ (yang ada: berdasarkan volume suara, lihat di atas) |
| — | auto-rig penuh (bone otomatis), S3/object storage, kolaborasi multi-user | ❌ belum |

### Catatan penting

- **Impor sheet aset** (`tools/sheet_import/slice_sheet.py SHEET.png OUT`, lalu `php artisan library:import-sheet OUT --user=<id>`): memotong grid sheet “Rakit Karaktermu”, menghapus latar tile, meng-upscale 4× dengan Real-ESRGAN, menempatkan tiap bagian pada kanvas karakter (800×1600 px = 400×800 unit) lalu mengimpornya sebagai aset pribadi. Koordinat panel diskalakan otomatis untuk sheet beresolusi lebih tinggi dengan tata letak sama. Sepatu (tampak samping), tas, jam, dan jepit dilewati karena tidak cocok untuk karakter tampak depan; pose/ekspresi pada sheet adalah karakter utuh, bukan bagian. Posisi hasil perkiraan dari titik standar slot; sempurnakan dengan slider geser/skala.

- **Aset contoh** dibuat oleh `backend/database/library/generate.py` (jalankan ulang untuk mengubah, lalu `php artisan db:seed --class=LibrarySeeder`; kunci aset yang sudah ada tidak diubah). Gaya sederhana (garis tipis, warna datar), bukan setara ilustrasi referensi; tambah aset lewat upload/AI.

- **Database**: gunakan MySQL 8+ dengan engine **InnoDB** (WAMP bawaan MyISAM; `config/database.php` memaksa InnoDB). Buat DB `animasi2d`, atur `DB_*` di `backend/.env`, jalankan `php artisan migrate`. Data dev lama di SQLite tidak dimigrasikan otomatis. Tabel `ai_jobs`→`animation_jobs` dan `export_jobs`→`render_jobs` (diganti nama oleh migrasi).
- **PNG sequence transparan**: centang "Latar transparan" di dialog Export → frame dirender satu per satu di browser dengan alfa asli (maks. 600 frame, ukuran = kanvas proyek), di-ZIP di browser, divalidasi server dan disimpan tanpa re-encode. Tanpa centang, PNG sequence/GIF/MP4/WebM berasal dari rekaman kanvas yang opak (GIF hanya transparansi 1-bit pun tidak dipakai).
- Alur transparan **belum diuji di browser sungguhan** (hanya sisi server dan ZIP writer yang diuji otomatis).

- **Transisi** bergaya *dip* (scene keluar lalu scene berikutnya masuk), bukan crossfade tumpang-tindih. **Audio** pada pratinjau hanya terdengar saat "Putar film"; saat export dicampur server.
- **Export** direkam *di browser* selama durasi film (tab harus tetap terbuka), lalu dikonversi FFmpeg oleh queue worker.
- **Undo** berlaku per scene; menambah/menghapus/mengurutkan scene mengosongkan riwayat undo (simpan versi dulu bila perlu).
- Keyframe disimpan dalam satuan frame: mengubah FPS mengubah kecepatan gerak. Atur pivot sebelum membuat keyframe.
- **AI pisah bagian**: model benar soal struktur & induk-anak, tetapi kotaknya sering meleset (uji live: IoU ≈ 0,5–0,65 untuk bagian besar, lengan lebih buruk) dan sesekali mengarang bagian — hasil SELALU ditinjau dulu. Bagian dipotong persegi, jadi piksel tetangga di area tumpang tindih ikut terbawa (bersihkan dengan Retouch); anak selalu digambar di atas induknya. Grid koordinat pada gambar sempat dicoba dan tidak memperbaiki akurasi.
- **AI gerak**: nilai absolut dari model bisa berbeda dari pose saat ini; server mencoba ulang sekali bila JSON rusak, membuang track untuk layer tak dikenal/rotasi IK, dan membatasi nilai.
- Mobile: tampilan, pratinjau, dan upload berfungsi; penyuntingan dioptimalkan untuk desktop.

## Menjalankan (development)

Prasyarat: PHP ≥ 8.3 (`pdo_sqlite`/`pdo_pgsql`, `gd`, `fileinfo`, `zip`), Composer, Node ≥ 20, FFmpeg ≥ 4.4 + ffprobe, Python ≥ 3.9 + Pillow (`pip install -r worker/requirements.txt`).

```bash
cd backend && composer install && cp .env.example .env && php artisan key:generate && php artisan migrate
cd ../frontend && npm install

# tiga proses:
cd backend  && php artisan serve --host=127.0.0.1 --port=8000
cd backend  && php artisan queue:work --tries=1 --timeout=900      # WAJIB: export & AI berjalan lewat queue
cd frontend && npm run dev                                          # http://127.0.0.1:5173 (proxy /api → :8000)
```

Pada Windows, isi `FFMPEG_BIN`/`FFPROBE_BIN` di `.env` dengan tanda kutip tunggal dan slash (`'C:/…/ffmpeg.exe'`). `php artisan serve` **tidak** meneruskan variabel env shell ke server; ubah `.env`, bukan env shell.

## 🎬 Pembuat Film Kartun Otomatis Harian (Daily Cartoon Automation)

Fitur ini memungkinkan pembuatan film kartun 2D secara otomatis setiap hari:
1. **Naskah Cerita**: AI (atau katalog cerita pilihan) menyusun 2–3 adegan, dialog, dan lokasi.
2. **Pengisi Suara (TTS)**: Menghasilkan suara dubbing bahasa Indonesia natural (`edge-tts` — Sekar: `id-ID-GadisNeural`, Uki: `id-ID-ArdiNeural`).
3. **Rig & Animasi Karakter**: Karakter ber-bone dari *Character Builder* otomatis ditempatkan dan diberi animasi gerak bicara (angguk kepala & gestur tangan).
4. **Export MP4 Otomatis**: Headless renderer merekam kanvas dan FFmpeg menggabungkan audio menjadi video MP4 di folder `daily_output/`.

### 1. Prasyarat Tambahan
```bash
# Dependensi TTS Python:
pip install -r worker/requirements.txt   # (Pillow + edge-tts)

# Dependensi headless runner:
cd tools && npm install                  # (puppeteer-core)
```

### 2. Cara Menjalankan

#### A. Lewat Tampilan Web (UI)
1. Buka browser: `http://localhost:5173/`
2. Di halaman daftar proyek, klik tombol ungu **🎬 Kartun Harian (Auto)**.
3. Masukkan topik (atau kosongkan untuk cerita acak AI), pilih karakter (Sekar & Uki), lalu klik **⚡ Buat Film Kartun Sekarang**.
4. Setelah selesai, tonton langsung di studio atau unduh video MP4.

#### B. 1-Klik dari Windows (Batch Script)
Cukup klik ganda file:
```text
generate_daily.bat
```
Script ini otomatis memastikan server aktif, membuat kartun hari ini, me-render video MP4, dan langsung membuka folder `daily_output/`.

#### C. Lewat Terminal CLI (Artisan)
```bash
cd backend

# Membuat naskah, suara TTS, dan adegan proyek
php artisan cartoon:generate-daily --topic="Tips Semangat Pagi"

# Membuat kartun sekaligus render dan export MP4
php artisan cartoon:generate-daily --topic="Misteri Kucing Sekolah" --export
```

#### D. Otomatisasi Terjadwal Harian (Setiap Pagi Jam 07:00)
Perintah sudah terdaftar di `backend/routes/console.php`:
```php
Schedule::command('cartoon:generate-daily --export')->dailyAt('07:00')->withoutOverlapping();
```
Untuk mengaktifkan di Windows tanpa membuka aplikasi:
1. Buka **Windows Task Scheduler** (`taskschd.msc`).
2. Buat tugas baru (*Create Basic Task*) harian jam `07:00`.
3. Set aksi (*Action*): jalankan program `generate_daily.bat`.
4. Video MP4 setiap hari akan otomatis tersimpan di folder `daily_output/kartun_YYYY-MM-DD_project_X.mp4`.


## Konfigurasi

Lengkap (termasuk produksi) di [docs/DEPLOY.md](docs/DEPLOY.md). Yang paling sering dipakai di `backend/.env`:

| Key | Fungsi |
|---|---|
| `DB_CONNECTION` | `sqlite` (dev) atau `pgsql` |
| `QUEUE_CONNECTION`, `CACHE_STORE`, `REDIS_CLIENT=predis` | `database`/`file` (dev) atau `redis` |
| `FFMPEG_BIN`, `FFPROBE_BIN`, `PYTHON_BIN`, `WORKER_DIR` | alat eksternal |
| `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` | 9router (`http://127.0.0.1:20128/v1`); kunci dari dashboard-nya. Kosong = fitur AI mati dengan rapi |
| `REGISTRATION_ENABLED`, `SANCTUM_EXPIRATION`, `TRUSTED_PROXIES`, `CORS_ALLOWED_ORIGINS` | akses & keamanan |

Frontend: `VITE_API_URL` (default `/api`), `VITE_API_PROXY` (target proxy dev).

## Struktur data

- `users`, `personal_access_tokens`
- `projects` — `document` JSON **schema 2**: `settings{width,height,fps}`, `scenes[{id,name,duration,background,transition,layers[]}]`, `audio[{id,assetId,name,start,volume}]`; `revision` untuk konkurensi. Dokumen schema 1 (satu scene) dimigrasi otomatis saat dibaca/disimpan.
- `project_versions` — snapshot (maks. 30 per project)
- `assets` — gambar & audio (`path` di storage, `width/height` atau `duration`)
- `export_jobs` — status, format, ukuran, FPS, klip audio, path hasil
- `ai_jobs` — Prompt-to-Motion & AI pisahkan bagian (status, input, hasil/galat)
- tabel infrastruktur Laravel (`jobs`, `cache`, …)

## API (prefix `/api`, Bearer token kecuali disebut)

`GET auth/options` (publik) · `POST auth/register|login|logout`, `GET auth/me` · `GET/POST projects`, `GET/PUT/DELETE projects/{id}`, `POST projects/{id}/duplicate`, `GET projects/{id}/versions`, `POST projects/{id}/versions/{n}/restore` · `GET/POST projects/{id}/assets`, `POST projects/{id}/audio`, `DELETE assets/{id}`, `POST assets/{id}/process` (crop, resize, remove_bg, sketch, trim, enhance), `GET assets/{id}/file` (URL bertanda tangan) · `GET ai/status`, `POST projects/{id}/ai/motion`, `POST assets/{id}/ai/segment`, `POST ai/jobs/{id}/segment/apply`, `GET ai/jobs/{id}` · `GET/POST projects/{id}/exports`, `GET exports/{id}`, `GET exports/{id}/download` · `GET /up` (health).

## Pengujian

```bash
cd backend  && php artisan test                         # 89 test (SQLite/MySQL; FFmpeg & Pillow nyata)
cd frontend && npx tsc -b && npm test && npm run build  # 210 unit test (rig, pose/gerakan, ekspresi, kamera, lip-sync, skrip, store, geometri Builder, ...)
```

Selain itu, alur nyata diuji dengan Chrome headless (daftar → upload → edit → rig → animasi → scene/transisi/audio → export → verifikasi isi video dengan ffprobe/Pillow) pada dev server, dan pada tumpukan produksi: **nginx → FastCGI → PostgreSQL + Redis**. Detail dan batasan (Docker belum dijalankan) ada di [docs/DEPLOY.md](docs/DEPLOY.md).

Uji browser (puppeteer + Edge headless, skrip tidak ada di repo) untuk Alat film: 48 pemeriksaan (rig bertanda, pose, ekspresi, gerakan, kamera, efek, teks, properti, audio/mikrofon, lip-sync, simpan & muat ulang, papan cerita, export film) dan 9 pemeriksaan dengan aset PNG asli.

## Arsitektur singkat

- `frontend/src/store.ts` — sumber kebenaran dokumen (tampilan scene aktif + project), undo/redo per scene, autosave berkonkurensi; `canvas.ts` — renderer PixiJS imperatif (scene graph bertingkat = FK; transisi sebagai overlay/offset); `anim.ts` — evaluasi keyframe, IK analitik, preset, rencana AI; `movie.ts` — migrasi dokumen, pemetaan waktu film → scene, efek transisi; `retouch.ts`/`rigparts.ts` — operasi piksel & komposisi bagian (murni, diuji unit).
- `backend/app/Services` — `MotionPlanner`, `SegmentPlanner` (AI + sanitasi), `AiClient`, `ImageWorker`; `Jobs/ProcessExport` (FFmpeg + campuran audio), `ProcessAiMotion`, `ProcessAiSegment`.
- Semua hasil AI diperlakukan sebagai **usulan** yang divalidasi di server dan ditinjau pengguna; tidak ada simulasi fitur yang tidak tersedia.

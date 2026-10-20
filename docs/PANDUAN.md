# Panduan pengguna

Panduan singkat untuk membuat animasi dari sketsa sampai video. Semua langkah juga tersedia lewat tombol **?** (tur & pintasan) di editor.

## 1. Mulai
- Daftar/masuk, lalu **Buat project** atau **Coba contoh karakter** (karakter ber-rig yang melambai — cara tercepat untuk melihat hierarki, bone, dan keyframe).
- Project tersimpan otomatis. **Simpan versi** (Ctrl+S) membuat titik kembali di **Riwayat**.

## 2. Gambar
- **Import gambar** (JPG/PNG/WebP) atau seret file ke kanvas. Foto sketsa di kertas: klik ✎ pada aset → *Sketsa kertas/foto → garis transparan*, atur kekuatan, **Proses**, lalu *Tambah sebagai layer* atau *Ganti gambar layer terpilih*.
- Latar polos: *Hapus latar polos (dari tepi)*. Lubang di dalam objek tidak ikut terhapus.
- Hasil selalu menjadi aset baru; gambar asli tidak berubah.

## 3. Pisahkan karakter menjadi bagian
1. Pilih layer gambar karakter → **✨ AI pisahkan bagian…** → *Analisis dengan AI*.
2. **Periksa dan koreksi** — model sering meleset pada koordinat: geser kotak, tarik sudut kanan-bawah, geser titik sendi (bulatan), ganti nama/induk, hapus atau tambah bagian, *⤢ Rapatkan* untuk menyusutkan kotak ke isi gambar.
3. **Potong & buat layer**. Hasilnya: layer per bagian, berhierarki (badan → lengan atas → lengan bawah), pivot di sendi.
4. Piksel tetangga yang ikut terpotong (mis. bagian badan di potongan lengan): **🖌 Retouch** → *Hapus*; ujung yang terpotong: *Lukis* atau *Perluas kanvas*.

## 4. Rig
- **+ Bone** membuat bone (anak dari bone terpilih bila ada). Pilih layer → *Parent (FK)* untuk menempelkannya; posisi di layar tidak bergeser.
- Putar parent, anak ikut. Seret titik oranye untuk memindah **pivot**; atur pivot *sebelum* membuat keyframe.
- **IK 2-bone**: pilih bone ujung rantai → *Aktifkan IK 2-bone*; gerakkan atau beri keyframe pada *Target IK*.
- Bone hanya terlihat di editor dan tidak ikut export.

## 5. Animasi
- Aktifkan **Auto-key**, pindah frame, ubah posisi/rotasi/skala → keyframe terbuat. Atau klik ◆ di samping properti. Geser/hapus key di timeline; atur easing per key.
- **Preset gerak…** menerapkan gerak siap pakai ke layer terpilih (untuk siklus jalan: *Ayun* pada kaki dengan fase 0° dan 180°).
- **✨ AI Gerak**: tulis perintah ("lengan melambai, loop 2 detik"); tinjau ringkasan track, lalu *Terapkan*. Hasilnya keyframe biasa; Ctrl+Z membatalkannya.
- **Onion skin** menampilkan frame sebelum (merah) dan sesudah (hijau).

## 6. Scene, transisi, audio
- **+ Scene** menambah scene setelah scene aktif; ⧉ menggandakan, ◀ ▶ mengurutkan, 🗑 menghapus.
- Tanpa layer terpilih, panel kanan menampilkan nama, durasi, latar scene, dan **transisi ke scene berikutnya** (fade hitam/putih, geser kiri/kanan).
- **+ Audio** (panel kiri) mengunggah klip; atur *Mulai* dan *Volume*. **▶ Putar film** memutar semua scene + transisi + audio.

## 3b. Ekspor karakter sebagai SVG (vektor)
Di Character Builder klik **SVG (vektor)**. File SVG berisi satu layer per bagian karakter, jadi bisa dibuka dan diedit di Inkscape, Illustrator, Figma, atau CorelDRAW (simpan sebagai PDF/EPS/AI dari sana bila perlu).
- Bagian yang memang SVG tetap vektor asli. Bagian yang berupa gambar PNG: pilih **Vektor penuh** (dilacak menjadi bentuk berwarna; hasilnya mirip tetapi bukan identik, gradasi halus menjadi pita warna) atau **Sematkan PNG** (persis, tetapi bagian itu tetap bukan vektor).
- Naikkan *Detail pelacakan* untuk hasil lebih mirip (file lebih besar dan lebih lama). Centang ZIP untuk mendapat juga satu SVG per bagian.

## 6b. Alat film (panel kanan, di bawah properti)
Pilih bagian karakter yang disisipkan **dengan bone** (Karakter → *Sisipkan + bone*), lalu:
- **Karakter**: *Pose* di playhead; *Gerakan* (berjalan, berlari, melambai…) mulai dari playhead; *Ekspresi* (jika karakter menyimpan ekspresi di Builder); *Lip-sync* dari klip suara (mengikuti volume, bukan huruf).
- **Kamera**: ubah angka (x, y, zoom, putar) untuk memasang keyframe, atau pakai preset zoom/geser/getar/fokus. Centang *Lihat lewat kamera* untuk melihatnya saat menyunting; Putar film dan Export selalu memakainya.
- **Efek**: waktu (pagi/sore/malam), hujan, salju, vignette.
- **Teks**: balon dialog, judul, subtitle. **Properti**: benda dari library, *Pegang di tangan*, *Bayangan di kaki*.
- **Audio** (panel kiri): *● Rekam suara*, *+ Efek* (efek suara di playhead), jenis klip, fade in/out.
- **Papan cerita** (toolbar): catatan scene dan dialog; *Buat dari skrip* membuat scene lengkap (latar, karakter, subtitle).

## 7. Export
**Export** → pilih MP4 / WebM / PNG sequence, resolusi, FPS, dan *Seluruh film* atau *Scene aktif*. Kanvas direkam di browser selama durasi film — **biarkan tab terbuka**. Server lalu mengonversi dan mencampur audio; unduh dari daftar hasil.

## Pintasan
Ctrl+Z / Ctrl+Y undo/redo · Ctrl+S simpan versi · Spasi play/pause · Delete hapus layer/keyframe · Panah (+Shift) geser layer · Esc tutup dialog.

## Yang belum ada
Image-to-Video dan Video-to-Motion tidak tersedia (gateway AI tidak punya model untuk itu). Lip-sync hanya mengikuti **volume** suara (mulut buka-tutup), bukan bentuk huruf. Efek suara adalah nada sintetis sederhana, bukan rekaman. Latar buatan AI menunggu provider gambar yang aktif.

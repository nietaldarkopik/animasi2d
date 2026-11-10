# Panduan Integrasi Karakter 2.5D & Blender MCP di `animasi2d`

Struktur karakter modular berbasis kartu 2.5D dari `BututDesign` kini telah diimplementasikan penuh di project **`animasi2d`** (`C:\wamp64\www\animasi2d`). Karakter dapat digerakkan secara otomatis oleh Blender menggunakan **Blender MCP Socket (Port 9876)** atau mode **Blender CLI Headless**.

---

## 1. Struktur Folder Karakter (`C:\wamp64\www\animasi2d\karakter`)

Format karakter tersimpan dalam folder masing-masing:
```text
C:\wamp64\www\animasi2d\karakter\
├── uki\                      # Karakter Uki (SMK Informatika)
│   ├── character.json        # Metadata koordinat, titik pasang, pose, ekspresi
│   ├── uki_badan_<pose>.png  # 9 Pose badan
│   ├── uki_kepala_<exp>.png  # 10 Ekspresi wajah
│   ├── uki_mulut_<vokal>.png # 5 Bentuk mulut vokal (a, i, u, e, o)
│   └── uki_kelopak.png       # Overlay kelopak mata untuk kedip
├── arum\                     # Karakter Arum (Siswi SMA matematika, rambut ungu)
├── seni\                     # Karakter Seni (Siswi SMA fisika, rambut bob)
├── riska\                    # Karakter Riska (Siswi SMA berjilbab putih)
├── _template\                # Template kartun 600x1000
├── _template_anime\          # Template anime 800x1400 / 400x400
├── DAFTAR_GAMBAR.txt         # Panduan gambar standar
└── DAFTAR_GAMBAR_ANIME.txt   # Panduan gambar gaya anime
```

### Spesifikasi Aset Gambar (Transparan PNG)
1. **Badan (`badan_<pose>.png`)**: Ukuran 800×1400 px. Titik tumpu kaki di `y=1375`, pusat di `x=400`.
   - **9 Pose**: `diam`, `tunjuk`, `angkat`, `lambai`, `pinggang`, `pelipis`, `dagu`, `jempol`, `silang`.
2. **Kepala (`kepala_<ekspresi>.png`)**: Ukuran 400×400 px, ditempel pada koordinat leher badan.
   - **10 Ekspresi**: `netral`, `senang`, `kaget`, `sinis`, `sedih`, `marah`, `bingung`, `mengantuk`, `sombong`, `malu`.
3. **Mulut (`mulut_<bentuk>.png`)**: Ukuran 120×80 px, ditempel pada pusat mulut kepala `(198, 244)`.
   - **5 Bentuk Vokal**: `a`, `i`, `u`, `e`, `o`.
4. **Kelopak (`kelopak.png`)**: Ukuran 400×400 px (overlay kedip mata).

---

## 2. Pustaka dan Alat di `tools/blender/`

| File | Fungsi |
|---|---|
| `char_lib.py` | Pustaka Blender EEVEE universal untuk merakit karakter (Plane ber-UV, material Toon Shader, track to camera, pernapasan idle sinusoidal, kedip acak otomatis, pop animasi transisi, dan lip-sync 'on twos'). |
| `blender_bridge.py` | Jembatan pengiriman kode Python ke Blender. Otomatis mencoba port socket TCP `localhost:9876` (Blender MCP). Jika Blender belum dibuka, otomatis fallback menggunakan Blender Background CLI. |
| `script_to_blender.py` | Engine penerjemah naskah/prompt menjadi keyframe animasi, setup panggung, kamera sinematik, tata cahaya toon, dan rendering. |
| `run_blender_anim.bat` | Script batch Windows siap klik untuk menjalankan animasi. |

---

## 3. Cara Menggerakkan Karakter

### A. Melalui Web UI (Frontend GUI)
Kini Anda dapat langsung mengontrol dan melihat hasil render secara visual di antarmuka web browser:
1. Buka browser di `http://localhost:5173/` (setelah menjalankan `start.bat`).
2. Klik tab menu **`🎬 Blender 2.5D`** di navigasi atas atau tombol oranye **`🎨 Blender 2.5D Studio`** di halaman utama Project.
3. Di dalam GUI Studio:
   - **Tab Gerakkan & Render Animasi**:
     - Pilih **Mode Teks Prompt** (bisa klik contoh preset dialog cepat) atau **Mode File Naskah Cerita** (dropdown dari folder `naskah/`).
     - Centang bila ingin me-render video MP4 penuh.
     - Klik tombol **`🎬 Gerakkan & Render di Blender`**.
     - Hasil render (JPEG preview / MP4 video) langsung ditampilkan di layar, dan tersedia tombol **`📦 Download .blend`** untuk membuka adegan di Blender.
   - **Tab Karakter 2.5D**: Menampilkan galeri visual kartu karakter (Uki, Arum, Seni, Riska), preview wajah, daftar pose, dan ekspresi.
   - **Tab Galeri Hasil Output**: Mengakses dan mengunduh seluruh file `.blend`, `.jpg`, dan `.mp4` hasil render sebelumnya.

### B. Melalui Perintah Teks / Prompt (CLI)

Anda dapat menggerakkan karakter cukup dengan menuliskan deskripsi aksi atau percakapan:

```bash
# Contoh 1: Dialog 2 karakter sekaligus (Uki & Arum)
python tools/blender/script_to_blender.py --prompt="Arum: Hah?! Benarkah nilaiku lulus? | Uki: Benar, selamat ya! (Uki tersenyum dan melambai)" --save-blend="output/dialog.blend" --render-still="output/dialog.jpg"

# Contoh 2: Deskripsi aksi
python tools/blender/script_to_blender.py --prompt="Arum kaget melihat Uki melambaikan tangan" --save-blend="output/aksi.blend"
```

### B. Melalui File Naskah (JSON)

Gunakan file naskah yang sudah ada di folder `naskah/`:

```bash
python tools/blender/script_to_blender.py --script="naskah/uki-kesiangan.json" --save-blend="output/naskah.blend" --render-still="output/preview_naskah.jpg"
```

Untuk me-render langsung video utuh format MP4:
```bash
python tools/blender/script_to_blender.py --script="naskah/uki-kesiangan.json" --render-video="output/video_naskah.mp4"
```

### C. Melalui Artisan Command (Laravel)

Dari folder `backend`:
```bash
php artisan cartoon:blender --script="naskah/uki-kesiangan.json" --save-blend="tools/blender/output/hasil.blend"
php artisan cartoon:blender --prompt="Uki: Halo semuanya, selamat datang! (Uki melambai)" --render-still="tools/blender/output/halo.jpg"
```

### D. Melalui Blender MCP Interaktif (Live Socket)

1. Buka Blender 5.2.
2. Pastikan add-on **MCP** aktif di *Edit > Preferences > Add-ons* (listening di `localhost:9876`).
3. Jalankan perintah di atas, maka script langsung dieksekusi secara real-time di dalam jendela Blender yang sedang terbuka tanpa perlu membuka file secara manual!


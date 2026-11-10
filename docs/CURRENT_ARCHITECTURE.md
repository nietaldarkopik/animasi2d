# Current Architecture Audit — Cartoon Maker AI & Blender MCP

**Tanggal Audit:** 10 November 2026  
**Project:** Cartoon Maker AI (`C:\wamp64\www\animasi2d`)  
**Lingkungan Eksekusi:** Windows 10/11, Intel Core i5-8400, 16 GB RAM, NVIDIA GTX 1660 Super, Blender 5.2.3 LTS.

---

## 1. Komponen Aplikasi

### A. Frontend (`frontend/`)
- **Teknologi:** React 18, TypeScript, Vite, PixiJS.
- **Port:** `5173` (Vite dev server).
- **Halaman:**
  - `ProjectsPage` (`/`): Daftar proyek 2D, buat proyek, tombol Kartun Harian & Blender 2.5D Studio.
  - `BuilderPage` (`/builder`): Character Builder 2D SVG/PNG per bagian (wajah, rambut, mata, mulut, baju, celana/rok, sepatu).
  - `StoriesPage` (`/stories`) & `StoryPage` (`/stories/:id`): Manajemen alur cerita berseri, daftar episode, generate naskah AI, dan tombol **"Buat film sekarang"** (`produce`).
  - `LibraryPage` (`/library`): Manajemen aset latar dan bagian karakter.
  - `BlenderPage` (`/blender`): Studio GUI untuk mengontrol Blender MCP, preview karakter 2.5D, prompt/naskah animator, dan download hasil render.
  - `EditorPage` (`/projects/:id`): Canvas PixiJS timeline, bone rigging 2D, recording canvas ke WebM/MP4.

### B. Backend (`backend/`)
- **Teknologi:** Laravel 13, Sanctum auth, MySQL 8 (InnoDB).
- **Port:** `8010` (PHP artisan serve).
- **Entitas / Database:**
  - `users`: Pemilik proyek dan cerita.
  - `projects`: Menyimpan dokumen JSON scene (`scenes`, `layers`, `keyframes`, `audio`).
  - `story_series`: Judul cerita berseri, premis, daftar karakter (`character_ids`), suara narasi & dialog.
  - `story_episodes`: Nomor episode, judul, sinopsis, naskah (`script`), status (`draft`, `queued`, `producing`, `done`, `failed`), project_id, output_path.
- **Service Utama:**
  - `DailyCartoonService`: Memproses naskah, generate audio Edge-TTS (`id-ID-ArdiNeural`, `id-ID-GadisNeural`), menyusun timing scene, dan menyisipkan layer karakter 2D & balon dialog.
  - `StoryWriter`: AI gateway (kompatibel OpenAI / 9router) untuk menyusun naskah berseri.
  - `FilmPipeline`: Menjalankan runner headless Chrome (`tools/daily_cartoon_runner.js`) untuk merekam canvas PixiJS ke MP4, dan opsional publish ke YouTube via clipper.
  - `BlenderController`: Endpoint API `/api/blender/*` untuk status MCP port 9876, metadata karakter, generate animasi naskah/prompt, dan menyajikan file output.

### C. Blender MCP & Alat 2.5D (`tools/blender/`)
- **Blender:** 5.2.3 LTS di `C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`.
- **Add-on MCP:** Blender Lab MCP Extension aktif di `localhost:9876` (TCP null-byte delimited JSON).
- **`char_lib.py`:** Pustaka universal merakit kartu karakter 2.5D (Uki, Arum, Seni, Riska) dengan material Toon Shader, track-to-camera, idle napas & goyang kepala, kedip acak otomatis, pop transisi, dan lip-sync vokal.
- **`blender_bridge.py`:** Socket client ke port 9876 dengan fallback ke Blender CLI Headless.
- **`script_to_blender.py`:** Parser naskah/prompt ke keyframe animasi karakter, kamera, dan panggung dasar.

---

## 2. Analisis Masalah Saat Ini

Saat memanggil endpoint `POST /api/story/episodes/{id}/produce`:
1. `StoryController::produce` memicu job `ProduceEpisode`.
2. `ProduceEpisode` saat ini memanggil `FilmPipeline::export`, yang mengeksekusi `daily_cartoon_runner.js` melalui Chromium Headless.
3. Di editor 2D, adegan hanya merender karakter tanpa environment 3D, tanpa variasi kamera sinematik, tanpa pencahayaan dramatis, dan tanpa objek interaktif (props).
4. Hasil rekaman video tampak datar (flat) karena dunia 3D belum dibangun oleh Blender MCP secara terstruktur dari naskah.

---

## 3. Titik Integrasi yang Diperlukan
- Menghubungkan alur naskah episode ke **AI Scene Director** & **Blender MCP Scene Builder**.
- Membangun environment 3D modular (interior kamar tidur, ruang tamu, dapur, kamar mandi, kelas, jalan raya, taman) dan properti prosedural lengkap.
- Mengimplementasikan Cinematography Engine (shot sizes, camera movements, tracking, depth of field).
- Memastikan kesinambungan tempat dan properti (Scene Continuity) antarshot.


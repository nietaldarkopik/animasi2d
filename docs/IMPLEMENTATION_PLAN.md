# Implementation Plan — Autonomous Cartoon Production System

**Tujuan:** Membangun sistem produksi kartun 2.5D di dunia 3D otomatis menggunakan AI Director dan Blender MCP untuk aplikasi Cartoon Maker AI.

---

## Rencana Fase Implementasi

### Phase 1 — Audit & Arsitektur (Selesai)
- [x] Audit struktur folder, dependency, backend, frontend, database, dan task scheduler.
- [x] Dokumentasi `docs/CURRENT_ARCHITECTURE.md`.
- [x] Dokumentasi `docs/BLENDER_MCP_CAPABILITIES.md`.
- [x] Dokumentasi `docs/IMPLEMENTATION_PLAN.md`.

---

### Phase 2 — Scene Planner & AI Director (`tools/blender/director/`)
- [ ] **Data Schema:** Struktur JSON terstandar untuk Storyboard, Scene, Shots, Camera, Props, dan Environment.
- [ ] **AI Director (`scene_director.py`):**
  - Menganalisis naskah cerita kata demi kata, mendeteksi lokasi, waktu, suasana (mood), karakter yang bicara/mendengar, aksi, dan emosi.
  - Memecah naskah menjadi adegan (scenes) dan shot sinematik (establishing wide, medium two-shot, over-the-shoulder, reaction close-up).
- [ ] **Visual Storyboard Generator (`storyboard_generator.py`):**
  - Menghasilkan daftar shot lengkap dengan ID, durasi, timing frame, kamera, properti, dan pencahayaan.

---

### Phase 3 — Environment Generator (`tools/blender/environment/`)
- [ ] **Room Builder (`room_builder.py`):**
  - Membangun geometri 3D interior ber-dimensi presisi: dinding, lantai, plafon, pintu, jendela, dan koridor.
- [ ] **Presets Interior:**
  - Kamar tidur (`bedroom`).
  - Ruang tamu (`living_room`).
  - Dapur (`kitchen`).
  - Kamar mandi (`bathroom`).
  - Ruang kelas (`classroom`).
  - Koridor / Lorong (`corridor`).
- [ ] **Presets Exterior & Alam:**
  - Jalan raya / Perumahan (`street`).
  - Halaman sekolah / Gedung (`school_yard`).
  - Taman (`park`).
- [ ] **Lighting Presets (`lighting_presets.py`):**
  - Siang (Day), Pagi (Morning), Sore / Senja (Sunset), Malam / Misteri (Night / Mystery).
- [ ] **Scene Continuity Engine (`continuity.py`):**
  - Menyimpan layout environment dan ID objek agar konsisten di semua shot pada lokasi yang sama.

---

### Phase 4 — Props & Object Generator (`tools/blender/props/`)
- [ ] **Procedural Props Builder (`props_factory.py`):**
  - Geometri 3D parametrik kartun dengan material toon:
    - Furnitur: Lemari, tempat tidur, meja, kursi, sofa.
    - Kamar mandi: Pintu, wastafel, cermin, shower, ember, gayung, handuk, keset, lampu.
    - Dapur: Kompor, wajan, kulkas, piring, gelas, meja makan, radio/ventilasi.
    - Elektronik / Properti Cerita: Mikrofon, speaker, buku, kertas/jimat, jam dinding, koper.
- [ ] **Object Animation:**
  - Pintu membuka/menutup, lampu berkedip, radio bergetar.

---

### Phase 5 — Cinematography Engine (`tools/blender/cinematography/`)
- [ ] **Camera Rig & Motions (`camera_rig.py`):**
  - Shot sizes: Extreme Wide, Wide, Full, Medium Wide, Medium, Medium Close-Up, Close-Up, Extreme Close-Up.
  - Angles: Eye Level, Low Angle, High Angle, Over-the-Shoulder, Dutch Angle.
  - Movements: Static hold, Dolly In, Tracking Follow, Push In, Whip Pan.
- [ ] **Safety & Occlusion Check:**
  - Kamera tidak menembus dinding, karakter tidak terpotong, framing komposisi rule-of-thirds.

---

### Phase 6 — Blender MCP Modular Scene Builder (`tools/blender/core/`)
- [ ] **`scene_manager.py`:** Mengatur pembangunan scene di Blender, memuat environment, props, karakter, kamera, dan keyframing.
- [ ] **`character_adapter.py`:** Jembatan ke `char_lib.py` untuk mengontrol Uki, Arum, Seni, Riska dalam ruang 3D.
- [ ] **Blender MCP Socket Execution:** Mengirim kode terstruktur ke Blender port 9876 atau background CLI.

---

### Phase 7 — UI Frontend (`frontend/src/`)
- [ ] **Panel AI Scene Director & Storyboard Viewer** di halaman Story dan modal Blender.
- [ ] **Environment & Props Selector / Preview.**
- [ ] **Shot Inspector:** Melihat daftar shot, angle kamera, dan karakter yang tampil.

---

### Phase 8 — Integrasi Pipeline (`backend/`)
- [ ] Hubungkan `ProduceEpisode` dan `StoryController::produce` agar otomatis memanfaatkan Blender MCP Scene Builder untuk membangun environment, props, kamera, dan merender video film lengkap.
- [ ] Dukungan profil produksi: Short-form (9:16) dan Long-form (16:9).

---

### Phase 9 — Verifikasi & Testing
- [ ] Uji skenario lengkap episode 2 "Les Vokal Gaib" & skenario pengujian "Suara di Kamar Mandi" (Seni & Arum, kamar mandi, wastafel, shower, cermin, pintu, ember, gayung).
- [ ] Verifikasi render JPEG preview dan MP4 video.


# Blender MCP Capabilities & Execution Specifications

**Versi Blender:** Blender 5.2.3 LTS  
**Lokasi Executable:** `C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`  
**Host & Port MCP:** `localhost:9876` (TCP Socket Bridge)  
**Hardware Target:** NVIDIA GTX 1660 Super (6 GB VRAM), 16 GB System RAM, Intel Core i5-8400 (6 Cores).

---

## 1. Protokol Komunikasi Blender MCP

Add-on Blender MCP (`mcp_to_blender_server.py`) mendengarkan di `localhost:9876`.
- **Format Request:** JSON diakhiri karakter null (`\0`):
  ```json
  {"type": "execute", "code": "<python_code>", "strict_json": false}\0
  ```
- **Format Response:** JSON diakhiri karakter null (`\0`):
  ```json
  {"status": "ok", "result": {...}, "stdout": "...", "stderr": "..."}\0
  ```
- **Karakteristik & Batasan Add-on:**
  - `weak_sandbox.py` memblokir perintah berisiko tinggi seperti `bpy.ops.wm.read_factory_settings(use_empty=True)`. Sebagai gantinya gunakan `bpy.ops.wm.read_homefile(use_empty=True, use_factory_startup=True)` atau pembersihan objek scene secara langsung.
  - Non-blocking socket loop berjalan di main-thread timer Blender (`TIMER_INTERVAL_ACTIVE = 0.05`).
  - Pembuatan objek mesh paling stabil menggunakan API langsung `bpy.data.meshes.new` dan `bpy.data.objects.new` daripada `bpy.ops.mesh.*` untuk menghindari ketergantungan konteks viewport.

---

## 2. Kemampuan Rendering & Shader (EEVEE Next)

### A. Toon Shading (2.5D Kartun di Dunia 3D)
- **Karakter Card 2D:**
  - ShaderNodeBsdfDiffuse → ShaderNodeShaderToRGB → ColorRamp (CONSTANT) → Mix (MULTIPLY tekstur PNG) → Emission (1.0) → MixShader dengan Transparent BSDF berdasarkan Alpha PNG.
  - Karakter menerima cahaya lampu adegan dan menghasilkan bayangan kontak di lantai.
- **Environment & Props 3D:**
  - Principled BSDF dengan palet warna datar jenuh (saturated flat color) + garis outline atau toon ramp.
  - Pencahayaan: Key Sun light hangat (50° pitch, -25° yaw) + Ambient Sky soft blue/purple fill + Light pools jendela/lampu meja.

### B. Cinematography & Kamera
- Kamera 35mm / 42mm / 50mm / 85mm.
- Constraints: `LOCKED_TRACK` / `TRACK_TO` ke karakter atau empty target.
- Gerak kamera: Dolly in, tracking follow, over-the-shoulder, push-in, low angle, bird's eye view.
- Keyframing transformasi kamera: Lokasi dan rotasi ber-easing (*ease-out burst* atau *smootherstep*).

---

## 3. Spesifikasi Render & Optimasi GPU

- **Resolusi Produksi:**
  - Short-form: 1080×1920 (9:16 portrait).
  - Long-form: 1280×720 atau 1920×1080 (16:9 landscape).
- **Sampel EEVEE:** 8–16 sampel (cukup untuk toon kartun, sangat cepat ~0.08–0.25 detik/frame di GTX 1660 Super).
- **Format Output:**
  - Pratinjau: JPEG (quality 90).
  - Video Final: FFMPEG H.264 / AAC MP4.
- **Strategi Batch Render:**
  - Jika render video panjang, gunakan background detached process (`blender.exe -b <file.blend> -a`) agar tidak membebani UI Blender interaktif.


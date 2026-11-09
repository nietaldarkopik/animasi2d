# Sistem desain karakter (Character Builder)

Dokumen ini memetakan spesifikasi "Modular Character Design System" ke kode yang ada. Intinya: **template yang menentukan, AI/unggahan hanya mengisi di dalam batasnya, dan aplikasi memeriksa hasilnya sebelum masuk library**.

## Yang sudah ada

| Bagian spesifikasi | Wujud di proyek | Berkas |
|---|---|---|
| 3–4 Template master, sistem koordinat | Satu template: `anime-v1` (anime SMA). Kanvas 400×800 unit (PNG 800×1600), garis tengah x=200, tanah y=799. Landmark bernama (`head.neck_anchor`, bahu, siku, pergelangan, pinggang, pinggul, lutut, pergelangan kaki). Untuk tiap slot: titik jangkar, lebar maksimum, dan **per arah**: area yang boleh ditempati seni + rentang lebar/tinggi — diukur dari bagian yang sudah disetujui | `backend/resources/design/anime-v1.json`, `DesignTemplate.php`, `SlotTemplate.php`, `frontend/src/builder/spec.ts` (tes menjaga ketiganya sama) |
| 5 Empat arah | Tiap bagian punya arah `front/right/left/back` (`meta.view`). Badan kit (leher/kaki, atasan+lengan, bawahan, sepatu) ada untuk keempat arah; kepala belakang dari 8 gambar rambut belakang. Tombol arah di Builder menukar bagian yang punya pasangan (`meta.set`) | `facing.ts`, `ImportKitViews`, `ImportBackHeads` |
| 6 Kategori | Slot: rambut belakang/depan, kerudung, wajah, mata, alis, mulut, kacamata, topi, headphone, badan, torso, lengan kiri/kanan, atasan, bawahan, sepatu (kiri/kanan), tas, aksesori | kategori di database |
| 7 Metadata kompatibilitas | Per aset: kategori, arah, set (pasangan antar-arah), template, hash (versi isi), `mirror` (satu sepatu dicerminkan), laporan validasi, status. Karakter menyimpan **id + hash** tiap bagian; aset yang diganti diarsipkan agar versi lama tetap utuh | `LibraryAsset::present()`, `BuilderCharacterController` |
| 8 Titik pasang | **Titik pasang bernama per bagian dan per arah**: tiap bagian raster diukur dari gambarnya sendiri (`head.top_anchor`, `head.neck_anchor`, `face.left_eye_anchor`/`right_eye_anchor`, `face.left_brow_anchor`, `face.mouth_anchor`, `torso.neck_anchor`, `torso.waist_anchor`, `arm.shoulder_anchor`, `foot.ankle_anchor`, …) dan disimpan di `meta.anchors`; template menyimpan posisi yang diharapkan (median bagian yang disetujui, per slot dan arah). Bagian wajah (atas kepala, mata, alis, mulut, kacamata) **dibandingkan** dengan template (peringatan ≥ 14 unit, error ≥ 40, pesan memuat berapa unit harus digeser) dan **otomatis digeser** saat dipilih di Builder (`align`; Reset posisi kembali ke posisi itu). Lainnya (rambut, baju, lengan, leher wajah) berbeda menurut desain, bukan karena salah, jadi tidak dipaksa ke satu angka. Bagian ditukar tanpa resize karena semua dipas ke bingkai slot (`library:conform`); kepala dipasang ke leher badan kit (`headFit`). Ukur ulang template: `php artisan design:measure`; ukur bagian lama: `php artisan library:anchors` | `AnchorExtractor.php`, `MeasureDesignTemplate.php`, `MeasureLibraryAnchors.php`, `align.ts`, `SlotTemplate::conform`, `fitHead.ts` |
| 7 (lanjutan) **Keluarga desain** | Tiap bagian punya `meta.family`: `male` / `female` (lembar v2), `kit-l1` / `kit-p` / `kit-p2` / `kit-p3` (badan kit), `legacy` (lembar pertama), `general` — ditebak dari nama (`php artisan library:families`), atau dipilih saat mengunggah. Posisi titik pasang yang berbeda **menurut desain** (kerah baju, pinggang bawahan, mata kaki sepatu) hanya dibandingkan dengan bagian sekeluarga yang punya minimal dua contoh terukur (`design:measure` menyimpan median per keluarga); keluarga `general`/`legacy` mencampur desain yang tak terkait sehingga tidak dipakai. Matriks keluarga mana yang cocok digabung ada di template (`families`, endpoint `GET /design/template`); Builder menampilkan **catatan kompatibilitas** (tidak memblokir) bila satu karakter memakai bagian dari keluarga yang tak cocok, mis. wajah perempuan dengan rambut laki-laki. Sepatu, kacamata, topi, tas tidak dihitung (dipakai siapa saja). Pakaian/sepatu hanya diluruskan naik-turun | `DesignFamily.php`, `LabelLibraryFamilies.php`, `DesignController.php`, `compat.ts` |
| 9 Pakaian & oklusi | Urutan lapisan per slot (z), badan telanjang berhenti di ujung baju bila memakai rok, lengan baju terpisah dari lengan | `rigRender.ts` |
| 11 Aturan pembuatan AI | Prompt memakai master style tetap + parameter karakter/bagian/arah/bingkai slot, hanya bagian yang diminta, latar transparan | `RasterAssetGenerator.php` |
| 12 Validasi aset | Tiap bagian yang diunggah/dibuat AI diperiksa: kanvas standar, ada transparansi, tidak kosong, seni di dalam area slot-arah, ukuran, arah dikenal, duplikat. **Yang melanggar tidak disetujui otomatis** (status *pending* + laporan; pembuat bisa menyetujui sendiri). Audit seluruh library: `php artisan library:validate`; periksa ulang satu aset: `POST /library/assets/{id}/validate` | `AssetValidator.php`, `ValidateLibraryParts.php`, halaman Library |
| 7 (lanjutan) Penolakan komponen tak cocok | Bagian untuk template lain ditolak server dengan alasan dan daftar pengganti yang cocok; Builder hanya menawarkan bagian yang cocok dengan template karakter | `BuilderCharacterController`, `BuilderPage` |
| 14 Data & versi | Metadata di database, gambar di penyimpanan berkas, karakter mengacu ke id+hash | — |
| 15 Render & ekspor | Render berlapis (PNG transparan, SVG berlapis), tidak diratakan permanen; rig + bone untuk animasi | `render.ts`, `svgExport.ts`, `rigRender.ts` |
| 16 Pengujian | Tes unit/fitur untuk template, validator, kompatibilitas, arah, sepatu, kit, rig (lihat `DesignSystemTest`, `PartFormatTest`, `rigRender.test.ts`, dll.) | `backend/tests`, `frontend/src/**/*.test.ts` |

## Yang belum (jujur)

- **Banyak template**: baru `anime-v1`. Format sudah siap (`resources/design/<id>.json`, `meta.template`, `config.template`), tetapi preset chibi/kartun/semi-realistis belum dibuat dan belum ada gambarnya.
- **Titik pasang untuk semua bagian**: bagian wajah dicocokkan dengan angka seluruh library; kerah baju, pinggang bawahan, dan mata kaki sepatu hanya dengan bagian sekeluarga yang punya dua contoh atau lebih (belum untuk keluarga kit yang tiap slotnya baru punya satu contoh). Leher wajah dan titik lengan tidak dicocokkan (menurut dagu / pose).
- Titik pasang bagian profil/belakang diukur dari contoh yang ada (badan kit); wajah/mata/mulut tampak samping belum punya contoh sehingga belum ada angka templatenya.
- **Kompatibilitas halus**: yang ada baru keluarga desain (matriks dan catatan, tidak memblokir) dan template. Belum ada aturan eksplisit rambut ↔ bentuk kepala, lengan baju ↔ lengan, bentuk sepatu ↔ kaki, atau warna kulit.
- **Arah**: kepala tampak kanan/kiri (wajah, mata, alis, mulut, rambut) belum ada; prompt-nya di `docs/PROMPT_BAGIAN_ARAH.md`. Validator memberi peringatan "belum ada contoh" untuk arah itu.
- **Generasi AI dengan gambar referensi/template** (kondisi gambar, bukan hanya teks) belum ada, dan provider gambar di komputer ini belum mendukung pembuatan gambar. Validasi pascagenerasi sudah ada.
- **Set ekspresi lengkap + fonem lip-sync**: ada 6 ekspresi mulut dan lip-sync berdasar volume, belum fonem.
- **Regresi visual otomatis** (perbandingan gambar) belum ada; pengecekan visual dilakukan manual.
- **Validasi SVG** hanya memeriksa kanvas; posisi/ukuran seni SVG belum diukur.
- **Pengukuran area** memakai bagian yang sudah ada sebagai standar: jadi "lolos" berarti "mirip yang sudah disetujui", bukan "benar secara anatomi".

## Impor avatar VRM

`tools/vrm_import` merender avatar VRM (VRoid) menjadi bagian 2D format standar (800×1600) dari empat arah:

```
cd tools/vrm_import && npm install
node render.mjs ../../master-assets/AvatarSample_M.vrm ../../master-assets/vrm/AvatarSample_M
php artisan design:new vrm-vroid --from=anime-v1      # sekali saja (proporsi VRoid ≠ anime-v1)
php artisan library:import-vrm ../master-assets/vrm/AvatarSample_M --permission="siapa yang mengizinkan" --approve
php artisan design:measure vrm-vroid
```

- Keluarga desain `vrm-<avatar>` dibuat otomatis; hanya cocok dengan dirinya sendiri dan bagian umum.
- Lisensi avatar disalin ke `meta.vrm` tiap aset. Avatar yang melarang modifikasi/redistribusi **ditolak** tanpa `--permission`.
- Kulit dipisah menurut tulang (lengan kiri/kanan, kaki, badan); kulit badan di bawah ujung atasan dimasukkan ke kaki agar tidak tampak hitam di antara baju dan rok. Mulut = kulit sekitar mulut + isi mulut (bukan isi mulut saja).
- Belum ada rig/bone untuk template selain `anime-v1` (karakter VRM dilewati auto-director).

## Bone di karakter (Builder → Bone)

Setiap karakter menyimpan titik sendinya sendiri per arah (`config.rig.<facing>.joints`: leher, bahu/siku/pergelangan, pinggul, pangkal paha/lutut/pergelangan kaki), plus `armWidth` (lebar lengan baju) dan `skirt` (bawahan = rok). Belum diatur → ditebak dari letak & piksel bagian.

"Sisipkan + bone" (dan auto-director) memotong **tiap bagian sendiri-sendiri** di titik itu (`builder/charRig.ts` `planPartPieces`): bagian lengan dipotong melintang di siku & pergelangan; lengan baju diambil dari atasan hanya di sisi luar bahu; celana/badan dipotong di pinggul & lutut; tiap sepatu jadi potongan sendiri; rok utuh di pinggul. Bone dibangun dari titik yang sama (`bonesFromJoints`), jadi berlaku untuk semua template (termasuk VRM). Pemotongan lama dengan kolom tetap dan kit badan (`public/kits`) tidak dipakai lagi.

# Kit badan laki-laki SMA (anime) — kemeja putih lengan pendek & celana panjang abu-abu

Sumber: gambar turnaround dari AI gambar Figma (sumber_figma_turnaround.png) — sudah dengan logo OSIS SMA
di saku kemeja dan celana abu-abu SMA — lalu dipotong per bagian.
Kanvas karakter 400×800 (sama dengan Builder), gambar 2 px per unit. Kepala tidak termasuk.

- parts/<tampak>-<bagian>.png : satu PNG transparan per bagian (depan, kanan, kiri, belakang)
- rig.json : per tampak → bone (sendi, arah, panjang, induk, urutan) + kotak posisi tiap bagian di kanvas

Catatan
- Kepala dari Library perlu diperkecil ±75–80% agar proporsinya pas dengan badan ini.
- "collar" = kerah yang digambar DI ATAS kepala, supaya leher dari aset wajah masuk ke dalam kerah.
- "pelvis" = bagian celana di pinggul (ikut root), paha/betis/sepatu masing-masing ber-bone.
- Tampak samping: lengan/kaki "jauh" = salinan yang digelapkan; tangan jauh tidak ada (tertutup badan).
- Bagian yang tertutup di gambar asli (badan di balik lengan) diisi otomatis.
- Tampak kanan = cermin tampak kiri.

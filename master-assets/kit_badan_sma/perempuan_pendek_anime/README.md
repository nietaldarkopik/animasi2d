# Kit badan perempuan SMA (anime) — lengan pendek & rok pendek (kemeja pelaut)

Sumber: gambar turnaround dari AI gambar Figma (sumber_figma_turnaround.png), lalu dipotong per bagian.
Kanvas karakter 400×800 (sama dengan Builder), gambar 2 px per unit. Kepala tidak termasuk.

- parts/<tampak>-<bagian>.png : satu PNG transparan per bagian (depan, kanan, kiri, belakang)
- rig.json : per tampak → bone (sendi, arah, panjang, induk, urutan) + kotak posisi tiap bagian di kanvas

Catatan
- Kepala dari Library perlu diperkecil ±75% agar proporsinya pas dengan badan ini (badan ±7 kepala).
- "collar" = kerah yang digambar DI ATAS kepala, supaya leher dari aset wajah masuk ke dalam kerah.
- Tampak samping: rok tengah + panel depan/belakang ber-bone (putar ±65% sudut kaki saat jalan).
  Lengan/kaki "jauh" = salinan yang digelapkan; tangan jauh tidak ada (tertutup badan).
- Bagian yang tertutup di gambar asli (badan di balik lengan samping, rok di balik tangan, kaki di balik rok)
  diisi otomatis, jadi terlihat saat bagian depannya bergerak.
- Tampak kanan = cermin tampak kiri.

# Kit badan perempuan SMA — lengan panjang & rok panjang

Kanvas karakter 400×800 (sama dengan Builder), pusat x=200. Kepala TIDAK termasuk: pakai wajah/rambut dari Library
(sambungan leher di y≈212–260, sendi kepala di (200,250)).

| File | Isi |
|---|---|
| depan.svg, kanan.svg, kiri.svg, belakang.svg | satu layer (grup) per bagian rig, bisa dibuka di Inkscape / Figma / Illustrator |
| rig.json | per tampak: daftar bone (sendi, arah, panjang, induk, urutan) + bagian mana menempel di bone mana |

Aturan gambar supaya mudah digerakkan
- Setiap bagian yang berputar (lengan atas, lengan bawah, tangan, paha, betis, sepatu) adalah layer sendiri.
- Sambungan dibuat tumpang tindih dan tanpa garis tepi di potongannya, jadi saat ditekuk tidak terlihat celah/garis.
- Warna utama memakai data-tint (skin, top, bottom, tie, shoe, accent) → bisa diganti dari palet Builder.
- Bayangan = lapisan transparan, jadi tetap benar setelah warna diganti.
- Samping: lengan/kaki "jauh" sedikit lebih gelap dan di belakang badan. Rok panjang = rok tengah (diam di pinggul)
  + panel depan & belakang dengan bone sendiri; putar panel ±60–70% dari sudut kaki saat berjalan.
- Tampak kiri = cermin tampak kanan (saku/badge ikut tercermin).

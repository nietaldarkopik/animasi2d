"""Penggantian warna per wilayah untuk kartu karakter: keluarga warna sumber -> warna tujuan, bayangan tetap terjaga.

Wilayah ditentukan oleh warna sumber (hue untuk warna berwarna; kecerahan untuk hitam/abu/putih), dengan pembatas opsional:
kotak (x0,y0,x1,y1 pada kanvas kelompoknya) dan/atau berkas mask PNG. Alfa tidak pernah diubah.
Batasan jujur: warna hampir tak bersaturasi (rambut hitam, seragam putih/abu) tidak bisa dipisahkan dari garis tepi hanya dengan warna,
beri kotak atau mask.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

import numpy as np
from PIL import Image

CHROMATIC = .12          # saturasi minimum agar sebuah warna dianggap "berwarna"


def hex_to_rgb(s: str) -> tuple[int, int, int]:
    s = s.strip().lstrip('#')
    if len(s) == 3:
        s = ''.join(c * 2 for c in s)
    if not re.fullmatch(r'[0-9a-fA-F]{6}', s):
        raise ValueError(f'warna bukan hex 3/6 digit: {s!r}')
    return int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16)


def rgb_to_hex(rgb) -> str:
    return '#%02x%02x%02x' % tuple(int(round(float(c))) for c in rgb)


def rgb2hsv(a: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """a: (...,3) float 0..1 -> h derajat 0..360, s, v"""
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mx, mn = a.max(-1), a.min(-1)
    d = mx - mn
    safe = np.where(d > 1e-9, d, 1.0)
    h = np.where(mx == r, ((g - b) / safe) % 6, np.where(mx == g, (b - r) / safe + 2, (r - g) / safe + 4)) * 60.0
    h = np.where(d > 1e-9, h, 0.0)
    s = np.where(mx > 1e-9, d / np.where(mx > 1e-9, mx, 1.0), 0.0)
    return h, s, mx


def hsv2rgb(h: np.ndarray, s: np.ndarray, v: np.ndarray) -> np.ndarray:
    c = v * s
    hp = (h % 360.0) / 60.0
    x = c * (1 - np.abs(hp % 2 - 1))
    z = np.zeros_like(c)
    sector = hp.astype(int) % 6
    r = np.choose(sector, [c, x, z, z, x, c])
    g = np.choose(sector, [x, c, c, x, z, z])
    b = np.choose(sector, [z, z, x, c, c, x])
    m = v - c
    return np.stack([r + m, g + m, b + m], -1)


@dataclass
class Region:
    src: tuple[int, int, int]
    dst: tuple[int, int, int]
    tol: float = 25.0                                  # derajat hue (berwarna); juga skala toleransi kecerahan (abu)
    vtol: float = .28                                  # toleransi kecerahan untuk warna berwarna
    box: tuple[int, int, int, int] | None = None
    exclude: tuple = ()                                # kotak pengecualian (x0,y0,x1,y1), boleh banyak
    groups: tuple[str, ...] | None = None              # None = ikut default pemanggil
    mask: str | None = None                            # PNG sekanvas; alfa (atau abu) = bobot

    def describe(self) -> dict:
        d = {'src': rgb_to_hex(self.src), 'dst': rgb_to_hex(self.dst), 'tol': self.tol}
        if self.box: d['box'] = list(self.box)
        if self.exclude: d['not'] = [list(b) for b in self.exclude]
        if self.groups: d['groups'] = list(self.groups)
        if self.mask: d['mask'] = self.mask
        return d

    @property
    def chromatic(self) -> bool:
        return rgb2hsv(np.array(self.src, float) / 255)[1] >= CHROMATIC


def parse_region(text: str, default_tol: float = 25.0) -> Region:
    """'#635674>#2f6bd0[;tol=30][;vtol=.3][;box=0,0,400,260][;not=130,190,270,245][;groups=head,body][;mask=berkas.png]'"""
    head, *opts = text.split(';')
    if '>' not in head:
        raise ValueError(f'format --map salah (pakai SUMBER>TUJUAN): {text!r}')
    a, b = head.split('>', 1)
    r = Region(hex_to_rgb(a), hex_to_rgb(b), default_tol)
    for o in opts:
        k, _, v = o.partition('=')
        k = k.strip()
        if k == 'tol': r.tol = float(v)
        elif k == 'vtol': r.vtol = float(v)
        elif k == 'box':
            n = [int(x) for x in v.split(',')]
            if len(n) != 4: raise ValueError('box butuh 4 angka x0,y0,x1,y1')
            r.box = (n[0], n[1], n[2], n[3])
        elif k == 'not':
            n = [int(x) for x in v.split(',')]
            if len(n) != 4: raise ValueError('not butuh 4 angka x0,y0,x1,y1')
            r.exclude = (*r.exclude, (n[0], n[1], n[2], n[3]))
        elif k == 'groups': r.groups = tuple(x for x in v.split(',') if x)
        elif k == 'mask': r.mask = v
        else: raise ValueError(f'opsi --map tidak dikenal: {k!r}')
    return r


def weights(rgb01: np.ndarray, region: Region) -> np.ndarray:
    """Bobot 0..1 tiap piksel untuk wilayah ini (belum dikalikan alfa/kotak/mask)."""
    h, s, v = rgb2hsv(rgb01)
    hs, ss, vs = (float(x) for x in rgb2hsv(np.array(region.src, float) / 255))
    if ss >= CHROMATIC:
        dh = np.abs((h - hs + 180) % 360 - 180)
        wh = np.clip((1.5 * region.tol - dh) / (.5 * region.tol), 0, 1)
        ws = np.clip((s - .35 * ss) / (.25 * ss), 0, 1)
        wv = np.clip((region.vtol + .2 - np.abs(v - vs)) / .2, 0, 1)
        return wh * ws * wv
    tolv = region.tol / 250.0
    wv = np.clip((1.5 * tolv - np.abs(v - vs)) / (.5 * tolv), 0, 1)
    ws = np.clip((.18 - s) / .06, 0, 1)
    return wv * ws


def _apply_one(rgb01: np.ndarray, w: np.ndarray, region: Region) -> np.ndarray:
    h, s, v = rgb2hsv(rgb01)
    hs, ss, vs = (float(x) for x in rgb2hsv(np.array(region.src, float) / 255))
    hd, sd, vd = (float(x) for x in rgb2hsv(np.array(region.dst, float) / 255))
    if ss >= CHROMATIC:
        nh = (h + (hd - hs)) % 360 if sd >= CHROMATIC else np.full_like(h, hd)
        ns = np.clip(s * (sd / ss), 0, 1)
        nv = np.clip(v * float(np.clip(vd / max(vs, 1e-3), .35, 2.5)), 0, 1)
    else:
        nh = np.full_like(h, hd)
        ns = np.full_like(s, sd)
        nv = np.clip(v * float(np.clip(vd / max(vs, .03), .35, 6.0)), 0, 1)
    new = hsv2rgb(nh, ns, nv)
    return rgb01 * (1 - w[..., None]) + new * w[..., None]


def apply_regions(img: Image.Image, regions: list[Region], group: str, default_groups: tuple[str, ...], mask_dir=None) -> Image.Image:
    """Kembalikan salinan RGBA dengan wilayah yang berlaku untuk `group` diwarnai ulang. Alfa identik dengan sumber."""
    rgba = np.asarray(img.convert('RGBA')).astype(np.float32)
    rgb, alpha = rgba[..., :3] / 255.0, rgba[..., 3]
    active = False
    for rg in regions:
        if group not in (rg.groups or default_groups):
            continue
        w = weights(rgb, rg) * (alpha > 0)
        if rg.box:
            x0, y0, x1, y1 = rg.box
            m = np.zeros(w.shape, bool)
            m[max(0, y0):max(0, y1), max(0, x0):max(0, x1)] = True
            w = w * m
        for x0, y0, x1, y1 in rg.exclude:
            w = w.copy()
            w[max(0, y0):max(0, y1), max(0, x0):max(0, x1)] = 0
        if rg.mask:
            from pathlib import Path
            p = Path(rg.mask) if mask_dir is None else Path(mask_dir) / rg.mask
            mk = Image.open(p).convert('RGBA')
            if mk.size != img.size:
                raise ValueError(f'mask {p.name} berukuran {mk.size}, kanvas {img.size}')
            a = np.asarray(mk).astype(np.float32)
            w = w * (a[..., 3] / 255.0 if a[..., 3].min() < 255 else a[..., :3].mean(-1) / 255.0)
        if not w.any():
            continue
        rgb = _apply_one(rgb, w, rg)
        active = True
    if not active:
        return img.convert('RGBA')
    out = np.concatenate([np.clip(rgb * 255 + .5, 0, 255), alpha[..., None]], -1).astype(np.uint8)
    return Image.fromarray(out, 'RGBA')


def cluster_bounds(images: dict[str, Image.Image], hex_color: str, tol: float = 25.0) -> dict[str, list[int] | None]:
    """Kotak [x0,y0,x1,y1] (persentil 1-99, abaikan piksel liar) tempat keluarga warna ini berada, per gambar."""
    out: dict[str, list[int] | None] = {}
    for label, im in images.items():
        a = np.asarray(im.convert('RGBA')).astype(np.float32)
        w = weights(a[..., :3] / 255.0, Region(hex_to_rgb(hex_color), hex_to_rgb(hex_color), tol)) * (a[..., 3] > 200)
        ys, xs = np.where(w > .5)
        out[label] = [int(np.percentile(xs, 1)), int(np.percentile(ys, 1)), int(np.percentile(xs, 99)), int(np.percentile(ys, 99))] if len(xs) > 40 else None
    return out


# ------------------------------------------------------------------ analisis warna

_HUE_NAMES = [(15, 'merah'), (45, 'jingga'), (70, 'kuning'), (160, 'hijau'), (200, 'toska'), (255, 'biru'), (290, 'ungu'), (335, 'merah muda'), (361, 'merah')]


def hue_name(h: float) -> str:
    return next(n for lim, n in _HUE_NAMES if h < lim)


def analyze(images: list[Image.Image], top: int = 8) -> list[dict]:
    """Keluarga warna dominan pada piksel padat: [{name, hex, share, kind, hue?}], dipakai untuk memilih --map."""
    px = np.concatenate([np.asarray(i.convert('RGBA')).reshape(-1, 4) for i in images])
    px = px[px[:, 3] > 200][:, :3].astype(np.float32) / 255
    if not len(px):
        return []
    if len(px) > 400_000:
        px = px[np.random.default_rng(0).choice(len(px), 400_000, replace=False)]
    h, s, v = rgb2hsv(px)
    total = len(px)
    out = []
    chrom = (s >= CHROMATIC) & (v >= .12)
    if chrom.any():
        bins = (h[chrom] // 15).astype(int) % 24
        hist = np.bincount(bins, minlength=24).astype(float)
        used = np.zeros(24, bool)
        for i in np.argsort(-hist):
            if used[i] or hist[i] / total < .01:
                continue
            grp = [(i + d) % 24 for d in (-1, 0, 1)]
            sel = np.isin(bins, [g for g in grp if not used[g]])
            for g in grp: used[g] = True
            idx = np.where(chrom)[0][sel]
            if not len(idx): continue
            mean = px[idx].mean(0) * 255
            out.append({'name': hue_name(float(np.median(h[idx]))), 'hex': rgb_to_hex(mean), 'share': len(idx) / total, 'kind': 'berwarna', 'sat': float(s[idx].mean())})
    for name, lo, hi in (('gelap', 0, .3), ('abu', .3, .7), ('terang', .7, 1.01)):
        sel = (~chrom) & (v >= lo) & (v < hi)
        if sel.sum() / total >= .01:
            out.append({'name': name, 'hex': rgb_to_hex(px[sel].mean(0) * 255), 'share': float(sel.sum() / total), 'kind': 'netral', 'sat': float(s[sel].mean())})
    return sorted(out, key=lambda c: -c['share'])[:top]

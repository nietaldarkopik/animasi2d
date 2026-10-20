import { BASE } from '../api'
import { layerEntries, placement, tintSvg, VIEWS, type FracBox } from './spec'
import type { CharacterConfig, LibAsset, Palette } from './types'

/** Server URLs are relative to the app origin ("/api/..."); with an absolute VITE_API_URL they must point at that host. */
export function absUrl(u: string): string {
  return u.startsWith('/') && /^https?:\/\//.test(BASE) ? new URL(BASE).origin + u : u
}

const textCache = new Map<string, Promise<string>>()
const imgCache = new Map<string, Promise<HTMLImageElement>>()

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const im = new Image()
    im.onload = () => res(im)
    im.onerror = () => rej(new Error('Gagal memuat gambar aset.'))
    im.src = src
  })
}

/** Raw markup of an SVG asset (cached). */
export function assetSvgText(a: LibAsset): Promise<string> {
  let t = textCache.get(a.url)
  if (!t) {
    t = fetch(absUrl(a.url)).then((r) => { if (!r.ok) throw new Error('Gagal memuat aset.'); return r.text() })
    textCache.set(a.url, t)
  }
  return t
}

/** Asset -> drawable image, recoloured with the palette when the asset has tint regions. Cached per asset+palette. */
export function assetImage(a: LibAsset, palette: Palette): Promise<HTMLImageElement> {
  const key = `${a.id}:${a.hash}:${a.tintable ? JSON.stringify(palette) : ''}`
  let p = imgCache.get(key)
  if (!p) {
    if (a.mime === 'image/svg+xml') {
      p = assetSvgText(a).then((svg) => loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(a.tintable ? tintSvg(svg, palette) : svg)))
    } else {
      p = loadImage(absUrl(a.url))
    }
    imgCache.set(key, p)
    p.catch(() => imgCache.delete(key))
  }
  return p
}

/** True when the part carries a colour adjustment. */
export const hasTint = (p: { tint?: string; brightness?: number }) => !!p.tint || (p.brightness !== undefined && Math.abs(p.brightness - 1) > 0.005)

const tintCache = new Map<string, HTMLCanvasElement>()

/**
 * Recoloured copy of a part image: brightness first, then the 'color' blend (hue + saturation of the tint, luminance of the
 * artwork, so shading and line art survive), then the original alpha is restored so nothing spills outside the shape.
 */
export function tintedImage(im: HTMLImageElement, key: string, p: { tint?: string; tintAmount?: number; brightness?: number }): HTMLCanvasElement {
  const ck = `${key}|${p.tint ?? ''}|${p.tintAmount ?? 1}|${p.brightness ?? 1}`
  const hit = tintCache.get(ck)
  if (hit) return hit
  const c = document.createElement('canvas')
  c.width = im.naturalWidth
  c.height = im.naturalHeight
  const ctx = c.getContext('2d')!
  if (p.brightness !== undefined && p.brightness !== 1) ctx.filter = `brightness(${p.brightness})`
  ctx.drawImage(im, 0, 0)
  ctx.filter = 'none'
  if (p.tint && (p.tintAmount ?? 1) > 0) {
    ctx.globalCompositeOperation = 'color'
    ctx.globalAlpha = p.tintAmount ?? 1
    ctx.fillStyle = p.tint
    ctx.fillRect(0, 0, c.width, c.height)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'destination-in'
    ctx.drawImage(im, 0, 0)
  }
  if (tintCache.size > 48) tintCache.delete(tintCache.keys().next().value!)
  tintCache.set(ck, c)
  return c
}

export interface RenderOpts {
  /** pixels per canvas unit */
  scale: number
  zOf: (slot: string) => number
  transparent?: boolean
  background?: string
  /** override of config.view */
  view?: 'half' | 'full'
  /** draw only the front pass (whole parts + the clipped front copy of split parts) or only the back copies */
  pass?: 'front' | 'back'
  /** explicit region of the character canvas (units); wins over `view` */
  rect?: { x: number; y: number; w: number; h: number }
}

/** Renders the character into a new canvas covering the chosen view (half / full body). */
export async function renderCharacter(config: CharacterConfig, assets: Record<number, LibAsset>, o: RenderOpts): Promise<HTMLCanvasElement> {
  const v = o.rect ?? VIEWS[o.view ?? config.view]
  const cv = document.createElement('canvas')
  cv.width = Math.round(v.w * o.scale)
  cv.height = Math.round(v.h * o.scale)
  const ctx = cv.getContext('2d')!
  if (!o.transparent && o.background) { ctx.fillStyle = o.background; ctx.fillRect(0, 0, cv.width, cv.height) }

  const entries = layerEntries(config, o.zOf).filter((e) => (o.pass === 'back' ? e.pass === 'back' : o.pass === 'front' ? e.pass !== 'back' : true))
  const images = await Promise.all(entries.map((e) => (assets[config.parts[e.slot].assetId] ? assetImage(assets[config.parts[e.slot].assetId], config.palette) : Promise.resolve(null))))
  entries.forEach((e, i) => {
    const im = images[i]
    const asset = assets[config.parts[e.slot].assetId]
    if (!im || !asset) return
    const pl = placement(e.slot, asset, config.parts[e.slot])
    ctx.save()
    ctx.scale(o.scale, o.scale)
    ctx.translate(-v.x, -v.y)
    // clip in canvas units, before the part's own transform
    if (e.clipToY !== undefined || e.clipFromY !== undefined) {
      ctx.beginPath()
      if (e.clipToY !== undefined) ctx.rect(-200, -400, 800, 400 + e.clipToY)
      else ctx.rect(-200, e.clipFromY!, 800, 1600)
      ctx.clip()
    }
    ctx.translate(pl.px + pl.dx, pl.py + pl.dy)
    ctx.rotate((pl.rot * Math.PI) / 180)
    ctx.scale(pl.scale, pl.scale)
    ctx.translate(-pl.px, -pl.py)
    const part = config.parts[e.slot]
    ctx.drawImage(hasTint(part) ? tintedImage(im, `${asset.id}:${asset.hash}:${config.palette ? JSON.stringify(asset.tintable ? config.palette : '') : ''}`, part) : im, pl.x, pl.y, pl.w, pl.h)
    ctx.restore()
  })
  return cv
}

export const canvasBlob = (cv: HTMLCanvasElement) => new Promise<Blob>((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('Gagal membuat PNG.'))), 'image/png'))

/** Rasterises a background (SVG/PNG) to a PNG blob of the given size, for use as a scene layer. */
export async function backgroundPng(a: LibAsset, w: number, h: number): Promise<Blob> {
  const im = await assetImage(a, { skin: '', hair: '', top: '', bottom: '', hijab: '', tie: '', eye: '', shoe: '', accent: '' })
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const ctx = cv.getContext('2d')!
  const k = Math.max(w / a.width, h / a.height) // cover
  ctx.drawImage(im, (w - a.width * k) / 2, (h - a.height * k) / 2, a.width * k, a.height * k)
  return canvasBlob(cv)
}

/** Rasterises an asset (a prop SVG/PNG) to a transparent PNG whose longest side is `maxSide` pixels. */
export async function assetPng(a: LibAsset, maxSide: number): Promise<{ blob: Blob; width: number; height: number }> {
  const im = await assetImage(a, { skin: '', hair: '', top: '', bottom: '', hijab: '', tie: '', eye: '', shoe: '', accent: '' })
  const k = maxSide / Math.max(a.width, a.height)
  const cv = document.createElement('canvas')
  cv.width = Math.max(1, Math.round(a.width * k))
  cv.height = Math.max(1, Math.round(a.height * k))
  cv.getContext('2d')!.drawImage(im, 0, 0, cv.width, cv.height)
  return { blob: await canvasBlob(cv), width: cv.width, height: cv.height }
}

export interface AlphaInfo { frac: FracBox; mask: { w: number; h: number; a: Uint8ClampedArray }; /** mean lightness (0..255) of the visible pixels */ lum: number }
const alphaCache = new Map<string, Promise<AlphaInfo>>()
const NEUTRAL: Palette = { skin: '#000', hair: '#000', top: '#000', bottom: '#000', hijab: '#000', tie: '#000', eye: '#000', shoe: '#000', accent: '#000' }

/** Low-resolution alpha mask + bounding box of the visible pixels (independent of the palette). Cached per asset. */
export function alphaInfo(a: LibAsset): Promise<AlphaInfo> {
  const key = `${a.id}:${a.hash}`
  let p = alphaCache.get(key)
  if (!p) {
    p = assetImage(a, NEUTRAL).then((im) => {
      const w = 160, h = Math.max(8, Math.round((160 * a.height) / a.width))
      const c = document.createElement('canvas')
      c.width = w; c.height = h
      const ctx = c.getContext('2d', { willReadFrequently: true })!
      ctx.drawImage(im, 0, 0, w, h)
      const d = ctx.getImageData(0, 0, w, h).data
      const mask = new Uint8ClampedArray(w * h)
      let x0 = w, y0 = h, x1 = -1, y1 = -1, lumSum = 0, lumN = 0
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const al = d[(y * w + x) * 4 + 3]
        mask[y * w + x] = al
        if (al > 200) { lumSum += 0.299 * d[(y * w + x) * 4] + 0.587 * d[(y * w + x) * 4 + 1] + 0.114 * d[(y * w + x) * 4 + 2]; lumN++ }
        if (al > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
      }
      const frac: FracBox = x1 < 0 ? { x0: 0, y0: 0, x1: 1, y1: 1 } : { x0: x0 / w, y0: y0 / h, x1: (x1 + 1) / w, y1: (y1 + 1) / h }
      return { frac, mask: { w, h, a: mask }, lum: lumN ? lumSum / lumN : 128 }
    })
    alphaCache.set(key, p)
    p.catch(() => alphaCache.delete(key))
  }
  return p
}

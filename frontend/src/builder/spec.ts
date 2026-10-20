import type { CharacterConfig, LibAsset, Palette, PartRef } from './types'

/** Shared full-body character canvas. Half body = the same canvas, cropped (no asset is drawn twice). */
export const CANVAS = { w: 400, h: 800 }
export const VIEWS = {
  half: { x: 0, y: 30, w: 400, h: 570, label: 'Setengah badan' },
  full: { x: 0, y: 30, w: 400, h: 770, label: 'Seluruh badan' },
} as const

export const DEFAULT_PALETTE: Palette = {
  skin: '#f1c7a0', hair: '#1f1b24', top: '#f4f6fa', bottom: '#34456a', hijab: '#f1f1f5',
  tie: '#3f5f86', eye: '#3a2b2b', shoe: '#2b2b33', accent: '#2e3440',
}

export const PALETTE_LABELS: Record<keyof Palette, string> = {
  skin: 'Kulit', hair: 'Rambut', top: 'Atasan', bottom: 'Bawahan', hijab: 'Kerudung', tie: 'Dasi', eye: 'Iris mata', shoe: 'Sepatu', accent: 'Aksen (topi, kacamata, tas)',
}

/** Where an asset that is NOT drawn on the full 400x800 canvas (an upload) is centred and how wide it may be by default. */
export const SLOT_ANCHORS: Record<string, { cx: number; cy: number; maxW: number }> = {
  hair_back: { cx: 200, cy: 200, maxW: 320 }, body: { cx: 200, cy: 520, maxW: 260 }, shoes: { cx: 200, cy: 765, maxW: 200 },
  bottom: { cx: 200, cy: 650, maxW: 220 }, top: { cx: 200, cy: 440, maxW: 240 }, bag: { cx: 200, cy: 430, maxW: 260 },
  face: { cx: 200, cy: 190, maxW: 170 }, hair_front: { cx: 200, cy: 150, maxW: 300 }, hijab: { cx: 200, cy: 230, maxW: 260 },
  eyes: { cx: 200, cy: 196, maxW: 160 }, brows: { cx: 200, cy: 165, maxW: 160 }, mouth: { cx: 200, cy: 250, maxW: 70 },
  glasses: { cx: 200, cy: 196, maxW: 190 }, hat: { cx: 200, cy: 95, maxW: 260 }, headphone: { cx: 200, cy: 200, maxW: 300 },
  accessory: { cx: 200, cy: 420, maxW: 60 },
  torso: { cx: 200, cy: 415, maxW: 240 }, arm_l: { cx: 110, cy: 460, maxW: 60 }, arm_r: { cx: 290, cy: 460, maxW: 60 },
}

/** Slots that can stay empty (everything but the body/face base). */
export const REQUIRED_SLOTS = ['body', 'face'] as const

/** Expression presets: eyes + brows + mouth asset KEYS of the seeded library. */
export const EXPRESSIONS: { id: string; label: string; keys: Record<'eyes' | 'brows' | 'mouth', string> }[] = [
  { id: 'netral', label: 'Netral', keys: { eyes: 'eyes_round', brows: 'brows_normal', mouth: 'mouth_smile' } },
  { id: 'senang', label: 'Senang', keys: { eyes: 'eyes_happy', brows: 'brows_normal', mouth: 'mouth_open' } },
  { id: 'tertawa', label: 'Tertawa', keys: { eyes: 'eyes_laugh', brows: 'brows_up', mouth: 'mouth_laugh' } },
  { id: 'kaget', label: 'Kaget', keys: { eyes: 'eyes_wide', brows: 'brows_up', mouth: 'mouth_surprised' } },
  { id: 'serius', label: 'Serius', keys: { eyes: 'eyes_serious', brows: 'brows_serious', mouth: 'mouth_flat' } },
  { id: 'berpikir', label: 'Berpikir', keys: { eyes: 'eyes_think', brows: 'brows_normal', mouth: 'mouth_think' } },
]

export const STARTER_KEYS = ['body_normal', 'shoes_sneakers', 'bottom_trousers', 'top_smk_short', 'acc_tie', 'face_round', 'hairb_short', 'hairf_neat', 'eyes_round', 'brows_normal', 'mouth_smile']

/** Drawn on the shared canvas (400x800 units). A raster at 2x/3x (e.g. 800x1600) counts too: only the aspect matters. */
export const isFullCanvas = (a: Pick<LibAsset, 'width' | 'height'>) => a.width >= CANVAS.w && Math.abs(a.width / a.height - CANVAS.w / CANVAS.h) < 0.005

/**
 * Recolour data-tint regions. Strokes are tinted for elements whose fill is "none" or translucent (lenses, outlines),
 * the fill otherwise. Pure string work so it runs anywhere (also in tests).
 */
export function tintSvg(svg: string, palette: Palette): string {
  return svg.replace(/<(path|circle|ellipse|rect|polygon|polyline|line)\b[^>]*\bdata-tint="(\w+)"[^>]*>/g, (tag, _name: string, tint: string) => {
    const color = (palette as unknown as Record<string, string>)[tint]
    if (!color) return tag
    const useStroke = /\bfill="none"/.test(tag) || /\bfill-opacity="/.test(tag)
    const attr = useStroke ? 'stroke' : 'fill'
    return tag.replace(new RegExp(`(\\s${attr}=")[^"]*(")`), `$1${color}$2`)
  })
}

export interface Placement {
  /** top-left + size of the image, in canvas units, before the part transform */
  x: number; y: number; w: number; h: number
  /** transform pivot in canvas units */
  px: number; py: number
  dx: number; dy: number; scale: number
  /** degrees, clockwise on screen */
  rot: number
}

export function placement(slot: string, asset: Pick<LibAsset, 'width' | 'height'>, ref: Pick<PartRef, 'dx' | 'dy' | 'scale' | 'rot'>): Placement {
  const a = SLOT_ANCHORS[slot] ?? { cx: 200, cy: 400, maxW: 260 }
  const base = isFullCanvas(asset)
    ? { x: 0, y: 0, w: CANVAS.w, h: CANVAS.h }
    : (() => {
        const k = Math.min(a.maxW / asset.width, 600 / asset.height)
        const w = asset.width * k, h = asset.height * k
        return { x: a.cx - w / 2, y: a.cy - h / 2, w, h }
      })()
  return { ...base, px: a.cx, py: a.cy, dx: ref.dx ?? 0, dy: ref.dy ?? 0, scale: ref.scale ?? 1, rot: ref.rot ?? 0 }
}

/** Parts in drawing order (back to front), using the category z_order from the API (and per-part overrides). */
export function drawOrder(config: CharacterConfig, zOf: (slot: string) => number): string[] {
  return Object.keys(config.parts).sort((a, b) => effectiveZ(config, a, zOf) - effectiveZ(config, b, zOf) || zOf(a) - zOf(b))
}

/** z used for stacking: the part's override, else the category order. */
export const effectiveZ = (config: CharacterConfig, slot: string, zOf: (slot: string) => number) => config.parts[slot]?.z ?? zOf(slot)

/** Behind the body (category z 2) but in front of the back hair (z 1). */
export const BACK_Z = 1.1

export interface LayerEntry {
  slot: string
  pass: 'whole' | 'front' | 'back'
  z: number
  /** keep only canvas y <= this (the front copy of a split part) */
  clipToY?: number
  /** keep only canvas y >= this (the back copy of a split part) */
  clipFromY?: number
}

/** What actually gets drawn, back to front. A split part contributes two entries (see PartRef.split). */
export function layerEntries(config: CharacterConfig, zOf: (slot: string) => number): LayerEntry[] {
  const out: LayerEntry[] = []
  for (const slot of Object.keys(config.parts)) {
    const p = config.parts[slot]
    const z = effectiveZ(config, slot, zOf)
    if (typeof p.split === 'number') {
      out.push({ slot, pass: 'back', z: BACK_Z, clipFromY: p.split - 2 }) // 2 units of overlap: no gap, no visible seam
      out.push({ slot, pass: 'front', z, clipToY: p.split })
    } else out.push({ slot, pass: 'whole', z })
  }
  return out.sort((a, b) => a.z - b.z || zOf(a.slot) - zOf(b.slot) || (a.pass === 'back' ? -1 : 0) - (b.pass === 'back' ? -1 : 0))
}

/**
 * New `z` for `slot` after moving it one step in the stack (dir +1 = toward the front, -1 = toward the back);
 * null when it is already at that end. The value lies between the two neighbours so nothing else moves.
 */
export function moveLayerZ(config: CharacterConfig, slot: string, dir: 1 | -1, zOf: (slot: string) => number): number | null {
  const order = drawOrder(config, zOf)
  const i = order.indexOf(slot)
  const j = i + dir
  if (i < 0 || j < 0 || j >= order.length) return null
  const zt = effectiveZ(config, order[j], zOf)
  const zu = order[j + dir] ? effectiveZ(config, order[j + dir], zOf) : zt + dir * 2
  const gap = Math.abs(zu - zt)
  const z = zt + dir * (gap > 0.002 ? gap / 2 : 0.001)
  return Math.round(z * 1000) / 1000
}

export function emptyConfig(view: 'half' | 'full' = 'half'): CharacterConfig {
  return { schema_version: 1, view, palette: { ...DEFAULT_PALETTE }, parts: {} }
}

// ---------------------------------------------------------------------------------------------------- direct manipulation

/** Bounding box of the visible pixels as fractions (0..1) of the asset image. */
export interface FracBox { x0: number; y0: number; x1: number; y1: number }
export interface Box { x0: number; y0: number; x1: number; y1: number }
/** `rot` is only present when the rotation is being set (it may then be 0 = remove the rotation). */
export interface PartXform { dx: number; dy: number; scale: number; rot?: number }

/** Server limits for a part transform (see BuilderCharacterController::validatedConfig). */
export const LIMITS = { dx: [-400, 400], dy: [-800, 800], scale: [0.2, 4] } as const
export const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v))
/** Angle in (-180, 180]. */
export const normDeg = (d: number) => { const m = ((d % 360) + 360) % 360; return m > 180 ? m - 360 : m }
export const rotv = (x: number, y: number, deg: number) => { const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r); return { x: x * c - y * s, y: x * s + y * c } }

export function clampXform(t: PartXform): PartXform {
  const out: PartXform = { dx: Math.round(clamp(t.dx, LIMITS.dx) * 10) / 10, dy: Math.round(clamp(t.dy, LIMITS.dy) * 10) / 10, scale: Math.round(clamp(t.scale, LIMITS.scale) * 1000) / 1000 }
  if (t.rot !== undefined) out.rot = Math.round(normDeg(t.rot) * 100) / 100
  return out
}

/** Point in the part's own (untransformed) canvas coordinates -> point on the character canvas. */
export function toCanvas(pl: Placement, p: { x: number; y: number }) {
  const v = rotv(p.x - pl.px, p.y - pl.py, pl.rot)
  return { x: pl.px + pl.dx + pl.scale * v.x, y: pl.py + pl.dy + pl.scale * v.y }
}
export function fromCanvas(pl: Placement, p: { x: number; y: number }) {
  const v = rotv((p.x - pl.px - pl.dx) / pl.scale, (p.y - pl.py - pl.dy) / pl.scale, -pl.rot)
  return { x: pl.px + v.x, y: pl.py + v.y }
}

/** Untransformed box of the visible pixels, in canvas units. */
export function baseBox(pl: Placement, fb: FracBox): Box {
  return { x0: pl.x + fb.x0 * pl.w, y0: pl.y + fb.y0 * pl.h, x1: pl.x + fb.x1 * pl.w, y1: pl.y + fb.y1 * pl.h }
}
/** The four corners (top-left, top-right, bottom-right, bottom-left) of the visible box after the part transform: a rotated rectangle. */
export function orientedCorners(pl: Placement, fb: FracBox) {
  const b = baseBox(pl, fb)
  return [{ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }, { x: b.x1, y: b.y1 }, { x: b.x0, y: b.y1 }].map((p) => toCanvas(pl, p))
}
/** Axis-aligned box around that (used for the union of a selection, rubber-band hits and the frame of unrotated parts). */
export function partBox(pl: Placement, fb: FracBox): Box {
  const c = orientedCorners(pl, fb)
  return { x0: Math.min(...c.map((p) => p.x)), y0: Math.min(...c.map((p) => p.y)), x1: Math.max(...c.map((p) => p.x)), y1: Math.max(...c.map((p) => p.y)) }
}

/** New transform with `scale`, chosen so the centre of the part's visible box stays where it is on screen. */
export function scaleAboutCenter(pl: Placement, fb: FracBox, scale: number): PartXform {
  const b = baseBox(pl, fb)
  const c0 = { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 }
  const now = toCanvas(pl, c0)
  const v = rotv(c0.x - pl.px, c0.y - pl.py, pl.rot)
  return clampXform({ scale, dx: now.x - pl.px - scale * v.x, dy: now.y - pl.py - scale * v.y })
}

/** Alpha mask lookup for hit-testing: is the visible part under canvas point p? */
export function hitsPart(pl: Placement, mask: { w: number; h: number; a: Uint8ClampedArray }, p: { x: number; y: number }, threshold = 24): boolean {
  const q = fromCanvas(pl, p)
  const fx = (q.x - pl.x) / pl.w, fy = (q.y - pl.y) / pl.h
  if (fx < 0 || fy < 0 || fx >= 1 || fy >= 1) return false
  return mask.a[Math.floor(fy * mask.h) * mask.w + Math.floor(fx * mask.w)] > threshold
}

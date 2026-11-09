import { canvasBlob, renderCharacter } from './render'
import { guessJoints, planPartPieces, type CharRig, type Joints, type Poly } from './charRig'
import { effectiveZ } from './spec'
import type { PieceSpec } from './rig'
import type { CharacterConfig, LibAsset } from './types'

/** Pixels per character-canvas unit of the piece images (matches the 2x canvas-aligned raster assets). */
export const RIG_PX = 2
const FULL = { x: 0, y: 0, w: 400, h: 800 }

export interface RigRenderInput {
  config: CharacterConfig
  assets: Record<number, LibAsset>
  zOf: (slot: string) => number
  /** display name of a slot (category name) for head pieces */
  labelOf: (slot: string) => string
  onProgress?: (done: number, total: number) => void
  /** the bottom is a skirt (default: from the rig, else from the name of the bottom part) */
  skirt?: boolean
}
export interface RenderedPiece {
  spec: Omit<PieceSpec, 'assetId' | 'expr'>
  canvas: HTMLCanvasElement
  /** the same piece drawn for each saved expression (eyes / brows / mouth), cropped to the SAME box so they swap in place */
  variants?: Record<string, HTMLCanvasElement>
}

const EXPR_SLOTS = ['eyes', 'brows', 'mouth']

function crop(cv: HTMLCanvasElement, b: { x: number; y: number; w: number; h: number }): HTMLCanvasElement {
  const out = document.createElement('canvas')
  out.width = b.w
  out.height = b.h
  out.getContext('2d')!.drawImage(cv, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h)
  return out
}

/** A skirt (or anything named "rok") hangs from the hips as one piece; trousers are cut into the two legs. */
export function isSkirt(asset: Pick<LibAsset, 'name' | 'key'> | undefined): boolean {
  return !!asset && /\b(rok|skirt)\b|_skirt/i.test(`${asset.name} ${asset.key ?? ''}`)
}

/** Bounding box of pixels with alpha > 8 (canvas px), or null when the image is empty. */
export function alphaBounds(cv: HTMLCanvasElement): { x: number; y: number; w: number; h: number } | null {
  const { width: w, height: h } = cv
  const d = cv.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

/** Crops a composed piece to its pixels; a piece of one face slot also gets one image per saved expression (same box, so they swap in place). */
async function finishPiece(inp: RigRenderInput, cv: HTMLCanvasElement, g: { key: string; name: string; bone: string; order: number }, slots: string[]): Promise<RenderedPiece | null> {
  const { config, assets, zOf } = inp
  let b = alphaBounds(cv)
  const full: Record<string, HTMLCanvasElement> = {}
  if (slots.length === 1 && EXPR_SLOTS.includes(slots[0])) {
    const slot = slots[0]
    for (const e of config.expressions ?? []) {
      const part = e.parts[slot as 'eyes']
      if (!part || !assets[part.assetId]) continue
      full[e.id] = await renderCharacter({ ...config, parts: { [slot]: part } }, assets, { scale: RIG_PX, zOf, transparent: true, rect: FULL, pass: 'front' })
      const vb = alphaBounds(full[e.id])
      if (vb) b = b ? { x: Math.min(b.x, vb.x), y: Math.min(b.y, vb.y), w: Math.max(b.x + b.w, vb.x + vb.w) - Math.min(b.x, vb.x), h: Math.max(b.y + b.h, vb.y + vb.h) - Math.min(b.y, vb.y) } : vb
    }
  }
  if (!b) return null
  const variants = Object.fromEntries(Object.entries(full).map(([id, c]) => [id, crop(c, b!)]))
  return { spec: { key: g.key, name: g.name, bone: g.bone, order: g.order, box: { x0: b.x / RIG_PX, y0: b.y / RIG_PX, x1: (b.x + b.w) / RIG_PX, y1: (b.y + b.h) / RIG_PX } }, canvas: crop(cv, b), ...(Object.keys(variants).length ? { variants } : {}) }
}

/** Renders every slot alone (canvas-aligned, RIG_PX per unit); a split part also as its back copy (`<slot>:back`). */
async function slotLayers(inp: RigRenderInput, slots: string[], tick: () => void): Promise<Record<string, HTMLCanvasElement>> {
  const { config, assets, zOf } = inp
  const layers: Record<string, HTMLCanvasElement> = {}
  for (const s of slots) {
    // (the whole configuration, drawing one slot: a mirrored left shoe draws its right twin only when the right foot has no part of its own)
    layers[s] = await renderCharacter(config, assets, { scale: RIG_PX, zOf, transparent: true, rect: FULL, pass: 'front', only: [s] })
    if (typeof config.parts[s].split === 'number') layers[`${s}:back`] = await renderCharacter(config, assets, { scale: RIG_PX, zOf, transparent: true, rect: FULL, pass: 'back', only: [s] })
    tick()
  }
  return layers
}

function polyPath(ctx: CanvasRenderingContext2D, polys: Poly[]) {
  ctx.beginPath()
  for (const poly of polys) {
    // one winding for every polygon: with the nonzero rule, overlapping polygons of opposite windings would cancel out
    const area = poly.reduce((a, p, i) => { const q = poly[(i + 1) % poly.length]; return a + p.x * q.y - q.x * p.y }, 0)
    const pts = area < 0 ? [...poly].reverse() : poly
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x * RIG_PX, p.y * RIG_PX) : ctx.moveTo(p.x * RIG_PX, p.y * RIG_PX)))
    ctx.closePath()
  }
}

/**
 * The rig of a character cut PART BY PART at its joints (see charRig.planPartPieces): the joints the user placed in the Builder
 * (config.rig), or a guess from where the parts are. Returns the pieces and the joints used (the bones are built from them).
 */
export async function renderPartPieces(inp: RigRenderInput, rig: CharRig | null): Promise<{ pieces: RenderedPiece[]; joints: Joints }> {
  const { config, zOf } = inp
  const effZ = (s: string) => effectiveZ(config, s, zOf)
  const slots = Object.keys(config.parts).sort((a, b) => effZ(a) - effZ(b))
  const skirt = rig?.skirt ?? inp.skirt ?? isSkirt(inp.assets[config.parts.bottom?.assetId])
  let done = 0
  const layers = await slotLayers(inp, slots, () => inp.onProgress?.(++done, slots.length + 20))
  const boxes = Object.fromEntries(slots.map((s) => { const b = alphaBounds(layers[s]); return [s, b ? { x0: b.x / RIG_PX, y0: b.y / RIG_PX, x1: (b.x + b.w) / RIG_PX, y1: (b.y + b.h) / RIG_PX } : undefined] }))
  const alpha: Record<string, Uint8ClampedArray> = {}
  const hit = (slot: string, p: { x: number; y: number }) => {
    const cv = layers[slot]
    if (!cv) return false
    alpha[slot] ??= cv.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, cv.width, cv.height).data
    const x = Math.round(p.x * RIG_PX), y = Math.round(p.y * RIG_PX)
    return x >= 0 && y >= 0 && x < cv.width && y < cv.height && alpha[slot][(y * cv.width + x) * 4 + 3] > 40
  }
  const joints = rig?.joints ?? guessJoints(boxes, hit)
  const top = boxes.top
  const plan = planPartPieces({ slots, joints, armWidth: rig?.armWidth, skirt, zOf: effZ, labelOf: inp.labelOf, splits: slots.filter((s) => typeof config.parts[s].split === 'number'), hemY: skirt && top ? top.y1 : undefined })
  const pieces: RenderedPiece[] = []
  for (const p of plan) {
    const cv = document.createElement('canvas')
    cv.width = FULL.w * RIG_PX
    cv.height = FULL.h * RIG_PX
    const ctx = cv.getContext('2d')!
    for (const l of p.layers) {
      const src = layers[l.slot]
      if (!src) continue
      const tmp = document.createElement('canvas')
      tmp.width = cv.width
      tmp.height = cv.height
      const t = tmp.getContext('2d')!
      t.save()
      for (const w of l.within ?? []) { polyPath(t, w); t.clip() } // nested clips intersect
      t.drawImage(src, 0, 0)
      t.restore()
      if (l.minus?.length) { t.globalCompositeOperation = 'destination-out'; polyPath(t, l.minus); t.fill() }
      ctx.drawImage(tmp, 0, 0)
    }
    inp.onProgress?.(++done, Math.max(slots.length + 20, done))
    const piece = await finishPiece(inp, cv, p, p.layers.map((l) => l.slot))
    if (piece) pieces.push(piece)
  }
  return { pieces, joints }
}

export const pieceBlob = (p: RenderedPiece) => canvasBlob(p.canvas)

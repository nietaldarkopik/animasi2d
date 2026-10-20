import { canvasBlob, renderCharacter } from './render'
import { effectiveZ } from './spec'
import type { PieceSpec } from './rig'
import type { CharacterConfig, LibAsset } from './types'

/** Pixels per character-canvas unit of the piece images (matches the 2x canvas-aligned raster assets). */
export const RIG_PX = 2
const FULL = { x: 0, y: 0, w: 400, h: 800 }

type Rect = readonly [number, number, number, number] // x0, y0, x1, y1 in canvas units

/** What goes into one rig image: which slots (back to front), restricted to which regions of the canvas. */
interface Group {
  key: string
  name: string
  bone: string
  order: number
  slots: string[]
  /** union of regions to keep; null = the whole canvas */
  keep: Rect[] | null
  /** extra per-slot restriction (intersected with `keep`) */
  slotKeep?: Record<string, Rect[]>
}

// Anatomy of the shared canvas (see generate.py / AiAssetGenerator::GEOMETRY)
const SHOULDER_Y = 326, ELBOW_Y = 452, ARM_END_Y = 660, HIP_Y = 556, KNEE_Y = 661
const ARM_L: Rect = [0, SHOULDER_Y, 124, ARM_END_Y]
const ARM_R: Rect = [276, SHOULDER_Y, 400, ARM_END_Y]
const HEAD_SLOTS = ['face', 'hair_front', 'hijab', 'eyes', 'brows', 'mouth', 'glasses', 'hat', 'headphone']
const BODY_SLOTS = ['body', 'torso', 'top', 'bag', 'accessory']

export interface RigRenderInput {
  config: CharacterConfig
  assets: Record<number, LibAsset>
  zOf: (slot: string) => number
  /** display name of a slot (category name) for head pieces */
  labelOf: (slot: string) => string
  onProgress?: (done: number, total: number) => void
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

/** The group definitions for a configuration (pure; used by the renderer and tested). */
export function planGroups(slots: string[], skirt: boolean, zOf: (s: string) => number, labelOf: (s: string) => string, splits: string[] = []): Group[] {
  const has = (s: string) => slots.includes(s)
  const groups: Group[] = []
  if (has('hair_back')) groups.push({ key: 'hair_back', name: labelOf('hair_back'), bone: 'torso', order: 0, slots: ['hair_back'], keep: null })
  for (const s of HEAD_SLOTS.filter(has)) groups.push({ key: s, name: labelOf(s), bone: 'head', order: 100 + zOf(s), slots: [s], keep: null })
  // split parts (long hair): the whole part also hangs BEHIND the torso image, so the clothes sit between the two copies
  for (const s of splits.filter((x) => has(x))) groups.push({ key: `${s}_back`, name: `${labelOf(s)} (belakang)`, bone: 'torso', order: 0, slots: [`${s}:back`], keep: null })

  const body = BODY_SLOTS.filter(has).sort((a, b) => zOf(a) - zOf(b))
  const torsoKeep: Rect[] = [[124, 0, 276, 800], [0, 0, 124, SHOULDER_Y], [276, 0, 400, SHOULDER_Y], [0, ARM_END_Y, 400, 800]]
  groups.push({ key: 'torso', name: 'Badan', bone: 'torso', order: 5, slots: body, keep: torsoKeep, slotKeep: { body: [[0, 0, 400, HIP_Y]] } })
  for (const [side, rect, label] of [['l', ARM_L, 'kiri'], ['r', ARM_R, 'kanan']] as const) {
    groups.push({ key: `arm_${side}_up`, name: `Lengan atas ${label}`, bone: `arm_${side}`, order: 0, slots: body, keep: [[rect[0], SHOULDER_Y, rect[2], ELBOW_Y]] })
    groups.push({ key: `arm_${side}_low`, name: `Lengan bawah ${label}`, bone: `forearm_${side}`, order: 0, slots: body, keep: [[rect[0], ELBOW_Y, rect[2], ARM_END_Y]] })
  }

  // posed arms (one image per arm, drawn for the pose): rigid piece on the upper-arm bone, rotating about the shoulder.
  // Behind the sleeve normally; in front of everything when the user stacked it above the top (arms across the chest...)
  for (const [side, slot, label] of [['l', 'arm_l', 'kiri'], ['r', 'arm_r', 'kanan']] as const) {
    if (has(slot)) groups.push({ key: `${slot}_pose`, name: `Lengan ${label} (pose)`, bone: `arm_${side}`, order: zOf(slot) > zOf('top') ? 20 : -1, slots: [slot], keep: null })
  }

  const legSlots = ['body', ...(skirt || !has('bottom') ? [] : ['bottom']), ...(has('shoes') ? ['shoes'] : [])].filter(has).sort((a, b) => zOf(a) - zOf(b))
  for (const [side, x0, x1, label] of [['l', 0, 200, 'kiri'], ['r', 200, 400, 'kanan']] as const) {
    const top = (s: string) => (s === 'bottom' ? 546 : HIP_Y) // the waistband starts above the hip line
    groups.push({ key: `leg_${side}_up`, name: `Paha ${label}`, bone: `leg_${side}`, order: 0, slots: legSlots, keep: null, slotKeep: Object.fromEntries(legSlots.map((s) => [s, [[x0, top(s), x1, KNEE_Y] as Rect]])) })
    groups.push({ key: `leg_${side}_low`, name: `Betis ${label}`, bone: `shin_${side}`, order: 0, slots: legSlots, keep: null, slotKeep: Object.fromEntries(legSlots.map((s) => [s, [[x0, KNEE_Y, x1, 800] as Rect]])) })
  }
  if (skirt && has('bottom')) groups.push({ key: 'skirt', name: labelOf('bottom'), bone: 'root', order: 5, slots: ['bottom'], keep: null })
  return groups
}

function clipTo(ctx: CanvasRenderingContext2D, rects: readonly Rect[]) {
  ctx.beginPath()
  for (const [x0, y0, x1, y1] of rects) ctx.rect(x0 * RIG_PX, y0 * RIG_PX, (x1 - x0) * RIG_PX, (y1 - y0) * RIG_PX)
  ctx.clip()
}

/** Bounding box of pixels with alpha > 8 (canvas px), or null when the image is empty. */
export function alphaBounds(cv: HTMLCanvasElement): { x: number; y: number; w: number; h: number } | null {
  const { width: w, height: h } = cv
  const d = cv.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

/** Renders every slot alone, then composes + cuts the rig images. Empty pieces are dropped. */
export async function renderRigPieces(inp: RigRenderInput): Promise<RenderedPiece[]> {
  const { config, assets, zOf } = inp
  const effZ = (s: string) => effectiveZ(config, s, zOf)
  const slots = Object.keys(config.parts).sort((a, b) => effZ(a) - effZ(b))
  const skirt = isSkirt(assets[config.parts.bottom?.assetId])
  const splits = slots.filter((s) => typeof config.parts[s].split === 'number')
  const groups = planGroups(slots, skirt, effZ, inp.labelOf, splits)

  const layers: Record<string, HTMLCanvasElement> = {}
  let done = 0
  for (const s of slots) {
    const one = { ...config, parts: { [s]: config.parts[s] } }
    layers[s] = await renderCharacter(one, assets, { scale: RIG_PX, zOf, transparent: true, rect: FULL, pass: 'front' })
    if (typeof config.parts[s].split === 'number') layers[`${s}:back`] = await renderCharacter(one, assets, { scale: RIG_PX, zOf, transparent: true, rect: FULL, pass: 'back' })
    inp.onProgress?.(++done, slots.length + groups.length)
  }

  const out: RenderedPiece[] = []
  for (const g of groups) {
    const cv = document.createElement('canvas')
    cv.width = FULL.w * RIG_PX
    cv.height = FULL.h * RIG_PX
    const ctx = cv.getContext('2d')!
    for (const s of g.slots) {
      if (!layers[s]) continue
      ctx.save()
      if (g.keep) clipTo(ctx, g.keep)
      const extra = g.slotKeep?.[s]
      if (extra) clipTo(ctx, extra) // nested clips intersect
      ctx.drawImage(layers[s], 0, 0)
      ctx.restore()
    }
    inp.onProgress?.(++done, slots.length + groups.length)
    let b = alphaBounds(cv)
    // saved expressions: draw the slot once per expression; every variant is cropped to the union box so they swap in place
    const full: Record<string, HTMLCanvasElement> = {}
    if (g.slots.length === 1 && EXPR_SLOTS.includes(g.slots[0])) {
      const slot = g.slots[0]
      for (const e of config.expressions ?? []) {
        const part = e.parts[slot as 'eyes']
        if (!part || !assets[part.assetId]) continue
        full[e.id] = await renderCharacter({ ...config, parts: { [slot]: part } }, assets, { scale: RIG_PX, zOf, transparent: true, rect: FULL, pass: 'front' })
        const vb = alphaBounds(full[e.id])
        if (vb) b = b ? { x: Math.min(b.x, vb.x), y: Math.min(b.y, vb.y), w: Math.max(b.x + b.w, vb.x + vb.w) - Math.min(b.x, vb.x), h: Math.max(b.y + b.h, vb.y + vb.h) - Math.min(b.y, vb.y) } : vb
      }
    }
    if (!b) continue
    const variants = Object.fromEntries(Object.entries(full).map(([id, c]) => [id, crop(c, b!)]))
    out.push({ spec: { key: g.key, name: g.name, bone: g.bone, order: g.order, box: { x0: b.x / RIG_PX, y0: b.y / RIG_PX, x1: (b.x + b.w) / RIG_PX, y1: (b.y + b.h) / RIG_PX } }, canvas: crop(cv, b), ...(Object.keys(variants).length ? { variants } : {}) })
  }
  return out
}

export const pieceBlob = (p: RenderedPiece) => canvasBlob(p.canvas)

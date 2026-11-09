import { freshPart } from './align'
import { alphaInfo } from './render'
import { partBox, placement, type FracBox } from './spec'
import type { CharacterConfig, HeadFit, LibAsset, PartRef } from './types'

/** Slots drawn on the head: they move and scale together. */
export const HEAD_SLOTS = ['face', 'hair_back', 'hair_front', 'hijab', 'eyes', 'brows', 'mouth', 'glasses', 'hat', 'headphone'] as const

/** The body kits (master-assets/kit_badan_sma): where the head sits (neck joint of the kit, canvas units) and how big it should be. */
export const KITS: Record<string, { jointY: number; scale: number }> = {
  laki_laki_anime: { jointY: 205, scale: 0.78 },
  perempuan_panjang_anime: { jointY: 212, scale: 0.75 },
  perempuan_pendek_anime: { jointY: 218, scale: 0.75 },
}

/** How far below the kit's neck joint the bottom of the face (its neck) ends: it tucks into the collar. */
const NECK_TUCK = 6

/** The kit of the character's body, from the set key of its clothes ("kit:<kit>:<slot>"), or null. */
export function kitOf(config: CharacterConfig, assets: LibAsset[]): string | null {
  for (const slot of ['top', 'bottom', 'body']) {
    const a = assets.find((x) => x.id === config.parts[slot]?.assetId)
    const m = /^kit:([a-z_]+):/.exec(a?.set ?? '')
    if (m && KITS[m[1]]) return m[1]
  }
  return null
}

/**
 * Shrink the whole head (face, hair, eyes… as one) to the proportions of a body kit and seat its neck on the kit's neck joint.
 * The head parts keep their relative layout: it is one scale about the bottom-centre of the face plus one move.
 * `fracOf` gives the visible box of an asset (fractions of its image); injected so this stays testable without a canvas.
 */
export function fitHeadWith(config: CharacterConfig, assets: LibAsset[], fracOf: (a: LibAsset) => FracBox): { config: CharacterConfig; kit: string } | null {
  const kit = kitOf(config, assets)
  if (!kit) return null
  const byId = new Map(assets.map((a) => [a.id, a]))
  const anchorSlot = (['face', 'hijab', 'hair_front'] as const).find((s) => config.parts[s] && byId.get(config.parts[s].assetId))
  if (!anchorSlot) return null
  const { jointY, scale: s } = KITS[kit]

  const ref0 = config.parts[anchorSlot]
  const a0 = byId.get(ref0.assetId)!
  const box = partBox(placement(anchorSlot, a0, ref0), fracOf(a0))
  const fit: HeadFit = { s, nx: round((box.x0 + box.x1) / 2), ny: round(box.y1), jx: 200, jy: jointY + NECK_TUCK }

  const parts = { ...config.parts }
  for (const slot of HEAD_SLOTS) {
    const ref = config.parts[slot]
    const a = ref && byId.get(ref.assetId)
    if (ref && a) parts[slot] = fitRef(slot, a, ref, fit)
  }
  return { config: { ...config, parts, headFit: fit }, kit }
}

/** One part moved by the head fit: scale about (nx, ny), then (nx, ny) goes to (jx, jy). Works for a part that already has a transform. */
export function fitRef(slot: string, asset: LibAsset, ref: PartRef, f: HeadFit): PartRef {
  const pl = placement(slot, asset, ref)
  const next: PartRef = {
    ...ref,
    scale: round((ref.scale ?? 1) * f.s),
    dx: round(f.jx + f.s * (pl.px + (ref.dx ?? 0) - f.nx) - pl.px),
    dy: round(f.jy + f.s * (pl.py + (ref.dy ?? 0) - f.ny) - pl.py),
  }
  delete next.hash // the server fills it again
  return next
}

/** A freshly chosen head part (default placement) gets the same fit as the rest of the head, so swapping parts keeps size and place. */
export function fittedHeadPart(slot: string, asset: LibAsset, fit: HeadFit): PartRef {
  return fitRef(slot, asset, freshPart(asset), fit)
}

const round = (n: number) => Math.round(n * 100) / 100

export async function fitHead(config: CharacterConfig, assets: LibAsset[]): Promise<{ config: CharacterConfig; kit: string } | null> {
  const need = new Map<number, LibAsset>()
  for (const slot of HEAD_SLOTS) {
    const a = assets.find((x) => x.id === config.parts[slot]?.assetId)
    if (a) need.set(a.id, a)
  }
  const fracs = new Map<number, FracBox>()
  await Promise.all([...need.values()].map(async (a) => { fracs.set(a.id, (await alphaInfo(a)).frac) }))
  return fitHeadWith(config, assets, (a) => fracs.get(a.id) ?? { x0: 0, y0: 0, x1: 1, y1: 1 })
}

import type { BoneSpec, Box, PieceSpec, Pt } from './rig'
import { SLOT_ANCHORS } from './spec'
import type { CharacterConfig, LibAsset, PartRef } from './types'

/**
 * Body kits (public/kits/<id>/rig.json): ready-cut body pieces with their own skeleton, matching the "Kit SMA …" library
 * assets. When a character wears such a kit, "Sisipkan + bone" uses the kit's bones and pieces for the body instead of
 * cutting the body with the default skeleton (whose proportions don't fit the anime kits).
 */
export interface KitPiece extends Omit<PieceSpec, 'assetId' | 'expr'> {
  /** image file next to rig.json (2 px per canvas unit) */
  file: string
  /** the Builder slot whose library asset contains this piece (body / top / bottom / shoes) */
  slot: string
}
export interface KitRig {
  id: string
  /** library asset names of this kit start with this text */
  match: string
  label: string
  view: string
  bones: BoneSpec[]
  parts: KitPiece[]
}
export interface KitIndexEntry { id: string; match: string; label: string }

export const KIT_SLOTS = ['body', 'top', 'bottom', 'shoes'] as const

const kitBase = () => `${(import.meta.env?.BASE_URL ?? '/').replace(/\/$/, '')}/kits`

let indexCache: Promise<KitIndexEntry[]> | null = null
export function loadKitIndex(): Promise<KitIndexEntry[]> {
  indexCache ??= fetch(`${kitBase()}/index.json`, { cache: 'no-store' })
    .then((r) => (r.ok ? (r.json() as Promise<KitIndexEntry[]>) : []))
    .catch(() => [])
  return indexCache
}
export async function loadKit(id: string): Promise<KitRig> {
  const r = await fetch(`${kitBase()}/${id}/rig.json`, { cache: 'no-store' })
  if (!r.ok) throw new Error(`Kit badan "${id}" tidak ditemukan (${r.status}).`)
  return r.json() as Promise<KitRig>
}
export const kitFileUrl = (id: string, file: string) => `${kitBase()}/${id}/${file}`

/** Which kit the character wears (the one owning the most of its body slots) and which slots come from it. */
export function detectKit(config: CharacterConfig, assets: Record<number, Pick<LibAsset, 'name'>>, index: KitIndexEntry[]): { kit: KitIndexEntry; slots: string[] } | null {
  let best: { kit: KitIndexEntry; slots: string[] } | null = null
  for (const kit of index) {
    const slots = KIT_SLOTS.filter((s) => {
      const a = config.parts[s] && assets[config.parts[s].assetId]
      return !!a && a.name.trim().startsWith(kit.match)
    })
    if (slots.length && (!best || slots.length > best.slots.length)) best = { kit, slots }
  }
  return best
}

/**
 * The kit's geometry moved the way the user placed the kit in the Builder (offset + scale of its top, or of the first
 * kit slot). Rotation is ignored: kit parts are meant to be placed upright.
 */
export function placeKit(kit: Pick<KitRig, 'bones' | 'parts'>, slot: string, ref: Pick<PartRef, 'dx' | 'dy' | 'scale'>): { bones: BoneSpec[]; parts: KitPiece[]; scale: number } {
  const a = SLOT_ANCHORS[slot] ?? { cx: 200, cy: 400 }
  const s = ref.scale ?? 1, dx = ref.dx ?? 0, dy = ref.dy ?? 0
  // rig.json stores joints as [x, y]
  const pt = (p: Pt | readonly number[]): Pt => (Array.isArray(p) ? { x: Number(p[0]), y: Number(p[1]) } : (p as Pt))
  const map = (q: Pt | readonly number[]): Pt => { const p = pt(q); return { x: a.cx + dx + s * (p.x - a.cx), y: a.cy + dy + s * (p.y - a.cy) } }
  const box = (b: Box): Box => {
    const p0 = map({ x: b.x0, y: b.y0 }), p1 = map({ x: b.x1, y: b.y1 })
    return { x0: p0.x, y0: p0.y, x1: p1.x, y1: p1.y }
  }
  return {
    bones: kit.bones.map((b) => ({ ...b, joint: map(b.joint), length: b.length * s })),
    parts: kit.parts.map((p) => ({ ...p, box: box(p.box) })),
    scale: s,
  }
}

/** The configuration without the kit's slots (what is still rendered + cut by the generic renderer: head, accessories…). */
export function withoutSlots(config: CharacterConfig, slots: string[]): CharacterConfig {
  return { ...config, parts: Object.fromEntries(Object.entries(config.parts).filter(([k]) => !slots.includes(k))) }
}

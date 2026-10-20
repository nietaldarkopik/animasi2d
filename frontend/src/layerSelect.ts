import { evalLayer } from './anim'
import type { Layer } from './types'

/** Selected layers that act for the whole selection: no selected ancestor (children already follow their parent). */
export function topMost(layers: Layer[], ids: string[]): string[] {
  const byId = new Map(layers.map((l) => [l.id, l]))
  const set = new Set(ids)
  return ids.filter((id) => {
    const l = byId.get(id)
    if (!l) return false
    for (let p = l.parentId, n = 0; p && n < 256; p = byId.get(p)?.parentId, n++) if (set.has(p)) return false
    return true
  })
}

/** x/y patches that move every (unlocked, top-most) selected layer by dx, dy from where it is at `frame`. */
export function nudgePatches(layers: Layer[], ids: string[], frame: number, dx: number, dy: number): Record<string, Partial<Layer>> {
  const out: Record<string, Partial<Layer>> = {}
  for (const id of topMost(layers, ids)) {
    const base = layers.find((l) => l.id === id)!
    if (base.locked) continue
    const l = evalLayer(base, frame)
    out[id] = { x: l.x + dx, y: l.y + dy }
  }
  return out
}

/** Layers Ctrl+A selects: everything that is not locked (locked = background and similar), bones only when they are shown. */
export const selectableIds = (layers: Layer[], showBones: boolean) => layers.filter((l) => !l.locked && (showBones || l.type !== 'bone')).map((l) => l.id)

import type { Layer } from './types'

export interface Box { x: number; y: number; w: number; h: number }
export interface PartDraft {
  /** stable key for the editor (not the layer id) */
  key: string
  name: string
  /** key of the parent part, or null for a root */
  parent: string | null
  box: Box
  /** joint in source-image pixels; null = derive a sensible default */
  joint: { x: number; y: number } | null
}

const center = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })

/** Default joint: the middle of the overlap with the parent (where a limb meets the body), else the part's own centre. */
export function defaultJoint(part: PartDraft, parent: PartDraft | undefined): { x: number; y: number } {
  if (part.joint) return part.joint
  if (parent) {
    const x0 = Math.max(part.box.x, parent.box.x)
    const y0 = Math.max(part.box.y, parent.box.y)
    const x1 = Math.min(part.box.x + part.box.w, parent.box.x + parent.box.w)
    const y1 = Math.min(part.box.y + part.box.h, parent.box.y + parent.box.h)
    if (x1 > x0 && y1 > y0) return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 }
  }
  return center(part.box)
}

const round = (n: number) => Math.round(n * 1000) / 1000

/**
 * Build rig layers (without assetId) for the parts so that every part sits exactly where it was in the source image.
 *
 * Child coordinates live in the parent's content space (origin = parent's content centre), the pivot is the joint
 * (relative to the part's own centre) and children keep scale 1 / rotation 0, so scaling or rotating a parent moves the
 * whole limb chain. Roots inherit the source layer's transform. Parts that are drawn *behind* their parent are not
 * possible in a nested rig ? children always render above the parent.
 */
export function composeParts(
  source: Pick<Layer, 'x' | 'y' | 'scaleX' | 'scaleY' | 'rotation' | 'pivotX' | 'pivotY' | 'parentId'>,
  imgW: number,
  imgH: number,
  parts: PartDraft[],
  newId: () => string,
): { layers: Omit<Layer, 'assetId' | 'type' | 'name'>[] & { key: string; name: string }[] } {
  const ids = new Map(parts.map((p) => [p.key, newId()]))
  const byKey = new Map(parts.map((p) => [p.key, p]))
  const u = (px: number, py: number) => ({ x: px - imgW / 2, y: py - imgH / 2 }) // image pixel -> centre-origin
  const r = (source.rotation * Math.PI) / 180
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  const toParentOfSource = (p: { x: number; y: number }) => {
    // point in the source layer's content space -> the source's parent space
    const dx = (p.x - (source.pivotX ?? 0)) * source.scaleX
    const dy = (p.y - (source.pivotY ?? 0)) * source.scaleY
    return { x: source.x + dx * cos - dy * sin, y: source.y + dx * sin + dy * cos }
  }

  const layers = parts.map((p) => {
    const parent = p.parent ? byKey.get(p.parent) : undefined
    const j = u(...(Object.values(defaultJoint(p, parent)) as [number, number]))
    const c = u(...(Object.values(center(p.box)) as [number, number]))
    const base = {
      key: p.key,
      name: p.name,
      id: ids.get(p.key)!,
      opacity: 1,
      visible: true,
      locked: false,
      pivotX: round(j.x - c.x),
      pivotY: round(j.y - c.y),
    }
    if (parent) {
      const pc = u(...(Object.values(center(parent.box)) as [number, number]))
      return { ...base, parentId: ids.get(parent.key)!, x: round(j.x - pc.x), y: round(j.y - pc.y), scaleX: 1, scaleY: 1, rotation: 0 }
    }
    const w = toParentOfSource(j)
    return { ...base, parentId: source.parentId ?? null, x: round(w.x), y: round(w.y), scaleX: source.scaleX, scaleY: source.scaleY, rotation: source.rotation }
  })
  return { layers } as never
}

interface PixelData { width: number; height: number; data: ArrayLike<number> }

/**
 * Shrink `box` to the bounding box of "content" pixels inside it: opaque pixels that differ from the background
 * colour (median of the image border). A 1px margin is kept. Returns the original box if nothing is found.
 */
export function snapBox(img: PixelData, box: Box, tolerance = 40): Box {
  const { width: W, height: H, data } = img
  const px = (x: number, y: number) => {
    const i = (y * W + x) * 4
    return [data[i], data[i + 1], data[i + 2], data[i + 3]] as const
  }
  const border: number[][] = [[], [], []]
  const step = Math.max(1, Math.floor(Math.max(W, H) / 200))
  const push = (x: number, y: number) => { const p = px(x, y); if (p[3] > 8) for (let c = 0; c < 3; c++) border[c].push(p[c]) }
  for (let x = 0; x < W; x += step) { push(x, 0); push(x, H - 1) }
  for (let y = 0; y < H; y += step) { push(0, y); push(W - 1, y) }
  const bg = border.map((a) => (a.length ? a.sort((p, q) => p - q)[a.length >> 1] : -1))
  const hasBg = bg[0] >= 0

  const x0 = Math.max(0, Math.floor(box.x)), y0 = Math.max(0, Math.floor(box.y))
  const x1 = Math.min(W, Math.ceil(box.x + box.w)), y1 = Math.min(H, Math.ceil(box.y + box.h))
  let minX = W, minY = H, maxX = -1, maxY = -1
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const [r, g, b, a] = px(x, y)
      if (a <= 8) continue
      if (hasBg && Math.abs(r - bg[0]) <= tolerance && Math.abs(g - bg[1]) <= tolerance && Math.abs(b - bg[2]) <= tolerance) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (maxX < 0) return box
  const m = 1
  const nx = Math.max(0, minX - m), ny = Math.max(0, minY - m)
  return { x: nx, y: ny, w: Math.min(W, maxX + 1 + m) - nx, h: Math.min(H, maxY + 1 + m) - ny }
}

import type { Layer, SceneDocument } from './types'

/** Straight-alpha RGBA pixels, row-major. */
export interface Pixels { w: number; h: number; data: Uint8ClampedArray }
export type Tool = 'erase' | 'restore' | 'paint'
export interface Brush { tool: Tool; radius: number; /** 0 = hard edge, 1 = fully feathered */ softness: number; color: [number, number, number]; /** per-stamp strength 0..1 */ flow: number }

export const clonePixels = (p: Pixels): Pixels => ({ w: p.w, h: p.h, data: new Uint8ClampedArray(p.data) })

/**
 * Apply one round brush stamp centred at (cx, cy) to `img`. `orig` supplies the pixels for the restore tool
 * (same size as `img`). Works in premultiplied space so semi-transparent edges blend correctly.
 */
export function stamp(img: Pixels, orig: Pixels, cx: number, cy: number, b: Brush): void {
  const { w, h, data } = img
  const r = Math.max(0.5, b.radius)
  const inner = r * (1 - Math.min(1, Math.max(0, b.softness)))
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(w - 1, Math.ceil(cx + r))
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(h - 1, Math.ceil(cy + r))
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
      if (d > r) continue
      const falloff = d <= inner ? 1 : (r - d) / Math.max(1e-6, r - inner)
      const a = Math.min(1, Math.max(0, falloff * b.flow))
      if (a <= 0) continue
      const i = (y * w + x) * 4
      const A = data[i + 3] / 255
      if (b.tool === 'erase') {
        data[i + 3] = Math.round(A * (1 - a) * 255)
      } else if (b.tool === 'paint') {
        const outA = a + A * (1 - a)
        for (let c = 0; c < 3; c++) data[i + c] = outA > 0 ? Math.round((b.color[c] * a + data[i + c] * A * (1 - a)) / outA) : 0
        data[i + 3] = Math.round(outA * 255)
      } else {
        const OA = orig.data[i + 3] / 255
        const outA = A * (1 - a) + OA * a
        for (let c = 0; c < 3; c++) {
          const pm = data[i + c] * A * (1 - a) + orig.data[i + c] * OA * a
          data[i + c] = outA > 0 ? Math.round(pm / outA) : 0
        }
        data[i + 3] = Math.round(outA * 255)
      }
    }
  }
}

/** Stamp along a segment so fast strokes stay continuous (spacing = a fraction of the radius). */
export function stampLine(img: Pixels, orig: Pixels, x0: number, y0: number, x1: number, y1: number, b: Brush): void {
  const dist = Math.hypot(x1 - x0, y1 - y0)
  const step = Math.max(1, b.radius / 4)
  const n = Math.max(1, Math.ceil(dist / step))
  for (let k = 1; k <= n; k++) stamp(img, orig, x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n, b)
}

/** Grow the canvas with transparent margins (to paint a cut-off part beyond the old edge). */
export function padPixels(img: Pixels, top: number, right: number, bottom: number, left: number): Pixels {
  const w = img.w + left + right
  const h = img.h + top + bottom
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < img.h; y++) data.set(img.data.subarray(y * img.w * 4, (y + 1) * img.w * 4), ((y + top) * w + left) * 4)
  return { w, h, data }
}

/** Shift of the image centre caused by padding, in old-image pixels. */
export const padShift = (top: number, right: number, bottom: number, left: number) => ({ x: (right - left) / 2, y: (bottom - top) / 2 })

/**
 * Keep a layer's artwork ? and everything rigged to it ? visually unchanged after its image grew asymmetrically.
 * Content coordinates are measured from the image centre, which moved by `c`: the pivot (a content point) shifts by -c,
 * the layer's own position stays, and children (positioned in this layer's content space) shift by -c, keyframes included.
 */
export function compensatePad(doc: SceneDocument, layerId: string, c: { x: number; y: number }): void {
  if (!c.x && !c.y) return
  const layer = doc.layers.find((l) => l.id === layerId)
  if (!layer) return
  layer.pivotX = (layer.pivotX ?? 0) - c.x
  layer.pivotY = (layer.pivotY ?? 0) - c.y
  const shiftKeys = (l: Layer, prop: 'x' | 'y', d: number) => l.keyframes?.[prop]?.forEach((k) => (k.v -= d))
  for (const child of doc.layers.filter((l) => l.parentId === layerId)) {
    child.x -= c.x
    child.y -= c.y
    shiftKeys(child, 'x', c.x)
    shiftKeys(child, 'y', c.y)
  }
}

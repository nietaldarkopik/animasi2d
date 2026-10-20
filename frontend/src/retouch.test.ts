import { describe, expect, it } from 'vitest'
import { worldPoint } from './anim'
import { compensatePad, padPixels, padShift, stamp, stampLine, type Brush, type Pixels } from './retouch'
import type { Layer, SceneDocument } from './types'

const solid = (w: number, h: number, rgba: [number, number, number, number]): Pixels => {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) data.set(rgba, i * 4)
  return { w, h, data }
}
const px = (p: Pixels, x: number, y: number) => Array.from(p.data.subarray((y * p.w + x) * 4, (y * p.w + x) * 4 + 4))
const brush = (o: Partial<Brush> = {}): Brush => ({ tool: 'erase', radius: 5, softness: 0, color: [255, 0, 0], flow: 1, ...o })

describe('brush', () => {
  it('erase clears alpha inside the radius only', () => {
    const img = solid(40, 40, [10, 20, 30, 255])
    stamp(img, img, 20, 20, brush())
    expect(px(img, 20, 20)[3]).toBe(0)
    expect(px(img, 20, 24)[3]).toBe(0)
    expect(px(img, 20, 27)).toEqual([10, 20, 30, 255])
    expect(px(img, 0, 0)).toEqual([10, 20, 30, 255])
  })
  it('soft edge fades smoothly and flow limits strength', () => {
    const img = solid(40, 40, [0, 0, 0, 255])
    stamp(img, img, 20, 20, brush({ radius: 10, softness: 1, flow: 0.5 }))
    expect(Math.abs(px(img, 20, 20)[3] - 128)).toBeLessThan(12) // centre: ~50% erased (flow 0.5)
    const mid = px(img, 20, 25)[3]
    const edge = px(img, 20, 29)[3]
    expect(mid).toBeGreaterThan(px(img, 20, 20)[3]) // less erased further out
    expect(edge).toBeGreaterThan(mid)
  })
  it('paint puts colour on transparent pixels and blends over opaque ones', () => {
    const img = solid(20, 20, [0, 0, 0, 0])
    stamp(img, img, 10, 10, brush({ tool: 'paint', color: [200, 50, 10] }))
    expect(px(img, 10, 10)).toEqual([200, 50, 10, 255])
    const half = solid(20, 20, [0, 0, 255, 255])
    stamp(half, half, 10, 10, brush({ tool: 'paint', color: [255, 0, 0], flow: 0.5 }))
    const [r, , b, a] = px(half, 10, 10)
    expect(a).toBe(255)
    expect(r).toBeGreaterThan(100); expect(b).toBeGreaterThan(100) // purple-ish mix
  })
  it('restore brings erased pixels back from the original', () => {
    const orig = solid(30, 30, [9, 99, 199, 255])
    const img = clone(orig)
    stamp(img, orig, 15, 15, brush({ radius: 8 })) // erase
    expect(px(img, 15, 15)[3]).toBe(0)
    stamp(img, orig, 15, 15, brush({ tool: 'restore', radius: 4 }))
    expect(px(img, 15, 15)).toEqual([9, 99, 199, 255])
    expect(px(img, 15, 21)[3]).toBe(0) // outside the restore radius stays erased
  })
  it('a long stroke leaves no gaps', () => {
    const img = solid(100, 20, [1, 1, 1, 255])
    stampLine(img, img, 5, 10, 95, 10, brush({ radius: 3 }))
    for (let x = 6; x <= 94; x++) expect(px(img, x, 10)[3]).toBe(0)
  })
})

function clone(p: Pixels): Pixels { return { w: p.w, h: p.h, data: new Uint8ClampedArray(p.data) } }

describe('padPixels', () => {
  it('keeps content at the right offset and adds transparent margins', () => {
    const p = padPixels(solid(2, 2, [5, 6, 7, 255]), 1, 3, 2, 4)
    expect([p.w, p.h]).toEqual([9, 5])
    expect(px(p, 4, 1)).toEqual([5, 6, 7, 255])
    expect(px(p, 5, 2)).toEqual([5, 6, 7, 255])
    expect(px(p, 0, 0)[3]).toBe(0)
    expect(px(p, 6, 1)[3]).toBe(0)
  })
  it('reports the centre shift', () => {
    expect(padShift(1, 3, 2, 4)).toEqual({ x: -0.5, y: 0.5 })
    expect(padShift(5, 5, 5, 5)).toEqual({ x: 0, y: 0 })
  })
})

describe('compensatePad keeps rigged artwork in place', () => {
  const L = (o: Partial<Layer> & { id: string }): Layer => ({ type: 'image', name: o.id, x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, visible: true, locked: false, ...o })
  const mk = (): SceneDocument => ({
    schema: 1, settings: { width: 1280, height: 720, fps: 24, duration: 5, background: '#fff' },
    layers: [
      L({ id: 'arm', x: 300, y: 200, rotation: 35, scaleX: 0.7, scaleY: 0.7, pivotX: 10, pivotY: -20 }),
      L({ id: 'hand', parentId: 'arm', x: 50, y: 80, keyframes: { x: [{ f: 0, v: 50, e: 'linear' }, { f: 10, v: 70, e: 'linear' }] } }),
    ],
  })
  it('a content point keeps its world position after asymmetric padding', () => {
    const d = mk()
    // pixel (u,v) measured from the OLD centre; after padding the new centre moved by c, so it becomes (u-c)
    const c = padShift(0, 40, 10, 0) // grew right by 40 and bottom by 10
    const probes = [[0, 0], [30, -12], [-25, 40]]
    const before = probes.map(([u, v]) => worldPoint(d, 'arm', 0, u, v))
    const handBefore = [worldPoint(d, 'hand', 0, 0, 0), worldPoint(d, 'hand', 10, 0, 0)]
    compensatePad(d, 'arm', c)
    probes.forEach(([u, v], i) => {
      const after = worldPoint(d, 'arm', 0, u - c.x, v - c.y)
      expect(after.x).toBeCloseTo(before[i].x, 6)
      expect(after.y).toBeCloseTo(before[i].y, 6)
    })
    // the child (and its keyframes) did not move
    expect(worldPoint(d, 'hand', 0, 0, 0).x).toBeCloseTo(handBefore[0].x, 6)
    expect(worldPoint(d, 'hand', 0, 0, 0).y).toBeCloseTo(handBefore[0].y, 6)
    expect(worldPoint(d, 'hand', 10, 0, 0).x).toBeCloseTo(handBefore[1].x, 6)
  })
  it('does nothing for symmetric padding', () => {
    const d = mk(); const snap = JSON.stringify(d)
    compensatePad(d, 'arm', padShift(5, 5, 5, 5))
    expect(JSON.stringify(d)).toBe(snap)
  })
})

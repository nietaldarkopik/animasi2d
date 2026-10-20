import { describe, expect, it } from 'vitest'
import { boxesIntersect, centerOf, marqueeHits, moveItems, normBox, rotateItems, scaleItems, toggle, unionBox, type Item } from './selection'
import { clampXform, fromCanvas, hitsPart, normDeg, orientedCorners, partBox, placement, toCanvas } from './spec'
import { centerOn, clampPan, clampZoom, fitViewport, fitZoom, panBy, renderScale, stageOf, toScreen, toUnits, zoomAt, ZOOM_MAX, ZOOM_MIN } from './viewport'

const view = { x: 0, y: 30, w: 400, h: 570 }
const stage = stageOf(view)

describe('viewport', () => {
  it('the stage is bigger than the export frame on every side', () => {
    expect(stage.x).toBeLessThan(view.x)
    expect(stage.y).toBeLessThan(view.y)
    expect(stage.x + stage.w).toBeGreaterThan(view.x + view.w)
    expect(stage.y + stage.h).toBeGreaterThan(view.y + view.h)
  })

  it('fit shows the whole frame, centred, with room around it', () => {
    const vp = fitViewport(900, 700, stage, view)
    expect(vp.zoom * view.h).toBeLessThanOrEqual(700)
    expect(vp.zoom * view.w).toBeLessThanOrEqual(900)
    const c = toScreen(vp, stage, view.x + view.w / 2, view.y + view.h / 2)
    expect(c.x).toBeCloseTo(450)
    expect(c.y).toBeCloseTo(350)
    expect(fitZoom(900, 700, view)).toBeCloseTo(Math.min(900 * 0.9 / 400, 700 * 0.9 / 570))
  })

  it('units and screen coordinates are inverses', () => {
    const vp = { zoom: 1.7, ox: 33, oy: -20 }
    const u = toUnits(vp, stage, 410, 250)
    const s = toScreen(vp, stage, u.x, u.y)
    expect([s.x, s.y]).toEqual([410, 250].map((n) => expect.closeTo(n, 6)))
  })

  it('zooming keeps the point under the cursor fixed', () => {
    const vp = centerOn(900, 700, stage, view, 1)
    const before = toUnits(vp, stage, 300, 200)
    const z = zoomAt(vp, 2, 300, 200)
    expect(z.zoom).toBeCloseTo(2)
    const after = toUnits(z, stage, 300, 200)
    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.y).toBeCloseTo(before.y, 6)
    // zooming out again returns to the same viewport
    const back = zoomAt(z, 0.5, 300, 200)
    expect(back.ox).toBeCloseTo(vp.ox, 6)
    expect(back.oy).toBeCloseTo(vp.oy, 6)
  })

  it('zoom is bounded and panning is clamped so the stage cannot be lost', () => {
    expect(clampZoom(100)).toBe(ZOOM_MAX)
    expect(clampZoom(0.001)).toBe(ZOOM_MIN)
    expect(zoomAt({ zoom: ZOOM_MAX, ox: 0, oy: 0 }, 5, 10, 10).zoom).toBe(ZOOM_MAX)
    const far = clampPan(panBy({ zoom: 1, ox: 0, oy: 0 }, 99999, -99999), 900, 700, stage)
    expect(far.ox).toBeLessThanOrEqual(900 - 120)
    expect(far.oy).toBeGreaterThanOrEqual(120 - stage.h)
  })

  it('render resolution follows the zoom within sane limits', () => {
    expect(renderScale(0.1)).toBe(0.6)
    expect(renderScale(1, 2)).toBe(2)
    expect(renderScale(6, 2)).toBe(3)
  })
})

describe('selection geometry', () => {
  const fb = { x0: 0.25, y0: 0.25, x1: 0.75, y1: 0.75 }
  const item = (slot: string, over: Partial<{ dx: number; dy: number; scale: number }> = {}, s = 'eyes'): Item => ({ slot, pl: placement(s, { width: 400, height: 800 }, { dx: 0, dy: 0, scale: 1, ...over }), frac: fb })
  const withXform = (i: Item, t: { dx: number; dy: number; scale: number }): Item => ({ ...i, pl: { ...i.pl, ...t } })

  it('union box and rectangle tests', () => {
    const a = { x0: 0, y0: 0, x1: 10, y1: 10 }, b = { x0: 5, y0: 5, x1: 30, y1: 8 }
    expect(unionBox([a, b])).toEqual({ x0: 0, y0: 0, x1: 30, y1: 10 })
    expect(unionBox([])).toBeNull()
    expect(boxesIntersect(a, b)).toBe(true)
    expect(boxesIntersect(a, { x0: 11, y0: 0, x1: 20, y1: 5 })).toBe(false)
    expect(normBox(10, 20, 2, 5)).toEqual({ x0: 2, y0: 5, x1: 10, y1: 20 })
    expect(centerOf(a)).toEqual({ x: 5, y: 5 })
  })

  it('marquee selects exactly the parts it touches', () => {
    const near = item('a'), far = item('b', { dx: 300 })
    expect(marqueeHits([near, far], normBox(90, 190, 120, 220))).toEqual(['a'])  // a's box is 100..300 x 200..600
    expect(marqueeHits([near, far], normBox(-50, -50, 450, 900)).sort()).toEqual(['a', 'b'])
    expect(marqueeHits([near, far], normBox(0, 700, 10, 710))).toEqual([])
  })

  it('moving a group shifts every part by the same amount', () => {
    const items = [item('a'), item('b', { dx: 20, dy: -5, scale: 1.5 })]
    const m = moveItems(items, 10, -4)
    expect(m.a).toEqual({ dx: 10, dy: -4, scale: 1 })
    expect(m.b).toEqual({ dx: 30, dy: -9, scale: 1.5 })
  })

  it('resizing a group scales each part and keeps the layout (distances grow by the same factor)', () => {
    const items = [item('a'), item('b', { dx: 100, dy: 40 })]
    const boxes = items.map((i) => partBox(i.pl, i.frac))
    const g = unionBox(boxes)!
    const pivot = centerOf(g)
    const out = scaleItems(items, 1.5, pivot)
    const after = items.map((i) => withXform(i, out[i.slot])).map((i) => partBox(i.pl, i.frac))
    const g2 = unionBox(after)!
    expect(centerOf(g2).x).toBeCloseTo(pivot.x, 1)           // the group centre stays put
    expect(centerOf(g2).y).toBeCloseTo(pivot.y, 1)
    expect(g2.x1 - g2.x0).toBeCloseTo((g.x1 - g.x0) * 1.5, 0) // the group got 1.5x bigger
    expect(g2.y1 - g2.y0).toBeCloseTo((g.y1 - g.y0) * 1.5, 0)
    const dBefore = centerOf(boxes[1]).x - centerOf(boxes[0]).x
    const dAfter = centerOf(after[1]).x - centerOf(after[0]).x
    expect(dAfter).toBeCloseTo(dBefore * 1.5, 0)             // relative offsets scale too
    expect(out.a.scale).toBeCloseTo(1.5)
  })

  it('scaling a single item about its own centre equals the single-part resize', () => {
    const i = item('a', { dx: 8, dy: 5, scale: 1.2 })
    const c = centerOf(partBox(i.pl, i.frac))
    const out = scaleItems([i], 2, c).a
    const after = partBox(withXform(i, out).pl, i.frac)
    expect(centerOf(after).x).toBeCloseTo(c.x, 1)
    expect(centerOf(after).y).toBeCloseTo(c.y, 1)
  })

  it('toggle adds and removes', () => {
    expect(toggle(['a'], 'b')).toEqual(['a', 'b'])
    expect(toggle(['a', 'b'], 'a')).toEqual(['b'])
  })
})

describe('rotation', () => {
  const fb = { x0: 0.25, y0: 0.25, x1: 0.75, y1: 0.75 } // visible box 200 x 400 units at (100..300, 200..600) in an unrotated 400x800 part
  const pl0 = (over: Partial<{ dx: number; dy: number; scale: number; rot: number }> = {}) => placement('eyes', { width: 400, height: 800 }, { dx: 0, dy: 0, scale: 1, ...over })
  const item = (over = {}): Item => ({ slot: 'a', pl: pl0(over), frac: fb })
  const withX = (i: Item, t: { dx: number; dy: number; scale: number; rot?: number }): Item => ({ ...i, pl: { ...i.pl, ...t, rot: t.rot ?? i.pl.rot } })

  it('normDeg wraps into (-180, 180]', () => {
    expect([normDeg(190), normDeg(-190), normDeg(360), normDeg(540), normDeg(-180), normDeg(180), normDeg(45)]).toEqual([-170, 170, 0, 180, 180, 180, 45])
  })

  it('toCanvas / fromCanvas stay inverse with a rotation, and 90° turns a vector a quarter turn', () => {
    const p = pl0({ dx: 7, dy: -3, scale: 1.4, rot: 33 })
    const back = fromCanvas(p, toCanvas(p, { x: 123, y: 456 }))
    expect([back.x, back.y]).toEqual([expect.closeTo(123, 6), expect.closeTo(456, 6)])
    const q = pl0({ rot: 90 })
    const t = toCanvas(q, { x: q.px + 10, y: q.py })   // 10 units to the right of the pivot ...
    expect([t.x, t.y]).toEqual([expect.closeTo(q.px, 6), expect.closeTo(q.py + 10, 6)]) // ... ends up 10 units BELOW it (clockwise on screen)
  })

  it('the oriented frame turns with the part; the axis-aligned box is the box around it', () => {
    const c = orientedCorners(pl0({ rot: 90 }), fb)
    const b = partBox(pl0({ rot: 90 }), fb)
    expect(b.x1 - b.x0).toBeCloseTo(400, 3)   // 200 wide x 400 high becomes 400 wide x 200 high
    expect(b.y1 - b.y0).toBeCloseTo(200, 3)
    // the first corner (top-left) of the frame is no longer top-left on screen after a quarter turn
    expect(c[0].x).toBeGreaterThan(c[2].x)
  })

  it('rotating one part keeps the centre of its artwork fixed, adds the angle and leaves the scale alone', () => {
    const i = item({ dx: 12, dy: 5, scale: 1.3 })
    const c = centerOf(partBox(i.pl, i.frac))
    const out = rotateItems([i], 40, c).a
    expect(out.rot).toBeCloseTo(40)
    expect(out.scale).toBeCloseTo(1.3)
    const after = withX(i, out as { dx: number; dy: number; scale: number; rot: number })
    const c2 = centerOf(partBox(after.pl, after.frac))
    expect([c2.x, c2.y]).toEqual([expect.closeTo(c.x, 1), expect.closeTo(c.y, 1)])
    // a full turn is the identity
    const full = rotateItems([i], 360, c).a
    expect([full.dx, full.dy, full.rot]).toEqual([expect.closeTo(i.pl.dx, 1), expect.closeTo(i.pl.dy, 1), 0])
  })

  it('rotating a group turns it like a rigid object about the pivot', () => {
    const a = item(), b = { ...item({ dx: 100, dy: 40 }), slot: 'b' }
    const g = unionBox([partBox(a.pl, a.frac), partBox(b.pl, b.frac)])!
    const pivot = centerOf(g)
    const out = rotateItems([a, b], 90, pivot)
    const centres = [a, b].map((i) => centerOf(partBox(withX(i, out[i.slot] as never).pl, i.frac)))
    const before = [a, b].map((i) => centerOf(partBox(i.pl, i.frac)))
    // each artwork centre swung 90° about the pivot (distances to the pivot unchanged; the angle between the two centres turned by 90°)
    for (const k of [0, 1]) expect(Math.hypot(centres[k].x - pivot.x, centres[k].y - pivot.y)).toBeCloseTo(Math.hypot(before[k].x - pivot.x, before[k].y - pivot.y), 1)
    const ang = (p: { x: number; y: number }, q: { x: number; y: number }) => (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI
    expect(normDeg(ang(centres[0], centres[1]) - ang(before[0], before[1]))).toBeCloseTo(90, 0)
    expect([out.a.rot, out.b.rot]).toEqual([90, 90])
  })

  it('hit-testing follows the rotation', () => {
    const mask = { w: 2, h: 2, a: new Uint8ClampedArray([255, 0, 0, 0]) } // only the top-left quarter of the image is visible
    const p = pl0()
    expect(hitsPart(p, mask, { x: 50, y: 100 })).toBe(true)
    const turned = pl0({ rot: 180 })  // half a turn about the slot anchor (200, 196): the visible quarter moves to the opposite corner
    expect(hitsPart(turned, mask, { x: 50, y: 100 })).toBe(false)
    expect(hitsPart(turned, mask, { x: 350, y: 292 })).toBe(true)
  })

  it('clampXform normalises the angle and only reports it when asked', () => {
    expect(clampXform({ dx: 0, dy: 0, scale: 1 }).rot).toBeUndefined()
    expect(clampXform({ dx: 0, dy: 0, scale: 1, rot: 365.123 }).rot).toBeCloseTo(5.12, 2)
    expect(clampXform({ dx: 0, dy: 0, scale: 1, rot: -190 }).rot).toBe(170)
  })
})

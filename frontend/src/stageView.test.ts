import { describe, expect, it } from 'vitest'
import { clampZoom, fitZoom, MAX_ZOOM, MIN_ZOOM, wheelFactor, zoomAt } from './stageView'

describe('stage zoom and pan', () => {
  it('zooming about the cursor keeps the scene point under the cursor in place', () => {
    const v = { zoom: 0.8, pan: { x: 30, y: -20 } }
    const c = { x: 140, y: 90 } // cursor offset from the centre of the work area
    const sceneUnder = (view: typeof v) => ({ x: (c.x - view.pan.x) / view.zoom, y: (c.y - view.pan.y) / view.zoom }) // scene units from the scene centre
    const before = sceneUnder(v)
    for (const f of [1.25, 0.5, 3, 1 / 1.25]) {
      const n = zoomAt(v, f, c)
      const a = sceneUnder(n)
      expect(a.x).toBeCloseTo(before.x, 6)
      expect(a.y).toBeCloseTo(before.y, 6)
    }
  })

  it('zooming about the centre only changes the zoom when the scene is centred', () => {
    expect(zoomAt({ zoom: 1, pan: { x: 0, y: 0 } }, 2)).toEqual({ zoom: 2, pan: { x: 0, y: 0 } })
    const n = zoomAt({ zoom: 1, pan: { x: 40, y: 10 } }, 2)
    expect(n.pan).toEqual({ x: 80, y: 20 }) // the offset scales with the zoom
  })

  it('is limited to the zoom range and does not drift at the limits', () => {
    expect(clampZoom(100)).toBe(MAX_ZOOM)
    expect(clampZoom(0.001)).toBe(MIN_ZOOM)
    const top = zoomAt({ zoom: MAX_ZOOM, pan: { x: 12, y: 7 } }, 2, { x: 50, y: 50 })
    expect(top).toEqual({ zoom: MAX_ZOOM, pan: { x: 12, y: 7 } })
  })

  it('wheel notches: up zooms in, down zooms out, large deltas are bounded', () => {
    expect(wheelFactor(-100)).toBeGreaterThan(1)
    expect(wheelFactor(100)).toBeLessThan(1)
    expect(wheelFactor(0)).toBe(1)
    expect(wheelFactor(-100000)).toBe(wheelFactor(-300))
  })

  it('fit never enlarges beyond 100% and leaves a margin', () => {
    expect(fitZoom({ w: 2000, h: 2000 }, { w: 1280, h: 720 })).toBe(1)
    expect(fitZoom({ w: 700, h: 500 }, { w: 1280, h: 720 })).toBeCloseTo((700 - 32) / 1280, 6)
    expect(fitZoom({ w: 10, h: 10 }, { w: 1280, h: 720 })).toBe(0.05)
  })
})

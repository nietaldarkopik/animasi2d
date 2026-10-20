import { describe, expect, it } from 'vitest'
import { BACK_Z, baseBox, effectiveZ, layerEntries, moveLayerZ, clampXform, DEFAULT_PALETTE, drawOrder, emptyConfig, EXPRESSIONS, fromCanvas, hitsPart, partBox, placement, scaleAboutCenter, tintSvg, toCanvas, VIEWS } from './spec'

describe('tintSvg', () => {
  const pal = { ...DEFAULT_PALETTE, hair: '#ff0000', accent: '#00ff00', skin: '#0000ff' }

  it('recolours the fill of filled regions', () => {
    const out = tintSvg('<svg><path d="M0 0" fill="#111" data-tint="hair" stroke="#26262e"/></svg>', pal)
    expect(out).toContain('fill="#ff0000"')
    expect(out).toContain('stroke="#26262e"') // outline untouched
  })

  it('recolours the stroke when the fill is none (brows, headphone band)', () => {
    const out = tintSvg('<svg><path d="M0 0" fill="none" stroke="#1f1b24" data-tint="hair" stroke-width="5"/></svg>', pal)
    expect(out).toContain('stroke="#ff0000"')
    expect(out).toContain('fill="none"')
  })

  it('recolours the frame (stroke) but not the translucent lens fill of glasses', () => {
    const out = tintSvg('<svg><circle cx="1" cy="1" r="9" fill="#cfe6f5" fill-opacity="0.22" stroke="#2e3440" data-tint="accent" stroke-width="4"/></svg>', pal)
    expect(out).toContain('fill="#cfe6f5"')
    expect(out).toContain('stroke="#00ff00"')
  })

  it('leaves untinted elements and unknown tints alone', () => {
    const src = '<svg><path d="M1 1" fill="#abc"/><path d="M2 2" fill="#def" data-tint="nope"/></svg>'
    expect(tintSvg(src, pal)).toBe(src)
  })

  it('handles several regions in one file', () => {
    const out = tintSvg('<svg><path fill="#1" data-tint="skin"/><ellipse fill="#2" data-tint="hair"/></svg>', pal)
    expect(out).toContain('fill="#0000ff"')
    expect(out).toContain('fill="#ff0000"')
  })
})

describe('placement', () => {
  it('full-canvas assets are drawn at the origin and transformed about the slot anchor', () => {
    const p = placement('hat', { width: 400, height: 800 }, { dx: 5, dy: -3, scale: 1.2 })
    expect([p.x, p.y, p.w, p.h]).toEqual([0, 0, 400, 800])
    expect([p.px, p.py, p.dx, p.dy, p.scale]).toEqual([200, 95, 5, -3, 1.2])
  })

  it('a canvas-aligned raster at 2x is still drawn over the whole canvas', () => {
    const p = placement('face', { width: 800, height: 1600 }, { dx: 0, dy: 0, scale: 1 })
    expect([p.x, p.y, p.w, p.h]).toEqual([0, 0, 400, 800])
  })

  it('an upload of another size is centred on the slot anchor and capped to its default width', () => {
    const p = placement('glasses', { width: 380, height: 100 }, { dx: 0, dy: 0, scale: 1 })
    expect(p.w).toBeCloseTo(190)
    expect(p.h).toBeCloseTo(50)
    expect(p.x + p.w / 2).toBeCloseTo(200)
    expect(p.y + p.h / 2).toBeCloseTo(196)
  })

  it('defaults missing transform values', () => {
    const p = placement('top', { width: 400, height: 800 }, {} as never)
    expect([p.dx, p.dy, p.scale]).toEqual([0, 0, 1])
  })
})

describe('layout', () => {
  it('draws parts back-to-front by category z-order', () => {
    const cfg = { ...emptyConfig(), parts: { eyes: { assetId: 1, dx: 0, dy: 0, scale: 1 }, body: { assetId: 2, dx: 0, dy: 0, scale: 1 }, hat: { assetId: 3, dx: 0, dy: 0, scale: 1 } } }
    const z: Record<string, number> = { body: 2, eyes: 10, hat: 14 }
    expect(drawOrder(cfg, (s) => z[s])).toEqual(['body', 'eyes', 'hat'])
  })

  it('half body is a crop of the same canvas, full body is taller', () => {
    expect(VIEWS.half.w).toBe(VIEWS.full.w)
    expect(VIEWS.half.y).toBe(VIEWS.full.y)
    expect(VIEWS.full.h).toBeGreaterThan(VIEWS.half.h)
    expect(VIEWS.full.y + VIEWS.full.h).toBeLessThanOrEqual(800)
  })

  it('expression presets only touch eyes, brows and mouth', () => {
    for (const e of EXPRESSIONS) expect(Object.keys(e.keys).sort()).toEqual(['brows', 'eyes', 'mouth'])
  })
})

describe('direct manipulation geometry', () => {
  const fb = { x0: 0.25, y0: 0.25, x1: 0.75, y1: 0.75 }
  const pl = (x: Partial<{ dx: number; dy: number; scale: number }> = {}) => placement('eyes', { width: 400, height: 800 }, { dx: 0, dy: 0, scale: 1, ...x })

  it('toCanvas and fromCanvas are inverses', () => {
    const p = pl({ dx: 13, dy: -7, scale: 1.7 })
    const back = fromCanvas(p, toCanvas(p, { x: 123, y: 456 }))
    expect(back.x).toBeCloseTo(123)
    expect(back.y).toBeCloseTo(456)
  })

  it('the visible box follows move and scale', () => {
    const base = partBox(pl(), fb)
    expect([base.x0, base.y0, base.x1, base.y1]).toEqual([100, 200, 300, 600])
    const moved = partBox(pl({ dx: 10, dy: -20 }), fb)
    expect([moved.x0, moved.y0]).toEqual([110, 180])
    const big = partBox(pl({ scale: 2 }), fb)
    expect(big.x1 - big.x0).toBeCloseTo(400)
  })

  it('scaleAboutCenter keeps the centre of the visible box fixed', () => {
    const start = pl({ dx: 8, dy: 5, scale: 1.2 })
    const before = partBox(start, fb)
    const t = scaleAboutCenter(start, fb, 2)
    const after = partBox({ ...start, ...t }, fb)
    expect((after.x0 + after.x1) / 2).toBeCloseTo((before.x0 + before.x1) / 2, 0)
    expect((after.y0 + after.y1) / 2).toBeCloseTo((before.y0 + before.y1) / 2, 0)
    expect(after.x1 - after.x0).toBeCloseTo((before.x1 - before.x0) * (2 / 1.2), 0)
  })

  it('clamps to the limits the server accepts', () => {
    expect(clampXform({ dx: 999, dy: -999, scale: 9 })).toEqual({ dx: 400, dy: -800, scale: 4 })
    expect(clampXform({ dx: 0, dy: 0, scale: 0.01 }).scale).toBe(0.2)
  })

  it('hit-test uses the alpha mask through the part transform', () => {
    const mask = { w: 2, h: 2, a: new Uint8ClampedArray([255, 0, 0, 0]) } // only the top-left quarter of the image is visible
    const p = pl()
    expect(hitsPart(p, mask, { x: 50, y: 100 })).toBe(true)
    expect(hitsPart(p, mask, { x: 350, y: 700 })).toBe(false)
    expect(hitsPart(p, mask, { x: -5, y: 100 })).toBe(false)
    const moved = pl({ dx: 100 })
    expect(hitsPart(moved, mask, { x: 50, y: 100 })).toBe(false) // the part moved away
    expect(hitsPart(moved, mask, { x: 150, y: 100 })).toBe(true)
    expect(baseBox(p, fb).x0).toBe(100)
  })
})

describe('layering', () => {
  const z: Record<string, number> = { hair_back: 1, body: 2, top: 5, face: 7, hair_front: 8, hat: 14 }
  const zOf = (s: string) => z[s] ?? 0
  const P = (extra: object = {}) => ({ assetId: 1, dx: 0, dy: 0, scale: 1, ...extra })
  const cfg = (parts: Record<string, object>) => ({ ...emptyConfig(), parts: parts as never })

  it('a part uses its category order unless it has a z override', () => {
    const c = cfg({ top: P(), hat: P({ z: 3 }) })
    expect(effectiveZ(c, 'top', zOf)).toBe(5)
    expect(effectiveZ(c, 'hat', zOf)).toBe(3)
    expect(layerEntries(c, zOf).map((e) => e.slot)).toEqual(['hat', 'top']) // the hat now sits behind the top
  })

  it('a split part is drawn twice: whole BEHIND the body, and only the part above the line IN FRONT', () => {
    const c = cfg({ body: P(), top: P(), face: P(), hair_front: P({ split: 326 }) })
    const e = layerEntries(c, zOf)
    const hairs = e.filter((x) => x.slot === 'hair_front')
    expect(hairs.map((x) => x.pass)).toEqual(['back', 'front'])
    expect(hairs[0]).toMatchObject({ z: BACK_Z, clipFromY: 324 })
    expect(hairs[1]).toMatchObject({ z: 8, clipToY: 326 })
    const order = e.map((x) => `${x.slot}:${x.pass}`)
    // back copy < body < top < face < front copy: the shirt is "between" the two hair layers
    expect(order.indexOf('hair_front:back')).toBeLessThan(order.indexOf('body:whole'))
    expect(order.indexOf('top:whole')).toBeLessThan(order.indexOf('hair_front:front'))
  })

  it('without split nothing is duplicated', () => {
    expect(layerEntries(cfg({ top: P(), face: P() }), zOf)).toHaveLength(2)
  })

  it('moveLayerZ moves a part exactly one step and leaves the others alone', () => {
    const c = cfg({ body: P(), top: P(), face: P(), hat: P() })
    const up = moveLayerZ(c, 'top', 1, zOf)!   // top (5) over face (7)
    const moved = cfg({ body: P(), top: P({ z: up }), face: P(), hat: P() })
    expect(drawOrder(moved, zOf)).toEqual(['body', 'face', 'top', 'hat'])
    const down = moveLayerZ(moved, 'top', -1, zOf)!
    expect(drawOrder(cfg({ body: P(), top: P({ z: down }), face: P(), hat: P() }), zOf)).toEqual(['body', 'top', 'face', 'hat'])
  })

  it('moveLayerZ returns null at the ends and handles repeated moves between the same neighbours', () => {
    const c = cfg({ body: P(), top: P(), face: P() })
    expect(moveLayerZ(c, 'body', -1, zOf)).toBeNull()
    expect(moveLayerZ(c, 'face', 1, zOf)).toBeNull()
    let cur = cfg({ a: P({ z: 1 }), b: P({ z: 2 }), c: P({ z: 3 }) })
    for (let i = 0; i < 8; i++) { // bubble 'a' up and down: precision must hold
      const upZ = moveLayerZ(cur, 'a', 1, () => 0)
      if (upZ !== null) cur = cfg({ ...(cur.parts as Record<string, object>), a: P({ z: upZ }) })
    }
    expect(drawOrder(cur, () => 0)).toEqual(['b', 'c', 'a'])
  })
})

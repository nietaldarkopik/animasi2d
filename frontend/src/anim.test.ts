import { describe, expect, it } from 'vitest'
import { PRESETS, applyPreset, evalAll, evalProp, worldMatrix, worldPoint } from './anim'
import type { Layer, SceneDocument } from './types'

const L = (o: Partial<Layer> & { id: string }): Layer => ({
  type: 'bone', name: o.id, x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, visible: true, locked: false, pivotX: 0, pivotY: 0, length: 100, ...o,
})
const doc = (layers: Layer[]): SceneDocument => ({ schema: 1, settings: { width: 1280, height: 720, fps: 24, duration: 5, background: '#ffffff' }, layers })
const tip = (d: SceneDocument, id: string, f = 0) => worldPoint(d, id, f, d.layers.find((l) => l.id === id)!.length ?? 100, 0)

describe('FK hierarchy', () => {
  it('rotating the parent carries the child', () => {
    const d = doc([L({ id: 'p', x: 100, y: 100, rotation: 90 }), L({ id: 'c', parentId: 'p', x: 100 })])
    const w = worldMatrix(d, d.layers[1], 0)
    expect(w.tx).toBeCloseTo(100, 5) // child joint: 100 along parent's rotated +x => straight down
    expect(w.ty).toBeCloseTo(200, 5)
  })
})

describe('2-bone IK', () => {
  const rig = (target: { x: number; y: number }, bend: 1 | -1 = 1) =>
    doc([
      L({ id: 'upper', x: 0, y: 0 }),
      L({ id: 'lower', parentId: 'upper', x: 100, ik: { target: 'goal', bend } }),
      L({ id: 'goal', type: 'shape', x: target.x, y: target.y }),
    ])

  for (const bend of [1, -1] as const) {
    it(`reaches a reachable target (bend ${bend})`, () => {
      const d = rig({ x: 120, y: 80 }, bend)
      const t = tip(d, 'lower')
      expect(t.x).toBeCloseTo(120, 3)
      expect(t.y).toBeCloseTo(80, 3)
    })
  }

  it('bend flips the elbow side', () => {
    const e = (b: 1 | -1) => worldPoint(rig({ x: 120, y: 80 }, b), 'lower', 0).y
    expect(Math.sign(e(1))).toBe(-Math.sign(e(-1)) || 1)
  })

  it('straightens toward an unreachable target without NaN', () => {
    const d = rig({ x: 1000, y: 0 })
    const t = tip(d, 'lower')
    expect(Number.isFinite(t.x) && Number.isFinite(t.y)).toBe(true)
    expect(t.x).toBeCloseTo(200, 0)
  })

  it('follows an animated target', () => {
    const d = rig({ x: 0, y: 0 })
    d.layers[2].keyframes = { x: [{ f: 0, v: 150, e: 'linear' }, { f: 10, v: 50, e: 'linear' }], y: [{ f: 0, v: 50, e: 'linear' }, { f: 10, v: 120, e: 'linear' }] }
    for (const f of [0, 5, 10]) {
      const t = tip(d, 'lower', f)
      expect(t.x).toBeCloseTo(evalProp(d.layers[2], 'x', f), 3)
      expect(t.y).toBeCloseTo(evalProp(d.layers[2], 'y', f), 3)
    }
  })

  it('works under a rotated, translated grandparent', () => {
    const d = doc([
      L({ id: 'root', x: 300, y: 200, rotation: 30 }),
      L({ id: 'upper', parentId: 'root', x: 20, y: 10 }),
      L({ id: 'lower', parentId: 'upper', x: 100, ik: { target: 'goal', bend: 1 } }),
      L({ id: 'goal', type: 'shape', x: 380, y: 330 }),
    ])
    const t = tip(d, 'lower')
    expect(t.x).toBeCloseTo(380, 2)
    expect(t.y).toBeCloseTo(330, 2)
  })

  it('evalAll leaves non-IK layers untouched', () => {
    const d = rig({ x: 120, y: 80 })
    expect(evalAll(d, 0).get('goal')!.x).toBe(120)
  })
})

describe('motion presets', () => {
  const base = L({ id: 'a', type: 'shape', x: 100, y: 200 })

  for (const p of PRESETS) {
    it(`${p.id}: writes sorted, unique, in-range keys on declared props only`, () => {
      const l = { ...base }
      applyPreset(l, p.id, p.defaults, 10, 24, base)
      const end = 10 + Math.round(p.defaults.duration * 24) + 8
      expect(Object.keys(l.keyframes ?? {}).sort()).toEqual([...p.props].sort())
      for (const ks of Object.values(l.keyframes!)) {
        expect(ks!.length).toBeGreaterThanOrEqual(2)
        ks!.forEach((k, i) => {
          expect(Number.isFinite(k.v)).toBe(true)
          expect(k.f).toBeGreaterThanOrEqual(10)
          expect(k.f).toBeLessThanOrEqual(end)
          if (i) expect(k.f).toBeGreaterThan(ks![i - 1].f)
        })
      }
    })
  }

  it('swing oscillates around the base within amplitude', () => {
    const l = { ...base, rotation: 10 }
    applyPreset(l, 'swing', { duration: 2, amount: 30, cycles: 2, phase: 0 }, 0, 24, l)
    let lo = 1e9, hi = -1e9
    for (let f = 0; f <= 48; f++) { const v = evalProp(l, 'rotation', f); lo = Math.min(lo, v); hi = Math.max(hi, v) }
    expect(hi).toBeGreaterThan(10 + 25)
    expect(hi).toBeLessThanOrEqual(10 + 30 + 1e-6)
    expect(lo).toBeLessThan(10 - 25)
  })

  it('opposite phases give opposite swings (walk cycle limbs)', () => {
    const a = { ...base }, b = { ...base }
    applyPreset(a, 'swing', { duration: 2, amount: 30, cycles: 2, phase: 0 }, 0, 24, a)
    applyPreset(b, 'swing', { duration: 2, amount: 30, cycles: 2, phase: 180 }, 0, 24, b)
    for (const f of [6, 18, 30]) expect(evalProp(a, 'rotation', f) + evalProp(b, 'rotation', f)).toBeCloseTo(0, 0)
  })

  it('walk travels the requested distance', () => {
    const l = { ...base }
    applyPreset(l, 'walk', { duration: 2, amount: 300, cycles: 4, phase: 0 }, 0, 24, l)
    expect(evalProp(l, 'x', 48)).toBeCloseTo(400, 5)
  })

  it('replaces keys inside the range but keeps those outside', () => {
    const l: Layer = { ...base, keyframes: { rotation: [{ f: 0, v: 5, e: 'linear' }, { f: 30, v: 99, e: 'linear' }, { f: 500, v: 7, e: 'linear' }] } }
    applyPreset(l, 'swing', { duration: 1, amount: 10, cycles: 1, phase: 0 }, 20, 24, base)
    const fs = l.keyframes!.rotation!.map((k) => k.f)
    expect(fs).toContain(0)
    expect(fs).toContain(500)
    expect(l.keyframes!.rotation!.find((k) => k.v === 99)).toBeUndefined()
  })
})

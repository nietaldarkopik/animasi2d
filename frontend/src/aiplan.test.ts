import { describe, expect, it } from 'vitest'
import { applyMotionPlan, evalProp } from './anim'
import type { MotionPlan } from './anim'
import type { Layer, SceneDocument } from './types'

const L = (o: Partial<Layer> & { id: string }): Layer => ({ type: 'bone', name: o.id, x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, visible: true, locked: false, ...o })
const doc = (layers: Layer[]): SceneDocument => ({ schema: 1, settings: { width: 1280, height: 720, fps: 24, duration: 2, background: '#ffffff' }, layers })
const plan = (tracks: MotionPlan['tracks'], duration = 2): MotionPlan => ({ duration, tracks, notes: '', dropped: [] })

describe('applyMotionPlan', () => {
  it('bakes seconds into frames at the playhead and interpolates', () => {
    const d = doc([L({ id: 'a' })])
    const r = applyMotionPlan(d, plan([{ layer: 'a', name: 'a', prop: 'rotation', keys: [{ t: 0, v: 0, e: 'linear' }, { t: 1, v: 40, e: 'linear' }] }]), 12)
    expect(r).toEqual({ applied: 1, skipped: 0 })
    expect(d.layers[0].keyframes!.rotation!.map((k) => k.f)).toEqual([12, 36])
    expect(evalProp(d.layers[0], 'rotation', 24)).toBeCloseTo(20, 5)
  })
  it('skips missing layers and IK-driven rotation, keeps other keys outside the range', () => {
    const d = doc([L({ id: 'up' }), L({ id: 'low', parentId: 'up', ik: { target: 'g', bend: 1 } }), L({ id: 'g' }),
      L({ id: 'free', keyframes: { rotation: [{ f: 0, v: 1, e: 'linear' }, { f: 100, v: 9, e: 'linear' }] } })])
    const keys = [{ t: 0, v: 0, e: 'linear' as const }, { t: 1, v: 5, e: 'linear' as const }]
    const r = applyMotionPlan(d, plan([
      { layer: 'up', name: 'up', prop: 'rotation', keys },
      { layer: 'nope', name: 'x', prop: 'x', keys },
      { layer: 'g', name: 'g', prop: 'x', keys },
      { layer: 'free', name: 'free', prop: 'rotation', keys },
    ]), 10)
    expect(r).toEqual({ applied: 2, skipped: 2 })
    expect(d.layers[0].keyframes).toBeUndefined()
    expect(d.layers[3].keyframes!.rotation!.map((k) => k.f)).toEqual([0, 10, 34, 100])
  })
  it('extends the scene when the motion runs past the end', () => {
    const d = doc([L({ id: 'a' })])
    applyMotionPlan(d, plan([{ layer: 'a', name: 'a', prop: 'y', keys: [{ t: 0, v: 0, e: 'linear' }, { t: 3, v: 1, e: 'linear' }] }], 3), 24)
    expect(d.settings.duration).toBe(4)
  })
})

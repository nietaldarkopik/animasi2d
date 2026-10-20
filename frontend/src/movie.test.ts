import { describe, expect, it } from 'vitest'
import { audibleAt, cloneScene, effectAt, locate, mergeView, migrate, sceneStart, sceneView, totalDuration } from './movie'
import type { Layer, ProjectDoc, Scene } from './types'

const L = (id: string, o: Partial<Layer> = {}): Layer => ({ id, type: 'bone', name: id, x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, visible: true, locked: false, ...o })
const S = (id: string, duration: number, o: Partial<Scene> = {}): Scene => ({ id, name: id, duration, background: '#ffffff', transition: null, layers: [], ...o })
const P = (scenes: Scene[]): ProjectDoc => ({ schema: 2, settings: { width: 1000, height: 500, fps: 24 }, scenes, audio: [] })

describe('migrate', () => {
  it('turns a schema-1 document into one scene and keeps schema-2 untouched', () => {
    const p = migrate({ settings: { width: 800, height: 600, fps: 30, duration: 7, background: '#112233' }, layers: [L('a')] })
    expect(p.scenes).toHaveLength(1)
    expect(p.scenes[0]).toMatchObject({ duration: 7, background: '#112233' })
    expect(p.scenes[0].layers[0].id).toBe('a')
    expect(p.settings).toEqual({ width: 800, height: 600, fps: 30 })
    const v2 = P([S('x', 3)])
    expect(migrate(v2).scenes[0].id).toBe('x')
  })
})

describe('view <-> project', () => {
  it('round-trips edits of the active scene and project-wide settings, leaving other scenes alone', () => {
    const p = P([S('a', 2, { background: '#111111', layers: [L('l1')] }), S('b', 4)])
    const view = sceneView(p, 'a')
    expect(view.settings).toMatchObject({ width: 1000, duration: 2, background: '#111111' })
    const edited = { ...view, settings: { ...view.settings, duration: 6, width: 640, background: '#222222' }, layers: [L('l1'), L('l2')] }
    const q = mergeView(p, 'a', edited)
    expect(q.scenes[0]).toMatchObject({ duration: 6, background: '#222222' })
    expect(q.scenes[0].layers).toHaveLength(2)
    expect(q.scenes[1]).toBe(p.scenes[1])
    expect(q.settings.width).toBe(640)
  })
})

describe('film timeline', () => {
  const p = P([S('a', 2), S('b', 3), S('c', 1)])
  it('totals and scene starts', () => {
    expect(totalDuration(p)).toBe(6)
    expect([0, 1, 2].map((i) => sceneStart(p, i))).toEqual([0, 2, 5])
  })
  it('locates the scene for a film time (and clamps at the ends)', () => {
    expect(locate(p, 0.5)).toMatchObject({ index: 0, local: 0.5 })
    expect(locate(p, 2)).toMatchObject({ index: 1, local: 0 })
    expect(locate(p, 4.9)).toMatchObject({ index: 1 })
    expect(locate(p, 5.5)).toMatchObject({ index: 2, local: 0.5 })
    expect(locate(p, 99)).toMatchObject({ index: 2, local: 1 })
    expect(locate(p, -3)).toMatchObject({ index: 0, local: 0 })
  })
})

describe('transitions (dip style: out in the first half, in during the second)', () => {
  const p = P([S('a', 2, { transition: { type: 'fade', duration: 1 } }), S('b', 2, { transition: { type: 'slideLeft', duration: 1 } }), S('c', 2)])
  it('fade: scene a darkens during its last half-duration only', () => {
    expect(effectAt(p, 0, 1.0, 1000)).toBeNull()
    expect(effectAt(p, 0, 1.5, 1000)).toBeNull() // boundary of the half window
    const mid = effectAt(p, 0, 1.75, 1000) as any
    expect(mid).toMatchObject({ kind: 'fade', color: '#000000' })
    expect(mid.alpha).toBeGreaterThan(0.3); expect(mid.alpha).toBeLessThan(0.7)
    expect((effectAt(p, 0, 2, 1000) as any).alpha).toBeCloseTo(1, 5)
  })
  it('fade: scene b starts dark and clears during the first half-duration', () => {
    expect((effectAt(p, 1, 0, 1000) as any).alpha).toBeCloseTo(1, 5)
    expect(effectAt(p, 1, 0.5, 1000)).toBeNull()
    expect(effectAt(p, 1, 1.0, 1000)).toBeNull()
  })
  it('slide: out to the left, next scene enters from the right', () => {
    expect((effectAt(p, 1, 2, 1000) as any).offsetX).toBeCloseTo(-1000, 5)
    expect(effectAt(p, 1, 1.9, 1000)).toMatchObject({ kind: 'slide' })
    expect((effectAt(p, 1, 1.9, 1000) as any).offsetX).toBeLessThan(0)
    // scene c comes after a slideLeft transition: it starts off-screen on the right
    expect((effectAt(p, 2, 0, 1000) as any).offsetX).toBeCloseTo(1000, 5)
    expect(effectAt(p, 2, 1, 1000)).toBeNull()
  })
  it('the last scene has no outgoing effect, "none" does nothing, and long transitions are clamped to the scenes', () => {
    expect(effectAt(p, 2, 2, 1000)).toBeNull()
    const q = P([S('a', 2, { transition: { type: 'none', duration: 1 } }), S('b', 2)])
    expect(effectAt(q, 0, 2, 1000)).toBeNull()
    const short = P([S('a', 4, { transition: { type: 'fade', duration: 3 } }), S('b', 0.5)])
    expect(effectAt(short, 0, 3.7, 1000)).toBeNull() // clamped to the short scene: only the last 0.25s
    expect(effectAt(short, 0, 3.9, 1000)).not.toBeNull()
  })
})

describe('cloneScene', () => {
  it('gives layers fresh ids and keeps parent links and IK targets consistent', () => {
    const sc = S('a', 2, { layers: [L('root'), L('mid', { parentId: 'root' }), L('tip', { parentId: 'mid', ik: { target: 'goal', bend: 1 } }), L('goal')] })
    let n = 0
    const c = cloneScene(sc, 'a2', 'Salinan', () => 'n' + n++)
    expect(c.id).toBe('a2')
    expect(c.layers.map((l) => l.id)).toEqual(['n0', 'n1', 'n2', 'n3'])
    expect(c.layers[1].parentId).toBe('n0')
    expect(c.layers[2].parentId).toBe('n1')
    expect(c.layers[2].ik!.target).toBe('n3')
    expect(sc.layers[1].parentId).toBe('root') // original untouched
  })
})

describe('audibleAt', () => {
  it('picks the clips covering a time, with the offset into the file', () => {
    const clips = [{ id: 'a', assetId: 1, name: 'a', start: 1, volume: 1 }, { id: 'b', assetId: 2, name: 'b', start: 0, volume: 1 }]
    const d = { 1: 2, 2: 0.5 }
    expect(audibleAt(clips, d, 1.5).map(([c, o]) => [c.id, o])).toEqual([['a', 0.5]])
    expect(audibleAt(clips, d, 0.2).map(([c, o]) => [c.id, o])).toEqual([['b', 0.2]])
    expect(audibleAt(clips, d, 3.1)).toEqual([])
  })
})

import { describe, expect, it } from 'vitest'
import { worldPoint } from './anim'
import { composeParts, defaultJoint, snapBox } from './rigparts'
import type { PartDraft } from './rigparts'
import type { Layer, SceneDocument } from './types'

const doc = (layers: Layer[]): SceneDocument => ({ schema: 1, settings: { width: 1280, height: 720, fps: 24, duration: 5, background: '#fff' }, layers })
let n = 0
const id = () => 'p' + n++

function build(source: Parameters<typeof composeParts>[0], parts: PartDraft[], W = 400, H = 600) {
  n = 0
  const { layers } = composeParts(source, W, H, parts, id) as unknown as { layers: (Layer & { key: string })[] }
  const full = layers.map((l) => ({ ...l, type: 'image' as const }))
  return { d: doc(full), byKey: Object.fromEntries(full.map((l) => [l.key, l])) }
}
const parts: PartDraft[] = [
  { key: 'body', name: 'Badan', parent: null, box: { x: 100, y: 200, w: 200, h: 300 }, joint: { x: 200, y: 450 } },
  { key: 'arm', name: 'Lengan', parent: 'body', box: { x: 40, y: 220, w: 70, h: 200 }, joint: { x: 100, y: 240 } },
  { key: 'hand', name: 'Tangan', parent: 'arm', box: { x: 30, y: 400, w: 60, h: 80 }, joint: null },
]
const src = (o = {}) => ({ x: 640, y: 360, scaleX: 0.5, scaleY: 0.5, rotation: 0, parentId: null, ...o })
/** where a pixel of the source image lands on the scene */
const sceneOf = (s: ReturnType<typeof src> & { pivotX?: number; pivotY?: number }, px: number, py: number, W = 400, H = 600) => {
  const r = (s.rotation * Math.PI) / 180
  const dx = (px - W / 2 - (s.pivotX ?? 0)) * s.scaleX, dy = (py - H / 2 - (s.pivotY ?? 0)) * s.scaleY
  return { x: s.x + dx * Math.cos(r) - dy * Math.sin(r), y: s.y + dx * Math.sin(r) + dy * Math.cos(r) }
}

describe('composeParts keeps every part exactly where it was', () => {
  for (const [label, s] of [['plain', src()], ['rotated + scaled', src({ rotation: 33, scaleX: 0.8, scaleY: 0.8 })], ['with pivot', src({ rotation: -20, pivotX: 15, pivotY: -40 })]] as const) {
    it(label, () => {
      const { d, byKey } = build(s, parts)
      for (const p of parts) {
        const c = { x: p.box.x + p.box.w / 2, y: p.box.y + p.box.h / 2 }
        const got = worldPoint(d, byKey[p.key].id, 0, 0, 0) // world position of the part's content centre
        const want = sceneOf(s, c.x, c.y)
        expect(got.x).toBeCloseTo(want.x, 2)
        expect(got.y).toBeCloseTo(want.y, 2)
      }
    })
  }
  it('builds the hierarchy and puts pivots at the joints', () => {
    const { byKey } = build(src(), parts)
    expect(byKey.arm.parentId).toBe(byKey.body.id)
    expect(byKey.hand.parentId).toBe(byKey.arm.id)
    expect(byKey.body.parentId).toBeNull()
    // arm joint (100,240) relative to arm centre (75,320)
    expect([byKey.arm.pivotX, byKey.arm.pivotY]).toEqual([25, -80])
    expect([byKey.arm.scaleX, byKey.hand.rotation]).toEqual([1, 0])
  })
  it('rotating a parent about its joint carries the child (FK) around the joint', () => {
    const { d, byKey } = build(src({ scaleX: 1, scaleY: 1 }), parts)
    const armJoint = worldPoint(d, byKey.arm.id, 0, byKey.arm.pivotX!, byKey.arm.pivotY!) // joint, world
    const before = worldPoint(d, byKey.hand.id, 0)
    byKey.arm.rotation = 90
    const after = worldPoint(d, byKey.hand.id, 0)
    const dist = (a: { x: number; y: number }) => Math.hypot(a.x - armJoint.x, a.y - armJoint.y)
    expect(dist(after)).toBeCloseTo(dist(before), 3) // swung around the joint
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(50)
  })
})

describe('defaultJoint', () => {
  it('uses the middle of the overlap with the parent, else the centre', () => {
    const j = defaultJoint(parts[2], parts[1])
    expect(j).toEqual({ x: 65, y: 410 }) // hand overlaps arm in x 40..90, y 400..420
    expect(defaultJoint({ ...parts[2], box: { x: 300, y: 0, w: 10, h: 10 } }, parts[1])).toEqual({ x: 305, y: 5 })
  })
})

describe('snapBox', () => {
  const W = 100, H = 100
  const data = new Uint8ClampedArray(W * H * 4).fill(255)
  for (let y = 40; y < 60; y++) for (let x = 30; x < 70; x++) { const i = (y * W + x) * 4; data[i] = 20; data[i + 1] = 80; data[i + 2] = 200 }
  it('shrinks an oversized box onto the content', () => {
    expect(snapBox({ width: W, height: H, data }, { x: 10, y: 20, w: 80, h: 70 })).toEqual({ x: 29, y: 39, w: 42, h: 22 })
  })
  it('keeps the box when it contains only background', () => {
    const b = { x: 0, y: 0, w: 20, h: 20 }
    expect(snapBox({ width: W, height: H, data }, b)).toEqual(b)
  })
})

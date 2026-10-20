import { describe, expect, it } from 'vitest'
import { worldMatrix } from '../anim'
import type { Layer, SceneDocument } from '../types'
import { buildRigLayers, fitScale, SKELETON, sceneOf, type PieceSpec } from './rig'

const scene = { width: 1280, height: 720 }
const k = 0.8
let n = 0
const newId = () => `id${++n}`

const piece = (key: string, bone: string, box: [number, number, number, number], order = 0): PieceSpec => ({ key, name: key, bone, order, assetId: 7, box: { x0: box[0], y0: box[1], x1: box[2], y1: box[3] } })
const pieces = [
  piece('hair_back', 'torso', [100, 100, 300, 500], 0),
  piece('torso', 'torso', [112, 322, 288, 560], 5),
  piece('face', 'head', [120, 98, 280, 290], 101),
  piece('eyes', 'head', [140, 170, 260, 220], 110),
  piece('arm_l_up', 'arm_l', [80, 330, 124, 452]),
  piece('arm_l_low', 'forearm_l', [80, 452, 124, 620]),
  piece('leg_l_up', 'leg_l', [140, 556, 200, 661]),
  piece('shin_l', 'shin_l', [130, 661, 200, 786]),
]
const layers = () => buildRigLayers({ scene, k, pxPerUnit: 2, name: 'Uki', pieces, newId })
const doc = (l: Layer[]): SceneDocument => ({ schema: 2, settings: { width: 1280, height: 720, fps: 24, duration: 5, background: '#fff' }, layers: l })
const byName = (l: Layer[], suffix: string) => l.find((x) => x.name.endsWith(suffix))!

/** world position of the centre of an image layer */
const worldCenter = (d: SceneDocument, l: Layer) => {
  const m = worldMatrix(d, l, 0)
  return { x: m.tx + m.a * (l.pivotX ?? 0) + m.c * (l.pivotY ?? 0), y: m.ty + m.b * (l.pivotX ?? 0) + m.d * (l.pivotY ?? 0) }
}

describe('buildRigLayers', () => {
  it('creates the full skeleton as bones with a single root and valid parent links', () => {
    const l = layers()
    const bones = l.filter((x) => x.type === 'bone')
    expect(bones).toHaveLength(SKELETON.length)
    expect(bones.filter((b) => !b.parentId)).toHaveLength(1)
    const ids = new Set(l.map((x) => x.id))
    expect(new Set(l.map((x) => x.id)).size).toBe(l.length)
    for (const x of l) if (x.parentId) expect(ids.has(x.parentId)).toBe(true)
    // a parent always comes before its children in document order
    l.forEach((x, i) => { if (x.parentId) expect(l.findIndex((p) => p.id === x.parentId)).toBeLessThan(i) })
  })

  it('every image sits exactly where its box is on the character canvas (at rest)', () => {
    const l = layers()
    const d = doc(l)
    for (const p of pieces) {
      const want = sceneOf({ scene, k }, { x: (p.box.x0 + p.box.x1) / 2, y: (p.box.y0 + p.box.y1) / 2 })
      const got = worldCenter(d, byName(l, ` · ${p.key}`))
      expect(got.x).toBeCloseTo(want.x, 1)
      expect(got.y).toBeCloseTo(want.y, 1)
    }
  })

  it('images are upright and have the right scale (scene px per image px)', () => {
    const l = layers()
    const d = doc(l)
    const img = byName(l, ' · arm_l_low')
    const m = worldMatrix(d, img, 0)
    expect(Math.hypot(m.a, m.b)).toBeCloseTo(k / 2, 5)
    expect(Math.atan2(m.b, m.a)).toBeCloseTo(0, 5) // world rotation 0
  })

  it('rotating a bone swings its images and everything below it about the joint, and nothing else', () => {
    const l = layers()
    const arm = byName(l, ' · Lengan atas kiri')
    const rest = doc(l)
    const before = {
      upper: worldCenter(rest, byName(l, ' · arm_l_up')),
      lower: worldCenter(rest, byName(l, ' · arm_l_low')),
      torso: worldCenter(rest, byName(l, ' · torso')),
      face: worldCenter(rest, byName(l, ' · face')),
    }
    const swung = doc(l.map((x) => (x.id === arm.id ? { ...x, rotation: x.rotation + 90 } : x)))
    const after = {
      upper: worldCenter(swung, byName(l, ' · arm_l_up')),
      lower: worldCenter(swung, byName(l, ' · arm_l_low')),
      torso: worldCenter(swung, byName(l, ' · torso')),
      face: worldCenter(swung, byName(l, ' · face')),
    }
    const joint = sceneOf({ scene, k }, { x: 106, y: 340 })
    const turn = (p: { x: number; y: number }) => ({ x: joint.x - (p.y - joint.y), y: joint.y + (p.x - joint.x) }) // +90° about the joint
    for (const key of ['upper', 'lower'] as const) {
      expect(after[key].x).toBeCloseTo(turn(before[key]).x, 1)
      expect(after[key].y).toBeCloseTo(turn(before[key]).y, 1)
    }
    expect(after.torso).toEqual(before.torso)
    expect(after.face).toEqual(before.face)
  })

  it('moving the root moves the whole character; the head turns about the neck', () => {
    const l = layers()
    const root = l.find((x) => x.type === 'bone' && !x.parentId)!
    const moved = doc(l.map((x) => (x.id === root.id ? { ...x, x: x.x + 100, y: x.y - 30 } : x)))
    const rest = doc(l)
    for (const p of pieces) {
      const a = worldCenter(rest, byName(l, ` · ${p.key}`)), b = worldCenter(moved, byName(l, ` · ${p.key}`))
      expect(b.x - a.x).toBeCloseTo(100, 3)
      expect(b.y - a.y).toBeCloseTo(-30, 3)
    }
    const head = byName(l, ' · Kepala')
    const nod = doc(l.map((x) => (x.id === head.id ? { ...x, rotation: x.rotation + 180 } : x)))
    const neck = sceneOf({ scene, k }, { x: 200, y: 320 })
    const f0 = worldCenter(rest, byName(l, ' · face')), f1 = worldCenter(nod, byName(l, ' · face'))
    expect(f1.x).toBeCloseTo(2 * neck.x - f0.x, 1) // 180° about the neck point
    expect(f1.y).toBeCloseTo(2 * neck.y - f0.y, 1)
  })

  it('stacking: legs behind the torso subtree; torso image behind the head and arms; hair_back behind the torso image', () => {
    const l = layers()
    const idx = (suffix: string) => l.findIndex((x) => x.name.endsWith(suffix))
    expect(idx(' · Paha kiri')).toBeLessThan(idx(' · Badan'))
    expect(idx(' · hair_back')).toBeLessThan(idx(' · torso'))
    expect(idx(' · torso')).toBeLessThan(idx(' · Kepala'))
    expect(idx(' · Kepala')).toBeLessThan(idx(' · Lengan atas kiri'))
    expect(idx(' · face')).toBeLessThan(idx(' · eyes'))
    // children come right after their bone (depth-first), so siblings keep their relative order
    expect(l[idx(' · Kepala') + 1].parentId).toBe(l[idx(' · Kepala')].id)
  })

  it('fitScale fills about 90% of the scene height and never blows the figure up too much', () => {
    expect(fitScale(720) * 770).toBeCloseTo(648, 0)
    expect(fitScale(5000)).toBe(1.2)
  })
})

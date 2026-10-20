import { describe, expect, it } from 'vitest'
import { assetAt, evalAll, evalCamera, evalLayer, setCamKey, setSwap, worldPoint } from '../anim'
import type { Layer, SceneCamera, SceneDocument } from '../types'
import { buildRigLayers, SKELETON, type PieceSpec } from './rig'
import { applyExpression, applyPose, applyRigMotion, findRigs, MOTIONS, POSES, restRotation, rigExpressions, rigOf } from './rigMotion'

const scene = { width: 1280, height: 720 }
let n = 0
const newId = () => `id${++n}`
const piece = (key: string, bone: string, box: [number, number, number, number], order = 0, extra: Partial<PieceSpec> = {}): PieceSpec => ({ key, name: key, bone, order, assetId: 7, box: { x0: box[0], y0: box[1], x1: box[2], y1: box[3] }, ...extra })
const pieces = [
  piece('torso', 'torso', [112, 322, 288, 560], 5),
  piece('face', 'head', [120, 98, 280, 290], 101),
  piece('eyes', 'head', [140, 170, 260, 220], 110, { assetId: 10, expr: { senang: 11, marah: 12 } }),
  piece('mouth', 'head', [170, 240, 230, 270], 111, { assetId: 20, expr: { senang: 21 } }),
]
const k = 0.8
const build = (id?: string) => buildRigLayers({ scene, k, pxPerUnit: 2, name: 'Uki', pieces, newId, rigId: id })
const doc = (l: Layer[]): SceneDocument => ({ schema: 2, settings: { width: 1280, height: 720, fps: 24, duration: 5, background: '#fff' }, layers: l })
const clone = <T,>(v: T): T => structuredClone(v)

describe('rig tagging', () => {
  it('every layer of a character carries the same rig id and its own role', () => {
    const l = build('abc')
    expect(l.every((x) => x.rig?.id === 'abc')).toBe(true)
    expect(l.filter((x) => x.type === 'bone').map((x) => x.rig!.role).sort()).toEqual(SKELETON.map((b) => `bone:${b.key}`).sort())
    expect(l.find((x) => x.rig?.role === 'piece:mouth')!.expr).toEqual({ senang: 21, default: 20 })
    expect(l.find((x) => x.rig?.role === 'piece:face')!.expr).toBeUndefined()
  })

  it('finds two characters in one scene separately and picks the one that owns the selection', () => {
    const a = build('A'), b = build('B')
    const all = [...a, ...b]
    expect(findRigs(all).map((r) => r.id).sort()).toEqual(['A', 'B'])
    const faceB = b.find((x) => x.rig?.role === 'piece:face')!
    expect(rigOf(all, faceB.id)!.id).toBe('B')
    expect(rigOf(all, null)).toBeNull() // ambiguous with two characters
    expect(rigOf(a, null)!.id).toBe('A') // a single one is implied
  })

  it('recognises older rigs that were inserted before tagging (by the "<name> · <part>" layer names)', () => {
    const old = build('x').map(({ rig, ...rest }) => rest as Layer)
    const rigs = findRigs(old)
    expect(rigs).toHaveLength(1)
    expect(Object.keys(rigs[0].bones)).toHaveLength(SKELETON.length)
    expect(rigs[0].name).toBe('Uki')
  })

  it('a prop attached to a hand bone makes the selection belong to that character', () => {
    const l = build('A')
    const hand = l.find((x) => x.rig?.role === 'bone:forearm_r')!
    const prop: Layer = { id: 'cup', type: 'image', name: 'Gelas', x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, visible: true, locked: false, parentId: hand.id }
    expect(rigOf([...l, prop], 'cup')!.id).toBe('A')
  })
})

describe('poses', () => {
  const tip = (d: SceneDocument, r: ReturnType<typeof findRigs>[number], bone: string, f = 0) => worldPoint(d, r.bones[bone].id, f, r.bones[bone].length ?? 0, 0)

  it('standing is the rest pose (rotations equal the rest values)', () => {
    const d = doc(clone(build('A')))
    const r = findRigs(d.layers)[0]
    applyPose(d, r, POSES.find((p) => p.id === 'berdiri')!, 0)
    const ev = evalAll(d, 0)
    for (const b of SKELETON) expect(ev.get(r.bones[b.key].id)!.rotation).toBeCloseTo(restRotation(b.key), 5)
  })

  it('waving raises the right hand above the shoulder; hands-on-hips keeps the hands near the waist', () => {
    const d = doc(clone(build('A')))
    const r = findRigs(d.layers)[0]
    const shoulderY = worldPoint(d, r.bones.arm_r.id, 0, 0, 0).y
    const restHand = tip(d, r, 'forearm_r')
    expect(restHand.y).toBeGreaterThan(shoulderY + 100) // arm hangs down
    applyPose(d, r, POSES.find((p) => p.id === 'lambai')!, 5)
    expect(tip(d, r, 'forearm_r', 5).y).toBeLessThan(shoulderY - 20) // hand is higher than the shoulder
    applyPose(d, r, POSES.find((p) => p.id === 'pinggang')!, 10)
    const hipY = worldPoint(d, r.bones.root.id, 10, 0, 0).y
    const hand = tip(d, r, 'forearm_l', 10)
    expect(Math.abs(hand.y - hipY)).toBeLessThan(60 * k + 40)
    expect(hand.x).toBeGreaterThan(worldPoint(d, r.bones.arm_l.id, 10, 0, 0).x - 30) // inward / at the side, not flung out
  })

  it('a pose is a set of keys at one frame and replaces the keys of an earlier pose at that frame', () => {
    const d = doc(clone(build('A')))
    const r = findRigs(d.layers)[0]
    expect(applyPose(d, r, POSES[1], 12)).toBe(SKELETON.length)
    applyPose(d, r, POSES[2], 12)
    const layer = d.layers.find((l) => l.id === r.bones.arm_r.id)!
    expect(layer.keyframes!.rotation!.filter((x) => x.f === 12)).toHaveLength(1)
    expect(layer.keyframes!.rotation![0].v).toBeCloseTo(restRotation('arm_r') - 38, 5)
  })

  it('skips bones that are driven by IK', () => {
    const l = build('A')
    const forearm = l.find((x) => x.rig?.role === 'bone:forearm_r')!
    const target: Layer = { id: 'tg', type: 'bone', name: 't', x: 5, y: 5, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, visible: true, locked: false }
    forearm.ik = { target: 'tg', bend: 1 }
    const d = doc([...clone(l), target])
    const r = findRigs(d.layers)[0]
    expect(applyPose(d, r, POSES[1], 0)).toBe(SKELETON.length - 2) // forearm_r and its parent arm_r
  })
})

describe('movements', () => {
  const setup = () => {
    const d = doc(clone(build('A')))
    return { d, r: findRigs(d.layers)[0] }
  }

  it('walking moves the root by the distance (both directions) and swings the legs in opposite phase', () => {
    const { d, r } = setup()
    const x0 = d.layers.find((l) => l.id === r.bones.root.id)!.x
    expect(applyRigMotion(d, r, 'walk', 0, { duration: 2, distance: 300, dir: 1 })).toBe(true)
    const root = d.layers.find((l) => l.id === r.bones.root.id)!
    const frames = 48
    expect(evalLayer(root, frames).x - x0).toBeCloseTo(300, 0)
    const legL = d.layers.find((l) => l.id === r.bones.leg_l.id)!, legR = d.layers.find((l) => l.id === r.bones.leg_r.id)!
    // somewhere in the cycle the legs are on opposite sides of rest
    let opposite = 0
    for (let f = 0; f <= frames; f++) {
      const a = evalLayer(legL, f).rotation - restRotation('leg_l')
      const b = evalLayer(legR, f).rotation - restRotation('leg_r')
      if (Math.abs(a) > 10 && Math.abs(b) > 10 && Math.sign(a) !== Math.sign(b)) opposite++
    }
    expect(opposite).toBeGreaterThan(10)
    const left = setup()
    applyRigMotion(left.d, left.r, 'walk', 0, { duration: 2, distance: 300, dir: -1 })
    expect(evalLayer(left.d.layers.find((l) => l.id === left.r.bones.root.id)!, frames).x - x0).toBeCloseTo(-300, 0)
  })

  it('starts from the playhead and keeps keys that are outside its range', () => {
    const { d, r } = setup()
    const root = d.layers.find((l) => l.id === r.bones.root.id)!
    root.keyframes = { x: [{ f: 0, v: 50, e: 'linear' }] }
    applyRigMotion(d, r, 'walk', 24, { duration: 1, distance: 100, dir: 1 })
    const xs = root.keyframes!.x!
    expect(xs[0]).toEqual({ f: 0, v: 50, e: 'linear' })
    expect(xs.at(-1)!.f).toBe(24 + 24)
  })

  it('waving raises the arm, holds it while the forearm swings, then lowers it', () => {
    const { d, r } = setup()
    applyRigMotion(d, r, 'wave', 0, { duration: 2.5, distance: 0, dir: 1 })
    const arm = d.layers.find((l) => l.id === r.bones.arm_r.id)!
    expect(evalLayer(arm, 0).rotation).toBeCloseTo(restRotation('arm_r'), 3)
    expect(evalLayer(arm, 30).rotation).toBeCloseTo(restRotation('arm_r') - 140, 3)
    expect(evalLayer(arm, 60).rotation).toBeCloseTo(restRotation('arm_r'), 3)
    const fore = d.layers.find((l) => l.id === r.bones.forearm_r.id)!
    const vals = Array.from({ length: 30 }, (_, i) => evalLayer(fore, 12 + i).rotation)
    expect(Math.max(...vals) - Math.min(...vals)).toBeGreaterThan(20) // it really oscillates
  })

  it('every listed movement applies, and an unknown id does nothing', () => {
    for (const m of MOTIONS) {
      const { d, r } = setup()
      expect(applyRigMotion(d, r, m.id, 0, { duration: m.duration, distance: m.distance, dir: 1 }), m.id).toBe(true)
      expect(d.layers.some((l) => l.keyframes), m.id).toBe(true)
    }
    const { d, r } = setup()
    expect(applyRigMotion(d, r, 'moonwalk', 0, { duration: 1, distance: 0, dir: 1 })).toBe(false)
  })
})

describe('expressions (image swaps)', () => {
  it('lists the variants the character has and swaps eyes + mouth from the chosen frame on', () => {
    const d = doc(clone(build('A')))
    const r = findRigs(d.layers)[0]
    expect(rigExpressions(r).sort()).toEqual(['default', 'marah', 'senang'])
    const eyes = d.layers.find((l) => l.id === r.pieces.eyes.id)!
    const mouth = d.layers.find((l) => l.id === r.pieces.mouth.id)!
    expect(applyExpression(d, r, 'senang', 24)).toBe(2) // eyes + mouth (no brows piece in this rig)
    expect(assetAt(eyes, 10)).toBe(10) // before the key: the original image
    expect(assetAt(eyes, 24)).toBe(11)
    expect(assetAt(mouth, 100)).toBe(21)
    expect(evalLayer(eyes, 30).assetId).toBe(11)
    applyExpression(d, r, 'default', 48) // back to normal
    expect(assetAt(eyes, 48)).toBe(10)
    expect(assetAt(mouth, 47)).toBe(21)
    // an expression a piece does not have is skipped for that piece (the mouth has no 'marah')
    expect(applyExpression(d, r, 'marah', 72)).toBe(1)
    expect(assetAt(eyes, 72)).toBe(12)
    expect(assetAt(mouth, 72)).toBe(20) // unchanged: the 'default' key at frame 48 still holds
  })
})

describe('swaps and camera', () => {
  it('setSwap keeps one key per frame, sorted, and assetAt holds the last one', () => {
    const l = { assetId: 1 } as Layer
    setSwap(l, 20, 3); setSwap(l, 5, 2); setSwap(l, 20, 4)
    expect(l.swaps).toEqual([{ f: 5, assetId: 2 }, { f: 20, assetId: 4 }])
    expect([0, 4.9, 5, 19, 20, 99].map((f) => assetAt(l, f))).toEqual([1, 1, 2, 2, 4, 4])
  })

  it('camera defaults to the whole scene and interpolates its keys', () => {
    expect(evalCamera(undefined, 10, 1280, 720)).toEqual({ x: 640, y: 360, zoom: 1, rot: 0 })
    const cam: SceneCamera = {}
    setCamKey(cam, 'zoom', 0, 1, 'linear')
    setCamKey(cam, 'zoom', 48, 2, 'linear')
    setCamKey(cam, 'x', 48, 300, 'linear')
    const mid = evalCamera(cam, 24, 1280, 720)
    expect(mid.zoom).toBeCloseTo(1.5, 6)
    expect(mid.x).toBe(300) // a single key holds its value
    expect(mid.y).toBe(360)
  })
})

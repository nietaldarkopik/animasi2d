import { describe, expect, it } from 'vitest'
import { worldPoint } from '../anim'
import type { SceneDocument } from '../types'
import { figureExtent, rigLayers, type PreparedRig } from './insertRig'
import { fitScale, type PieceSpec } from './rig'

const piece = (key: string, bone: string, box: [number, number, number, number]): PieceSpec => ({ key, name: key, bone, order: 0, assetId: 1, box: { x0: box[0], y0: box[1], x1: box[2], y1: box[3] } })
const prepared: PreparedRig = { name: 'Uki', version: 1, specs: [piece('face', 'head', [120, 98, 280, 290]), piece('torso', 'torso', [112, 322, 288, 560]), piece('shin_l', 'shin_l', [130, 661, 200, 786])] }
const scene = { width: 1280, height: 720 }
const doc = (layers: ReturnType<typeof rigLayers>): SceneDocument => ({ schema: 2, settings: { ...scene, fps: 24, duration: 5, background: '#fff' }, layers })

/** scene y of the bottom edge of the shin image */
const feetY = (layers: ReturnType<typeof rigLayers>) => {
  const l = layers.find((x) => x.rig?.role === 'piece:shin_l')!
  const half = ((786 - 661) * 2) / 2 // image height in px (2 px per canvas unit) / 2
  return worldPoint(doc(layers), l.id, 0, 0, half).y
}

describe('placing a rig on the floor', () => {
  it('measures the figure from its pieces', () => {
    expect(figureExtent(prepared)).toEqual({ top: 98, bottom: 786 })
  })

  it('footY puts the lowest point of the figure exactly there, at any size and horizontal position', () => {
    for (const [scale, xFrac, footY] of [[1, 0.5, 600], [0.58, 0.32, 577], [0.4, 0.8, 540], [0.58, 0.5, 433]] as const) {
      const l = rigLayers(prepared, scene, { scale, xFrac, footY })
      expect(feetY(l)).toBeCloseTo(footY, 1)
    }
  })

  it('without footY the figure keeps the old centred placement; x placement does not change the height', () => {
    const a = rigLayers(prepared, scene)
    const b = rigLayers(prepared, scene, { xFrac: 0.3 })
    expect(feetY(a)).toBeCloseTo(feetY(b), 6)
    expect(feetY(a)).toBeCloseTo(360 + fitScale(720) * (786 - 415), 1)
  })

  it('only the root bone is moved (everything else follows it)', () => {
    const base = rigLayers(prepared, scene, { scale: 0.5 })
    const moved = rigLayers(prepared, scene, { scale: 0.5, footY: 500, xFrac: 0.7 })
    const rootBase = base.find((l) => l.rig?.role === 'bone:root')!, rootMoved = moved.find((l) => l.rig?.role === 'bone:root')!
    expect(rootMoved.x).toBeGreaterThan(rootBase.x)
    for (const [i, l] of moved.entries()) if (l.parentId) expect([l.x, l.y]).toEqual([base[i].x, base[i].y])
  })
})

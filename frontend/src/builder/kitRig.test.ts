import { describe, expect, it } from 'vitest'
import { detectKit, placeKit, withoutSlots, type KitRig } from './kitRig'
import type { CharacterConfig } from './types'

const index = [
  { id: 'sma-p3', match: 'Kit SMA P3 (anime)', label: 'P3' },
  { id: 'sma-l1', match: 'Kit SMA L1 (anime)', label: 'L1' },
]
const ref = (assetId: number, extra = {}) => ({ assetId, dx: 0, dy: 0, scale: 1, ...extra })
const config = (parts: CharacterConfig['parts']): CharacterConfig => ({ schema_version: 1, view: 'full', palette: {} as CharacterConfig['palette'], parts })
const assets = {
  1: { name: 'Kit SMA L1 (anime) – leher' },
  2: { name: 'Kit SMA L1 (anime) – kemeja' },
  3: { name: 'Kit SMA L1 (anime) – celana' },
  4: { name: 'Sepatu kets' },
  5: { name: 'Wajah bulat' },
  6: { name: 'Kit SMA P3 (anime) – rok' },
}

describe('detectKit', () => {
  it('finds the kit and the slots taken from it', () => {
    const r = detectKit(config({ body: ref(1), top: ref(2), bottom: ref(3), shoes: ref(4), face: ref(5) }), assets, index)
    expect(r?.kit.id).toBe('sma-l1')
    expect(r?.slots).toEqual(['body', 'top', 'bottom'])
  })
  it('prefers the kit owning most slots', () => {
    const r = detectKit(config({ body: ref(1), top: ref(2), bottom: ref(6) }), assets, index)
    expect(r?.kit.id).toBe('sma-l1')
  })
  it('returns null for a character without kit parts', () => {
    expect(detectKit(config({ shoes: ref(4), face: ref(5) }), assets, index)).toBeNull()
  })
})

describe('placeKit', () => {
  const kit: Pick<KitRig, 'bones' | 'parts'> = {
    bones: [{ key: 'torso', name: 'Badan', parent: null, joint: { x: 200, y: 400 }, angle: -90, length: 200, order: 0 }],
    parts: [{ key: 'torso', name: 'Badan', bone: 'torso', order: 0, file: 't.png', slot: 'top', box: { x0: 150, y0: 200, x1: 250, y1: 400 } }],
  }
  it('is the identity at rest', () => {
    const p = placeKit(kit, 'top', { dx: 0, dy: 0, scale: 1 })
    expect(p.bones[0].joint).toEqual({ x: 200, y: 400 })
    expect(p.parts[0].box).toEqual(kit.parts[0].box)
  })
  it('follows the offset and the scale about the slot anchor (top: 200,440)', () => {
    const p = placeKit(kit, 'top', { dx: 10, dy: -20, scale: 0.5 })
    expect(p.bones[0].joint.x).toBeCloseTo(210)
    expect(p.bones[0].joint.y).toBeCloseTo(440 - 20 + 0.5 * (400 - 440))
    expect(p.bones[0].length).toBeCloseTo(100)
    expect(p.parts[0].box.x1 - p.parts[0].box.x0).toBeCloseTo(50)
    expect(p.scale).toBe(0.5)
  })
})

describe('withoutSlots', () => {
  it('drops only the given slots', () => {
    const c = withoutSlots(config({ body: ref(1), top: ref(2), face: ref(5) }), ['body', 'top'])
    expect(Object.keys(c.parts)).toEqual(['face'])
  })
})

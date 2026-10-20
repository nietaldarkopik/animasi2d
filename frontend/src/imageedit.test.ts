import { describe, expect, it } from 'vitest'
import { replaceImagePatch } from './imageedit'
import type { Layer } from './types'

const layer = (o: Partial<Layer> = {}): Layer => ({ id: 'a', type: 'image', name: 'a', x: 100, y: 100, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, visible: true, locked: false, ...o })

describe('replaceImagePatch', () => {
  it('crop of the right half moves the centre right by a quarter of the width', () => {
    const { patch, compensated } = replaceImagePatch(layer(), 9, { pixel_scale: 1, origin: [100, 0], input_size: [200, 100] }, 100, 100)
    expect(compensated).toBe(true)
    expect(patch.x).toBe(150)
    expect(patch.y).toBe(100)
  })
  it('halving the resolution doubles the layer scale', () => {
    const { patch } = replaceImagePatch(layer({ scaleX: 1.5, scaleY: 1.5 }), 9, { pixel_scale: 0.5, origin: [0, 0], input_size: [400, 400] }, 200, 200)
    expect(patch.scaleX).toBe(3)
    expect(patch.x).toBe(100)
  })
  it('the offset follows the layer scale and rotation', () => {
    const { patch } = replaceImagePatch(layer({ scaleX: 2, scaleY: 2, rotation: 90 }), 9, { pixel_scale: 1, origin: [100, 0], input_size: [200, 100] }, 100, 100)
    // +50 input px along local x, doubled by scale, rotated 90deg -> straight down
    expect(patch.x).toBeCloseTo(100, 5)
    expect(patch.y).toBeCloseTo(200, 5)
  })
  it('does not touch geometry when the layer is animated or has a pivot', () => {
    const geo = { pixel_scale: 0.5, origin: [10, 10] as [number, number], input_size: [100, 100] as [number, number] }
    const a = replaceImagePatch(layer({ keyframes: { x: [{ f: 0, v: 1, e: 'linear' }] } }), 9, geo, 50, 50)
    expect(a).toEqual({ patch: { assetId: 9 }, compensated: false })
    expect(replaceImagePatch(layer({ pivotX: 5 }), 9, geo, 50, 50).compensated).toBe(false)
  })
})

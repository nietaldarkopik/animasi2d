import { describe, expect, it } from 'vitest'
import { nudgePatches, selectableIds, topMost } from './layerSelect'
import type { Layer } from './types'

const L = (id: string, o: Partial<Layer> = {}): Layer => ({ id, type: 'shape', name: id, x: 10, y: 20, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, visible: true, locked: false, ...o })

describe('layer selection helpers', () => {
  const layers = [L('bg', { locked: true }), L('root', { type: 'bone' }), L('arm', { type: 'bone', parentId: 'root' }), L('hand', { parentId: 'arm' }), L('free')]

  it('top-most keeps only layers without a selected ancestor', () => {
    expect(topMost(layers, ['root', 'arm', 'hand', 'free'])).toEqual(['root', 'free'])
    expect(topMost(layers, ['arm', 'hand'])).toEqual(['arm'])
    expect(topMost(layers, ['hand', 'free'])).toEqual(['hand', 'free'])
    expect(topMost(layers, ['ghost'])).toEqual([])
  })

  it('nudging moves each top-most unlocked layer once, from its animated position', () => {
    const p = nudgePatches(layers, ['root', 'arm', 'free', 'bg'], 0, 5, -3)
    expect(Object.keys(p).sort()).toEqual(['free', 'root']) // arm follows root, bg is locked
    expect(p.free).toEqual({ x: 15, y: 17 })
    const anim = [L('a', { keyframes: { x: [{ f: 0, v: 0, e: 'linear' }, { f: 10, v: 100, e: 'linear' }] } })]
    expect(nudgePatches(anim, ['a'], 5, 1, 0).a).toEqual({ x: 51, y: 20 })
  })

  it('Ctrl+A skips locked layers, and bones when they are hidden', () => {
    expect(selectableIds(layers, true)).toEqual(['root', 'arm', 'hand', 'free'])
    expect(selectableIds(layers, false)).toEqual(['hand', 'free'])
  })
})

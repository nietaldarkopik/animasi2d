import { describe, expect, it } from 'vitest'
import { switchFacing } from './facing'
import type { CharacterConfig, Facing, LibAsset } from './types'

const asset = (id: number, category: string, view: Facing, set: string | null): LibAsset => ({ id, key: null, category, name: `a${id}`, tags: [], source: 'upload', status: 'approved', mime: 'image/png', width: 800, height: 1600, tintable: false, view, set, hash: `h${id}`, mine: true, meta: null, url: '' })

const lib = [
  asset(1, 'top', 'front', 'kit:L1:top'), asset(2, 'top', 'right', 'kit:L1:top'), asset(3, 'top', 'back', 'kit:L1:top'),
  asset(4, 'bottom', 'front', 'kit:L1:bottom'), asset(5, 'bottom', 'right', 'kit:L1:bottom'),
  asset(6, 'face', 'front', null),
]
const cfg: CharacterConfig = {
  schema_version: 1, view: 'full', palette: {} as never,
  parts: { top: { assetId: 1, hash: 'h1', dx: 3, dy: -2, scale: 1.1 }, bottom: { assetId: 4, dx: 0, dy: 0, scale: 1 }, face: { assetId: 6, dx: 0, dy: 0, scale: 1 } },
}

describe('switchFacing', () => {
  it('swaps every part that has a twin for the new facing and keeps its placement', () => {
    const r = switchFacing(cfg, 'right', lib)
    expect(r.config.facing).toBe('right')
    expect(r.config.parts.top).toEqual({ assetId: 2, dx: 3, dy: -2, scale: 1.1 }) // hash dropped: the server fills it for the new asset
    expect(r.config.parts.bottom.assetId).toBe(5)
    expect(r.swapped.sort()).toEqual(['bottom', 'top'])
  })

  it('keeps parts without a twin and reports them', () => {
    const r = switchFacing(cfg, 'right', lib)
    expect(r.config.parts.face.assetId).toBe(6)
    expect(r.missing).toEqual(['face'])
    const back = switchFacing(cfg, 'back', lib) // bottom has no back twin in this library
    expect(back.config.parts.top.assetId).toBe(3)
    expect(back.config.parts.bottom.assetId).toBe(4)
    expect(back.missing).toEqual(['bottom']) // the face is not seen from behind: set aside, not missing
    expect(Object.keys(back.hidden)).toEqual(['face'])
  })

  it('goes back to front through the same sets, and does not mutate the input', () => {
    const right = switchFacing(cfg, 'right', lib).config
    const front = switchFacing(right, 'front', lib)
    expect(front.config.parts.top.assetId).toBe(1)
    expect(front.config.parts.bottom.assetId).toBe(4)
    expect(cfg.parts.top.assetId).toBe(1)
    expect(cfg.facing).toBeUndefined()
  })

  describe('from behind', () => {
    const back = asset(20, 'hair_front', 'back', null)
    const all = [...lib, asset(7, 'hair_front', 'front', null), asset(8, 'eyes', 'front', null), back]
    const front: CharacterConfig = { ...cfg, parts: { ...cfg.parts, hair_front: { assetId: 7, dx: 0, dy: 0, scale: 1 }, eyes: { assetId: 8, dx: 0, dy: 0, scale: 1 } } }

    it('sets the face, eyes, brows and mouth aside and puts a back-of-head drawing on the hair layer', () => {
      const r = switchFacing(front, 'back', all)
      expect(r.config.parts.face).toBeUndefined()
      expect(r.config.parts.eyes).toBeUndefined()
      expect(r.config.parts.hair_front.assetId).toBe(20)
      expect(r.config.parts.top.assetId).toBe(3) // the body turns too
      expect(Object.keys(r.hidden).sort()).toEqual(['eyes', 'face', 'hair_front'])
    })

    it('gives everything back (face, eyes, the old hairstyle) when the character turns round', () => {
      const r = switchFacing(front, 'back', all)
      const again = switchFacing(r.config, 'front', all, r.hidden)
      expect(again.config.parts.face.assetId).toBe(6)
      expect(again.config.parts.eyes.assetId).toBe(8)
      expect(again.config.parts.hair_front.assetId).toBe(7)
      expect(again.config.parts.top.assetId).toBe(1)
      expect(again.hidden).toEqual({})
    })

    it('keeps the hair of a character fitted to a kit at the fitted size and place', () => {
      const fit = { s: 0.78, nx: 200, ny: 150, jx: 200, jy: 211 }
      const r = switchFacing({ ...front, headFit: fit }, 'back', all)
      expect(r.config.parts.hair_front.scale).toBeCloseTo(0.78, 2)
    })
  })
})

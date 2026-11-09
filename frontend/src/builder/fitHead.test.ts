import { describe, expect, it } from 'vitest'
import { fitHeadWith, fittedHeadPart, KITS, kitOf } from './fitHead'
import { partBox, placement, type FracBox } from './spec'
import type { CharacterConfig, Facing, LibAsset } from './types'

const asset = (id: number, category: string, set: string | null = null, view: Facing = 'front'): LibAsset => ({ id, key: null, category, name: `a${id}`, tags: [], source: 'upload', status: 'approved', mime: 'image/png', width: 800, height: 1600, tintable: false, view, set, hash: `h${id}`, mine: true, meta: null, url: '' })
const FRAC: FracBox = { x0: 0.3, y0: 0.05, x1: 0.7, y1: 0.35 } // visible art of every test asset (fractions of the 400x800 canvas image)
const lib = [asset(1, 'top', 'kit:laki_laki_anime:top'), asset(2, 'face'), asset(3, 'hair_front'), asset(4, 'face'), asset(5, 'top')]
const cfg = (top = 1): CharacterConfig => ({ schema_version: 1, view: 'full', palette: {} as never, parts: { top: { assetId: top, dx: 0, dy: 0, scale: 1 }, face: { assetId: 2, dx: 0, dy: 0, scale: 1 }, hair_front: { assetId: 3, dx: 0, dy: 0, scale: 1 } } })
const faceBox = (c: CharacterConfig, id: number) => { const a = lib.find((x) => x.id === id)!; return partBox(placement('face', a, { ...c.parts.face, assetId: id } as never), FRAC) }

describe('fit the head to a body kit', () => {
  it('knows the kit from the set key of the clothes, and not for other bodies', () => {
    expect(kitOf(cfg(1), lib)).toBe('laki_laki_anime')
    expect(kitOf(cfg(5), lib)).toBeNull()
    expect(fitHeadWith(cfg(5), lib, () => FRAC)).toBeNull()
  })

  it('shrinks the head to the kit scale and seats the bottom of the face on the neck joint', () => {
    const before = faceBox(cfg(), 2)
    const r = fitHeadWith(cfg(), lib, () => FRAC)!
    const after = faceBox(r.config, 2)
    expect((after.x1 - after.x0) / (before.x1 - before.x0)).toBeCloseTo(KITS.laki_laki_anime.scale, 2)
    expect((after.x0 + after.x1) / 2).toBeCloseTo(200, 1)
    expect(after.y1).toBeCloseTo(KITS.laki_laki_anime.jointY + 6, 1)
    expect(r.config.parts.top).toEqual(cfg().parts.top) // the body is untouched
  })

  it('moves hair and face as one: their relative layout is kept, scaled', () => {
    const r = fitHeadWith(cfg(), lib, () => FRAC)!
    const hairBefore = partBox(placement('hair_front', lib[2], cfg().parts.hair_front), FRAC)
    const hairAfter = partBox(placement('hair_front', lib[2], r.config.parts.hair_front), FRAC)
    const f0 = faceBox(cfg(), 2), f1 = faceBox(r.config, 2)
    const s = KITS.laki_laki_anime.scale
    expect(hairAfter.y1 - f1.y1).toBeCloseTo((hairBefore.y1 - f0.y1) * s, 1)
    expect(hairAfter.x0 - f1.x0).toBeCloseTo((hairBefore.x0 - f0.x0) * s, 1)
  })

  it('a head part chosen afterwards lands exactly where the same part would after fitting', () => {
    const r = fitHeadWith(cfg(), lib, () => FRAC)!
    const fit = r.config.headFit!
    expect(fit).toEqual({ s: 0.78, nx: 200, ny: expect.any(Number), jx: 200, jy: 211 })
    const swapped = { ...r.config, parts: { ...r.config.parts, face: fittedHeadPart('face', lib[3], fit) } }
    const a = faceBox(r.config, 2), b = faceBox(swapped, 4)
    expect(b.x0).toBeCloseTo(a.x0, 1)
    expect(b.y1).toBeCloseTo(a.y1, 1)
    expect(swapped.parts.face.scale).toBeCloseTo(0.78, 2)
  })

  it('needs a face, hijab or hair to anchor on', () => {
    const c = cfg(); delete c.parts.face; delete c.parts.hair_front
    expect(fitHeadWith(c, lib, () => FRAC)).toBeNull()
  })
})

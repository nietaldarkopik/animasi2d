import { describe, expect, it } from 'vitest'
import { composeSvg, type VectorPart } from './svgExport'
import { syncShoes } from './shoes'
import { baseSlot, DEFAULT_PALETTE, effectiveZ, placement } from './spec'
import type { CharacterConfig, LibAsset } from './types'

const shoe = (o: Partial<LibAsset> = {}): LibAsset => ({ id: 9, key: null, category: 'shoes', name: 'Sepatu (satu)', tags: [], source: 'upload', status: 'approved', mime: 'image/svg+xml', width: 800, height: 1600, tintable: false, hash: 'h', mine: true, meta: null, url: '', mirror: { px: 160, py: 760 }, ...o })

describe('one mirrored shoe', () => {
  it('turns and scales about its own centre, not about the pair centre', () => {
    const pl = placement('shoes', shoe(), { dx: 0, dy: 0, scale: 1.4, rot: 0 })
    expect([pl.px, pl.py]).toEqual([160, 760])
    // a pair keeps the slot pivot (centre of both shoes)
    const pair = placement('shoes', shoe({ mirror: null }), { dx: 0, dy: 0, scale: 1.4, rot: 0 })
    expect([pair.px, pair.py]).toEqual([200, 765])
  })

  it('is exported twice: the second copy flipped about the centre line with the same transform', () => {
    const config: CharacterConfig = { schema_version: 1, view: 'full', palette: { ...DEFAULT_PALETTE }, parts: { shoes: { assetId: 9, dx: 3, dy: -2, scale: 1.2 } } }
    const part: VectorPart = { kind: 'svg', inner: '<path d="M0 0h10v10z"/>', vbW: 800, vbH: 1600 }
    const out = composeSvg({ config, assets: { 9: shoe() }, parts: { shoes: part }, zOf: () => 0 } as never)
    expect(out.svg.match(/<path d="M0 0h10v10z"\/>/g)).toHaveLength(2)
    expect(out.svg).toContain('translate(400 0) scale(-1 1)')
    const single = composeSvg({ config, assets: { 9: shoe({ mirror: null }) }, parts: { shoes: part }, zOf: () => 0 } as never)
    expect(single.svg.match(/<path d="M0 0h10v10z"\/>/g)).toHaveLength(1)
  })

  it('gives the right shoe its own part: pivot at the mirror image of the left one, same category and stacking', () => {
    const left = placement('shoes', shoe(), { dx: 0, dy: 0, scale: 1 })
    const right = placement('shoes_r', shoe(), { dx: 5, dy: 0, scale: 1 })
    expect([right.px, right.py]).toEqual([400 - left.px, left.py])
    expect(baseSlot('shoes_r')).toBe('shoes')
    const z = (s: string) => ({ shoes: 3, body: 2 } as Record<string, number>)[s] ?? 0
    const c: CharacterConfig = { schema_version: 1, view: 'full', palette: { ...DEFAULT_PALETTE }, parts: { shoes_r: { assetId: 9, dx: 0, dy: 0, scale: 1 } } }
    expect(effectiveZ(c, 'shoes_r', z)).toBe(3)
  })

  it('exports each foot once when the right shoe is its own part, the right one flipped', () => {
    const config: CharacterConfig = { schema_version: 1, view: 'full', palette: { ...DEFAULT_PALETTE }, parts: { shoes: { assetId: 9, dx: 0, dy: 0, scale: 1 }, shoes_r: { assetId: 9, dx: 4, dy: 0, scale: 1.1 } } }
    const part: VectorPart = { kind: 'svg', inner: '<path d="M0 0h10v10z"/>', vbW: 800, vbH: 1600 }
    const out = composeSvg({ config, assets: { 9: shoe() }, parts: { shoes: part, shoes_r: part }, zOf: () => 0 } as never)
    expect(out.svg.match(/<path d="M0 0h10v10z"\/>/g)).toHaveLength(2)
    expect(out.svg.match(/translate\(400 0\) scale\(-1 1\)/g)).toHaveLength(1)
    expect(out.svg).toContain('data-part="shoes_r"')
  })
})

describe('syncShoes', () => {
  const assets = { 9: { mirror: { px: 160, py: 760 } }, 10: { mirror: null } }
  const base = (shoes: { assetId: number; dx: number; dy: number; scale: number; rot?: number }, extra = {}): CharacterConfig => ({ schema_version: 1, view: 'full', palette: { ...DEFAULT_PALETTE }, parts: { shoes, ...extra } })

  it('adds the right shoe as the mirror image of the left one when a mirrored shoe is picked', () => {
    const r = syncShoes(base({ assetId: 9, dx: 6, dy: -2, scale: 1.2, rot: 10 }), assets)
    expect(r.parts.shoes_r).toEqual({ assetId: 9, dx: -6, dy: -2, scale: 1.2, rot: -10 })
  })

  it('keeps what the user did to the right shoe, and follows a change of asset', () => {
    const c = base({ assetId: 9, dx: 0, dy: 0, scale: 1 }, { shoes_r: { assetId: 9, dx: 12, dy: 3, scale: 0.9 } })
    expect(syncShoes(c, assets)).toBe(c) // nothing to do
    const other = { ...assets, 11: { mirror: { px: 150, py: 770 } } }
    const r = syncShoes({ ...c, parts: { ...c.parts, shoes: { assetId: 11, dx: 0, dy: 0, scale: 1 } } }, other)
    expect(r.parts.shoes_r).toEqual({ assetId: 11, dx: 12, dy: 3, scale: 0.9 })
  })

  it('drops the right shoe when the shoes are a pair (or gone)', () => {
    const c = base({ assetId: 10, dx: 0, dy: 0, scale: 1 }, { shoes_r: { assetId: 9, dx: 1, dy: 0, scale: 1 } })
    expect(syncShoes(c, assets).parts.shoes_r).toBeUndefined()
    expect(syncShoes({ ...c, parts: {} }, assets).parts).toEqual({})
  })
})

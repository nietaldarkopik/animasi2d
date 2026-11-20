import { describe, expect, it } from 'vitest'
import { buildCharacterReferencePackManifest, CHARACTER_FRAME_SIZE } from './characterPack'
import { DEFAULT_PALETTE, emptyConfig } from './spec'
import type { LibAsset } from './types'

const asset = (id: number, category: string): LibAsset => ({
  id, asset_uuid: `uuid-${id}`, version_number: 2, parent_asset_id: null, is_current: true, change_note: null, created_at: '',
  key: `asset-${id}`, category, name: `Asset ${id}`, tags: [], source: 'upload', status: 'approved', mime: 'image/png',
  width: 800, height: 1600, tintable: false, view: 'front', set: null, anchors: null, align: null, family: 'general',
  template: 'anime-v1', validation: null, mirror: null, hash: `hash-${id}`, mine: true, meta: null, url: '',
})

describe('character reference pack', () => {
  it('uses the fixed 1024 square frame standard', () => {
    expect(CHARACTER_FRAME_SIZE).toBe(1024)
  })

  it('exports only referenced assets and preserves the character config and rig', () => {
    const config = {
      ...emptyConfig('full'),
      palette: { ...DEFAULT_PALETTE },
      rig: { front: { joints: {} as never } },
      parts: { body: { assetId: 1, dx: 0, dy: 0, scale: 1 }, face: { assetId: 2, dx: 0, dy: 0, scale: 1 } },
      expressions: [{ id: 'sad', name: 'Sedih', parts: { mouth: { assetId: 3, dx: 0, dy: 0, scale: 1 } } }],
    }
    const manifest = buildCharacterReferencePackManifest({
      characterId: 7, name: 'Uki', version: 4, config,
      assets: { 1: asset(1, 'body'), 2: asset(2, 'face'), 3: asset(3, 'mouth'), 4: asset(4, 'top') },
    })
    expect(manifest.format).toBe('animasi2d.character-reference-pack')
    expect(manifest.character).toMatchObject({ id: 7, name: 'Uki', version: 4, facing: 'front' })
    expect(manifest.frame).toMatchObject({ width: 1024, height: 1024, pivot: { x: 512, y: 1024 } })
    expect(manifest.assets.map((a) => a.id)).toEqual([1, 2, 3])
    expect(manifest.config).toEqual(config)
    expect(manifest.rig).toEqual(config.rig)
  })

  it('fails clearly when a referenced asset is not loaded', () => {
    const config = { ...emptyConfig('full'), parts: { body: { assetId: 99, dx: 0, dy: 0, scale: 1 } } }
    expect(() => buildCharacterReferencePackManifest({ characterId: null, name: 'New', version: null, config, assets: {} })).toThrow('Aset karakter #99 belum dimuat')
  })
})

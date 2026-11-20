import { canvasBlob, renderCharacter } from './render'
import type { CharacterConfig, LibAsset } from './types'

export const CHARACTER_FRAME_SIZE = 1024
export const CHARACTER_SOURCE_CANVAS = { width: 400, height: 800 } as const

export interface CharacterReferencePackManifest {
  format: 'animasi2d.character-reference-pack'
  format_version: 1
  character: { id: number | null; name: string; version: number | null; template: string; facing: string }
  frame: {
    width: 1024
    height: 1024
    mime: 'image/png'
    transparent: true
    pivot: { x: 512; y: 1024 }
    source_canvas: { width: 400; height: 800 }
    fit: 'contain-height'
  }
  reference_image: string
  rig: CharacterConfig['rig'] | null
  expressions: NonNullable<CharacterConfig['expressions']>
  config: CharacterConfig
  assets: Array<{
    id: number
    uuid: string
    version: number
    category: string
    name: string
    key: string | null
    hash: string
    mime: string
    width: number
    height: number
    view: string
    template: string
    family: string | null
  }>
  limitations: string[]
}

/** Render the existing 400x800 modular character canvas into a square 1024px reference frame. */
export async function renderCharacterReferenceFrame(
  config: CharacterConfig,
  assets: Record<number, LibAsset>,
  zOf: (slot: string) => number,
): Promise<Blob> {
  const source = await renderCharacter(config, assets, {
    scale: 1.28,
    zOf,
    transparent: true,
    rect: { x: 0, y: 0, w: CHARACTER_SOURCE_CANVAS.width, h: CHARACTER_SOURCE_CANVAS.height },
  })
  const frame = document.createElement('canvas')
  frame.width = CHARACTER_FRAME_SIZE
  frame.height = CHARACTER_FRAME_SIZE
  const ctx = frame.getContext('2d')
  if (!ctx) throw new Error('Browser tidak mendukung canvas 2D.')
  // The character keeps its original 1:2 proportions and is centred horizontally.
  ctx.drawImage(source, 256, 0, 512, 1024)
  return canvasBlob(frame)
}

/** Build a portable, version-pinned manifest; asset URLs are intentionally omitted because they are session-specific. */
export function buildCharacterReferencePackManifest(input: {
  characterId: number | null
  name: string
  version: number | null
  config: CharacterConfig
  assets: Record<number, LibAsset>
  referenceImageName?: string
}): CharacterReferencePackManifest {
  const referenced = new Set<number>()
  Object.values(input.config.parts).forEach((part) => referenced.add(part.assetId))
  for (const expression of input.config.expressions ?? []) {
    Object.values(expression.parts).forEach((part) => { if (part) referenced.add(part.assetId) })
  }
  const assetList = [...referenced].map((id) => {
    const asset = input.assets[id]
    if (!asset) throw new Error(`Aset karakter #${id} belum dimuat. Muat ulang karakter sebelum export.`)
    return {
      id: asset.id,
      uuid: asset.asset_uuid,
      version: asset.version_number,
      category: asset.category,
      name: asset.name,
      key: asset.key,
      hash: asset.hash,
      mime: asset.mime,
      width: asset.width,
      height: asset.height,
      view: asset.view ?? 'front',
      template: asset.template ?? input.config.template ?? 'anime-v1',
      family: asset.family ?? null,
    }
  }).sort((a, b) => a.id - b.id)

  return {
    format: 'animasi2d.character-reference-pack',
    format_version: 1,
    character: {
      id: input.characterId,
      name: input.name,
      version: input.version,
      template: input.config.template ?? 'anime-v1',
      facing: input.config.facing ?? 'front',
    },
    frame: {
      width: 1024,
      height: 1024,
      mime: 'image/png',
      transparent: true,
      pivot: { x: 512, y: 1024 },
      source_canvas: { ...CHARACTER_SOURCE_CANVAS },
      fit: 'contain-height',
    },
    reference_image: input.referenceImageName ?? 'character_reference_1024.png',
    rig: input.config.rig ?? null,
    expressions: input.config.expressions ?? [],
    config: input.config,
    assets: assetList,
    limitations: [
      'This v1 pack contains the current configured facing as a reference image, not a multi-frame animation atlas.',
      'The original modular config and rig are preserved; sprite animation frames must be supplied by a later animation-sheet import workflow.',
      'Google Flow output must be checked for identity, frame alignment, transparency and pose compatibility before production use.',
    ],
  }
}

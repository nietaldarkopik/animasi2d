import { RIGHT_SHOE } from './spec'
import type { CharacterConfig, LibAsset } from './types'

/**
 * A mirrored single shoe (see LibAsset.mirror) needs a part for each foot: "shoes" is the left one, "shoes_r" the right one (the same
 * asset, flipped), each with its own placement. This keeps the two in step with the picked asset:
 *  - a mirrored shoe in "shoes": the right shoe exists too (new: a mirror image of the left shoe's placement; existing: kept as the user set it)
 *  - anything else (a pair, no shoe): there is no right shoe part
 */
export function syncShoes(config: CharacterConfig, assets: Record<number, Pick<LibAsset, 'mirror'>>): CharacterConfig {
  const left = config.parts.shoes
  const mirrored = !!left && !!assets[left.assetId]?.mirror
  const right = config.parts[RIGHT_SHOE]
  if (!mirrored) {
    if (!right) return config
    const { [RIGHT_SHOE]: _gone, ...parts } = config.parts
    return { ...config, parts }
  }
  if (right && right.assetId === left.assetId) return config
  const { hash: _h, ...base } = left
  const next = right
    ? { ...right, assetId: left.assetId } // the asset changed: keep the placement the user gave the right shoe
    : { ...base, dx: -(left.dx ?? 0), ...(left.rot ? { rot: -left.rot } : {}) } // first time: the mirror image of the left shoe
  return { ...config, parts: { ...config.parts, [RIGHT_SHOE]: next } }
}

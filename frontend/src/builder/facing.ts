import { fittedHeadPart } from './fitHead'
import type { CharacterConfig, Facing, LibAsset, PartRef } from './types'

export const FACINGS: Facing[] = ['front', 'right', 'left', 'back']

/** Not drawn from behind: the back-of-head hair covers them. They are set aside when the character turns its back and put back on the way round. */
export const HIDDEN_FROM_BEHIND = ['face', 'eyes', 'brows', 'mouth', 'glasses'] as const

export interface FacingSwitch {
  config: CharacterConfig
  /** slots that were swapped to the part drawn for the new facing */
  swapped: string[]
  /** slots whose part has no version for the new facing yet (they keep the current art) */
  missing: string[]
  /** parts set aside because they are not seen from this facing (give them back to the next switchFacing call) */
  hidden: Record<string, PartRef>
}

/**
 * Turn a character to another facing: every part that belongs to a set (the same garment/body drawn for front, right, left and back)
 * is replaced by its twin for the new facing. Position, size and rotation of the part are kept. Parts without a twin stay as they are.
 * From behind, face/eyes/brows/mouth/glasses are set aside and the hair becomes a back-of-head drawing; `hidden` brings them back.
 */
export function switchFacing(config: CharacterConfig, to: Facing, assets: LibAsset[], hiddenBefore: Record<string, PartRef> = {}): FacingSwitch {
  const byId = new Map(assets.map((a) => [a.id, a]))
  const parts = { ...config.parts }
  const swapped: string[] = []
  const missing: string[] = []
  const hidden: Record<string, PartRef> = {}

  // coming back round: the parts set aside while the character faced away
  if (to !== 'back') for (const [slot, ref] of Object.entries(hiddenBefore)) if (!parts[slot] || slot === 'hair_front') parts[slot] = ref

  for (const [slot, ref] of Object.entries(parts)) {
    const cur = byId.get(ref.assetId)
    if (!cur || (cur.view ?? 'front') === to) continue
    // a rendered avatar's head from behind is ONE drawing in the hair slot: its hair-behind-the-head layer has no back twin and is left out
    const wholeHead = to === 'back' && slot === 'hair_back' && (cur.family ?? '').startsWith('vrm-')
    if (to === 'back' && ((HIDDEN_FROM_BEHIND as readonly string[]).includes(slot) || wholeHead)) {
      hidden[slot] = ref
      delete parts[slot]
      continue
    }
    const twin = cur.set ? assets.find((a) => a.set === cur.set && (a.view ?? 'front') === to && a.category === cur.category && a.status === 'approved') : undefined
    if (twin) {
      const { hash: _h, ...rest } = ref
      parts[slot] = { ...rest, assetId: twin.id }
      swapped.push(slot)
    } else if (to === 'back' && slot === 'hair_front') {
      // no twin of a front hairstyle: the first back-of-head drawing (◀ ▶ picks another)
      const back = assets.find((a) => a.category === 'hair_front' && a.view === 'back' && a.status === 'approved')
      if (back) {
        hidden[slot] = ref
        parts[slot] = config.headFit ? fittedHeadPart(slot, back, config.headFit) : { assetId: back.id, dx: 0, dy: 0, scale: 1 }
        swapped.push(slot)
      } else missing.push(slot)
    } else missing.push(slot)
  }
  return { config: { ...config, facing: to, parts }, swapped, missing, hidden }
}

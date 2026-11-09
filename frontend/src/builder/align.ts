import type { LibAsset, PartRef } from './types'

/**
 * A freshly picked part, placed so its named anchors (top of the head, eyes, brows, mouth...) land on the design template's: the server
 * measures them from the art and says how far to move (`align`). Parts that are not aligned (hair, clothes, arms...) start at 0, 0.
 * A manual move afterwards is an override on top of this, not the foundation.
 */
export function freshPart(a: Pick<LibAsset, 'id' | 'align'>, extra: Partial<PartRef> = {}): PartRef {
  return { assetId: a.id, dx: a.align?.dx ?? 0, dy: a.align?.dy ?? 0, scale: 1, ...extra }
}

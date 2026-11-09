import type { CharacterConfig, DesignFamilyInfo, LibAsset } from './types'

/** Parts worn by anyone: shoes, glasses, hats, bags... are never a mismatch, whatever sheet they were drawn on. */
const ANYONE = ['shoes', 'shoes_r', 'bag', 'accessory', 'glasses', 'hat', 'headphone']

export interface FamilyClash { a: string; b: string; message: string }

/**
 * Parts drawn for different bodies (a male-sheet shirt on a female-kit body...) may not fit each other: sizes and attachment points differ.
 * This only SAYS so, once per pair of families, and never blocks: mixing is sometimes exactly what the author wants.
 * `nameOf` gives the display name of a slot.
 */
export function familyClashes(config: CharacterConfig, assets: Record<number, Pick<LibAsset, 'name' | 'family'>>, families: Record<string, DesignFamilyInfo>, nameOf: (slot: string) => string = (s) => s): FamilyClash[] {
  const parts = Object.entries(config.parts)
    .map(([slot, p]) => ({ slot, a: assets[p.assetId] }))
    .filter((x) => !ANYONE.includes(x.slot) && x.a?.family && families[x.a.family])
  const seen = new Map<string, FamilyClash>()
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      const fa = parts[i].a!.family!, fb = parts[j].a!.family!
      if (fa === fb) continue
      const ok = (families[fa].compatible.includes(fb)) && (families[fb].compatible.includes(fa))
      if (ok) continue
      const [a, b] = [fa, fb].sort()
      if (seen.has(`${a}|${b}`)) continue
      seen.set(`${a}|${b}`, {
        a, b,
        message: `${nameOf(parts[i].slot)} “${parts[i].a!.name}” (${families[fa].label}) dan ${nameOf(parts[j].slot)} “${parts[j].a!.name}” (${families[fb].label}) dibuat untuk badan yang berbeda: ukuran dan titik pasangnya bisa tidak pas.`,
      })
    }
  }
  return [...seen.values()]
}

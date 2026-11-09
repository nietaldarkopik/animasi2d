import { describe, expect, it } from 'vitest'
import { familyClashes } from './compat'
import type { CharacterConfig, DesignFamilyInfo } from './types'

const all = ['male', 'female', 'kit-l1', 'kit-p3', 'general', 'legacy']
const families: Record<string, DesignFamilyInfo> = {
  male: { label: 'Laki-laki', compatible: ['male', 'kit-l1', 'general', 'legacy'] },
  female: { label: 'Perempuan', compatible: ['female', 'kit-p3', 'general', 'legacy'] },
  'kit-l1': { label: 'Kit L1', compatible: ['male', 'kit-l1', 'general', 'legacy'] },
  'kit-p3': { label: 'Kit P3', compatible: ['female', 'kit-p3', 'general', 'legacy'] },
  general: { label: 'Umum', compatible: all },
  legacy: { label: 'Lembar pertama', compatible: all },
}
const asset = (name: string, family: string | null) => ({ name, family })
const cfg = (...ids: [string, number][]): CharacterConfig => ({ schema_version: 1, view: 'full', palette: {} as never, parts: Object.fromEntries(ids.map(([slot, id]) => [slot, { assetId: id, dx: 0, dy: 0, scale: 1 }])) })

describe('familyClashes', () => {
  const assets = { 1: asset('Wajah perempuan 05', 'female'), 2: asset('Atasan laki-laki 02', 'male'), 3: asset('Mata 01', 'general'), 4: asset('Kit L1 - celana', 'kit-l1'), 5: asset('Kemeja SMK', 'legacy'), 6: asset('Atasan perempuan 03', 'female'), 7: asset('Tanpa label', null) }

  it('says nothing when everything fits: the same family, generic and first-sheet parts', () => {
    expect(familyClashes(cfg(['face', 1], ['top', 6], ['eyes', 3], ['bottom', 5]), assets, families)).toEqual([])
  })

  it('warns once per pair of families, however many parts clash', () => {
    const more = { ...assets, 8: asset('Atasan laki-laki 09', 'male') }
    expect(familyClashes(cfg(['face', 1], ['top', 2], ['bag', 8]), more, families)).toHaveLength(1)
  })

  it('every incompatible pair of families gets its own note, in either direction', () => {
    const c = familyClashes(cfg(['face', 1], ['top', 2], ['bottom', 4]), assets, families)
    expect(c.map((x) => `${x.a}|${x.b}`).sort()).toEqual(['female|kit-l1', 'female|male'])
    expect(c[0].message).toContain('dibuat untuk badan yang berbeda')
    expect(c.find((x) => x.a === 'female' && x.b === 'male')!.message).toContain('Wajah perempuan 05')
  })

  it('never counts shoes, glasses, hats or bags: anyone can wear them', () => {
    const extra = { ...assets, 9: asset('Kit SMA L1 - sepatu', 'kit-l1'), 10: asset('Kacamata', 'male') }
    expect(familyClashes(cfg(['face', 1], ['shoes', 9], ['glasses', 10], ['shoes_r', 9]), extra, families)).toEqual([])
  })

  it('ignores parts without a family, an unknown family, and never throws on a missing asset', () => {
    expect(familyClashes(cfg(['face', 1], ['top', 7], ['eyes', 99]), assets, families)).toEqual([])
    expect(familyClashes(cfg(['face', 1], ['top', 2]), assets, {})).toEqual([])
  })
})

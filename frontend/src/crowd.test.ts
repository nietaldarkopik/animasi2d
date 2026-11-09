import { describe, expect, it } from 'vitest'
import { CLEAR, crowdSpots, ROWS, silentCast } from './crowd'

describe('crowd behind the speakers', () => {
  it('keeps the front row clear of the speakers', () => {
    const spots = crowdSpots(5, [0.32, 0.68])
    expect(spots).toHaveLength(5)
    for (const s of spots) {
      expect(s.row).toBe(0)
      expect(Math.min(Math.abs(s.xFrac - 0.32), Math.abs(s.xFrac - 0.68))).toBeGreaterThanOrEqual(CLEAR - 1e-9)
      expect(s.xFrac).toBeGreaterThan(0)
      expect(s.xFrac).toBeLessThan(1)
    }
  })

  it('a big crowd fills two rows: the back row smaller and higher, in the gaps of the front row', () => {
    const spots = crowdSpots(12, [0.5])
    const front = spots.filter((s) => s.row === 0), back = spots.filter((s) => s.row === 1)
    expect(front).toHaveLength(6)
    expect(back).toHaveLength(6)
    expect(back[0].scale).toBeLessThan(front[0].scale)
    expect(back[0].lift).toBeGreaterThan(front[0].lift)
    for (const b of back) expect(Math.min(...front.map((f) => Math.abs(f.xFrac - b.xFrac)))).toBeGreaterThan(0.02)
  })

  it('never places more than the two rows hold', () => {
    expect(crowdSpots(40, [])).toHaveLength(ROWS[0].max + ROWS[1].max)
    expect(crowdSpots(0, [0.5])).toEqual([])
  })

  it('the silent cast leaves out the speakers, the narrator and duplicates', () => {
    expect(silentCast(['Uki', 'Sekar', 'pak suga', 'Narator', 'Ines', 'ines'], ['Pak Suga', 'Uki'])).toEqual(['Sekar', 'Ines'])
    expect(silentCast(undefined, ['Uki'])).toEqual([])
  })
})

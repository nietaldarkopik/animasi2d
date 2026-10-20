import { describe, expect, it } from 'vitest'
import type { Pixels } from '../retouch'
import { despeckle, erodeAlpha, floodErase } from './pixeledit'

/** w×h image from a character map: '.' transparent, 'W' white, 'R' red, 'K' black, 'G' light grey */
function make(rows: string[]): Pixels {
  const h = rows.length, w = rows[0].length
  const data = new Uint8ClampedArray(w * h * 4)
  const col: Record<string, number[]> = { W: [255, 255, 255, 255], G: [240, 240, 240, 255], R: [220, 30, 30, 255], K: [0, 0, 0, 255], '.': [0, 0, 0, 0] }
  rows.forEach((row, y) => [...row].forEach((c, x) => data.set(col[c], (y * w + x) * 4)))
  return { w, h, data }
}
/** '#' = still visible, '.' = transparent */
const shape = (p: Pixels) => Array.from({ length: p.h }, (_, y) => Array.from({ length: p.w }, (_, x) => (p.data[(y * p.w + x) * 4 + 3] > 0 ? '#' : '.')).join(''))

describe('floodErase', () => {
  it('erases only the connected region of the clicked colour (the outside background)', () => {
    const p = make(['WWWWWWW', 'WKKKKKW', 'WKRRRKW', 'WKKKKKW', 'WWWWWWW'])
    const n = floodErase(p, 0, 0, 10, true, 0)
    expect(n).toBe(7 * 5 - 5 * 3)
    expect(shape(p)).toEqual(['.......', '.#####.', '.#####.', '.#####.', '.......'])
  })

  it('contiguous mode leaves an enclosed region of the same colour; global mode erases it too', () => {
    const rows = ['WWWWW', 'WRRRW', 'WRWRW', 'WRRRW', 'WWWWW']
    const contiguous = make(rows)
    floodErase(contiguous, 0, 0, 10, true, 0)
    expect(shape(contiguous)).toEqual(['.....', '.###.', '.###.', '.###.', '.....'])
    const global = make(rows)
    floodErase(global, 0, 0, 10, false, 0)
    expect(shape(global)).toEqual(['.....', '.###.', '.#.#.', '.###.', '.....'])
  })

  it('tolerance decides how similar a colour must be', () => {
    const strict = make(['GW'])
    expect(floodErase(strict, 0, 0, 5, true, 0)).toBe(1) // grey (240) vs white (255): different at tolerance 5
    const loose = make(['GW'])
    expect(floodErase(loose, 0, 0, 20, true, 0)).toBe(2)
  })

  it('grow extends the erased area by whole pixels', () => {
    const p = make(['WWWWW', 'WWRWW', 'WWWWW'])
    floodErase(p, 1, 0, 10, true, 0)
    expect(shape(p)).toEqual(['.....', '..#..', '.....'])
    const q = make(['WRRRW', 'WRRRW'])
    floodErase(q, 0, 0, 10, true, 1) // white column x=0 is erased, plus a 1px fringe: red column x=1; x=4 is a separate white region and stays
    expect(shape(q)).toEqual(['..###', '..###'])
  })

  it('transparent or out-of-image clicks do nothing', () => {
    const t = make(['.R'])
    expect(floodErase(t, 0, 0, 10)).toBe(0)
    expect(floodErase(t, 9, 9, 10)).toBe(0)
    expect(floodErase(t, -1, 0, 10)).toBe(0)
  })
})

describe('despeckle', () => {
  it('removes small detached specks and keeps the main shape', () => {
    const p = make(['RRRRR....', 'RRRRR..R.', 'RRRRR....', 'RRRRR....'])
    expect(despeckle(p, 0.1)).toBe(1)
    expect(shape(p)[1]).toBe('#####....')
  })

  it('keeps several comparable parts (eye + brow) and does nothing on a single shape', () => {
    const p = make(['RRRR..KKKK', 'RRRR..KKKK'])
    expect(despeckle(p, 0.1)).toBe(0)
    expect(shape(p)[0]).toBe('####..####')
    expect(despeckle(make(['RR']), 0.5)).toBe(0)
  })
})

describe('erodeAlpha', () => {
  it('shrinks the opaque area by one pixel on every side', () => {
    const p = make(['KKKKK', 'KKKKK', 'KKKKK', 'KKKKK', 'KKKKK'])
    erodeAlpha(p, 1)
    expect(shape(p)).toEqual(['.....', '.###.', '.###.', '.###.', '.....'])
  })
})

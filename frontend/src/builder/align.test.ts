import { describe, expect, it } from 'vitest'
import { freshPart } from './align'

describe('freshPart', () => {
  it('places a part at its template alignment, or at 0,0 when it has none', () => {
    expect(freshPart({ id: 5, align: { dx: -3.5, dy: 4 } })).toEqual({ assetId: 5, dx: -3.5, dy: 4, scale: 1 })
    expect(freshPart({ id: 6, align: null })).toEqual({ assetId: 6, dx: 0, dy: 0, scale: 1 })
    expect(freshPart({ id: 7 })).toEqual({ assetId: 7, dx: 0, dy: 0, scale: 1 })
  })

  it('keeps extras such as a stacking override', () => {
    expect(freshPart({ id: 8, align: { dx: 1, dy: 1 } }, { z: 7.5 })).toEqual({ assetId: 8, dx: 1, dy: 1, scale: 1, z: 7.5 })
  })
})

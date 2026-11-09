import { describe, expect, it } from 'vitest'
import { isSkirt } from './rigRender'

describe('isSkirt', () => {
  it('recognises Indonesian and English names', () => {
    expect(isSkirt({ name: 'Rok plisa biru 1', key: null })).toBe(true)
    expect(isSkirt({ name: 'Rok panjang', key: 'bottom_skirt' })).toBe(true)
    expect(isSkirt({ name: 'Celana jeans', key: null })).toBe(false)
    expect(isSkirt({ name: 'Wortel', key: 'bottom_trousers' })).toBe(false)
    expect(isSkirt(undefined)).toBe(false)
  })
})

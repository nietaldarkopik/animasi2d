import { describe, expect, it } from 'vitest'
import { crc32, makeZip } from './zip'

describe('zip', () => {
  it('crc32 matches the reference value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })
  it('writes a well-formed archive', async () => {
    const z = makeZip([{ name: 'a.png', data: new Uint8Array([1, 2, 3]) }, { name: 'b.png', data: new Uint8Array([4]) }])
    const b = new DataView(await z.arrayBuffer())
    expect(b.getUint32(0, true)).toBe(0x04034b50)
    const end = b.byteLength - 22
    expect(b.getUint32(end, true)).toBe(0x06054b50)
    expect(b.getUint16(end + 10, true)).toBe(2)
    expect(b.getUint32(b.getUint32(end + 16, true), true)).toBe(0x02014b50)
  })
})

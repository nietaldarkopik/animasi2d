import { describe, expect, it } from 'vitest'
import { binarizeLineArt, fitSize, IMG_DETAILS } from './imageToSvg'
import { svgDocument } from './svgExport'

describe('image -> SVG helpers', () => {
  it('fits the longest side, never enlarges, keeps proportions', () => {
    expect(fitSize(2000, 1000, 1000)).toMatchObject({ w: 1000, h: 500 })
    expect(fitSize(300, 600, 900)).toEqual({ w: 300, h: 600, k: 1 })
    expect(fitSize(1, 5000, 100)).toMatchObject({ w: 1, h: 100 })
  })

  it('line-art keeps only dark opaque pixels as black ink on transparent', () => {
    // 4 pixels: black opaque, light grey opaque, dark but transparent, mid-dark opaque
    const d = new Uint8ClampedArray([0, 0, 0, 255, 200, 200, 200, 255, 10, 10, 10, 20, 100, 100, 100, 255])
    const ink = binarizeLineArt(d, 140)
    expect(ink).toBe(2)
    expect(Array.from(d)).toEqual([0, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255])
    const e = new Uint8ClampedArray([100, 100, 100, 255])
    expect(binarizeLineArt(e, 90)).toBe(0) // a lower threshold drops it
  })

  it('wraps paths in a document the library sanitiser accepts (viewBox 0 0 w h)', () => {
    const s = svgDocument('<path d="M0 0"/>', 640, 480)
    expect(s).toContain('viewBox="0 0 640 480"')
    expect(s).toContain('xmlns="http://www.w3.org/2000/svg"')
  })

  it('detail levels grow in colours, size and effort', () => {
    const l = Object.values(IMG_DETAILS)
    for (let i = 1; i < l.length; i++) { expect(l[i].colors).toBeGreaterThan(l[i - 1].colors); expect(l[i].maxSide).toBeGreaterThan(l[i - 1].maxSide); expect(l[i].pathomit).toBeLessThan(l[i - 1].pathomit) }
  })
})

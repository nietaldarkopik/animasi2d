import { describe, expect, it } from 'vitest'
import { composeSvg, compactTrace, scopeIds, splitSvg, svgPart, xmlEscape, type VectorPart } from './svgExport'
import { DEFAULT_PALETTE } from './spec'
import type { CharacterConfig, LibAsset } from './types'

const asset = (id: number, o: Partial<LibAsset> = {}): LibAsset => ({ id, key: null, category: 'x', name: `a${id}`, tags: [], source: 'upload', status: 'approved', mime: 'image/svg+xml', width: 400, height: 800, tintable: false, hash: 'h', mine: true, meta: null, url: '', ...o })
const cfg = (parts: CharacterConfig['parts'], view: 'half' | 'full' = 'full'): CharacterConfig => ({ schema_version: 1, view, palette: { ...DEFAULT_PALETTE }, parts })
const Z: Record<string, number> = { body: 2, top: 7, face: 9, hair_front: 10, hair_back: 1 }
const zOf = (s: string) => Z[s] ?? 0
const vec = (inner: string, vbW = 400, vbH = 800): VectorPart => ({ kind: 'svg', inner, vbW, vbH })
const ids = (svg: string) => [...svg.matchAll(/<g id="([^"]+)" inkscape:groupmode="layer"/g)].map((m) => m[1])

describe('SVG pieces', () => {
  it('splits an SVG document into inner markup and size (viewBox wins, offset viewBox is shifted)', () => {
    expect(splitSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 800" width="9" height="9"><path d="M0 0"/></svg>')).toEqual({ inner: '<path d="M0 0"/>', vbW: 400, vbH: 800 })
    expect(splitSvg('<svg width="120" height="60"><rect/></svg>')).toMatchObject({ vbW: 120, vbH: 60 })
    const shifted = splitSvg('<svg viewBox="10 20 100 50"><rect/></svg>')!
    expect(shifted.inner).toContain('translate(-10 -20)')
    expect(splitSvg('not svg')).toBeNull()
    expect(splitSvg('<svg><rect/></svg>')).toBeNull() // no size at all
  })

  it('makes ids and references unique per layer so gradients of two parts cannot collide', () => {
    const a = scopeIds('<defs><linearGradient id="g"/></defs><path fill="url(#g)" stroke="url(#h)"/>', 'hair')
    expect(a).toContain('id="hair-g"')
    expect(a).toContain('fill="url(#hair-g)"')
    expect(a).toContain('url(#hair-h)')
    expect(scopeIds('<use href="#x"/>', 'p')).toContain('href="#p-x"')
  })

  it('recolours tintable SVG assets with the palette', () => {
    const svg = '<svg viewBox="0 0 400 800"><path data-tint="hair" fill="#000000" d="M0 0"/></svg>'
    const p = svgPart(svg, { tintable: true }, { ...DEFAULT_PALETTE, hair: '#ff0000' })!
    expect(p.inner).toContain('fill="#ff0000"')
    expect(svgPart(svg, { tintable: false }, { ...DEFAULT_PALETTE, hair: '#ff0000' })!.inner).toContain('fill="#000000"')
  })

  it('compacts the tracer output: hex colours, no transparent layers, no tracer boilerplate', () => {
    const raw = '<svg width="10" height="10" version="1.1" xmlns="http://www.w3.org/2000/svg" desc="x" >' +
      '<path fill="rgb(255,0,16)" stroke="rgb(255,0,16)" stroke-width="1" opacity="1" d="M 0 0 L 5 0 L 5 5 Z " />' +
      '<path fill="rgb(0,0,0)" stroke="rgb(0,0,0)" stroke-width="1" opacity="0" d="M 0 0 L 9 9 Z " />' +
      '<path fill="rgb(1,2,3)" stroke="rgb(1,2,3)" stroke-width="1" opacity="1" d="M 1 1 L 2 2 Z " /></svg>'
    const c = compactTrace(raw, 1)
    expect(c.paths).toBe(2)
    expect(c.inner).toContain('fill="#ff0010"')
    expect(c.inner).toContain('fill="#010203"')
    expect(c.inner).not.toContain('rgb(')
    expect(c.inner).not.toContain('L 9 9') // the transparent one is gone
    expect(compactTrace(raw, 0).inner).not.toContain('stroke=')
  })

  it('escapes text for XML', () => {
    expect(xmlEscape('a & "b" <c>')).toBe('a &amp; &quot;b&quot; &lt;c&gt;')
  })
})

describe('composeSvg', () => {
  const parts = { body: { assetId: 1, dx: 0, dy: 0, scale: 1 }, top: { assetId: 2, dx: 0, dy: 0, scale: 1 }, face: { assetId: 3, dx: 0, dy: 0, scale: 1 } }
  const assets = { 1: asset(1), 2: asset(2), 3: asset(3) }
  const vp = { body: vec('<path id="a" fill="url(#g)"/>'), top: vec('<path id="a" fill="url(#g)"/>'), face: vec('<rect/>') }

  it('draws one named layer per part, back to front by category order', () => {
    const r = composeSvg({ config: cfg(parts), assets, zOf, parts: vp, labels: { body: 'Badan', top: 'Atasan', face: 'Wajah' }, title: 'Uki' })
    expect(ids(r.svg)).toEqual(['body', 'top', 'face'])
    expect(r.layers).toBe(3)
    expect(r.svg).toContain('inkscape:label="Badan"')
    expect(r.svg).toContain('<title>Uki</title>')
    expect(r.svg.startsWith('<?xml')).toBe(true)
    expect(r.svg).toContain('xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"')
  })

  it('honours a z override and keeps ids unique between layers', () => {
    const c = cfg({ ...parts, face: { ...parts.face, z: 3 } }) // face now between body (2) and top (7)
    const r = composeSvg({ config: c, assets, zOf, parts: vp })
    expect(ids(r.svg)).toEqual(['body', 'face', 'top'])
    const all = [...r.svg.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1])
    expect(new Set(all).size).toBe(all.length) // body-a / top-a and body-g / top-g, no duplicates
    expect(r.svg).toContain('url(#body-g)')
    expect(r.svg).toContain('url(#top-g)')
  })

  it('viewBox follows the view (half crops the bottom) and size = view x scale', () => {
    const full = composeSvg({ config: cfg(parts, 'full'), assets, zOf, parts: vp })
    expect(full.svg).toContain('viewBox="0 30 400 770"')
    expect([full.width, full.height]).toEqual([800, 1540])
    const half = composeSvg({ config: cfg(parts, 'half'), assets, zOf, parts: vp, scale: 1 })
    expect(half.svg).toContain('viewBox="0 30 400 570"')
    expect([half.width, half.height]).toEqual([400, 570])
  })

  it('applies the same transform chain as the renderer: offset, rotation, scale about the slot pivot', () => {
    const c = cfg({ face: { assetId: 3, dx: 10, dy: -5, scale: 1.5, rot: 20 } })
    const r = composeSvg({ config: c, assets, zOf, parts: { face: vec('<rect/>') } })
    // face pivot is (200,190): translate(px+dx py+dy) rotate scale translate(-px -py)
    expect(r.svg).toContain('transform="translate(210 185) rotate(20) scale(1.5) translate(-200 -190)"')
    // a full-canvas asset is placed at 0,0 at its natural size
    expect(r.svg).toContain('transform="translate(0 0) scale(1 1)"')
  })

  it('places an upload that is not canvas-sized at its slot anchor, scaled into its box', () => {
    const png = asset(9, { mime: 'image/png', width: 300, height: 300 })
    const c = cfg({ hat: { assetId: 9, dx: 0, dy: 0, scale: 1 } })
    const r = composeSvg({ config: c, assets: { 9: png }, zOf, parts: { hat: { kind: 'embed', vbW: 300, vbH: 300, inner: '<image width="300" height="300" xlink:href="data:image/png;base64,AA=="/>' } } })
    // hat slot: centre (200,95), max width 260 -> 260x260 at x=70, y=-35
    expect(r.svg).toContain('translate(70 -35) scale(0.867 0.867)')
    expect(r.embeds).toBe(1)
    expect(r.svg).toContain('data-source="embed"')
  })

  it('a split part (long hair) becomes two layers: the whole part behind the body, the upper part in front, each clipped', () => {
    const c = cfg({ body: parts.body, hair_front: { assetId: 3, dx: 0, dy: 0, scale: 1, split: 330 }, top: parts.top })
    const r = composeSvg({ config: c, assets, zOf, parts: { body: vp.body, top: vp.top, hair_front: vec('<rect/>') } })
    expect(ids(r.svg)).toEqual(['hair_front-behind', 'body', 'top', 'hair_front']) // behind body (z 1.1 < 2), front = category z 10
    expect(r.svg).toMatch(/<clipPath id="clip-hair_front-behind"><rect x="-200" y="328" width="800" height="1600"\/><\/clipPath>/)
    expect(r.svg).toMatch(/<clipPath id="clip-hair_front"><rect x="-200" y="-400" width="800" height="730"\/><\/clipPath>/)
    expect(r.svg).toContain('clip-path="url(#clip-hair_front)"')
  })

  it('can draw a subset (one part per file), add a background, and skips parts with no vector data', () => {
    const only = composeSvg({ config: cfg(parts), assets, zOf, parts: vp, only: ['top'] })
    expect(ids(only.svg)).toEqual(['top'])
    const bg = composeSvg({ config: cfg(parts), assets, zOf, parts: vp, background: '#ffffff' })
    expect(bg.svg).toContain('<rect id="background" x="0" y="30" width="400" height="770" fill="#ffffff"/>')
    expect(composeSvg({ config: cfg(parts), assets, zOf, parts: vp }).svg).not.toContain('id="background"')
    const missing = composeSvg({ config: cfg(parts), assets, zOf, parts: { body: vp.body } })
    expect(ids(missing.svg)).toEqual(['body'])
  })

  it('counts the vector shapes it contains', () => {
    const r = composeSvg({ config: cfg(parts), assets, zOf, parts: { body: vec('<path d="M0 0"/><path d="M1 1"/>'), top: vec('<path d="M0 0"/>'), face: vec('<rect/>') } })
    expect(r.paths).toBe(3)
  })

  it('escapes layer labels and titles', () => {
    const r = composeSvg({ config: cfg(parts), assets, zOf, parts: vp, labels: { body: 'Badan "A" & <B>' }, title: 'X & Y' })
    expect(r.svg).toContain('inkscape:label="Badan &quot;A&quot; &amp; &lt;B&gt;"')
    expect(r.svg).toContain('<title>X &amp; Y</title>')
  })
})

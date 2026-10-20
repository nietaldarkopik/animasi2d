import { layerEntries, placement, tintSvg, VIEWS } from './spec'
import type { CharacterConfig, LibAsset } from './types'

/**
 * Character -> one SVG document. Every part becomes a named layer (<g id="hair_front" inkscape:groupmode="layer">) in the same
 * stacking order, with the same placement, rotation, scale, recolouring and split-behind-the-clothes clipping as the canvas
 * renderer, so the file opens in Inkscape / Illustrator / Figma / CorelDRAW as an editable, layered drawing.
 *
 * What goes inside a layer depends on the asset:
 *   - SVG asset            -> its own vector markup (recoloured with the palette), ids made unique per layer
 *   - PNG, traced          -> vector paths (colour-quantised tracing) - an approximation of the picture
 *   - PNG, embedded        -> an <image> with the PNG (exact, but NOT vector)
 */

export type PartKind = 'svg' | 'trace' | 'embed'

/** The drawable content of one part, in the part's own image space (0 0 vbW vbH = the asset image). */
export interface VectorPart {
  kind: PartKind
  /** SVG markup (paths / groups / image) positioned inside the box 0 0 vbW vbH */
  inner: string
  vbW: number
  vbH: number
}

export interface SvgOptions {
  config: CharacterConfig
  assets: Record<number, LibAsset>
  zOf: (slot: string) => number
  /** one entry per slot that should be drawn */
  parts: Record<string, VectorPart>
  /** category name per slot, used as the layer label */
  labels?: Record<string, string>
  view?: 'half' | 'full'
  /** size of the document in pixels = scale x the view size in canvas units (default 2 -> 800 x 1540) */
  scale?: number
  /** solid background colour, or null for transparent */
  background?: string | null
  title?: string
  /** draw only these slots (a per-part file) */
  only?: string[]
}

const num = (v: number) => String(Math.round(v * 1000) / 1000)

export const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Make every id inside a markup fragment unique by prefixing it (gradients, clip paths...), including its url(#...) references. */
export function scopeIds(markup: string, prefix: string): string {
  return markup
    .replace(/\bid="([^"]+)"/g, (_m, id: string) => `id="${prefix}-${id}"`)
    .replace(/url\(#([^)\s]+)\)/g, (_m, id: string) => `url(#${prefix}-${id})`)
    .replace(/\b(xlink:href|href)="#([^"]+)"/g, (_m, a: string, id: string) => `${a}="#${prefix}-${id}"`)
}

/** Inner markup + size of an SVG document string (`null` when it does not look like one). */
export function splitSvg(svg: string): { inner: string; vbW: number; vbH: number } | null {
  const m = svg.match(/<svg\b([^>]*)>([\s\S]*)<\/svg>\s*$/i)
  if (!m) return null
  const attrs = m[1]
  const vb = attrs.match(/\bviewBox="\s*(-?[\d.]+)[\s,]+(-?[\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/i)
  const w = attrs.match(/\bwidth="([\d.]+)/i), h = attrs.match(/\bheight="([\d.]+)/i)
  const vbW = vb ? parseFloat(vb[3]) : w ? parseFloat(w[1]) : NaN
  const vbH = vb ? parseFloat(vb[4]) : h ? parseFloat(h[1]) : NaN
  if (!(vbW > 0) || !(vbH > 0)) return null
  // a viewBox that does not start at 0,0 is shifted into place
  const inner = vb && (parseFloat(vb[1]) !== 0 || parseFloat(vb[2]) !== 0) ? `<g transform="translate(${num(-parseFloat(vb[1]))} ${num(-parseFloat(vb[2]))})">${m[2]}</g>` : m[2]
  return { inner, vbW, vbH }
}

/** Vector content of an SVG asset recoloured with the palette (no browser needed). */
export function svgPart(svgText: string, asset: Pick<LibAsset, 'tintable'>, palette: CharacterConfig['palette']): VectorPart | null {
  const s = splitSvg(asset.tintable ? tintSvg(svgText, palette) : svgText)
  return s ? { kind: 'svg', inner: s.inner, vbW: s.vbW, vbH: s.vbH } : null
}

const hex2 = (n: number) => n.toString(16).padStart(2, '0')

/**
 * ImageTracer output -> compact paths in the traced image's pixel space: rgb() -> #hex, transparent layers dropped,
 * redundant attributes removed. `strokeWidth` (px) closes the hairline seams between neighbouring colour regions.
 */
export function compactTrace(tracerSvg: string, strokeWidth = 1): { inner: string; paths: number } {
  const out: string[] = []
  for (const m of tracerSvg.matchAll(/<path\b([^>]*?)\/>/g)) {
    const a = m[1]
    const fill = a.match(/\bfill="rgb\((\d+),(\d+),(\d+)\)"/)
    const d = a.match(/\bd="([^"]+)"/)
    const op = a.match(/\bopacity="([\d.]+)"/)
    if (!fill || !d || (op && parseFloat(op[1]) <= 0.01)) continue
    const col = `#${hex2(+fill[1])}${hex2(+fill[2])}${hex2(+fill[3])}`
    out.push(`<path fill="${col}"${strokeWidth > 0 ? ` stroke="${col}" stroke-width="${num(strokeWidth)}" stroke-linejoin="round"` : ''} fill-rule="evenodd" d="${d[1].trim()}"/>`)
  }
  return { inner: out.join(''), paths: out.length }
}

/** A standalone SVG document around path markup in the pixel space 0 0 w h (the shape the library's sanitiser accepts). */
export function svgDocument(inner: string, w: number, h: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${inner}</svg>`
}

/** Layer name -> a safe id fragment. */
const safeId = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '_')

export interface SvgResult { svg: string; width: number; height: number; layers: number; paths: number; embeds: number }

export function composeSvg(o: SvgOptions): SvgResult {
  const view = VIEWS[o.view ?? o.config.view]
  const k = o.scale ?? 2
  const width = Math.round(view.w * k)
  const height = Math.round(view.h * k)
  const entries = layerEntries(o.config, o.zOf).filter((e) => (!o.only || o.only.includes(e.slot)) && o.parts[e.slot])

  const defs: string[] = []
  const body: string[] = []
  let paths = 0
  let embeds = 0
  const used = new Set<string>()

  for (const e of entries) {
    const part = o.parts[e.slot]
    const ref = o.config.parts[e.slot]
    const asset = o.assets[ref.assetId]
    if (!asset) continue
    const pl = placement(e.slot, asset, ref)
    let id = safeId(e.slot) + (e.pass === 'back' ? '-behind' : '')
    while (used.has(id)) id += '_'
    used.add(id)
    const label = (o.labels?.[e.slot] ?? e.slot) + (e.pass === 'back' ? ' (di belakang badan)' : '')

    let clip = ''
    if (e.clipToY !== undefined || e.clipFromY !== undefined) {
      const rect = e.clipToY !== undefined ? `x="-200" y="-400" width="800" height="${num(400 + e.clipToY)}"` : `x="-200" y="${num(e.clipFromY!)}" width="800" height="1600"`
      defs.push(`<clipPath id="clip-${id}"><rect ${rect}/></clipPath>`)
      clip = ` clip-path="url(#clip-${id})"`
    }

    const inner = part.kind === 'svg' ? scopeIds(part.inner, id) : part.inner
    paths += (part.inner.match(/<path\b/g) ?? []).length
    if (part.kind === 'embed') embeds++
    // same chain as the canvas renderer: move to the pivot (+ offset), rotate, scale, move back; then place the image box
    const tf = `translate(${num(pl.px + pl.dx)} ${num(pl.py + pl.dy)})${pl.rot ? ` rotate(${num(pl.rot)})` : ''}${pl.scale !== 1 ? ` scale(${num(pl.scale)})` : ''} translate(${num(-pl.px)} ${num(-pl.py)})`
    const place = `translate(${num(pl.x)} ${num(pl.y)}) scale(${num(pl.w / part.vbW)} ${num(pl.h / part.vbH)})`
    body.push(
      `<g id="${id}" inkscape:groupmode="layer" inkscape:label="${xmlEscape(label)}" data-part="${xmlEscape(e.slot)}" data-source="${part.kind}"${clip}>` +
      `<g transform="${tf}"><g transform="${place}">${inner}</g></g></g>`,
    )
  }

  const title = o.title ? `<title>${xmlEscape(o.title)}</title>` : ''
  const bg = o.background ? `<rect id="background" x="${view.x}" y="${view.y}" width="${view.w}" height="${view.h}" fill="${xmlEscape(o.background)}"/>` : ''
  const svg =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" ` +
    `width="${width}" height="${height}" viewBox="${view.x} ${view.y} ${view.w} ${view.h}">\n` +
    `${title}${defs.length ? `<defs>${defs.join('')}</defs>\n` : ''}${bg}\n${body.join('\n')}\n</svg>\n`
  return { svg, width, height, layers: body.length, paths, embeds }
}

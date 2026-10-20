import { assetImage, assetSvgText, hasTint, tintedImage } from './render'
import { alphaBounds } from './rigRender'
import { compactTrace, svgPart, type VectorPart } from './svgExport'
import type { TraceReply, TraceRequest } from './traceWorker'
import type { CharacterConfig, LibAsset } from './types'

export type Detail = 'low' | 'medium' | 'high' | 'ultra'
export const DETAILS: Record<Detail, { label: string; colors: number; maxSide: number; pathomit: number }> = {
  low: { label: 'Rendah (8 warna, file kecil)', colors: 8, maxSide: 600, pathomit: 10 },
  medium: { label: 'Sedang (16 warna)', colors: 16, maxSide: 800, pathomit: 8 },
  high: { label: 'Tinggi (32 warna)', colors: 32, maxSide: 1100, pathomit: 4 },
  ultra: { label: 'Sangat tinggi (64 warna, lambat, file besar)', colors: 64, maxSide: 1500, pathomit: 2 },
}

let worker: Worker | null = null
let seq = 0
const pending = new Map<number, { res: (svg: string) => void; rej: (e: Error) => void }>()

function traceInWorker(req: Omit<TraceRequest, 'id'>): Promise<string> {
  if (!worker) {
    worker = new Worker(new URL('./traceWorker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<TraceReply>) => {
      const p = pending.get(e.data.id)
      if (!p) return
      pending.delete(e.data.id)
      if ('error' in e.data) p.rej(new Error(e.data.error))
      else p.res(e.data.svg)
    }
    worker.onerror = (e) => {
      for (const p of pending.values()) p.rej(new Error(e.message || 'Pelacak gagal.'))
      pending.clear()
      worker = null
    }
  }
  const id = ++seq
  return new Promise((res, rej) => {
    pending.set(id, { res, rej })
    worker!.postMessage({ ...req, id }, [req.data.buffer])
  })
}

export interface TraceOptions { colors: number; pathomit: number; /** px of same-colour outline that closes the seams between regions (0 = none) */ strokeWidth?: number }

/** Trace one canvas into compact SVG paths in that canvas' pixel space (alpha is cut to fully opaque / fully transparent first). */
export async function traceRaw(cv: HTMLCanvasElement, o: TraceOptions): Promise<{ inner: string; paths: number }> {
  const img = cv.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, cv.width, cv.height)
  // crisp silhouette: the soft anti-aliased edge would otherwise eat palette colours as half-transparent variants
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] >= 128) img.data[i + 3] = 255
    else { img.data[i] = img.data[i + 1] = img.data[i + 2] = img.data[i + 3] = 0 }
  }
  const sw = o.strokeWidth ?? 1
  const svg = await traceInWorker({
    width: img.width, height: img.height, data: img.data,
    options: { numberofcolors: o.colors, colorquantcycles: 3, colorsampling: 2, pathomit: o.pathomit, ltres: 1, qtres: 1, rightangleenhance: false, strokewidth: sw, roundcoords: 1, scale: 1, viewbox: false, blurradius: 0 },
  })
  return compactTrace(svg, sw)
}

/** Trace one canvas (already cropped to its visible pixels) with the preset of a detail level. */
export const traceCanvas = (cv: HTMLCanvasElement, detail: Detail) => traceRaw(cv, { colors: DETAILS[detail].colors, pathomit: DETAILS[detail].pathomit })

export interface PrepareInput {
  config: CharacterConfig
  assets: Record<number, LibAsset>
  /** 'trace' = PNG parts become vector paths; 'embed' = PNG parts are embedded as images */
  mode: 'trace' | 'embed'
  detail: Detail
  only?: string[]
  onProgress?: (done: number, total: number, label: string) => void
  isCancelled?: () => boolean
}

/** Vector content for every part of the character (SVG assets as they are, PNG assets traced or embedded). */
export async function preparePartVectors(inp: PrepareInput): Promise<Record<string, VectorPart>> {
  const { config, assets } = inp
  const slots = Object.keys(config.parts).filter((s) => !inp.only || inp.only.includes(s))
  const out: Record<string, VectorPart> = {}
  let done = 0
  for (const slot of slots) {
    if (inp.isCancelled?.()) throw new Error('Dibatalkan.')
    const ref = config.parts[slot]
    const asset = assets[ref.assetId]
    inp.onProgress?.(done, slots.length, slot)
    done++
    if (!asset) continue
    if (asset.mime === 'image/svg+xml') {
      const p = svgPart(await assetSvgText(asset), asset, config.palette)
      if (p) { out[slot] = p; continue }
    }
    // raster (or an SVG we could not split): start from the recoloured picture, exactly what the canvas draws
    const im = await assetImage(asset, config.palette)
    const W = im.naturalWidth, H = im.naturalHeight
    let src: HTMLCanvasElement
    if (hasTint(ref)) src = tintedImage(im, `${asset.id}:${asset.hash}:svgx`, ref)
    else { src = document.createElement('canvas'); src.width = W; src.height = H; src.getContext('2d')!.drawImage(im, 0, 0) }

    if (inp.mode === 'embed') {
      out[slot] = { kind: 'embed', vbW: W, vbH: H, inner: `<image width="${W}" height="${H}" xlink:href="${src.toDataURL('image/png')}"/>` }
      continue
    }
    const b = alphaBounds(src)
    if (!b) continue // nothing visible
    const crop = document.createElement('canvas')
    const k = Math.min(1, DETAILS[inp.detail].maxSide / Math.max(b.w, b.h))
    crop.width = Math.max(1, Math.round(b.w * k))
    crop.height = Math.max(1, Math.round(b.h * k))
    crop.getContext('2d')!.drawImage(src, b.x, b.y, b.w, b.h, 0, 0, crop.width, crop.height)
    const t = await traceCanvas(crop, inp.detail)
    // traced pixel space -> asset pixel space: undo the downscale, then move to where the crop was
    const sx = Math.round((b.w / crop.width) * 10000) / 10000
    const sy = Math.round((b.h / crop.height) * 10000) / 10000
    out[slot] = { kind: 'trace', vbW: W, vbH: H, inner: `<g transform="translate(${b.x} ${b.y}) scale(${sx} ${sy})">${t.inner}</g>` }
  }
  inp.onProgress?.(slots.length, slots.length, '')
  return out
}

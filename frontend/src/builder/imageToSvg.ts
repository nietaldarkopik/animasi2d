import { floodErase } from './pixeledit'
import { svgDocument } from './svgExport'
import { traceRaw } from './vectorize'

/** Photo / drawing (JPG, PNG, WebP) -> SVG by tracing. */
export type ImgMode = 'color' | 'lineart'

export interface ImgToSvgOptions {
  mode: ImgMode
  /** colour mode: palette size */
  colors: number
  /** longest side the picture is traced at (px); bigger = more detail, slower, larger file */
  maxSide: number
  /** make a plain background transparent (flood from the four corners) */
  removeBg: boolean
  bgTolerance: number
  /** line-art mode: pixels darker than this (0..255 luminance) become ink */
  threshold: number
  pathomit: number
}

export const IMG_DEFAULTS: ImgToSvgOptions = { mode: 'color', colors: 16, maxSide: 900, removeBg: true, bgTolerance: 40, threshold: 140, pathomit: 8 }

export const IMG_DETAILS = {
  low: { label: 'Rendah (8 warna, file kecil)', colors: 8, maxSide: 600, pathomit: 12 },
  medium: { label: 'Sedang (16 warna)', colors: 16, maxSide: 900, pathomit: 8 },
  high: { label: 'Tinggi (32 warna)', colors: 32, maxSide: 1200, pathomit: 4 },
  ultra: { label: 'Sangat tinggi (64 warna, lambat, file besar)', colors: 64, maxSide: 1600, pathomit: 2 },
} as const
export type ImgDetail = keyof typeof IMG_DETAILS

/** Size that fits `maxSide` (never enlarged). */
export function fitSize(w: number, h: number, maxSide: number): { w: number; h: number; k: number } {
  const k = Math.min(1, maxSide / Math.max(w, h))
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)), k }
}

/** Black ink on transparent: opaque pixels darker than `threshold` (luminance) become black, everything else transparent. Mutates `data`. Returns the ink pixel count. */
export function binarizeLineArt(data: Uint8ClampedArray, threshold: number): number {
  let ink = 0
  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    if (data[i + 3] >= 128 && lum < threshold) { data[i] = data[i + 1] = data[i + 2] = 0; data[i + 3] = 255; ink++ }
    else data[i] = data[i + 1] = data[i + 2] = data[i + 3] = 0
  }
  return ink
}

/** Progressively smaller settings, tried in order until the SVG fits a size limit (library: 300 KB). */
export function shrinkSteps(mode: ImgMode): Pick<ImgToSvgOptions, 'colors' | 'maxSide' | 'pathomit'>[] {
  return mode === 'lineart'
    ? [{ colors: 2, maxSide: 700, pathomit: 8 }, { colors: 2, maxSide: 500, pathomit: 16 }, { colors: 2, maxSide: 380, pathomit: 30 }, { colors: 2, maxSide: 300, pathomit: 50 }]
    : [{ colors: 8, maxSide: 600, pathomit: 12 }, { colors: 8, maxSide: 450, pathomit: 20 }, { colors: 6, maxSide: 350, pathomit: 30 }, { colors: 4, maxSide: 300, pathomit: 45 }]
}

export interface ImgToSvgResult { svg: string; width: number; height: number; paths: number; bytes: number }

/** Trace a loaded image. The SVG has `viewBox="0 0 w h"` (as the library requires) and only path elements. */
export async function imageToSvg(img: { width: number; height: number } & CanvasImageSource, o: ImgToSvgOptions): Promise<ImgToSvgResult> {
  const size = fitSize(img.width, img.height, o.maxSide)
  const cv = document.createElement('canvas')
  cv.width = size.w
  cv.height = size.h
  const ctx = cv.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0, size.w, size.h)
  const px = ctx.getImageData(0, 0, size.w, size.h)

  if (o.removeBg) {
    const pix = { w: size.w, h: size.h, data: px.data }
    for (const [x, y] of [[0, 0], [size.w - 1, 0], [0, size.h - 1], [size.w - 1, size.h - 1]]) floodErase(pix, x, y, o.bgTolerance, true, 1)
  }
  if (o.mode === 'lineart') binarizeLineArt(px.data, o.threshold)
  ctx.putImageData(px, 0, 0)

  const t = await traceRaw(cv, o.mode === 'lineart' ? { colors: 2, pathomit: Math.max(2, o.pathomit), strokeWidth: 0 } : { colors: o.colors, pathomit: o.pathomit, strokeWidth: 1 })
  const svg = svgDocument(t.inner, size.w, size.h)
  return { svg, width: size.w, height: size.h, paths: t.paths, bytes: new Blob([svg]).size }
}

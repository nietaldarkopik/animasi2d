import type { Geometry, Layer } from './types'

/**
 * Patch that swaps a layer's image for a processed version while keeping the visible artwork where it was
 * (crop/trim move the image centre; resize/auto-downscale change pixel density).
 * Only possible without keyframes on the affected props and with a centred pivot; otherwise only the asset
 * is swapped and `compensated` is false so the UI can say so.
 */
export function replaceImagePatch(layer: Layer, assetId: number, geo: Geometry, w: number, h: number): { patch: Partial<Layer>; compensated: boolean } {
  const animated = (['x', 'y', 'scaleX', 'scaleY', 'rotation'] as const).some((p) => layer.keyframes?.[p]?.length)
  if (animated || layer.pivotX || layer.pivotY) return { patch: { assetId }, compensated: false }

  const s = geo.pixel_scale
  const [W0, H0] = geo.input_size
  const shiftX = geo.origin[0] + w / (2 * s) - W0 / 2 // image-centre displacement, in input pixels
  const shiftY = geo.origin[1] + h / (2 * s) - H0 / 2
  const ox = shiftX * layer.scaleX
  const oy = shiftY * layer.scaleY
  const r = (layer.rotation * Math.PI) / 180
  const round = (n: number) => Math.round(n * 1000) / 1000
  return {
    compensated: true,
    patch: {
      assetId,
      x: round(layer.x + ox * Math.cos(r) - oy * Math.sin(r)),
      y: round(layer.y + ox * Math.sin(r) + oy * Math.cos(r)),
      scaleX: round(layer.scaleX / s),
      scaleY: round(layer.scaleY / s),
    },
  }
}

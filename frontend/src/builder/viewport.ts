/** Work-area geometry of the builder preview: a stage larger than the export frame, shown through a zoomable/pannable viewport. */
export interface Rect { x: number; y: number; w: number; h: number }

/** Free room around the export frame so parts moved outside it stay visible (the frame still decides what is exported). */
export const STAGE_MARGIN = { x: 300, y: 220 }

export const stageOf = (view: Rect): Rect => ({ x: view.x - STAGE_MARGIN.x, y: view.y - STAGE_MARGIN.y, w: view.w + 2 * STAGE_MARGIN.x, h: view.h + 2 * STAGE_MARGIN.y })

export const ZOOM_MIN = 0.2
export const ZOOM_MAX = 6

/**
 * Viewport: `zoom` screen pixels per canvas unit, and (ox, oy) = screen position (inside the container) of the stage's
 * top-left corner. So unit u maps to ox + (u.x - stage.x) * zoom.
 */
export interface Viewport { zoom: number; ox: number; oy: number }

export const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z))

/** Zoom that shows `rect` completely inside a container of size (cw, ch) with some breathing room. */
export function fitZoom(cw: number, ch: number, rect: Rect, room = 0.9): number {
  return clampZoom(Math.min((cw * room) / rect.w, (ch * room) / rect.h))
}

/** Viewport that centres `rect` (a part of the stage) in the container at the given zoom. */
export function centerOn(cw: number, ch: number, stage: Rect, rect: Rect, zoom: number): Viewport {
  return { zoom, ox: cw / 2 - (rect.x + rect.w / 2 - stage.x) * zoom, oy: ch / 2 - (rect.y + rect.h / 2 - stage.y) * zoom }
}

export function fitViewport(cw: number, ch: number, stage: Rect, view: Rect): Viewport {
  return centerOn(cw, ch, stage, view, fitZoom(cw, ch, view))
}

/** Multiplies the zoom by `factor` keeping the point under the cursor (container px) where it is. */
export function zoomAt(vp: Viewport, factor: number, cx: number, cy: number): Viewport {
  const zoom = clampZoom(vp.zoom * factor)
  const k = zoom / vp.zoom
  return { zoom, ox: cx - (cx - vp.ox) * k, oy: cy - (cy - vp.oy) * k }
}

export const panBy = (vp: Viewport, dx: number, dy: number): Viewport => ({ ...vp, ox: vp.ox + dx, oy: vp.oy + dy })

/** Container px -> canvas units, and back. */
export const toUnits = (vp: Viewport, stage: Rect, sx: number, sy: number) => ({ x: stage.x + (sx - vp.ox) / vp.zoom, y: stage.y + (sy - vp.oy) / vp.zoom })
export const toScreen = (vp: Viewport, stage: Rect, ux: number, uy: number) => ({ x: vp.ox + (ux - stage.x) * vp.zoom, y: vp.oy + (uy - stage.y) * vp.zoom })

/** Keep at least `keep` px of the stage inside the container so it cannot be panned out of reach. */
export function clampPan(vp: Viewport, cw: number, ch: number, stage: Rect, keep = 120): Viewport {
  const w = stage.w * vp.zoom, h = stage.h * vp.zoom
  return { ...vp, ox: Math.min(cw - keep, Math.max(keep - w, vp.ox)), oy: Math.min(ch - keep, Math.max(keep - h, vp.oy)) }
}

/** Resolution to render the stage at for a given zoom (device pixels per unit), bounded to keep canvases reasonable. */
export const renderScale = (zoom: number, dpr = 1) => Math.min(3, Math.max(0.6, zoom * dpr))

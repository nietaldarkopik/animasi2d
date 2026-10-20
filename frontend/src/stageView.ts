/** Zoom and pan of the editor canvas. `pan` = how far the scene's centre is from the centre of the work area (screen px). */
export interface StageView { zoom: number; pan: { x: number; y: number } }

export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 8

export const clampZoom = (z: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z))

/**
 * Zoom by `factor` keeping the scene point under the cursor where it is. `c` = cursor offset from the centre of the work area.
 * (the point under the cursor is at offset c - pan from the scene centre; it scales with the zoom, so pan moves to compensate)
 */
export function zoomAt(v: StageView, factor: number, c: { x: number; y: number } = { x: 0, y: 0 }): StageView {
  const zoom = clampZoom(v.zoom * factor)
  const k = zoom / v.zoom
  return { zoom, pan: { x: c.x - (c.x - v.pan.x) * k, y: c.y - (c.y - v.pan.y) * k } }
}

/** Wheel notch -> zoom factor (smooth for trackpads, bounded for big mouse notches). */
export const wheelFactor = (deltaY: number) => Math.exp(-Math.max(-300, Math.min(300, deltaY)) * 0.0015)

/** Zoom that fits the whole scene into the work area (never above 100%). */
export function fitZoom(box: { w: number; h: number }, scene: { w: number; h: number }, pad = 32): number {
  return Math.max(0.05, Math.min((box.w - pad) / scene.w, (box.h - pad) / scene.h, 1))
}

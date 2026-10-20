import { evalCamera, setCamKey } from './anim'
import type { Ease, SceneCamera } from './types'

/** Ready-made camera moves. They write ordinary camera keys (editable like any other key). Frames are scene frames. */

export const camZoom = (cam: SceneCamera, f0: number, f1: number, from: number, to: number, e: Ease = 'easeInOut') => {
  setCamKey(cam, 'zoom', f0, from, e)
  setCamKey(cam, 'zoom', f1, to, e)
}

export const camPan = (cam: SceneCamera, f0: number, f1: number, from: { x: number; y: number }, to: { x: number; y: number }, e: Ease = 'easeInOut') => {
  setCamKey(cam, 'x', f0, from.x, e); setCamKey(cam, 'x', f1, to.x, e)
  setCamKey(cam, 'y', f0, from.y, e); setCamKey(cam, 'y', f1, to.y, e)
}

/** Fly from the current view at `f` to look at (x, y) at `zoom`, arriving `frames` later. */
export function camFocus(cam: SceneCamera, f: number, frames: number, x: number, y: number, zoom: number, w: number, h: number) {
  const now = evalCamera(cam, f, w, h)
  for (const [p, v] of [['x', now.x], ['y', now.y], ['zoom', now.zoom]] as const) setCamKey(cam, p, f, v, 'easeInOut')
  setCamKey(cam, 'x', f + frames, x, 'easeInOut')
  setCamKey(cam, 'y', f + frames, y, 'easeInOut')
  setCamKey(cam, 'zoom', f + frames, zoom, 'easeInOut')
}

const rnd = (n: number) => { const x = Math.sin(n * 91.7 + 17.3) * 43758.5453; return x - Math.floor(x) }

/** Handheld shake: small jumps every other frame that fade out, then back to the resting position. */
export function camShake(cam: SceneCamera, f0: number, frames: number, amp: number, rest: { x: number; y: number }) {
  const step = 2
  for (let i = 0; i <= frames; i += step) {
    const decay = 1 - i / frames
    const dx = (rnd(i * 2 + 1) * 2 - 1) * amp * decay
    const dy = (rnd(i * 2 + 2) * 2 - 1) * amp * decay
    setCamKey(cam, 'x', f0 + i, rest.x + dx, 'linear')
    setCamKey(cam, 'y', f0 + i, rest.y + dy, 'linear')
  }
  setCamKey(cam, 'x', f0 + frames + step, rest.x, 'linear')
  setCamKey(cam, 'y', f0 + frames + step, rest.y, 'linear')
}

/** Camera key frames that exist (sorted, unique) for the key list in the UI. */
export function camKeyFrames(cam: SceneCamera | undefined): number[] {
  const set = new Set<number>()
  for (const list of Object.values(cam ?? {})) for (const k of list ?? []) set.add(k.f)
  return [...set].sort((a, b) => a - b)
}

import type { Keyframe, Layer } from './types'

/**
 * Lip sync from the LOUDNESS of the audio (not from phonemes): the mouth opens more when the voice is louder and closes in
 * pauses. It needs no AI model and works for any language; it cannot tell "a" from "o".
 */

/** RMS loudness of each video frame between `from` and `to` seconds of the sound (mono samples). */
export function envelope(samples: Float32Array, sampleRate: number, fps: number, from: number, to: number): number[] {
  const out: number[] = []
  const frames = Math.max(0, Math.ceil((to - from) * fps))
  for (let f = 0; f < frames; f++) {
    const a = Math.floor((from + f / fps) * sampleRate)
    const b = Math.min(samples.length, Math.floor((from + (f + 1) / fps) * sampleRate))
    let sum = 0
    let n = 0
    for (let i = Math.max(0, a); i < b; i++) { sum += samples[i] * samples[i]; n++ }
    out.push(n ? Math.sqrt(sum / n) : 0)
  }
  return out
}

export interface LipOptions {
  /** scaleY of the mouth when closed / at its widest, relative to its normal scale */
  closed: number
  open: number
  /** loudness below this fraction of the loud level counts as silence */
  threshold: number
}
export const LIP_DEFAULTS: LipOptions = { closed: 0.18, open: 1, threshold: 0.12 }

/** The mouth openings (0 = closed .. 1 = fully open) per frame: normalised, smoothed, quantised to 4 steps, no one-frame flicker. */
export function openings(env: number[], threshold = LIP_DEFAULTS.threshold): number[] {
  if (env.length === 0) return []
  const sorted = [...env].sort((a, b) => a - b)
  const loud = sorted[Math.floor(sorted.length * 0.92)] || sorted[sorted.length - 1]
  if (loud < 1e-4) return env.map(() => 0)
  // fast attack, slower release: the mouth snaps open and relaxes
  let s = 0
  const smooth = env.map((v) => {
    const x = Math.min(1.2, v / loud)
    s = x > s ? s + (x - s) * 0.8 : s + (x - s) * 0.45
    return s
  })
  const levels = [0, 0.4, 0.75, 1]
  const q = smooth.map((x) => (x < threshold ? 0 : x < 0.4 ? 1 : x < 0.7 ? 2 : 3))
  // a single-frame blip (up or down) is held to its neighbour
  for (let i = 1; i < q.length - 1; i++) if (q[i] !== q[i - 1] && q[i] !== q[i + 1] && q[i - 1] === q[i + 1]) q[i] = q[i - 1]
  return q.map((l) => levels[l])
}

/** Step keys (hold until the next change) for scaleY, one key per change of opening. `f0` = first frame. */
export function mouthKeys(open: number[], f0: number, base: number, o: LipOptions = LIP_DEFAULTS): Keyframe[] {
  const keys: Keyframe[] = []
  let last = NaN
  open.forEach((x, i) => {
    const v = Math.round(base * (o.closed + (o.open - o.closed) * x) * 1000) / 1000
    if (v !== last) { keys.push({ f: f0 + i, v, e: 'step' }); last = v }
  })
  if (open.length) keys.push({ f: f0 + open.length, v: base, e: 'linear' }) // back to the normal mouth after the speech
  return keys
}

/** Replace the scaleY keys of the mouth inside [f0, f0+len] by the lip-sync keys (mutates the layer). Returns the number of keys. */
export function applyLipSync(mouth: Layer, keys: Keyframe[]): number {
  if (keys.length === 0) return 0
  const lo = keys[0].f
  const hi = keys[keys.length - 1].f
  const kept = (mouth.keyframes?.scaleY ?? []).filter((k) => k.f < lo || k.f > hi)
  mouth.keyframes ??= {}
  const merged = [...kept, ...keys].sort((a, b) => a.f - b.f)
  mouth.keyframes.scaleY = merged.filter((k, i) => i === 0 || k.f > merged[i - 1].f)
  return keys.length
}

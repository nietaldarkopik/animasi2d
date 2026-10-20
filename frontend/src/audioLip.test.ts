import { describe, expect, it } from 'vitest'
import { evalLayer } from './anim'
import { encodeWav, mixToMono, SAMPLE_RATE, SFX, synthSfx } from './audioTools'
import { fadeGain } from './audio'
import { applyLipSync, envelope, mouthKeys, openings } from './lipsync'
import type { Layer } from './types'

const SR = 8000
/** speech-like signal: silence 0-0.5 s, loud 0.5-1.0, quiet 1.0-1.5, silence, loud 2.0-2.5 */
function voice(): Float32Array {
  const s = new Float32Array(SR * 3)
  const burst = (a: number, b: number, amp: number) => { for (let i = Math.floor(a * SR); i < Math.floor(b * SR); i++) s[i] = Math.sin(i * 0.3) * amp }
  burst(0.5, 1.0, 0.8); burst(1.0, 1.5, 0.2); burst(2.0, 2.5, 0.8)
  return s
}

describe('lip sync from loudness', () => {
  const fps = 24
  const env = envelope(voice(), SR, fps, 0, 3)
  const open = openings(env)

  it('has one loudness value per frame and follows the signal', () => {
    expect(env).toHaveLength(72)
    expect(env[6]).toBeLessThan(0.001) // 0.25 s: silence
    expect(env[18]).toBeGreaterThan(0.4) // 0.75 s: loud
    expect(env[30]).toBeGreaterThan(0.05)
    expect(env[30]).toBeLessThan(env[18]) // quieter than the loud part
  })

  it('opens wide for loud speech, partly for quiet speech, and closes in pauses', () => {
    expect(open[6]).toBe(0)
    expect(open[18]).toBeGreaterThanOrEqual(0.75)
    expect(open[30]).toBeGreaterThan(0)
    expect(open[30]).toBeLessThan(open[18])
    expect(open[42]).toBe(0) // 1.75 s: pause
    expect(open[54]).toBeGreaterThanOrEqual(0.75)
    expect(open).toHaveLength(env.length)
  })

  it('has no one-frame flicker', () => {
    for (let i = 1; i < open.length - 1; i++) {
      const blip = open[i] !== open[i - 1] && open[i] !== open[i + 1] && open[i - 1] === open[i + 1]
      expect(blip, `frame ${i}`).toBe(false)
    }
  })

  it('silence gives a closed mouth everywhere, and nothing at all gives no keys', () => {
    expect(openings(new Array(20).fill(0)).every((x) => x === 0)).toBe(true)
    expect(openings([])).toEqual([])
    expect(mouthKeys([], 0, 1)).toEqual([])
  })

  it('produces step keys relative to the mouth normal scale, ending back at it', () => {
    const keys = mouthKeys(open, 100, 0.5)
    expect(keys[0].f).toBe(100)
    expect(keys.slice(0, -1).every((k) => k.e === 'step')).toBe(true)
    expect(Math.min(...keys.map((k) => k.v))).toBeCloseTo(0.5 * 0.18, 3) // closed
    expect(Math.max(...keys.map((k) => k.v))).toBeCloseTo(0.5, 3) // fully open = normal size
    expect(keys.at(-1)).toEqual({ f: 100 + open.length, v: 0.5, e: 'linear' })
    expect(new Set(keys.map((k) => k.f)).size).toBe(keys.length) // one key per frame
    // far fewer keys than frames: only changes are keyed
    expect(keys.length).toBeLessThan(open.length / 2)
  })

  it('applies onto a mouth layer, replacing only its own range and holding the shapes', () => {
    const mouth = { id: 'm', type: 'image', name: 'm', x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, visible: true, locked: false, keyframes: { scaleY: [{ f: 0, v: 1, e: 'linear' }, { f: 500, v: 2, e: 'linear' }] } } as Layer
    const keys = mouthKeys(open, 100, 1)
    expect(applyLipSync(mouth, keys)).toBe(keys.length)
    const ks = mouth.keyframes!.scaleY!
    expect(ks[0]).toEqual({ f: 0, v: 1, e: 'linear' }) // kept: outside the range
    expect(ks.at(-1)).toEqual({ f: 500, v: 2, e: 'linear' })
    expect(ks.map((k) => k.f)).toEqual([...ks.map((k) => k.f)].sort((a, b) => a - b))
    expect(evalLayer(mouth, 100 + 6).scaleY).toBeCloseTo(0.18, 3) // silence at the start: closed
    expect(evalLayer(mouth, 100 + 18).scaleY).toBeGreaterThan(0.7) // loud: open
    expect(applyLipSync(mouth, [])).toBe(0)
  })

  it('analyses only the part of the sound that lies inside the scene', () => {
    const part = envelope(voice(), SR, fps, 2.0, 2.5) // the last burst only
    expect(part).toHaveLength(12)
    expect(Math.min(...part)).toBeGreaterThan(0.3)
  })
})

describe('audio tools', () => {
  it('encodeWav writes a valid 16-bit PCM header and clips out-of-range samples', async () => {
    const wav = encodeWav([new Float32Array([0, 0.5, -0.5, 2, -2])], 22050)
    const b = new DataView(await wav.arrayBuffer())
    expect(wav.type).toBe('audio/wav')
    const tag = (o: number) => String.fromCharCode(b.getUint8(o), b.getUint8(o + 1), b.getUint8(o + 2), b.getUint8(o + 3))
    expect([tag(0), tag(8), tag(12), tag(36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data'])
    expect(b.getUint16(20, true)).toBe(1)
    expect(b.getUint32(24, true)).toBe(22050)
    expect(b.getUint32(40, true)).toBe(10)
    expect(b.byteLength).toBe(44 + 10)
    expect(b.getInt16(44 + 6, true)).toBe(32767) // 2 -> clipped to max
    expect(b.getInt16(44 + 8, true)).toBe(-32768)
    const st = encodeWav([new Float32Array(4), new Float32Array(4)], 8000)
    expect(new DataView(await st.arrayBuffer()).getUint16(22, true)).toBe(2)
  })

  it('mixes channels to mono', () => {
    expect(Array.from(mixToMono([new Float32Array([1, 0]), new Float32Array([0, 1])]))).toEqual([0.5, 0.5])
  })

  it('every sound effect is audible, within range, of its declared length and deterministic', () => {
    for (const d of SFX) {
      const a = synthSfx(d.id)
      expect(a.length, d.id).toBe(Math.floor(d.seconds * SAMPLE_RATE))
      const peak = Math.max(...a.map(Math.abs))
      expect(peak, d.id).toBeGreaterThan(0.1)
      expect(peak, d.id).toBeLessThanOrEqual(0.951)
      expect(a.some((x) => Number.isNaN(x)), d.id).toBe(false)
      expect(Array.from(synthSfx(d.id).slice(0, 200)), d.id).toEqual(Array.from(a.slice(0, 200)))
    }
    expect(() => synthSfx('nope')).toThrow()
  })

  it('fade gain ramps in at the start and out at the end of a clip', () => {
    const c = { fadeIn: 1, fadeOut: 2 }
    expect(fadeGain(c, 10, 0)).toBe(0)
    expect(fadeGain(c, 10, 0.5)).toBeCloseTo(0.5, 6)
    expect(fadeGain(c, 10, 5)).toBe(1)
    expect(fadeGain(c, 10, 9)).toBeCloseTo(0.5, 6)
    expect(fadeGain(c, 10, 10)).toBe(0)
    expect(fadeGain({}, 10, 0)).toBe(1) // no fades: always full
  })
})

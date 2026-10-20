/** Audio helpers that run in the browser: WAV encoding, synthesised sound effects, microphone recording. */

export const SAMPLE_RATE = 44100

/** 16-bit PCM WAV (mono or stereo) from float samples in -1..1. */
export function encodeWav(channels: Float32Array[], sampleRate: number): Blob {
  const n = channels[0]?.length ?? 0
  const ch = channels.length
  const buf = new ArrayBuffer(44 + n * ch * 2)
  const v = new DataView(buf)
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  str(0, 'RIFF'); v.setUint32(4, 36 + n * ch * 2, true); str(8, 'WAVE'); str(12, 'fmt ')
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true)
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true)
  str(36, 'data'); v.setUint32(40, n * ch * 2, true)
  let o = 44
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const x = Math.max(-1, Math.min(1, channels[c][i])); v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true); o += 2 }
  return new Blob([buf], { type: 'audio/wav' })
}

/** Average of all channels. */
export function mixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0]
  const out = new Float32Array(channels[0].length)
  for (const c of channels) for (let i = 0; i < out.length; i++) out[i] += c[i] / channels.length
  return out
}

// ---- synthesised sound effects (deterministic, no files) ----------------------------------

export interface SfxDef { id: string; label: string; seconds: number }

export const SFX: SfxDef[] = [
  { id: 'ding', label: 'Ding (notifikasi)', seconds: 0.9 },
  { id: 'pop', label: 'Pop', seconds: 0.25 },
  { id: 'klik', label: 'Klik', seconds: 0.12 },
  { id: 'ketuk', label: 'Ketuk pintu', seconds: 0.9 },
  { id: 'langkah', label: 'Langkah kaki', seconds: 0.9 },
  { id: 'whoosh', label: 'Whoosh (lewat cepat)', seconds: 0.7 },
  { id: 'bel', label: 'Bel sekolah', seconds: 2.2 },
  { id: 'tada', label: 'Tada (berhasil)', seconds: 1.2 },
  { id: 'sedih', label: 'Nada sedih', seconds: 1.4 },
  { id: 'bruk', label: 'Bruk (jatuh/benturan)', seconds: 0.6 },
]

const TAU = Math.PI * 2
/** deterministic noise in -1..1 */
const noise = (n: number) => { const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return (x - Math.floor(x)) * 2 - 1 }

/** One tone with an exponential decay, added into `out` from `t0` seconds. */
function tone(out: Float32Array, sr: number, t0: number, freq: number, dur: number, gain: number, decay: number, harmonics: number[] = [1]) {
  const start = Math.floor(t0 * sr)
  const n = Math.min(out.length - start, Math.floor(dur * sr))
  for (let i = 0; i < n; i++) {
    const t = i / sr
    const env = Math.exp(-t * decay) * Math.min(1, t * 400) // 2.5 ms attack: no click
    let s = 0
    harmonics.forEach((h, k) => { s += Math.sin(TAU * freq * (k + 1) * t) * h })
    out[start + i] += s * env * gain
  }
}

export function synthSfx(id: string, sr = SAMPLE_RATE): Float32Array {
  const def = SFX.find((x) => x.id === id)
  if (!def) throw new Error(`Efek suara tidak dikenal: ${id}`)
  const out = new Float32Array(Math.floor(def.seconds * sr))
  switch (id) {
    case 'ding': tone(out, sr, 0, 1320, 0.9, 0.5, 5, [1, 0.3]); tone(out, sr, 0.12, 1760, 0.75, 0.3, 6); break
    case 'pop': for (let i = 0; i < out.length; i++) { const t = i / sr; out[i] = Math.sin(TAU * (700 - t * 1800) * t) * Math.exp(-t * 30) * 0.7 } break
    case 'klik': for (let i = 0; i < out.length; i++) { const t = i / sr; out[i] = noise(i) * Math.exp(-t * 70) * 0.5 + Math.sin(TAU * 1800 * t) * Math.exp(-t * 90) * 0.3 } break
    case 'ketuk': for (const t0 of [0.02, 0.28, 0.5]) tone(out, sr, t0, 180, 0.2, 0.9, 22, [1, 0.5, 0.2]); break
    case 'langkah': for (const t0 of [0.02, 0.47]) for (let i = 0; i < Math.floor(0.18 * sr); i++) { const t = i / sr; const k = Math.floor(t0 * sr) + i; if (k < out.length) out[k] += (noise(i + t0 * 1000) * 0.5 + Math.sin(TAU * 90 * t) * 0.6) * Math.exp(-t * 28) * 0.8 } break
    case 'whoosh': { let lp = 0; for (let i = 0; i < out.length; i++) { const t = i / sr; const env = Math.sin(Math.PI * Math.min(1, t / 0.7)) ** 2; lp += (noise(i) - lp) * (0.05 + 0.35 * env); out[i] = lp * env * 1.6 } break }
    case 'bel': for (let b = 0; b < 4; b++) { tone(out, sr, b * 0.5, 880, 1.6, 0.35, 2.2, [1, 0.5, 0.25]); tone(out, sr, b * 0.5, 1175, 1.4, 0.2, 2.6) } break
    case 'tada': [523.25, 659.25, 783.99, 1046.5].forEach((f, k) => tone(out, sr, k * 0.11, f, 0.9 - k * 0.1, 0.3, 3.5, [1, 0.3])); break
    case 'sedih': [392, 349.23, 311.13, 261.63].forEach((f, k) => tone(out, sr, k * 0.3, f, 0.5, 0.35, 3.2, [1, 0.2])); break
    case 'bruk': for (let i = 0; i < out.length; i++) { const t = i / sr; out[i] = (Math.sin(TAU * (110 - t * 70) * t) * 0.9 + noise(i) * 0.25) * Math.exp(-t * 9) } break
  }
  // keep within range
  let peak = 0
  for (const x of out) peak = Math.max(peak, Math.abs(x))
  if (peak > 0.95) for (let i = 0; i < out.length; i++) out[i] *= 0.95 / peak
  return out
}

export const sfxBlob = (id: string) => encodeWav([synthSfx(id)], SAMPLE_RATE)

// ---- microphone recording --------------------------------------------------------------------

export interface MicRecording { stop: () => Promise<Blob> }

/** Starts recording the microphone. `stop()` resolves with a WAV (the server accepts WAV, not the browser's WebM/Opus). */
export async function startMic(): Promise<MicRecording> {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('Browser ini tidak mendukung perekaman suara.')
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => { throw new Error('Mikrofon tidak bisa dipakai (izin ditolak atau tidak ada mikrofon).') })
  const rec = new MediaRecorder(stream)
  const chunks: Blob[] = []
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  const done = new Promise<void>((res) => { rec.onstop = () => res() })
  rec.start(200)
  return {
    stop: async () => {
      rec.stop()
      await done
      stream.getTracks().forEach((t) => t.stop())
      const raw = await new Blob(chunks, { type: rec.mimeType }).arrayBuffer()
      const ctx = new AudioContext()
      try {
        const buf = await ctx.decodeAudioData(raw)
        return encodeWav(Array.from({ length: Math.min(2, buf.numberOfChannels) }, (_, i) => buf.getChannelData(i)), buf.sampleRate)
      } finally {
        void ctx.close()
      }
    },
  }
}

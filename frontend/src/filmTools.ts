import { evalCamera } from './anim'
import type { EffectKind, Layer, Scene, SceneBoard, SceneDocument, SceneEffect, Subtitle } from './types'

/** Pure builders for the film tools (effects, balloons, titles, subtitles, props, storyboard). */

export interface TimePreset { id: string; label: string; effect: Omit<SceneEffect, 'id'> | null }

/** Time of day = one colour tint over the whole scene. "siang" removes the tint. */
export const TIME_PRESETS: TimePreset[] = [
  { id: 'pagi', label: 'Pagi', effect: { kind: 'tint', intensity: 0.22, color: '#ffe3a8', blend: 'normal', label: 'Pagi' } },
  { id: 'siang', label: 'Siang (normal)', effect: null },
  { id: 'sore', label: 'Sore', effect: { kind: 'tint', intensity: 0.55, color: '#ff9a52', blend: 'multiply', label: 'Sore' } },
  { id: 'malam', label: 'Malam', effect: { kind: 'tint', intensity: 0.8, color: '#27377a', blend: 'multiply', label: 'Malam' } },
]

export const EFFECT_LABEL: Record<EffectKind, string> = { rain: 'Hujan', snow: 'Salju', tint: 'Warna waktu', vignette: 'Vignette (tepi gelap)' }

/** Set the time of day: replaces any tint, leaves the other effects. */
export function setTimeOfDay(effects: SceneEffect[] | undefined, presetId: string, newId: () => string): SceneEffect[] {
  const rest = (effects ?? []).filter((e) => e.kind !== 'tint')
  const p = TIME_PRESETS.find((x) => x.id === presetId)
  return p?.effect ? [{ ...p.effect, id: newId() }, ...rest] : rest
}

/** Add one effect of a kind (one of each kind at most; adding again replaces it). */
export function addEffect(effects: SceneEffect[] | undefined, kind: EffectKind, intensity: number, newId: () => string): SceneEffect[] {
  return [...(effects ?? []).filter((e) => e.kind !== kind), { id: newId(), kind, intensity, ...(kind === 'vignette' ? { color: '#000000' } : {}) }]
}

export const timeOfDay = (effects: SceneEffect[] | undefined) => (effects ?? []).find((e) => e.kind === 'tint')?.label ?? 'Siang (normal)'

// ---- balloons / titles ----------------------------------------------------------------

const baseLayer = (over: Partial<Layer> & Pick<Layer, 'id' | 'type' | 'name'>, x: number, y: number): Layer => ({ x, y, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, visible: true, locked: false, ...over })

/** Size of a balloon that fits `text` (rough: 0.55 em per character). */
export function balloonSize(text: string, fontSize: number): { width: number; height: number } {
  const lines = Math.max(1, Math.ceil((text.length * fontSize * 0.55) / 360))
  return { width: Math.max(180, Math.min(420, Math.ceil(text.length * fontSize * 0.55) + 70)), height: Math.max(90, lines * fontSize * 1.3 + 50) }
}

export function makeBalloon(id: string, text: string, kind: 'speech' | 'thought' | 'shout', at: { x: number; y: number }, tailTo: { x: number; y: number } | null): Layer {
  const fontSize = 32
  const { width, height } = balloonSize(text, fontSize)
  // tail target relative to the balloon centre; default: pointing down-left
  const tx = tailTo ? tailTo.x - at.x : -width * 0.25
  const ty = tailTo ? tailTo.y - at.y : height * 0.9
  return baseLayer({ id, type: 'balloon', name: `Balon: ${text.slice(0, 18)}`, text, fontSize, fill: '#111111', width, height, bubble: kind, bubbleFill: '#ffffff', tailX: Math.round(tx), tailY: Math.round(ty) }, at.x, at.y)
}

/** A big centred title that fades in and out. */
export function makeTitle(id: string, text: string, w: number, h: number, fps: number, duration: number): Layer {
  const fade = Math.max(2, Math.round(fps * 0.5))
  const last = Math.max(fade * 2 + 1, Math.round(duration * fps))
  return baseLayer({
    id, type: 'text', name: `Judul: ${text.slice(0, 18)}`, text, fontSize: Math.round(h * 0.13), fill: '#ffffff',
    keyframes: { opacity: [{ f: 0, v: 0, e: 'easeOut' }, { f: fade, v: 1, e: 'linear' }, { f: last - fade, v: 1, e: 'easeIn' }, { f: last, v: 0, e: 'linear' }] },
  }, w / 2, h / 2)
}

/** Ellipse shadow on the ground under a character: dark, translucent, behind everything of the character. */
export function makeShadow(id: string, feet: { x: number; y: number }, width: number): Layer {
  return baseLayer({ id, type: 'shape', shape: 'ellipse', name: 'Bayangan', width: Math.round(width), height: Math.round(width * 0.22), fill: '#000000', opacity: 0.28, locked: false }, feet.x, feet.y)
}

// ---- subtitles --------------------------------------------------------------------------

export const SUBTITLE_SECONDS_PER_CHAR = 0.07
export const subtitleSeconds = (text: string) => Math.max(1.2, Math.round((0.6 + text.length * SUBTITLE_SECONDS_PER_CHAR) * 10) / 10)

/** Subtitles for dialogue lines, one after another from `from` seconds, clamped to the scene length. */
export function subtitlesFromDialog(lines: { text: string; who?: string }[], from: number, sceneSeconds: number, newId: () => string, withName = true): Subtitle[] {
  const out: Subtitle[] = []
  let t = from
  for (const l of lines) {
    const d = subtitleSeconds(l.text)
    if (t >= sceneSeconds) break
    out.push({ id: newId(), start: Math.round(t * 100) / 100, end: Math.round(Math.min(sceneSeconds, t + d) * 100) / 100, text: (withName && l.who ? `${l.who}: ` : '') + l.text })
    t += d + 0.2
  }
  return out
}

// ---- props ----------------------------------------------------------------------------

/** Where to put a new prop: the middle of what the camera looks at, size = ~25% of the scene height. */
export function propPlacement(doc: SceneDocument, frame: number, imgW: number, imgH: number) {
  const { width, height } = doc.settings
  const cam = evalCamera(doc.camera, frame, width, height)
  const k = Math.min(1, (height * 0.25) / Math.max(imgW, imgH))
  return { x: cam.x, y: cam.y, scale: k }
}

// ---- storyboard script -------------------------------------------------------------------------

export interface ScriptScene { name: string; location: string; summary: string; dialog: { who: string; text: string }[]; characters: string[] }

/**
 * Parses a plain-text script:
 *
 *   # Judul scene | lokasi: Kelas
 *   (Uki masuk kelas sambil tersenyum)        <- action / summary line
 *   Uki: Selamat pagi!
 *   Sekar: Pagi, Uki.
 *
 * A "#" line starts a scene; "(…)" lines are the summary; "Nama: kalimat" is dialogue. Anything else is added to the summary.
 */
export function parseScript(text: string): ScriptScene[] {
  const scenes: ScriptScene[] = []
  let cur: ScriptScene | undefined
  const start = (name: string, location: string) => { cur = { name: name.slice(0, 80) || `Scene ${scenes.length + 1}`, location: location.slice(0, 120), summary: '', dialog: [], characters: [] }; scenes.push(cur) }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('#')) {
      const [name, ...rest] = line.replace(/^#+\s*/, '').split('|')
      const loc = rest.join('|').match(/lokasi\s*:\s*(.+)/i)
      start(name.trim(), loc ? loc[1].trim() : '')
      continue
    }
    if (!cur) start(`Scene ${scenes.length + 1}`, '')
    const c = cur!
    const action = line.match(/^\((.*)\)$/)
    const dlg = line.match(/^([^:()]{1,30}):\s*(.+)$/)
    if (action) c.summary += (c.summary ? ' ' : '') + action[1].trim()
    else if (dlg) {
      const who = dlg[1].trim()
      c.dialog.push({ who, text: dlg[2].trim().slice(0, 500) })
      if (!c.characters.includes(who)) c.characters.push(who)
    } else c.summary += (c.summary ? ' ' : '') + line
  }
  return scenes.map((s) => ({ ...s, summary: s.summary.slice(0, 2000) }))
}

/** Scene length from its dialogue (reading time) with a floor, rounded to half seconds. */
export function sceneSecondsFor(s: Pick<ScriptScene, 'dialog'>): number {
  const t = s.dialog.reduce((a, d) => a + subtitleSeconds(d.text) + 0.2, 1)
  return Math.min(600, Math.max(3, Math.ceil(t * 2) / 2))
}

/** Best background for a location text: the asset whose name/tags share the most words with it. */
export function pickBackground<T extends { name: string; tags: string[] }>(location: string, bgs: T[]): T | null {
  const words = location.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2)
  if (words.length === 0) return null
  let best: T | null = null
  let bestScore = 0
  for (const b of bgs) {
    const hay = `${b.name} ${b.tags.join(' ')}`.toLowerCase()
    const score = words.reduce((a, w) => a + (hay.includes(w) ? 1 : 0), 0)
    if (score > bestScore) { best = b; bestScore = score }
  }
  return best
}

export const boardOf = (scene: Scene): SceneBoard => scene.board ?? {}

/** Storyboard fields of a scene -> board (dialog ids are generated). */
export function boardFromScript(s: ScriptScene, newId: () => string): SceneBoard {
  return { location: s.location || undefined, summary: s.summary || undefined, dialog: s.dialog.length ? s.dialog.map((d) => ({ id: newId(), who: d.who, text: d.text })) : undefined }
}

/** Evenly spread x positions (as fractions of the width) for `n` characters standing in a row. */
export function spreadX(n: number): number[] {
  if (n <= 1) return [0.5]
  return Array.from({ length: n }, (_, i) => 0.2 + (0.6 * i) / (n - 1))
}

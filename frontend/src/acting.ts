import type { Keyframe } from './types'

/**
 * Acting for the auto director: what a character feels while saying a line (from the words), which face and body pose goes
 * with it, and when. Rules are simple keyword rules for Indonesian dialogue; a line that matches nothing stays neutral
 * (the lip-sync alone moves the mouth).
 */

export type Emotion = 'netral' | 'kaget' | 'senang' | 'tertawa' | 'serius' | 'teriak'

const has = (t: string, re: RegExp) => re.test(t)

export function emotionOf(text: string): Emotion {
  const t = ` ${text.toLowerCase()} `
  if (has(t, /\b(haha|hehe|hihi|lucu sekali)\b/)) return 'tertawa'
  if (has(t, /\b(hah|astaga|ya ampun|ya tuhan|benarkah|masa sih)\b|\?!|!\?/)) return 'kaget'
  if (has(t, /\b(ayo cepat|cepat,|awas|tolong)\b|cepat!/)) return 'teriak'
  if (has(t, /\b(alhamdulillah|lulus|hebat|berhasil|selesai|terima kasih|asyik|hore|yeay)\b/)) return 'senang'
  if (has(t, /\b(aduh|maaf|panik|terlambat|kesiangan|sempit|semoga|belum sempat|tinggal sedikit|begadang|harus)\b/)) return 'serius'
  return 'netral'
}

/** Body pose (see POSES in rigMotion) for a line, or null for "just stand and talk". */
export function poseFor(text: string, emotion: Emotion): string | null {
  const t = text.toLowerCase()
  if (/\b(kelihatan|di depan|lihat|di sana|itu)\b/.test(t)) return 'tunjuk'
  if (emotion === 'kaget') return 'kaget'
  if (emotion === 'senang') return /\b(alhamdulillah|lulus|hebat|berhasil)\b/.test(t) ? 'angkat' : null
  if (emotion === 'serius') return /\b(semoga|belum|waktu|sempit|sedikit|tinggal)\b/.test(t) ? 'berpikir' : /\b(maaf|aduh)\b/.test(t) ? 'miring' : 'pinggang'
  return null
}

/** A scene where the character should run across the screen (by its name or the words spoken). */
export function isRunScene(sceneName: string, lines: string[]): boolean {
  return /\b(berlari|lari|mengejar|buru-buru|berangkat)\b/i.test(sceneName) || lines.some((l) => /\b(berlari|ayo cepat)\b/i.test(l))
}

export interface ActStep {
  /** frame the line starts / ends (scene frames) */
  start: number
  end: number
  emotion: Emotion
  pose: string | null
}

/** Acting plan for one speaker: one step per spoken line. */
export function planActing(lines: { text: string; start: number; end: number }[], fps: number): ActStep[] {
  return lines.map((l) => {
    const emotion = emotionOf(l.text)
    return { start: Math.round(l.start * fps), end: Math.round(l.end * fps), emotion, pose: poseFor(l.text, emotion) }
  })
}

/** Keys for something that must move together with a character (a balloon): the same keys, shifted by `delta`. */
export const followKeys = (keys: Keyframe[], delta: number): Keyframe[] => keys.map((k) => ({ ...k, v: Math.round((k.v + delta) * 100) / 100 }))

/** How many frames before a line a pose is eased in, and after it the character relaxes. */
export const EASE_IN = 5
export const EASE_OUT = 10

// ---- actions written in a script: "(Uki melambai)" ----------------------------------------

export type ActionEffect =
  | { kind: 'motion'; id: 'walk' | 'run' | 'wave' | 'nod' | 'jump'; dir?: 1 | -1 }
  | { kind: 'pose'; id: string }
  | { kind: 'expression'; id: string }

const ACTION_WORDS: [RegExp, ActionEffect][] = [
  [/\b(melambai|melambaikan|lambai)\b/, { kind: 'motion', id: 'wave' }],
  [/\b(melompat|lompat|meloncat|loncat)\b/, { kind: 'motion', id: 'jump' }],
  [/\b(berlari|lari)\b/, { kind: 'motion', id: 'run' }],
  [/\b(berjalan|melangkah)\b/, { kind: 'motion', id: 'walk' }],
  [/\b(mengangguk|angguk|menggeleng|geleng)\b/, { kind: 'motion', id: 'nod' }],
  [/\b(menunjuk|tunjuk)\b/, { kind: 'pose', id: 'tunjuk' }],
  [/\b(berpikir|merenung)\b/, { kind: 'pose', id: 'berpikir' }],
  [/\b(kaget|terkejut)\b/, { kind: 'pose', id: 'kaget' }],
  [/\b(berkacak pinggang|tangan di pinggang)\b/, { kind: 'pose', id: 'pinggang' }],
  [/\b(mengangkat tangan|angkat tangan|bersorak)\b/, { kind: 'pose', id: 'angkat' }],
  [/\b(memiringkan kepala|bingung|penasaran)\b/, { kind: 'pose', id: 'miring' }],
  [/\b(tersenyum|senyum|senang|gembira)\b/, { kind: 'expression', id: 'senang' }],
  [/\b(tertawa|ketawa)\b/, { kind: 'expression', id: 'tertawa' }],
  [/\b(kaget|terkejut)\b/, { kind: 'expression', id: 'kaget' }],
  [/\b(serius|marah|kesal|cemberut)\b/, { kind: 'expression', id: 'serius' }],
  [/\b(berpikir|merenung)\b/, { kind: 'expression', id: 'berpikir' }],
]

/** How far a walk or run may go: it stays on screen and stops beside whoever stands in the way (gap = 14% of the width). */
export function travelDistance(x: number, dir: 1 | -1, wanted: number, W: number, others: number[]): number {
  const edge = dir > 0 ? W * 0.92 - x : x - W * 0.08
  const free = others.map((o) => (o - x) * dir).filter((d) => d > 0).map((d) => d - W * 0.14)
  return Math.max(0, Math.min(wanted, edge, ...free))
}

export interface ParsedAction {
  /** the names found in the text, spelled as in `names` */
  who: string[]
  /** "semua ...": everybody who acts in the scene */
  all: boolean
  effects: ActionEffect[]
}

/** Reads an action line: who moves and how (simple keyword rules, like the acting above). Nothing recognised = no effects. */
export function parseAction(text: string, names: string[]): ParsedAction {
  const t = ` ${text.toLowerCase()} `
  const dir: 1 | -1 | undefined = /\bke kiri\b/.test(t) ? -1 : /\bke kanan\b/.test(t) ? 1 : undefined
  const who = names.filter((n) => {
    const name = n.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return !!name && new RegExp(`[^\\p{L}\\p{N}]${name}[^\\p{L}\\p{N}]`, 'u').test(t)
  })
  const effects = ACTION_WORDS.filter(([re]) => re.test(t)).map(([, e]) => (e.kind === 'motion' && (e.id === 'walk' || e.id === 'run') && dir ? { ...e, dir } : e))
  return { who, all: /\b(semua|semuanya|mereka)\b/.test(t), effects }
}

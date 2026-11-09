import { parseAction } from '../acting'
import { pickSfx, SFX } from '../audioTools'
import type { ScriptBeat, ScriptLine, StoryScript } from './types'

/**
 * A script as plain text, easy to type or paste:
 *
 *   # Nama scene | Lokasi | waktu | latar: Kris, Arum
 *   [bel]
 *   (Uki berlari ke kanan)
 *   Uki: Wah, sekolahnya besar sekali!
 *   Narator: Pagi itu Uki tiba di gerbang.
 *
 * `# ` starts a scene (location, time and the people in the background are optional), `(...)` is an action, `[...]` a sound effect, and
 * every other non-empty line is "Pembicara: kalimat". An action or effect happens before the next line of dialogue, or at the end of the
 * scene when no line follows. The server checks speakers and locations again, this only turns text into the JSON shape and back.
 */

type Scene = StoryScript['scenes'][number]

const isAction = (line: string) => line.startsWith('(') && line.endsWith(')')
const isSfx = (line: string) => line.startsWith('[') && line.endsWith(']')
const DIALOG = /^([^:]{1,40}):\s*(.+)$/
const inner = (line: string) => line.slice(1, -1).trim()
const sfxText = (line: string) => inner(line).replace(/^(sfx|efek(\s+suara)?)\s*:\s*/i, '').trim()
const isCrowdPart = (part: string) => /^latar\s*:/i.test(part)
const crowdNames = (part: string) => part.replace(/^latar\s*:/i, '').split(',').map((x) => x.trim()).filter(Boolean)

function parseHeader(line: string, index: number): Scene {
  const parts = line.replace(/^#\s*/, '').split('|').map((x) => x.trim())
  const crowd = parts.find(isCrowdPart)
  const [name, location, time] = parts.filter((p) => !isCrowdPart(p))
  const cast = crowd ? [...new Set(crowdNames(crowd))] : []
  return { name: name || `Scene ${index + 1}`, location: location ?? '', time: (time ?? 'siang').toLowerCase(), ...(cast.length ? { cast } : {}), dialog: [] }
}

const hasContent = (s: Scene) => s.dialog.length > 0 || (s.after?.length ?? 0) > 0

export function parseScript(text: string): StoryScript {
  const scenes: Scene[] = []
  let pending: ScriptBeat[] = []
  const flush = () => {
    const last = scenes[scenes.length - 1]
    if (last && pending.length) last.after = pending
    pending = []
  }
  const current = () => {
    if (!scenes.length) scenes.push({ name: 'Scene 1', location: '', time: 'siang', dialog: [] })
    return scenes[scenes.length - 1]
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('#')) {
      flush()
      scenes.push(parseHeader(line, scenes.length))
      continue
    }
    if (isAction(line) || isSfx(line)) {
      const value = isAction(line) ? inner(line) : sfxText(line)
      if (value) { current(); pending.push(isAction(line) ? { action: value } : { sfx: value }) }
      continue
    }
    const m = DIALOG.exec(line)
    if (!m) continue
    const dialog: ScriptLine = { who: m[1].trim(), text: m[2].trim() }
    if (pending.length) { dialog.before = pending; pending = [] }
    current().dialog.push(dialog)
  }
  flush()
  return { scenes: scenes.filter(hasContent) }
}

const beatLine = (b: ScriptBeat) => (b.action !== undefined ? `(${b.action})` : `[${b.sfx}]`)

export function formatScript(script: StoryScript | null | undefined): string {
  return (script?.scenes ?? [])
    .map((s) => [
      `# ${[s.name, s.location, s.time, ...(s.cast?.length ? [`latar: ${s.cast.join(', ')}`] : [])].filter((x) => x !== undefined).join(' | ')}`,
      ...s.dialog.flatMap((d) => [...(d.before ?? []).map(beatLine), `${d.who}: ${d.text}`]),
      ...(s.after ?? []).map(beatLine),
    ].join('\n'))
    .join('\n\n')
}

export interface ScriptCheck {
  /** who may speak in this series (the narrator too, when it is on) */
  speakers: string[]
  /** every character of the Character Builder: they can stand in the background or act */
  people: string[]
  locations: string[]
}

/** What will not end up in the film as written, in words the author can act on (a script is still saved: these are warnings). */
export function checkScript(text: string, ctx: ScriptCheck): string[] {
  const out: string[] = []
  const lower = (list: string[]) => new Set(list.map((x) => x.toLowerCase()))
  const speakers = lower(ctx.speakers)
  if (speakers.has('narator')) speakers.add('narrator')
  const people = lower(ctx.people)
  const locations = lower(ctx.locations)
  const actors = [...new Set([...ctx.speakers, ...ctx.people])].filter((n) => !/^narr?ator$/i.test(n))
  let scene: { name: string; line: number; filled: boolean } | null = null
  let scenes = 0
  const closeScene = () => { if (scene && !scene.filled) out.push(`Baris ${scene.line}: scene "${scene.name}" belum punya dialog atau aksi, jadi tidak ikut difilmkan.`) }

  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim()
    const at = `Baris ${i + 1}`
    if (!line) return
    if (line.startsWith('#')) {
      closeScene()
      const h = parseHeader(line, scenes)
      scene = { name: h.name, line: i + 1, filled: false }
      scenes++
      if (h.location && !locations.has(h.location.toLowerCase())) out.push(`${at}: lokasi "${h.location}" tidak ada di daftar, jadi dipakai latar yang paling mirip.`)
      if (!['pagi', 'siang', 'sore', 'malam'].includes(h.time)) out.push(`${at}: waktu "${h.time}" tidak dikenal, jadi dipakai siang.`)
      if ((h.cast?.length ?? 0) > 16) out.push(`${at}: orang latar paling banyak 16 per scene.`)
      for (const name of h.cast ?? []) if (!people.has(name.toLowerCase())) out.push(`${at}: orang latar "${name}" belum ada di Character Builder, jadi tidak muncul.`)
      return
    }
    if (isAction(line)) {
      if (scene) scene.filled = true
      const act = parseAction(inner(line), actors)
      if (!act.effects.length) out.push(`${at}: gerakan "${inner(line)}" belum dikenali, jadi tidak terlihat di film. Contoh: melambai, melompat, berlari, berjalan, mengangguk, menunjuk, berpikir, kaget, tertawa.`)
      else if (!act.all && !act.who.length) out.push(`${at}: sebutkan siapa yang bergerak, misalnya "(Uki melambai)" atau "(semua melompat)".`)
      return
    }
    if (isSfx(line)) {
      if (scene) scene.filled = true
      if (!pickSfx(sfxText(line))) out.push(`${at}: efek suara "${sfxText(line)}" belum ada. Pilihan: ${SFX.map((s) => s.id).join(', ')}.`)
      return
    }
    const m = DIALOG.exec(line)
    if (!m) { out.push(`${at}: baris ini diabaikan. Tulis "Nama: kalimat", "(aksi)", atau "[efek suara]".`); return }
    if (!speakers.has(m[1].trim().toLowerCase())) { out.push(`${at}: "${m[1].trim()}" belum ada di daftar Karakter cerita ini, jadi dialognya akan hilang.`); return }
    if (scene) scene.filled = true
    if (m[2].trim().length > 300) out.push(`${at}: dialog lebih dari 300 huruf akan dipotong.`)
  })
  closeScene()
  if (scenes > 12) out.push(`Naskah punya ${scenes} scene, padahal batasnya 12. Pecah jadi beberapa episode.`)
  return out
}

/** Adds a person to the background of the scene the cursor is in (a script without a heading gets one). */
export function addCrowdPerson(text: string, cursor: number, name: string): string {
  const lines = text.split('\n')
  let pos = 0
  let target = -1
  for (let i = 0; i < lines.length && pos <= cursor; i++) {
    if (lines[i].trim().startsWith('#')) target = i
    pos += lines[i].length + 1
  }
  if (target < 0) return `# Scene 1 | latar: ${name}\n${text}`
  const line = lines[target].trimEnd()
  const parts = line.split('|')
  const at = parts.findIndex((p) => isCrowdPart(p.trim()))
  if (at < 0) lines[target] = `${line} | latar: ${name}`
  else {
    const names = crowdNames(parts[at].trim())
    if (names.some((n) => n.toLowerCase() === name.toLowerCase())) return text
    parts[at] = ` latar: ${[...names, name].join(', ')}`
    lines[target] = parts.join('|')
  }
  return lines.join('\n')
}

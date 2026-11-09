import type { AudioClip, CameraProp, Ease, EffectKind, Keyframe, Layer, ProjectDoc, Scene, SceneCamera, SceneDocument, SceneEffect, Subtitle, Transition, TransitionType } from './types'

export const TRANSITIONS: { v: TransitionType; label: string }[] = [
  { v: 'none', label: 'Potong langsung' },
  { v: 'fade', label: 'Fade lewat hitam' },
  { v: 'fadeWhite', label: 'Fade lewat putih' },
  { v: 'slideLeft', label: 'Geser ke kiri' },
  { v: 'slideRight', label: 'Geser ke kanan' },
  { v: 'wipe', label: 'Tirai (wipe)' },
  { v: 'zoom', label: 'Zoom lewat hitam' },
]

export const sceneUid = () => 's' + Math.random().toString(36).slice(2, 9)

const EASES = new Set<Ease>(['linear', 'easeIn', 'easeOut', 'easeInOut', 'step'])
const EFFECTS = new Set<EffectKind>(['rain', 'snow', 'tint', 'vignette'])
const CAM_TRACK: Record<string, CameraProp> = { x: 'x', y: 'y', zoom: 'zoom', rot: 'rot', rotation: 'rot' }

const keysOf = (raw: unknown): Keyframe[] => {
  if (!Array.isArray(raw)) return []
  const byFrame = new Map<number, Keyframe>()
  for (const k of raw as { f?: unknown; v?: unknown; e?: unknown }[]) {
    if (k && Number.isFinite(k.f) && (k.f as number) >= 0 && Number.isFinite(k.v)) byFrame.set(Math.round(k.f as number), { f: Math.round(k.f as number), v: k.v as number, e: EASES.has(k.e as Ease) ? (k.e as Ease) : 'linear' })
  }
  return [...byFrame.values()].sort((a, b) => a.f - b.f)
}

/**
 * A scene camera in the shape the editor uses ({ x|y|zoom|rot: Keyframe[] }). Documents made by other tools can hold other
 * shapes (plain numbers, keyframes nested under `keyframes`, `rotation` instead of `rot`): tracks that are lists of keys are kept,
 * the nested form is lifted, everything else is dropped (the camera then simply stays at its default).
 */
export function normalizeCamera(raw: unknown): SceneCamera | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const src = raw as Record<string, unknown>
  const out: SceneCamera = {}
  const take = (o: Record<string, unknown>) => {
    for (const [name, v] of Object.entries(o)) {
      const prop = CAM_TRACK[name]
      const keys = prop ? keysOf(v) : []
      if (prop && keys.length) out[prop] = keys
    }
  }
  if (src.keyframes && typeof src.keyframes === 'object') take(src.keyframes as Record<string, unknown>)
  take(src)
  return Object.keys(out).length ? out : undefined
}

/** Drops malformed entries of the scene extras instead of letting one bad value break the whole editor. */
function normalizeScene(s: Scene): Scene {
  const out: Scene = { ...s, layers: Array.isArray(s.layers) ? s.layers : [] }
  const cam = normalizeCamera((s as { camera?: unknown }).camera)
  if (cam) out.camera = cam; else delete out.camera
  const fx = Array.isArray(s.effects) ? (s.effects as SceneEffect[]).filter((e) => e && EFFECTS.has(e.kind) && Number.isFinite(e.intensity)) : []
  if (fx.length) out.effects = fx; else delete out.effects
  const subs = Array.isArray(s.subtitles) ? (s.subtitles as Subtitle[]).filter((u) => u && typeof u.text === 'string' && Number.isFinite(u.start) && Number.isFinite(u.end)) : []
  if (subs.length) out.subtitles = subs; else delete out.subtitles
  if (out.board && (typeof out.board !== 'object' || Array.isArray(out.board))) delete out.board
  return out
}

/** Upgrade any stored document (schema 1: one scene) to schema 2. */
export function migrate(raw: any): ProjectDoc {
  if (raw && Array.isArray(raw.scenes)) {
    return {
      schema: 2, settings: raw.settings, scenes: (raw.scenes as Scene[]).map(normalizeScene), audio: Array.isArray(raw.audio) ? raw.audio : [],
      // set by the daily-cartoon generator: "characters still have to be placed" + who the film is about (the auto director reads them)
      ...(typeof raw.auto_generated === 'boolean' ? { auto_generated: raw.auto_generated } : {}),
      ...(raw.character_ids && typeof raw.character_ids === 'object' && !Array.isArray(raw.character_ids) ? { character_ids: Object.fromEntries(Object.entries(raw.character_ids as Record<string, unknown>).filter(([, v]) => Number.isInteger(v))) as Record<string, number> } : {}),
      ...(Array.isArray(raw.characters) ? { characters: (raw.characters as unknown[]).filter((c): c is string => typeof c === 'string') } : {}),
    }
  }
  const s = raw?.settings ?? {}
  return {
    schema: 2,
    settings: { width: s.width ?? 1280, height: s.height ?? 720, fps: s.fps ?? 24 },
    scenes: [{ id: sceneUid(), name: 'Scene 1', duration: s.duration ?? 5, background: s.background ?? '#ffffff', transition: null, layers: raw?.layers ?? [] }],
    audio: [],
  }
}

/** What the editor edits: the project settings + ONE scene flattened into the single-scene shape. */
export function sceneView(p: ProjectDoc, sceneId: string): SceneDocument {
  const sc = p.scenes.find((s) => s.id === sceneId) ?? p.scenes[0]
  return { schema: 1, settings: { ...p.settings, duration: sc.duration, background: sc.background }, layers: sc.layers, camera: sc.camera, effects: sc.effects, subtitles: sc.subtitles }
}

/** camera / effects / subtitles live in the view while editing; empty ones are dropped so documents stay small */
function withExtras(s: Scene, view: SceneDocument): Scene {
  const out: Scene = { ...s }
  const cam = view.camera && Object.values(view.camera).some((k) => k?.length) ? view.camera : undefined
  if (cam) out.camera = cam; else delete out.camera
  if (view.effects?.length) out.effects = view.effects; else delete out.effects
  if (view.subtitles?.length) out.subtitles = view.subtitles; else delete out.subtitles
  return out
}

/** Write an edited view back into the project (size/fps are project-wide, duration/background/layers belong to the scene). */
export function mergeView(p: ProjectDoc, sceneId: string, view: SceneDocument): ProjectDoc {
  const { width, height, fps, duration, background } = view.settings
  return {
    ...p,
    settings: { width, height, fps },
    scenes: p.scenes.map((s) => (s.id === sceneId ? withExtras({ ...s, duration, background, layers: view.layers }, view) : s)),
  }
}

export const totalDuration = (p: ProjectDoc) => p.scenes.reduce((a, s) => a + s.duration, 0)
export const sceneStart = (p: ProjectDoc, index: number) => p.scenes.slice(0, index).reduce((a, s) => a + s.duration, 0)

/** Scene playing at film time `t` (seconds) and the time inside it. Past the end it stays on the last frame. */
export function locate(p: ProjectDoc, t: number): { index: number; scene: Scene; local: number } {
  let acc = 0
  for (let i = 0; i < p.scenes.length; i++) {
    const d = p.scenes[i].duration
    if (t < acc + d || i === p.scenes.length - 1) return { index: i, scene: p.scenes[i], local: Math.max(0, Math.min(d, t - acc)) }
    acc += d
  }
  return { index: 0, scene: p.scenes[0], local: 0 }
}

export type Effect = { kind: 'fade'; color: string; alpha: number } | { kind: 'slide'; offsetX: number } | { kind: 'wipe'; progress: number; side: -1 | 1 } | { kind: 'zoom'; scale: number; alpha: number }

const smooth = (x: number) => x * x * (3 - 2 * x)

/**
 * Transitions are "dip" style (no overlap): the outgoing scene leaves during the first half of the transition and the
 * incoming scene enters during the second half. The effect belongs to the scene being drawn at `local` seconds.
 */
export function effectAt(p: ProjectDoc, index: number, local: number, width: number): Effect | null {
  const scene = p.scenes[index]
  const half = (tr: Transition | null, other: Scene | undefined) => (tr && tr.type !== 'none' && other ? Math.min(tr.duration, scene.duration, other.duration) / 2 : 0)

  const outTr = scene.transition
  const outHalf = half(outTr, p.scenes[index + 1])
  if (outHalf > 0 && local > scene.duration - outHalf) return make(outTr!.type, smooth((local - (scene.duration - outHalf)) / outHalf), -1, width)

  const prev = p.scenes[index - 1]
  const inHalf = half(prev?.transition ?? null, prev)
  if (inHalf > 0 && local < inHalf) return make(prev!.transition!.type, smooth(1 - local / inHalf), +1, width)
  return null
}

function make(type: TransitionType, progress: number, side: -1 | 1, width: number): Effect | null {
  if (progress <= 0) return null
  switch (type) {
    case 'fade': return { kind: 'fade', color: '#000000', alpha: progress }
    case 'fadeWhite': return { kind: 'fade', color: '#ffffff', alpha: progress }
    case 'slideLeft': return { kind: 'slide', offsetX: side * progress * width } // leaves to the left, enters from the right
    case 'slideRight': return { kind: 'slide', offsetX: -side * progress * width }
    case 'wipe': return { kind: 'wipe', progress, side }
    case 'zoom': return { kind: 'zoom', scale: 1 + progress * 0.6, alpha: progress }
    default: return null
  }
}

/** Deep copy of a scene with fresh layer ids (parent links and IK targets follow the new ids). */
export function cloneScene(scene: Scene, newId: string, name: string, newLayerId: () => string): Scene {
  const ids = new Map(scene.layers.map((l) => [l.id, newLayerId()]))
  const layers = structuredClone(scene.layers).map((l: Layer) => ({
    ...l,
    id: ids.get(l.id)!,
    parentId: l.parentId ? ids.get(l.parentId) ?? null : l.parentId ?? null,
    ik: l.ik ? { ...l.ik, target: ids.get(l.ik.target) ?? l.ik.target } : l.ik,
  }))
  return { ...structuredClone(scene), id: newId, name, layers }
}

export function audioEnd(c: AudioClip, assetDuration: number | null | undefined) {
  return c.start + (assetDuration ?? 0)
}

/** Clips that should be audible at film time `t`: [clip, offset into the file]. */
export function audibleAt(clips: AudioClip[], durations: Record<number, number | null | undefined>, t: number): [AudioClip, number][] {
  const out: [AudioClip, number][] = []
  for (const c of clips) {
    const d = durations[c.assetId] ?? 0
    if (t >= c.start && t < c.start + d) out.push([c, t - c.start])
  }
  return out
}

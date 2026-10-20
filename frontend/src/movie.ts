import type { AudioClip, Layer, ProjectDoc, Scene, SceneDocument, Transition, TransitionType } from './types'

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

/** Upgrade any stored document (schema 1: one scene) to schema 2. */
export function migrate(raw: any): ProjectDoc {
  if (raw && Array.isArray(raw.scenes)) {
    return { schema: 2, settings: raw.settings, scenes: raw.scenes, audio: Array.isArray(raw.audio) ? raw.audio : [] }
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

import type { AnimProp, CameraProp, Ease, Keyframe, Layer, SceneCamera, SceneDocument, Swap } from './types'

export const ANIM_PROPS: { prop: AnimProp; label: string }[] = [
  { prop: 'x', label: 'X' },
  { prop: 'y', label: 'Y' },
  { prop: 'scaleX', label: 'Skala X' },
  { prop: 'scaleY', label: 'Skala Y' },
  { prop: 'rotation', label: 'Rotasi' },
  { prop: 'opacity', label: 'Opacity' },
]

export const EASES: { v: Ease; label: string }[] = [
  { v: 'linear', label: 'Linear' },
  { v: 'easeIn', label: 'Ease in' },
  { v: 'easeOut', label: 'Ease out' },
  { v: 'easeInOut', label: 'Ease in-out' },
  { v: 'step', label: 'Step (tahan)' },
]

export const isAnimProp = (k: string): k is AnimProp => ANIM_PROPS.some((p) => p.prop === k)

const ease = (e: Ease, t: number) => {
  switch (e) {
    case 'easeIn': return t * t * t
    case 'easeOut': return 1 - (1 - t) ** 3
    case 'easeInOut': return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
    case 'step': return 0
    default: return t
  }
}

export const totalFrames = (d: SceneDocument) => Math.max(1, Math.round(d.settings.duration * d.settings.fps))

/** Value of a key list at a (possibly fractional) frame; `fallback` when there are no keys. Keys are sorted by frame. */
export function evalKeys(ks: Keyframe[] | undefined, frame: number, fallback: number): number {
  if (!ks || ks.length === 0) return fallback
  if (frame <= ks[0].f) return ks[0].v
  const last = ks[ks.length - 1]
  if (frame >= last.f) return last.v
  for (let i = 0; i < ks.length - 1; i++) {
    const a = ks[i]
    const b = ks[i + 1]
    if (frame >= a.f && frame < b.f) return a.v + (b.v - a.v) * ease(a.e, (frame - a.f) / (b.f - a.f))
  }
  return last.v
}

/** Value of one property at a (possibly fractional) frame. */
export const evalProp = (layer: Layer, prop: AnimProp, frame: number): number => evalKeys(layer.keyframes?.[prop], frame, layer[prop])

/** Asset shown at `frame`: the last swap key at or before it, else the layer's own asset. */
export function assetAt(layer: Pick<Layer, 'assetId' | 'swaps'>, frame: number): number | null | undefined {
  const sw = layer.swaps
  if (!sw || sw.length === 0) return layer.assetId
  let cur: number | null | undefined = layer.assetId
  for (const k of sw) { if (k.f <= frame + 1e-6) cur = k.assetId; else break }
  return cur
}

/** Insert or replace a swap key (mutates; keeps one key per frame, sorted). */
export function setSwap(layer: Layer, f: number, assetId: number) {
  const list = (layer.swaps ??= [])
  const i = list.findIndex((k) => k.f === f)
  if (i >= 0) list[i] = { f, assetId }
  else { list.push({ f, assetId }); list.sort((a, b) => a.f - b.f) }
}

export function removeSwap(layer: Layer, f: number) {
  if (!layer.swaps) return
  layer.swaps = layer.swaps.filter((k) => k.f !== f)
  if (layer.swaps.length === 0) delete layer.swaps
}

export type { Swap }

export function evalLayer(layer: Layer, frame: number): Layer {
  if (!layer.keyframes && !layer.swaps?.length) return layer
  const out = { ...layer }
  if (layer.keyframes) for (const { prop } of ANIM_PROPS) out[prop] = evalProp(layer, prop, frame)
  if (layer.swaps?.length) out.assetId = assetAt(layer, frame)
  return out
}

export const CAMERA_PROPS: { prop: CameraProp; label: string }[] = [
  { prop: 'x', label: 'Posisi X' },
  { prop: 'y', label: 'Posisi Y' },
  { prop: 'zoom', label: 'Zoom' },
  { prop: 'rot', label: 'Putar' },
]

/** Camera at `frame`: the scene point in the middle of the view, zoom (1 = whole scene) and roll in degrees. */
export function evalCamera(cam: SceneCamera | undefined, frame: number, width: number, height: number) {
  if (!cam) return { x: width / 2, y: height / 2, zoom: 1, rot: 0 }
  return {
    x: evalKeys(cam.x, frame, width / 2),
    y: evalKeys(cam.y, frame, height / 2),
    zoom: Math.max(0.05, evalKeys(cam.zoom, frame, 1)),
    rot: evalKeys(cam.rot, frame, 0),
  }
}

export const hasCamera = (cam: SceneCamera | undefined) => !!cam && Object.values(cam).some((k) => k && k.length > 0)

/** Insert/replace a camera key (mutates `cam`). */
export function setCamKey(cam: SceneCamera, prop: CameraProp, f: number, v: number, e: Ease = 'easeInOut') {
  const list = (cam[prop] ??= [])
  const i = list.findIndex((k) => k.f === f)
  if (i >= 0) list[i] = { f, v, e: e ?? list[i].e }
  else { list.push({ f, v, e }); list.sort((a, b) => a.f - b.f) }
}

export function removeCamKey(cam: SceneCamera, prop: CameraProp, f: number) {
  const next = (cam[prop] ?? []).filter((k) => k.f !== f)
  if (next.length) cam[prop] = next; else delete cam[prop]
}

/** Insert or replace a keyframe (mutates the layer; call on a cloned document). */
export function setKey(layer: Layer, prop: AnimProp, f: number, v: number, e?: Ease) {
  const kfs = (layer.keyframes ??= {})
  const list = (kfs[prop] ??= [])
  const i = list.findIndex((k) => k.f === f)
  if (i >= 0) list[i] = { f, v, e: e ?? list[i].e }
  else {
    list.push({ f, v, e: e ?? 'linear' })
    list.sort((a, b) => a.f - b.f)
  }
}

export function removeKey(layer: Layer, prop: AnimProp, f: number) {
  const list = layer.keyframes?.[prop]
  if (!list) return
  const next = list.filter((k) => k.f !== f)
  if (next.length) layer.keyframes![prop] = next
  else delete layer.keyframes![prop]
  if (layer.keyframes && Object.keys(layer.keyframes).length === 0) delete layer.keyframes
}

export const keyAt = (layer: Layer, prop: AnimProp, f: number): Keyframe | undefined => layer.keyframes?.[prop]?.find((k) => k.f === f)

// ---- hierarchy (rigging) ----------------------------------------------------

export interface Mat { a: number; b: number; c: number; d: number; tx: number; ty: number }

/** local matrix: T(x,y) · R(rot) · S(sx,sy) · T(-pivot) */
export function localMatrix(l: Layer): Mat {
  const r = (l.rotation * Math.PI) / 180
  const a = Math.cos(r) * l.scaleX
  const b = Math.sin(r) * l.scaleX
  const c = -Math.sin(r) * l.scaleY
  const d = Math.cos(r) * l.scaleY
  const px = l.pivotX ?? 0
  const py = l.pivotY ?? 0
  return { a, b, c, d, tx: l.x - (a * px + c * py), ty: l.y - (b * px + d * py) }
}

export const mul = (p: Mat, m: Mat): Mat => ({
  a: p.a * m.a + p.c * m.b,
  b: p.b * m.a + p.d * m.b,
  c: p.a * m.c + p.c * m.d,
  d: p.b * m.c + p.d * m.d,
  tx: p.a * m.tx + p.c * m.ty + p.tx,
  ty: p.b * m.tx + p.d * m.ty + p.ty,
})

/** World matrix of a layer at `frame`, composing animated values up the parent chain. */
export function worldMatrix(doc: SceneDocument, layer: Layer, frame: number, evaluated: Map<string, Layer> = evalAll(doc, frame)): Mat {
  return worldOf(evaluated, layer.id)
}

export const childrenOf = (doc: SceneDocument, id: string | null) => doc.layers.filter((l) => (l.parentId ?? null) === id)

export function descendantIds(doc: SceneDocument, id: string): Set<string> {
  const out = new Set<string>()
  const walk = (p: string) => childrenOf(doc, p).forEach((c) => { out.add(c.id); walk(c.id) })
  walk(id)
  return out
}

/** Layers in display order: roots top-first, each followed by its children (indented by depth). */
export function flatten(doc: SceneDocument): { layer: Layer; depth: number }[] {
  const out: { layer: Layer; depth: number }[] = []
  const known = new Set(doc.layers.map((l) => l.id))
  const walk = (parent: string | null, depth: number) => {
    const kids = doc.layers.filter((l) => (parent === null ? !l.parentId || !known.has(l.parentId) : l.parentId === parent))
    for (const l of [...kids].reverse()) {
      out.push({ layer: l, depth })
      walk(l.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

// ---- evaluation with IK ------------------------------------------------------

const IDENT: Mat = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }
const applyPt = (m: Mat, x: number, y: number) => ({ x: m.a * x + m.c * y + m.tx, y: m.b * x + m.d * y + m.ty })
const invert = (m: Mat): Mat => {
  const det = m.a * m.d - m.b * m.c || 1
  const a = m.d / det, b = -m.b / det, c = -m.c / det, d = m.a / det
  return { a, b, c, d, tx: -(a * m.tx + c * m.ty), ty: -(b * m.tx + d * m.ty) }
}

function worldOf(map: Map<string, Layer>, id: string | null | undefined): Mat {
  const chain: Layer[] = []
  for (let l = id ? map.get(id) : undefined, n = 0; l && n < 256; l = l.parentId ? map.get(l.parentId) : undefined, n++) chain.unshift(l)
  return chain.reduce<Mat>((acc, l) => mul(acc, localMatrix(l)), IDENT)
}

/**
 * Analytic 2-bone IK. The end bone `B` (with `ik`) and its parent `P` are rotated so B's tip reaches
 * the target layer's joint position. Assumes uniform scale along the chain. Mutates `map` values.
 */
function solveIK(map: Map<string, Layer>) {
  for (const B0 of [...map.values()]) {
    if (!B0.ik) continue
    const B = map.get(B0.id)!
    const P = B.parentId ? map.get(B.parentId) : undefined
    const T = map.get(B.ik!.target)
    if (!P || !T) continue
    const gp = worldOf(map, P.parentId)
    const targetParentWorld = worldOf(map, T.parentId)
    const tw = applyPt(targetParentWorld, T.x, T.y)
    const t = applyPt(invert(gp), tw.x, tw.y)

    const vx = (B.x - (P.pivotX ?? 0)) * P.scaleX
    const vy = (B.y - (P.pivotY ?? 0)) * P.scaleY
    const L1 = Math.hypot(vx, vy)
    const beta = Math.atan2(vy, vx)
    const L2 = (B.length ?? 100) * Math.abs(B.scaleX) * Math.abs(P.scaleX)
    if (L1 < 1e-6 || L2 < 1e-6) continue

    const dx = t.x - P.x
    const dy = t.y - P.y
    const d = Math.min(Math.max(Math.hypot(dx, dy), Math.abs(L1 - L2) + 1e-3), L1 + L2 - 1e-3)
    const base = Math.atan2(dy, dx)
    const cosA = Math.max(-1, Math.min(1, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d)))
    const ang1 = base + B.ik!.bend * Math.acos(cosA)
    const ex = P.x + L1 * Math.cos(ang1)
    const ey = P.y + L1 * Math.sin(ang1)
    const ang2 = Math.atan2(t.y - ey, t.x - ex)
    const rotP = ang1 - beta

    map.set(P.id, { ...P, rotation: (rotP * 180) / Math.PI })
    map.set(B.id, { ...B, rotation: ((ang2 - rotP) * 180) / Math.PI })
  }
}

/** Every layer evaluated at `frame` (keyframes), then IK applied. */
export function evalAll(doc: SceneDocument, frame: number): Map<string, Layer> {
  const map = new Map<string, Layer>()
  for (const l of doc.layers) map.set(l.id, evalLayer(l, frame))
  solveIK(map)
  return map
}

/** Bones whose rotation is currently driven by IK (the end bone and its parent). */
export function ikDriven(doc: SceneDocument): Set<string> {
  const out = new Set<string>()
  for (const l of doc.layers) if (l.ik && l.parentId) { out.add(l.id); out.add(l.parentId) }
  return out
}

/** Absolute world position of a point given in a layer's content space. */
export function worldPoint(doc: SceneDocument, id: string, frame: number, x = 0, y = 0) {
  const map = evalAll(doc, frame)
  return applyPt(worldOf(map, id), x, y)
}

// ---- motion presets --------------------------------------------------------

export interface PresetParams { duration: number; amount: number; cycles: number; phase: number }
export interface PresetDef {
  id: string
  label: string
  hint: string
  amountLabel: string
  defaults: PresetParams
  /** which props it writes */
  props: AnimProp[]
}

export const PRESETS: PresetDef[] = [
  { id: 'swing', label: 'Ayun / Lambai (rotasi)', hint: 'Pilih bone/layer lengan untuk melambai, atau kaki dengan fase 0° dan 180° untuk siklus jalan.', amountLabel: 'Sudut (°)', defaults: { duration: 2, amount: 25, cycles: 3, phase: 0 }, props: ['rotation'] },
  { id: 'walk', label: 'Berjalan (badan)', hint: 'Badan bergeser ke kanan sambil naik-turun dan menggoyang tiap langkah. Terapkan "Ayun" pada kaki/tangan untuk gerak anggota badan.', amountLabel: 'Jarak (px)', defaults: { duration: 2, amount: 300, cycles: 4, phase: 0 }, props: ['x', 'y', 'rotation'] },
  { id: 'run', label: 'Berlari (badan)', hint: 'Seperti berjalan, lebih cepat, lebih tinggi, dan condong ke depan.', amountLabel: 'Jarak (px)', defaults: { duration: 1.5, amount: 600, cycles: 6, phase: 0 }, props: ['x', 'y', 'rotation'] },
  { id: 'jump', label: 'Lompat', hint: 'Lompatan parabola dengan squash & stretch ringan.', amountLabel: 'Tinggi (px)', defaults: { duration: 1, amount: 150, cycles: 1, phase: 0 }, props: ['y', 'scaleY'] },
  { id: 'bob', label: 'Naik-turun', hint: 'Gerak vertikal sinus.', amountLabel: 'Jarak (px)', defaults: { duration: 2, amount: 20, cycles: 2, phase: 0 }, props: ['y'] },
  { id: 'sway', label: 'Goyang kiri-kanan', hint: 'Gerak horizontal sinus.', amountLabel: 'Jarak (px)', defaults: { duration: 2, amount: 30, cycles: 2, phase: 0 }, props: ['x'] },
  { id: 'breathe', label: 'Bernapas / berdenyut', hint: 'Skala membesar-mengecil.', amountLabel: 'Skala (%)', defaults: { duration: 3, amount: 4, cycles: 2, phase: 0 }, props: ['scaleX', 'scaleY'] },
  { id: 'spin', label: 'Berputar', hint: 'Rotasi penuh linear.', amountLabel: 'Putaran (×)', defaults: { duration: 2, amount: 1, cycles: 1, phase: 0 }, props: ['rotation'] },
  { id: 'fadein', label: 'Muncul (fade in)', hint: 'Opacity 0 → nilai saat ini.', amountLabel: '—', defaults: { duration: 1, amount: 0, cycles: 1, phase: 0 }, props: ['opacity'] },
  { id: 'fadeout', label: 'Menghilang (fade out)', hint: 'Opacity → 0.', amountLabel: '—', defaults: { duration: 1, amount: 0, cycles: 1, phase: 0 }, props: ['opacity'] },
  { id: 'talk', label: 'Mulut bicara (buka-tutup)', hint: 'Pilih layer MULUT. Ini hanya animasi buka-tutup acak, BUKAN lip sync ke audio.', amountLabel: 'Bukaan min (%)', defaults: { duration: 2, amount: 25, cycles: 6, phase: 0 }, props: ['scaleY'] },
]

type Key = { f: number; v: number; e: Ease }

/** Sine wave keyed at its extrema (+ start/end) so easeInOut segments approximate a sine. */
function sineKeys(base: number, amp: number, frames: number, cycles: number, phaseDeg: number): Key[] {
  const phi = (phaseDeg * Math.PI) / 180
  const w = (2 * Math.PI * cycles) / frames
  const val = (t: number) => base + amp * Math.sin(w * t + phi)
  const keys: Key[] = [{ f: 0, v: val(0), e: 'easeOut' }]
  // extrema where w*t + phi = pi/2 + k*pi
  for (let k = -4; ; k++) {
    const t = (Math.PI / 2 + k * Math.PI - phi) / w
    if (t >= frames) break
    if (t > 0.5) keys.push({ f: Math.round(t), v: base + amp * (k % 2 === 0 ? 1 : -1), e: 'easeInOut' })
  }
  keys.push({ f: frames, v: val(frames), e: 'easeIn' })
  // drop duplicate frames (keep first), keep ascending
  return keys.filter((k, i) => i === 0 || k.f > keys[i - 1].f)
}

/** Deterministic pseudo-random in [0,1) */
const rnd = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x) }

/**
 * Bake a preset into editable keyframes on `layer` starting at `start` (mutates the layer).
 * Existing keys in the written range are replaced; keys outside it are kept.
 */
export function applyPreset(layer: Layer, id: string, p: PresetParams, start: number, fps: number, evalAtStart: Layer) {
  const frames = Math.max(2, Math.round(p.duration * fps))
  const write = (prop: AnimProp, keys: Key[]) => {
    const end = start + frames
    const kept = (layer.keyframes?.[prop] ?? []).filter((k) => k.f < start || k.f > end)
    layer.keyframes ??= {}
    layer.keyframes[prop] = [...kept, ...keys.map((k) => ({ ...k, f: start + k.f }))].sort((a, b) => a.f - b.f)
  }
  const v0 = (prop: AnimProp) => evalAtStart[prop]

  switch (id) {
    case 'swing': write('rotation', sineKeys(v0('rotation'), p.amount, frames, p.cycles, p.phase)); break
    case 'bob': write('y', sineKeys(v0('y'), p.amount, frames, p.cycles, p.phase)); break
    case 'sway': write('x', sineKeys(v0('x'), p.amount, frames, p.cycles, p.phase)); break
    case 'breathe': {
      write('scaleX', sineKeys(v0('scaleX'), (v0('scaleX') * p.amount) / 100, frames, p.cycles, p.phase))
      write('scaleY', sineKeys(v0('scaleY'), (v0('scaleY') * p.amount) / 100, frames, p.cycles, p.phase + 90))
      break
    }
    case 'walk':
    case 'run': {
      const run = id === 'run'
      write('x', [{ f: 0, v: v0('x'), e: 'linear' }, { f: frames, v: v0('x') + p.amount, e: 'linear' }])
      // two bobs per cycle (one per step); upward = negative y on screen
      const bob = run ? 22 : 10
      write('y', sineKeys(v0('y') - bob / 2, bob / 2, frames, p.cycles * 2, -90))
      write('rotation', run
        ? [{ f: 0, v: v0('rotation') + 8, e: 'linear' }, { f: frames, v: v0('rotation') + 8, e: 'linear' }]
        : sineKeys(v0('rotation'), 2, frames, p.cycles, p.phase))
      break
    }
    case 'jump': {
      const y0 = v0('y')
      const s = v0('scaleY')
      const n = Math.max(1, Math.round(p.cycles))
      const seg = Math.max(2, Math.floor(frames / n))
      const ky: Key[] = []
      const ks: Key[] = []
      for (let i = 0; i < n; i++) {
        const f0 = i * seg
        ky.push({ f: f0, v: y0, e: 'easeOut' }, { f: f0 + Math.round(seg / 2), v: y0 - p.amount, e: 'easeIn' })
        ks.push({ f: f0, v: s * 0.85, e: 'easeOut' }, { f: f0 + Math.max(1, Math.round(seg * 0.15)), v: s * 1.08, e: 'linear' }, { f: f0 + Math.round(seg * 0.85), v: s * 1.08, e: 'easeOut' })
      }
      ky.push({ f: n * seg, v: y0, e: 'linear' })
      ks.push({ f: n * seg, v: s * 0.85, e: 'easeOut' }, { f: n * seg + Math.max(2, Math.round(seg * 0.2)), v: s, e: 'linear' })
      const uniq = (k: Key[]) => k.filter((x, i) => i === 0 || x.f > k[i - 1].f)
      write('y', uniq(ky))
      write('scaleY', uniq(ks))
      break
    }
    case 'spin': write('rotation', [{ f: 0, v: v0('rotation'), e: 'linear' }, { f: frames, v: v0('rotation') + 360 * p.amount, e: 'linear' }]); break
    case 'fadein': write('opacity', [{ f: 0, v: 0, e: 'easeOut' }, { f: frames, v: Math.max(v0('opacity'), 0.01) || 1, e: 'linear' }]); break
    case 'fadeout': write('opacity', [{ f: 0, v: v0('opacity'), e: 'easeIn' }, { f: frames, v: 0, e: 'linear' }]); break
    case 'talk': {
      const s = v0('scaleY')
      const lo = Math.max(0.02, p.amount / 100)
      const step = Math.max(1, Math.round(fps / Math.max(1, p.cycles)))
      const keys: Key[] = []
      for (let f = 0, i = 0; f < frames; f += step, i++) keys.push({ f, v: s * (i % 2 === 0 ? lo : 0.5 + 0.5 * rnd(i + 1)), e: 'linear' })
      keys.push({ f: frames, v: s, e: 'linear' })
      write('scaleY', keys)
      break
    }
  }
}

// ---- AI motion plan --------------------------------------------------------

export interface PlanTrack { layer: string; name: string; prop: AnimProp; keys: { t: number; v: number; e: Ease }[] }
export interface MotionPlan { duration: number; tracks: PlanTrack[]; notes: string; dropped: string[]; model?: string }

/**
 * Bake an AI motion plan into ordinary keyframes starting at frame `start` (mutates the document).
 * Keys inside each track's written range are replaced; others are kept. Tracks for layers that no longer exist,
 * or for rotations driven by IK, are skipped. Returns how many tracks were applied / skipped.
 */
export function applyMotionPlan(doc: SceneDocument, plan: MotionPlan, start: number): { applied: number; skipped: number } {
  const fps = doc.settings.fps
  const locked = ikDriven(doc)
  let applied = 0
  let skipped = 0
  for (const t of plan.tracks) {
    const layer = doc.layers.find((l) => l.id === t.layer)
    if (!layer || (t.prop === 'rotation' && locked.has(layer.id)) || t.keys.length < 1) { skipped++; continue }
    const keys = t.keys.map((k) => ({ f: start + Math.round(k.t * fps), v: k.v, e: k.e }))
    const lo = keys[0].f
    const hi = keys[keys.length - 1].f
    const kept = (layer.keyframes?.[t.prop] ?? []).filter((k) => k.f < lo || k.f > hi)
    const merged = [...kept, ...keys].sort((a, b) => a.f - b.f)
    layer.keyframes ??= {}
    layer.keyframes[t.prop] = merged.filter((k, i) => i === 0 || k.f > merged[i - 1].f) // one key per frame
    applied++
  }
  const need = (start + Math.round(plan.duration * fps)) / fps
  if (applied && need > doc.settings.duration) doc.settings.duration = Math.min(600, Math.ceil(need * 2) / 2)
  return { applied, skipped }
}

import { applyPreset, evalLayer, ikDriven, removeSwap, setKey, setSwap } from '../anim'
import { SKELETON } from './rig'
import type { Layer, SceneDocument } from '../types'

/** One character instance in a scene: its bone layers and image pieces, found by the `rig` tag (or by the layer names for older rigs). */
export interface RigRef {
  id: string
  name: string
  bones: Record<string, Layer>
  pieces: Record<string, Layer>
}

const BONE_BY_NAME = new Map(SKELETON.map((b) => [b.name, b.key]))
const PIECE_BY_NAME: Record<string, string> = { Mulut: 'mouth', Mata: 'eyes', Alis: 'brows' }

/** role of a layer: tagged by buildRigLayers, else guessed from the "<character> · <part>" name used before tagging existed */
function roleOf(l: Layer): { id: string; role: string; name: string } | null {
  if (l.rig) return { id: l.rig.id, role: l.rig.role, name: l.name.split(' · ')[0] }
  const [who, part] = l.name.split(' · ')
  if (!part) return null
  if (l.type === 'bone' && BONE_BY_NAME.has(part)) return { id: `name:${who}`, role: `bone:${BONE_BY_NAME.get(part)}`, name: who }
  if (l.type === 'image' && PIECE_BY_NAME[part]) return { id: `name:${who}`, role: `piece:${PIECE_BY_NAME[part]}`, name: who }
  return null
}

export function findRigs(layers: Layer[]): RigRef[] {
  const out = new Map<string, RigRef>()
  for (const l of layers) {
    const r = roleOf(l)
    if (!r) continue
    const rig = out.get(r.id) ?? { id: r.id, name: r.name, bones: {}, pieces: {} }
    const [kind, key] = r.role.split(':')
    if (kind === 'bone') rig.bones[key] = l
    else if (kind === 'piece') rig.pieces[key] = l
    out.set(r.id, rig)
  }
  return [...out.values()].filter((r) => r.bones.root || r.bones.torso)
}

/** The rig that owns the selected layer (a bone or one of its pieces), or the only rig of the scene. */
export function rigOf(layers: Layer[], selectedId: string | null): RigRef | null {
  const rigs = findRigs(layers)
  if (selectedId) {
    const hit = rigs.find((r) => [...Object.values(r.bones), ...Object.values(r.pieces)].some((l) => l.id === selectedId))
    if (hit) return hit
    // a child layer attached to a bone (a prop in the hand) belongs to that rig too
    const byId = new Map(layers.map((l) => [l.id, l]))
    for (let l = byId.get(selectedId); l?.parentId; l = byId.get(l.parentId)) {
      const hit2 = rigs.find((r) => Object.values(r.bones).some((b) => b.id === l!.parentId))
      if (hit2) return hit2
    }
  }
  return rigs.length === 1 ? rigs[0] : null
}

/**
 * Rest rotation of a bone (what buildRigLayers gave it): its angle relative to its parent's. A tagged rig layer keeps
 * that as its static rotation (keyframes override it), which is also right for body kits with their own skeleton.
 */
export function restRotation(key: string, layer?: Layer): number {
  if (layer?.rig && typeof layer.rotation === 'number') return layer.rotation
  const b = SKELETON.find((x) => x.key === key)
  if (!b) return 0
  const p = b.parent ? SKELETON.find((x) => x.key === b.parent) : undefined
  return b.angle - (p?.angle ?? 0)
}

// ---- poses -------------------------------------------------------------------

export interface PoseDef { id: string; label: string; /** degrees added to each bone's rest rotation (clockwise on screen = positive) */ deltas: Record<string, number> }

export const POSES: PoseDef[] = [
  { id: 'berdiri', label: 'Berdiri', deltas: {} },
  { id: 'lambai', label: 'Melambai', deltas: { arm_r: -150, forearm_r: -10, head: 4 } },
  { id: 'pinggang', label: 'Tangan di pinggang', deltas: { arm_l: 38, forearm_l: -85, arm_r: -38, forearm_r: 85 } },
  { id: 'tunjuk', label: 'Menunjuk ke samping', deltas: { arm_r: -88, forearm_r: -4, head: -4 } },
  { id: 'berpikir', label: 'Berpikir', deltas: { arm_r: 8, forearm_r: 150, head: 8 } },
  { id: 'kaget', label: 'Kaget (tangan naik)', deltas: { arm_l: 58, forearm_l: 25, arm_r: -58, forearm_r: -25, torso: -3, head: -4 } },
  { id: 'angkat', label: 'Kedua tangan naik', deltas: { arm_l: 150, forearm_l: 8, arm_r: -150, forearm_r: -8 } },
  { id: 'miring', label: 'Kepala miring (penasaran)', deltas: { head: 12 } },
]

/** Poses the whole body at `frame`: a rotation key on every bone (rest + delta). Bones driven by IK are skipped. */
export function applyPose(doc: SceneDocument, rig: RigRef, pose: PoseDef, frame: number): number {
  const locked = ikDriven(doc)
  let n = 0
  for (const b of SKELETON) {
    const ref = rig.bones[b.key]
    const layer = ref && doc.layers.find((l) => l.id === ref.id)
    if (!layer || locked.has(layer.id)) continue
    setKey(layer, 'rotation', frame, restRotation(b.key, layer) + (pose.deltas[b.key] ?? 0), 'easeInOut')
    n++
  }
  return n
}

// ---- ready-made movements ---------------------------------------------------------

export interface MotionDef {
  id: string
  label: string
  hint: string
  duration: number
  /** distance in scene pixels for travelling motions (0 = stays in place) */
  distance: number
}

export const MOTIONS: MotionDef[] = [
  { id: 'walk', label: 'Berjalan', hint: 'Badan melaju, kaki dan tangan berayun bergantian.', duration: 3, distance: 360 },
  { id: 'run', label: 'Berlari', hint: 'Seperti berjalan tetapi lebih cepat dan condong ke depan.', duration: 2, distance: 700 },
  { id: 'wave', label: 'Melambai', hint: 'Tangan kanan naik lalu melambai, kemudian turun.', duration: 2.5, distance: 0 },
  { id: 'nod', label: 'Mengangguk / menggoyang kepala', hint: 'Kepala bergoyang pelan.', duration: 2, distance: 0 },
  { id: 'breathe', label: 'Bernapas (diam)', hint: 'Badan naik-turun pelan agar karakter terlihat hidup.', duration: 3, distance: 0 },
  { id: 'jump', label: 'Melompat', hint: 'Satu lompatan dengan tangan terangkat.', duration: 1, distance: 0 },
]

const sine = (doc: SceneDocument, ref: Layer | undefined, amount: number, cycles: number, phase: number, start: number, duration: number, around?: number) => {
  const layer = ref && doc.layers.find((l) => l.id === ref.id)
  if (!layer) return
  const at = evalLayer(layer, start)
  applyPreset(layer, 'swing', { duration, amount, cycles, phase }, start, doc.settings.fps, around === undefined ? at : { ...at, rotation: around })
}

/**
 * Bakes a movement into ordinary keyframes on the rig's bones, starting at `start` (frame).
 * `dir` = +1 moves right, -1 moves left. Existing keys inside the range are replaced.
 */
export function applyRigMotion(doc: SceneDocument, rig: RigRef, id: string, start: number, opts: { duration: number; distance: number; dir: 1 | -1 }): boolean {
  const fps = doc.settings.fps
  const { duration, distance, dir } = opts
  const frames = Math.max(2, Math.round(duration * fps))
  const get = (k: string) => (rig.bones[k] ? doc.layers.find((l) => l.id === rig.bones[k].id) : undefined)
  const root = get('root')
  const rest = (k: string) => restRotation(k, get(k))
  const key = (k: string, f: number, v: number, e: 'easeInOut' | 'linear' = 'easeInOut') => { const l = get(k); if (l && !ikDriven(doc).has(l.id)) setKey(l, 'rotation', start + f, v, e) }

  switch (id) {
    case 'walk':
    case 'run': {
      const run = id === 'run'
      const steps = Math.max(1, Math.round(duration * (run ? 3 : 1.8)))
      if (root) applyPreset(root, id, { duration, amount: distance * dir, cycles: steps, phase: 0 }, start, fps, evalLayer(root, start))
      const legA = run ? 42 : 26
      const armA = run ? 48 : 20
      sine(doc, rig.bones.leg_l, legA, steps, 0, start, duration, rest('leg_l'))
      sine(doc, rig.bones.leg_r, legA, steps, 180, start, duration, rest('leg_r'))
      sine(doc, rig.bones.shin_l, legA * 0.6, steps, 90, start, duration, rest('shin_l'))
      sine(doc, rig.bones.shin_r, legA * 0.6, steps, 270, start, duration, rest('shin_r'))
      sine(doc, rig.bones.arm_l, armA, steps, 180, start, duration, rest('arm_l'))
      sine(doc, rig.bones.arm_r, armA, steps, 0, start, duration, rest('arm_r'))
      if (run) { sine(doc, rig.bones.forearm_l, 25, steps, 180, start, duration, rest('forearm_l') + 40); sine(doc, rig.bones.forearm_r, 25, steps, 0, start, duration, rest('forearm_r') - 40) }
      break
    }
    case 'wave': {
      const up = rest('arm_r') - 140
      const ramp = Math.round(0.4 * fps)
      key('arm_r', 0, rest('arm_r'))
      key('arm_r', ramp, up)
      key('arm_r', frames - ramp, up)
      key('arm_r', frames, rest('arm_r'))
      // the forearm waves while the arm is up
      const f = get('forearm_r')
      if (f) {
        const t0 = start + ramp
        const d = (frames - 2 * ramp) / fps
        if (d > 0.2) applyPreset(f, 'swing', { duration: d, amount: 24, cycles: Math.max(2, Math.round(d * 2.2)), phase: 0 }, t0, fps, { ...evalLayer(f, t0), rotation: rest('forearm_r') })
      }
      break
    }
    case 'nod': {
      sine(doc, rig.bones.head, 7, Math.max(2, Math.round(duration * 1.2)), 0, start, duration, rest('head'))
      break
    }
    case 'breathe': {
      if (get('torso')) applyPreset(get('torso')!, 'breathe', { duration, amount: 1.5, cycles: Math.max(1, Math.round(duration / 1.5)), phase: 0 }, start, fps, evalLayer(get('torso')!, start))
      sine(doc, rig.bones.arm_l, 2.5, Math.max(1, Math.round(duration / 1.5)), 0, start, duration, rest('arm_l'))
      sine(doc, rig.bones.arm_r, 2.5, Math.max(1, Math.round(duration / 1.5)), 180, start, duration, rest('arm_r'))
      break
    }
    case 'jump': {
      if (root) applyPreset(root, 'jump', { duration, amount: 160, cycles: 1, phase: 0 }, start, fps, evalLayer(root, start))
      const half = Math.round(frames / 2)
      key('arm_l', 0, rest('arm_l')); key('arm_l', half, rest('arm_l') + 130); key('arm_l', frames, rest('arm_l'))
      key('arm_r', 0, rest('arm_r')); key('arm_r', half, rest('arm_r') - 130); key('arm_r', frames, rest('arm_r'))
      key('shin_l', 0, rest('shin_l')); key('shin_l', half, rest('shin_l') - 25); key('shin_l', frames, rest('shin_l'))
      key('shin_r', 0, rest('shin_r')); key('shin_r', half, rest('shin_r') + 25); key('shin_r', frames, rest('shin_r'))
      break
    }
    default:
      return false
  }
  return true
}

// ---- expressions ---------------------------------------------------------------------

export const EXPR_SLOTS = ['eyes', 'brows', 'mouth'] as const

/** Expression ids this character has image variants for ('default' = the images it was inserted with). */
export function rigExpressions(rig: RigRef): string[] {
  const ids = new Set<string>()
  for (const k of EXPR_SLOTS) for (const id of Object.keys(rig.pieces[k]?.expr ?? {})) ids.add(id)
  return ['default', ...[...ids].filter((x) => x !== 'default')]
}

/** Shows expression `exprId` from `frame` on: an image-swap key on the eyes, brows and mouth pieces that have that variant. */
export function applyExpression(doc: SceneDocument, rig: RigRef, exprId: string, frame: number): number {
  let n = 0
  for (const k of EXPR_SLOTS) {
    const ref = rig.pieces[k]
    const layer = ref && doc.layers.find((l) => l.id === ref.id)
    const asset = layer && (exprId === 'default' ? (layer.expr?.default ?? layer.assetId) : layer.expr?.[exprId])
    if (!layer || !asset) continue
    setSwap(layer, frame, asset)
    n++
  }
  return n
}

/** Remove the expression keys at `frame` (back to whatever came before). */
export function clearExpression(doc: SceneDocument, rig: RigRef, frame: number): void {
  for (const k of EXPR_SLOTS) {
    const ref = rig.pieces[k]
    const layer = ref && doc.layers.find((l) => l.id === ref.id)
    if (layer) removeSwap(layer, frame)
  }
}

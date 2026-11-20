import { applyPreset, assetAt, evalLayer, evalProp, removeKey, removeSwap, setKey, setSwap } from '../anim'
import type { AnimProp, CardRig, Layer, SceneDocument } from '../types'
import { CARD_ROLES } from './card'
import type { RigRef } from './rigMotion'

/**
 * Runtime of 2.5D card characters (spec v2): turns, glances, sitting, walking and running by swapping images and keying the rig.
 * The rig is root bone (feet) -> body image -> head image -> mouth / eyelid overlays. Everything here is baked into ordinary
 * step keys and image swaps, so it shows in the timeline and can be edited like any other animation.
 */

export type View = 'depan' | '34' | 'sisi'
export type Gaze = 'kanan' | 'kiri'

/** What to show from a frame on. Undefined fields are left as they are. */
export interface CardLook {
  /** body slot id: a base pose ('diam', 'tunjuk' ...) or a spec v2 slot ('duduk_sila', 'lari_sisi' ...) */
  pose?: string
  view?: View
  /** +1 = faces the viewer's right (as drawn), -1 = mirrored to face left */
  facing?: 1 | -1
  /** eyes only: look to the viewer's right / left */
  gaze?: Gaze | null
  /** scene pixels to raise the whole figure, e.g. to sit on a chair */
  lift?: number
}

export interface CardParts { root: Layer; body: Layer; head: Layer; mouth?: Layer; blink?: Layer; data?: CardRig }

export function cardParts(doc: SceneDocument, rig: RigRef): CardParts | null {
  const get = (ref?: Layer) => (ref ? doc.layers.find((l) => l.id === ref.id) : undefined)
  const root = get(rig.bones.root)
  const body = get(rig.pieces[CARD_ROLES.body])
  const head = get(rig.pieces[CARD_ROLES.head])
  if (!root || !body || !head) return null
  return { root, body, head, mouth: get(rig.pieces[CARD_ROLES.mouth]), blink: get(rig.pieces[CARD_ROLES.blink]), data: root.rig?.card }
}

export const isCardRig = (rig: RigRef) => !!rig.pieces[CARD_ROLES.body] && !!rig.pieces[CARD_ROLES.head]

const slotsOf = (l: Layer) => Object.keys(l.expr ?? {}).filter((k) => k !== 'default')
const HIDDEN = 0.001   // scale of an overlay that must not show (never exactly 0: the editor inverts matrices)

/**
 * A step key: the value changes at `f` and holds. Frames before the first key take its value, so when the track had no earlier key
 * the state before `f` is first pinned with a key at frame 0.
 */
export function stepKey(layer: Layer, prop: AnimProp, f: number, v: number): void {
  const earlier = layer.keyframes?.[prop]?.some((k) => k.f < f)
  const before = f > 0 && !earlier ? evalProp(layer, prop, f - 1) : null
  setKey(layer, prop, f, v, 'step')
  if (before !== null && !layer.keyframes![prop]!.some((k) => k.f === 0)) setKey(layer, prop, 0, before, 'step')
}

/** The base expression ('netral', 'senang' ...) the head shows at `frame`, without any view suffix. */
export function headExpressionAt(parts: CardParts, frame: number): string {
  const asset = assetAt(parts.head, frame)
  const key = slotsOf(parts.head).find((k) => parts.head.expr![k] === asset)
  if (!key || key.startsWith('lirik_')) return 'netral'
  return key.replace(/_(34|sisi)(_kiri)?$/, '')
}

/** What the card has: which views and sitting/action poses its images cover. */
export function cardCapabilities(parts: CardParts) {
  const body = new Set(slotsOf(parts.body))
  const head = new Set(slotsOf(parts.head))
  const views = (['34', 'sisi'] as const).filter((v) => body.has(`diam_${v}`) || head.has(`netral_${v}`))
  return {
    bodyViews: (['34', 'sisi'] as const).filter((v) => body.has(`diam_${v}`)),
    headViews: (['34', 'sisi'] as const).filter((v) => head.has(`netral_${v}`)),
    views,
    gaze: head.has('lirik_kanan') && head.has('lirik_kiri'),
    sit: slotsOf(parts.body).filter((k) => k.startsWith('duduk_') && !/_(34|sisi)$/.test(k)),
    run: body.has('lari_sisi'),
    run2: body.has('lari_sisi_2'),
    jump: body.has('lompat'),
    /** walking images (side / 3/4); the walk uses them instead of the standing side view */
    walk: (['jalan_sisi', 'jalan_34'] as const).find((k) => body.has(k)) ?? null,
    /** the card has images drawn facing left (otherwise left = a mirrored copy of the right-facing ones) */
    leftImages: slotsOf(parts.body).some((k) => k.endsWith('_kiri')) || slotsOf(parts.head).some((k) => /_(34|sisi)_kiri$/.test(k)),
    mirror: parts.data?.mirror !== false,
    basePoses: slotsOf(parts.body).filter((k) => !/_(34|sisi|belakang)(_kiri)?$/.test(k) && !k.startsWith('duduk_') && !k.startsWith('lari_') && !k.startsWith('jalan_') && k !== 'lompat'),
  }
}

/** The body slot to use for a pose seen from `view`: its own view variant, else the standing pose of that view, else the pose itself. */
export function bodySlotFor(parts: CardParts, pose: string, view: View): { slot: string; exact: boolean } | null {
  const has = (k: string) => !!parts.body.expr?.[k]
  if (view === 'depan') return has(pose) ? { slot: pose, exact: true } : null
  for (const c of [`${pose}_${view}`]) if (has(c)) return { slot: c, exact: true }
  if (has(`diam_${view}`)) return { slot: `diam_${view}`, exact: false }
  return has(pose) ? { slot: pose, exact: false } : null
}

/**
 * The head image for `expr` seen from `view` (or with the eyes to one side). `left`: the figure faces left, so a head drawn facing left
 * (`<expr>_<view>_kiri`) is preferred over the right-facing one (which the caller then mirrors).
 */
export function headKeyFor(parts: CardParts, expr: string, view: View, gaze?: Gaze | null, left = false): string | null {
  const has = (k: string) => !!parts.head.expr?.[k]
  if (gaze) return has(`lirik_${gaze}`) ? `lirik_${gaze}` : null
  if (view === 'depan') return has(expr) ? expr : has('default') ? 'default' : null
  const keys = [`${expr}_${view}`, `netral_${view}`]
  return (left ? [...keys.map((k) => `${k}_kiri`), ...keys] : keys).find(has) ?? null
}

/** Body slot drawn facing left for `slot`, when the card has one. */
const leftBody = (p: CardParts, slot: string): string | null => (p.body.expr?.[`${slot}_kiri`] ? `${slot}_kiri` : null)

export interface LookResult { applied: string[]; notes: string[] }

/** Removes everything a look set at exactly `frame` (swaps and step keys), so the previous look carries on. */
export function clearCardLook(doc: SceneDocument, rig: RigRef, frame: number): void {
  const p = cardParts(doc, rig)
  if (!p) return
  removeSwap(p.body, frame)
  removeSwap(p.head, frame)
  const keys: [Layer | undefined, AnimProp[]][] = [[p.head, ['x', 'y', 'scaleX', ...(p.data?.rot ? ['rotation' as const] : [])]], [p.body, ['y']], [p.root, ['scaleX']], [p.mouth, ['scaleX']], [p.blink, ['scaleX']]]
  for (const [l, props] of keys) if (l) for (const prop of props) removeKey(l, prop, frame)
}

/** Shows `look` from `frame` on. Returns null for a character that is not a card. */
export function applyCardLook(doc: SceneDocument, rig: RigRef, look: CardLook, frame: number): LookResult | null {
  const parts = cardParts(doc, rig)
  if (!parts) return null
  const out: LookResult = { applied: [], notes: [] }
  const view = look.view ?? 'depan'
  const touchBody = look.pose !== undefined || look.view !== undefined
  let bodyKey = ''
  let bodyKiri = false     // the body shown is a picture drawn facing left, so the figure is not mirrored

  if (touchBody) {
    const r = bodySlotFor(parts, look.pose ?? 'diam', view)
    if (r) {
      const lk = look.facing === -1 ? leftBody(parts, r.slot) : null
      bodyKey = lk ?? r.slot
      bodyKiri = !!lk
      setSwap(parts.body, frame, parts.body.expr![bodyKey])
      out.applied.push(`badan ${bodyKey}`)
      if (!r.exact) out.notes.push(`pose "${look.pose ?? 'diam'}" belum punya tampak ${view}; dipakai "${r.slot}"`)
    } else out.notes.push(`badan untuk "${look.pose ?? 'diam'}" tampak ${view} tidak ada`)
  }

  // head image and its position
  const expr = headExpressionAt(parts, frame)
  const key = headKeyFor(parts, expr, view, look.gaze, bodyKiri)
  const headKiri = !!key?.endsWith('_kiri')
  if (look.gaze !== undefined || touchBody) {
    if (key) { setSwap(parts.head, frame, parts.head.expr![key]); out.applied.push(`kepala ${key}`) }
    else if (look.gaze) out.notes.push('karakter ini belum punya gambar melirik')
    else if (view !== 'depan') out.notes.push(`kepala tampak ${view} belum ada; kepala depan dipakai`)
  }
  if (touchBody) {
    const pos = (bodyKey && parts.data?.head[bodyKey]) || parts.data?.head0
    if (pos) { stepKey(parts.head, 'x', frame, pos[0]); stepKey(parts.head, 'y', frame, pos[1]) }
    tiltKey(parts, bodyKey, frame)
    stepKey(parts.body, 'y', frame, parts.body.y - (look.lift ?? 0))
    // the base mouth and eyelid overlays were drawn for the front view only
    for (const o of [parts.mouth, parts.blink]) if (o) stepKey(o, 'scaleX', frame, view === 'depan' ? 1 : HIDDEN)
  }

  if (look.facing !== undefined) {
    if (look.facing === -1 && bodyKiri) {
      // truly left-facing pictures: no mirroring; a head that is not drawn facing left is mirrored on its own
      stepKey(parts.root, 'scaleX', frame, 1)
      stepKey(parts.head, 'scaleX', frame, headKiri ? 1 : -1)
      out.applied.push('menghadap kiri (gambar kiri)')
    } else if (look.facing === -1 && parts.data?.mirror === false) out.notes.push('desain karakter ini asimetris (mirror_ok = false): tidak dicerminkan')
    else {
      stepKey(parts.root, 'scaleX', frame, look.facing)
      if (cardCapabilities(parts).leftImages) stepKey(parts.head, 'scaleX', frame, 1)   // undo a head mirrored on its own earlier
      out.applied.push(look.facing === -1 ? 'menghadap kiri' : 'menghadap kanan')
    }
  }
  return out
}

/**
 * Turns the head to the side and (optionally) back: front -> 3/4 -> side, held `hold` seconds. Only the head image changes; the head layer is
 * mirrored to look left. Returns the frame where the animation ends, or null when the card has no side head images.
 */
export function applyCardTurn(doc: SceneDocument, rig: RigRef, dir: 1 | -1, start: number, opts: { hold: number; back: boolean }): number | null {
  const parts = cardParts(doc, rig)
  if (!parts) return null
  const cap = cardCapabilities(parts)
  if (!cap.headViews.length) return null
  const fps = doc.settings.fps
  const expr = headExpressionAt(parts, start)
  const left = dir === -1
  const key = (v: View) => headKeyFor(parts, expr, v, undefined, left)
  // heads drawn facing left are used as they are; the others (right-facing) are mirrored for a turn to the left
  const drawnLeft = (v: View) => !!key(v)?.endsWith('_kiri')
  const anyLeft = left && (['34', 'sisi'] as const).some(drawnLeft)
  if (left && parts.data?.mirror === false && !anyLeft) return null
  const show = (f: number, v: View) => {
    const k = key(v)
    if (k) setSwap(parts.head, f, parts.head.expr![k])
    if (anyLeft) stepKey(parts.head, 'scaleX', f, k?.endsWith('_kiri') ? 1 : -1)
    for (const o of [parts.mouth, parts.blink]) if (o) stepKey(o, 'scaleX', f, v === 'depan' ? 1 : HIDDEN)
  }
  const step = Math.max(2, Math.round(fps / 8))
  const keys: View[] = cap.headViews.includes('34') && cap.headViews.includes('sisi') ? ['34', 'sisi'] : [cap.headViews[0]]
  let f = start
  keys.forEach((v) => { show(f, v); f += step })
  if (!anyLeft) stepKey(parts.head, 'scaleX', start, dir)
  const holdEnd = start + step * (keys.length - 1) + Math.max(1, Math.round(opts.hold * fps))
  if (!opts.back) return holdEnd
  let g = holdEnd
  for (const v of [...keys].reverse().slice(1)) { show(g, v); g += step }
  show(g, 'depan')
  stepKey(parts.head, 'scaleX', g, 1)
  return g
}

// ---- walking, running, jumping ----------------------------------------------------------------

/**
 * Head tilt of the body image `slot` (degrees, around the neck; see CardRig.rot). Cards without any tilted slot get no rotation keys at all,
 * so their animation stays exactly as it was.
 */
function tiltKey(p: CardParts, slot: string, f: number): void {
  if (p.data?.rot) stepKey(p.head, 'rotation', f, (slot && p.data.rot[slot]) || 0)
}

interface Snapshot { body?: number | null; head?: number | null; headX: number; headY: number; headRot: number; bodyY: number; flip: number; headFlip: number; mouth: number; blink: number }

const snapshot = (p: CardParts, f: number): Snapshot => ({
  body: assetAt(p.body, f), head: assetAt(p.head, f),
  headX: evalProp(p.head, 'x', f), headY: evalProp(p.head, 'y', f), headRot: evalProp(p.head, 'rotation', f), bodyY: evalProp(p.body, 'y', f),
  flip: evalProp(p.root, 'scaleX', f), headFlip: evalProp(p.head, 'scaleX', f),
  mouth: p.mouth ? evalProp(p.mouth, 'scaleX', f) : 1, blink: p.blink ? evalProp(p.blink, 'scaleX', f) : 1,
})

function restore(p: CardParts, s: Snapshot, f: number): void {
  if (s.body != null) setSwap(p.body, f, s.body)
  if (s.head != null) setSwap(p.head, f, s.head)
  stepKey(p.head, 'x', f, s.headX); stepKey(p.head, 'y', f, s.headY); stepKey(p.body, 'y', f, s.bodyY)
  if (p.data?.rot) stepKey(p.head, 'rotation', f, s.headRot)
  stepKey(p.root, 'scaleX', f, s.flip); stepKey(p.head, 'scaleX', f, s.headFlip)
  if (p.mouth) stepKey(p.mouth, 'scaleX', f, s.mouth)
  if (p.blink) stepKey(p.blink, 'scaleX', f, s.blink)
}

const headPos = (p: CardParts, slot: string): [number, number] | undefined => p.data?.head[slot] ?? p.data?.head0

/** Puts body slot `slot` (and, from `view`, the matching head) on screen at `f`, with the head where that slot needs it. */
function showPose(p: CardParts, slot: string, view: View, f: number, expr: string): void {
  const asset = p.body.expr?.[slot]
  if (asset) setSwap(p.body, f, asset)
  const native = slot.endsWith('_kiri')       // a picture drawn facing left: the figure is not mirrored
  const hk = headKeyFor(p, expr, view, undefined, native)
  if (hk) setSwap(p.head, f, p.head.expr![hk])
  if (native) stepKey(p.head, 'scaleX', f, hk?.endsWith('_kiri') ? 1 : -1)
  const pos = headPos(p, slot)
  if (pos) { stepKey(p.head, 'x', f, pos[0]); stepKey(p.head, 'y', f, pos[1]) }
  tiltKey(p, slot, f)
  for (const o of [p.mouth, p.blink]) if (o) stepKey(o, 'scaleX', f, view === 'depan' ? 1 : HIDDEN)
}

/**
 * Card versions of the ready-made movements. Walking and running use the side-view images when the card has them (and face the way
 * they go), jumping uses the "both hands up" pose, nodding tilts the head, breathing bobs the whole figure.
 * Returns false for movements a card has no use for (the caller falls back to the bone motions).
 */
export function applyCardMotion(doc: SceneDocument, rig: RigRef, id: string, start: number, opts: { duration: number; distance: number; dir: 1 | -1 }): boolean {
  const p = cardParts(doc, rig)
  if (!p) return false
  const fps = doc.settings.fps
  const { duration, distance, dir } = opts
  const frames = Math.max(2, Math.round(duration * fps))
  const end = start + frames
  const cap = cardCapabilities(p)
  const expr = headExpressionAt(p, start)
  const snap = snapshot(p, start)

  switch (id) {
    case 'walk':
    case 'run': {
      const run = id === 'run'
      const steps = Math.max(1, Math.round(duration * (run ? 3 : 1.8)))
      const r0 = evalLayer(p.root, start).rotation
      applyPreset(p.root, id, { duration, amount: distance * dir, cycles: steps, phase: 0 }, start, fps, evalLayer(p.root, start))
      // walking uses the walking images (side or 3/4) when the card has them, else the standing side view
      const base = run ? (cap.run ? 'lari_sisi' : null) : (cap.walk ?? (cap.bodyViews.includes('sisi') ? 'diam_sisi' : null))
      const left = dir === -1
      const slot = base && left ? (leftBody(p, base) ?? base) : base      // drawn facing left when the card has it
      const native = !!slot && slot.endsWith('_kiri')
      if (!slot || (left && !cap.mirror && !native)) return true      // no side images: the root still travels, bobbing, like before
      const view: View = slot.includes('_34') ? '34' : 'sisi'
      // the preset leans a runner clockwise (to the right); a figure running left leans the other way
      if (run && left) for (const kf of p.root.keyframes?.rotation ?? []) if (kf.f >= start && kf.f <= end) kf.v = 2 * r0 - kf.v
      stepKey(p.root, 'scaleX', start, native ? 1 : dir)
      showPose(p, slot, view, start, expr)
      const second = (run ? 'lari_sisi_2' : base === 'jalan_sisi' ? 'jalan_sisi_2' : base === 'jalan_34' ? 'jalan_34_2' : null)
      const secondSlot = second && (left ? (leftBody(p, second) ?? (native ? null : second)) : second)
      if (second && secondSlot && p.body.expr?.[secondSlot]) {
        for (let i = 1; i < steps; i++) showPose(p, i % 2 ? secondSlot : slot, view, start + Math.round((i * frames) / steps), expr)
      }
      restore(p, snap, end)
      return true
    }
    case 'jump': {
      const pose = cap.jump ? 'lompat' : p.body.expr?.angkat ? 'angkat' : null
      applyPreset(p.root, 'jump', { duration, amount: 160, cycles: 1, phase: 0 }, start, fps, evalLayer(p.root, start))
      if (pose) { showPose(p, pose, 'depan', start + Math.round(frames * 0.12), expr); restore(p, snap, start + Math.round(frames * 0.9)) }
      return true
    }
    case 'nod': {
      const at = evalLayer(p.head, start)
      applyPreset(p.head, 'swing', { duration, amount: 4, cycles: Math.max(2, Math.round(duration * 1.2)), phase: 0 }, start, fps, at)
      return true
    }
    case 'breathe': {
      applyPreset(p.root, 'bob', { duration, amount: 2, cycles: Math.max(1, Math.round(duration / 1.5)), phase: 0 }, start, fps, evalLayer(p.root, start))
      return true
    }
    default:
      return false
  }
}

import { SKELETON, type BoneSpec, type Box, type Pt } from './rig'
import type { CharacterConfig, Facing } from './types'

/**
 * The skeleton of a Character Builder character, stored WITH the character (config.rig, one per facing): the joints the user placed on
 * the Builder canvas. "Sisipkan + bone" builds the bones from them and cuts every PART on its own at those joints (the arm part at the
 * elbow and wrist, the legs at the knees...), instead of cutting the composed figure along fixed lines.
 */
export const JOINTS = ['neck', 'shoulder_l', 'elbow_l', 'wrist_l', 'shoulder_r', 'elbow_r', 'wrist_r', 'hip', 'hip_l', 'knee_l', 'ankle_l', 'hip_r', 'knee_r', 'ankle_r'] as const
export type JointKey = (typeof JOINTS)[number]
export type Joints = Record<JointKey, Pt>

export interface CharRig {
  joints: Joints
  /** half width (canvas units) of the band around an arm that is cut out of the clothes as its sleeve; default ARM_HALF_WIDTH */
  armWidth?: number
  /** the bottom is a skirt: one piece on the hips instead of being cut into the legs (default: guessed from its name) */
  skirt?: boolean
}

export const ARM_HALF_WIDTH = 24

export const JOINT_LABEL: Record<JointKey, string> = {
  neck: 'Leher', shoulder_l: 'Bahu kiri', elbow_l: 'Siku kiri', wrist_l: 'Pergelangan kiri', shoulder_r: 'Bahu kanan', elbow_r: 'Siku kanan', wrist_r: 'Pergelangan kanan',
  hip: 'Pinggul', hip_l: 'Pangkal paha kiri', knee_l: 'Lutut kiri', ankle_l: 'Pergelangan kaki kiri', hip_r: 'Pangkal paha kanan', knee_r: 'Lutut kanan', ankle_r: 'Pergelangan kaki kanan',
}

/** Bones between joints (for drawing the skeleton on the canvas). */
export const LINKS: [JointKey, JointKey][] = [
  ['hip', 'neck'], ['neck', 'shoulder_l'], ['shoulder_l', 'elbow_l'], ['elbow_l', 'wrist_l'], ['neck', 'shoulder_r'], ['shoulder_r', 'elbow_r'], ['elbow_r', 'wrist_r'],
  ['hip', 'hip_l'], ['hip_l', 'knee_l'], ['knee_l', 'ankle_l'], ['hip', 'hip_r'], ['hip_r', 'knee_r'], ['knee_r', 'ankle_r'],
]

const j = (key: string) => SKELETON.find((b) => b.key === key)!.joint
/** The joints of the default skeleton (anime-v1 proportions). */
export const DEFAULT_JOINTS: Joints = {
  neck: j('head'), hip: j('root'),
  shoulder_l: j('arm_l'), elbow_l: j('forearm_l'), wrist_l: j('hand_l'), shoulder_r: j('arm_r'), elbow_r: j('forearm_r'), wrist_r: j('hand_r'),
  hip_l: j('leg_l'), knee_l: j('shin_l'), ankle_l: { x: 172, y: 786 }, hip_r: j('leg_r'), knee_r: j('shin_r'), ankle_r: { x: 228, y: 786 },
}

/** The rig stored for the direction the character faces, if the user set one. */
export const rigOf = (config: CharacterConfig, facing: Facing = config.facing ?? 'front'): CharRig | undefined => config.rig?.[facing]

/**
 * First guess of the joints from where the parts are (visible boxes in canvas units, by slot): the arm parts give shoulder, elbow and
 * wrist; the face the neck; the bottom the hips; the shoes the ankles. Whatever is missing keeps the default skeleton.
 */
export type HitTest = (slot: string, p: Pt) => boolean

/** The pixels of `slot` along the row at height y: first and last x (canvas units), or null. */
function rowSpan(hit: HitTest, slot: string, box: Box, y: number): [number, number] | null {
  let a = Infinity, b = -Infinity
  for (let x = Math.floor(box.x0); x <= Math.ceil(box.x1); x++) if (hit(slot, { x, y })) { if (x < a) a = x; if (x > b) b = x }
  return a <= b ? [a, b] : null
}

export function guessJoints(boxes: Record<string, Box | undefined>, hit?: HitTest): Joints {
  const g: Joints = structuredClone(DEFAULT_JOINTS)
  const body = boxes.top ?? boxes.torso ?? boxes.body
  const cx = body ? (body.x0 + body.x1) / 2 : 200
  if (boxes.face) g.neck = { x: (boxes.face.x0 + boxes.face.x1) / 2, y: boxes.face.y1 - 0.04 * (boxes.face.y1 - boxes.face.y0) }
  for (const side of ['l', 'r'] as const) {
    const a = boxes[`arm_${side}`]
    if (!a) continue
    const h = a.y1 - a.y0, x = (a.x0 + a.x1) / 2
    const ys = { s: a.y0 + Math.min(14, 0.05 * h), e: a.y0 + 0.44 * h, w: a.y0 + 0.8 * h }
    g[`shoulder_${side}`] = { x, y: ys.s }
    g[`elbow_${side}`] = { x, y: ys.e }
    g[`wrist_${side}`] = { x, y: ys.w }
    if (hit) {
      // the middle of the arm at the elbow and the wrist; the shoulder half an arm's width in from the OUTER edge (an arm part may start at the
      // collarbone, under the shirt, so the middle of its top row is not the shoulder)
      const at = (y: number) => rowSpan(hit, `arm_${side}`, a, y)
      const e = at(ys.e), w = at(ys.w), top = at(a.y0 + 0.1 * h)
      if (e) g[`elbow_${side}`] = { x: (e[0] + e[1]) / 2, y: ys.e }
      if (w) g[`wrist_${side}`] = { x: (w[0] + w[1]) / 2, y: ys.w }
      if (top && e) {
        const half = Math.min(e[1] - e[0], top[1] - top[0]) / 2
        const outerLeft = (top[0] + top[1]) / 2 < cx // the arm is on the left of the body
        g[`shoulder_${side}`] = { x: outerLeft ? top[0] + half : top[1] - half, y: a.y0 + 0.1 * h }
      }
    }
  }
  const shoeL = boxes.shoes, shoeR = boxes.shoes_r
  if (shoeL && shoeR) {
    g.ankle_l = { x: (shoeL.x0 + shoeL.x1) / 2, y: shoeL.y0 + 0.3 * (shoeL.y1 - shoeL.y0) }
    g.ankle_r = { x: (shoeR.x0 + shoeR.x1) / 2, y: shoeR.y0 + 0.3 * (shoeR.y1 - shoeR.y0) }
  } else if (shoeL) { // a pair in one image: one foot in each half
    const y = shoeL.y0 + 0.3 * (shoeL.y1 - shoeL.y0), w = shoeL.x1 - shoeL.x0
    g.ankle_l = { x: shoeL.x0 + 0.25 * w, y }
    g.ankle_r = { x: shoeL.x0 + 0.75 * w, y }
  }
  const hipY = boxes.bottom ? boxes.bottom.y0 + 12 : g.hip.y
  g.hip = { x: cx, y: hipY }
  for (const side of ['l', 'r'] as const) {
    const ankle = g[`ankle_${side}`]
    const hx = Math.min(cx - 8, Math.max(cx - 60, side === 'l' ? ankle.x : 2 * cx - ankle.x))
    g[`hip_${side}`] = { x: side === 'l' ? hx : 2 * cx - hx, y: hipY }
    g[`knee_${side}`] = { x: (g[`hip_${side}`].x + ankle.x) / 2, y: hipY + 0.456 * (ankle.y - hipY) }
  }
  return g
}

const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y })
const len = (v: Pt) => Math.hypot(v.x, v.y)
const unit = (v: Pt): Pt => { const l = len(v) || 1; return { x: v.x / l, y: v.y / l } }
const deg = (v: Pt) => (Math.atan2(v.y, v.x) * 180) / Math.PI
const r1 = (n: number) => Math.round(n * 10) / 10

/** The bones of the rig (same keys, parents and drawing order as the default skeleton), placed on the user's joints. */
export function bonesFromJoints(J: Joints): BoneSpec[] {
  const bone = (key: string, from: Pt, to: Pt | null, fallbackAngle = 90, fallbackLen = 50): BoneSpec => {
    const base = SKELETON.find((b) => b.key === key)!
    const v = to ? sub(to, from) : null
    return { ...base, joint: { x: r1(from.x), y: r1(from.y) }, angle: v && len(v) > 1 ? r1(deg(v)) : fallbackAngle, length: v && len(v) > 1 ? r1(len(v)) : fallbackLen }
  }
  const handDir = (s: 'l' | 'r') => deg(sub(J[`wrist_${s}`], J[`elbow_${s}`]))
  return [
    bone('root', J.hip, null, -90, 34),
    bone('leg_l', J.hip_l, J.knee_l), bone('shin_l', J.knee_l, J.ankle_l),
    bone('leg_r', J.hip_r, J.knee_r), bone('shin_r', J.knee_r, J.ankle_r),
    bone('torso', J.hip, J.neck, -90, 230),
    bone('head', J.neck, null, -90, 150),
    bone('arm_l', J.shoulder_l, J.elbow_l), bone('forearm_l', J.elbow_l, J.wrist_l), { ...bone('hand_l', J.wrist_l, null), angle: r1(handDir('l')) },
    bone('arm_r', J.shoulder_r, J.elbow_r), bone('forearm_r', J.elbow_r, J.wrist_r), { ...bone('hand_r', J.wrist_r, null), angle: r1(handDir('r')) },
  ]
}

// ---------------------------------------------------------------------------------------------------- cutting each part at the joints
export type Poly = Pt[]
/** A piece's view of one slot: drawn inside EVERY entry of `within` (each entry = a union of polygons), then `minus` is erased. */
export interface PieceLayer { slot: string; within?: Poly[][]; minus?: Poly[] }
export interface PartPiece { key: string; name: string; bone: string; order: number; layers: PieceLayer[] }

const BIG = 4000
/** Everything on the side of the line through `p` that `n` points to. */
export function halfPlane(p: Pt, n: Pt): Poly {
  const u = unit(n), t = { x: -u.y, y: u.x }
  return [
    { x: p.x - t.x * BIG, y: p.y - t.y * BIG }, { x: p.x + t.x * BIG, y: p.y + t.y * BIG },
    { x: p.x + t.x * BIG + u.x * BIG, y: p.y + t.y * BIG + u.y * BIG }, { x: p.x - t.x * BIG + u.x * BIG, y: p.y - t.y * BIG + u.y * BIG },
  ]
}
/** A band of half width `r` along a -> b, running on past b by `beyond` (the hand, the cuff). */
export function band(a: Pt, b: Pt, r: number, beyond = 0): Poly {
  const u = unit(sub(b, a)), t = { x: -u.y * r, y: u.x * r }
  const e = { x: b.x + u.x * beyond, y: b.y + u.y * beyond }
  return [{ x: a.x + t.x, y: a.y + t.y }, { x: e.x + t.x, y: e.y + t.y }, { x: e.x - t.x, y: e.y - t.y }, { x: a.x - t.x, y: a.y - t.y }]
}
/** The part of a convex polygon on the side of the line through `p` that `n` points to (Sutherland-Hodgman, one edge). */
export function clipConvex(poly: Poly, p: Pt, n: Pt): Poly {
  const d = (q: Pt) => (q.x - p.x) * n.x + (q.y - p.y) * n.y
  const out: Poly = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], da = d(a), db = d(b)
    if (da >= 0) out.push(a)
    if (da >= 0 !== db >= 0) { const t = da / (da - db); out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }) }
  }
  return out
}

/** Is `p` inside a convex polygon (any winding)? */
export function insideConvex(poly: Poly, p: Pt): boolean {
  let sign = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length]
    const c = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
    if (Math.abs(c) < 1e-9) continue
    if (sign === 0) sign = Math.sign(c)
    else if (Math.sign(c) !== sign) return false
  }
  return true
}

const HEAD_SLOTS = ['face', 'hair_front', 'hijab', 'eyes', 'brows', 'mouth', 'glasses', 'hat', 'headphone']
const BODY_SLOTS = ['body', 'torso', 'top', 'bag', 'accessory']

export interface PartPlanInput {
  /** slots of the character, back to front */
  slots: string[]
  joints: Joints
  armWidth?: number
  skirt: boolean
  zOf: (slot: string) => number
  labelOf: (slot: string) => string
  /** split parts (long hair): also a copy behind the torso */
  splits?: string[]
  /** with a skirt: the bottom of the top (the bare body under the skirt stops a little below it) */
  hemY?: number
}

/**
 * The pieces of a character cut PART BY PART at its joints:
 *  - head parts whole on the head bone; the back hair whole behind the torso
 *  - an arm part cut at its elbow and wrist (across the arm, so a bent arm is cut right too): upper arm, forearm, hand
 *  - a side without an arm part: the arm is cut out of the clothes/body along the arm (a band around shoulder -> wrist)
 *  - a top stacked over an arm part gives the same band as its sleeve, hung on the arm bones in front of the arm
 *  - the bare body and trousers cut at the hips into the legs, and at the knees; each shoe part on its own shin
 *  - a skirt whole on the hips
 */
export function planPartPieces(inp: PartPlanInput): PartPiece[] {
  const { slots, joints: J, skirt, zOf, labelOf } = inp
  const r = inp.armWidth ?? ARM_HALF_WIDTH
  const has = (s: string) => slots.includes(s)
  const out: PartPiece[] = []
  if (has('hair_back')) out.push({ key: 'hair_back', name: labelOf('hair_back'), bone: 'torso', order: 0, layers: [{ slot: 'hair_back' }] })
  for (const s of HEAD_SLOTS.filter(has)) out.push({ key: s, name: labelOf(s), bone: 'head', order: 100 + zOf(s), layers: [{ slot: s }] })
  for (const s of (inp.splits ?? []).filter(has)) out.push({ key: `${s}_back`, name: `${labelOf(s)} (belakang)`, bone: 'torso', order: 0, layers: [{ slot: `${s}:back` }] })

  // the line of the hips: the torso is above it, the legs below; "up" is the direction of the torso
  const up = unit(sub(J.neck, J.hip))
  const above = (p: Pt) => halfPlane(p, up)
  const below = (p: Pt) => halfPlane(p, { x: -up.x, y: -up.y })
  const along = (p: Pt, d: number): Pt => ({ x: p.x + up.x * d, y: p.y + up.y * d })
  const waist = along(J.hip, 10) // trousers: the waistband belongs to the torso
  const skinEnd = skirt && inp.hemY !== undefined && has('top') ? (() => { const y = Math.min(J.hip.y, Math.ceil(inp.hemY) + 6); return { x: J.hip.x, y: Math.max(J.neck.y, y) } })() : J.hip

  // arms
  const body = BODY_SLOTS.filter(has).sort((a, b) => zOf(a) - zOf(b))
  const sleeves: Poly[] = [] // cut out of the top only
  const armBands: Poly[] = [] // sides without an arm part: cut out of the top, the torso and the bare body
  for (const side of ['l', 'r'] as const) {
    const S = J[`shoulder_${side}`], E = J[`elbow_${side}`], W = J[`wrist_${side}`]
    const dU = unit(sub(E, S)), dL = unit(sub(W, E)), nE = unit({ x: dU.x + dL.x, y: dU.y + dL.y })
    const upper = halfPlane(E, { x: -nE.x, y: -nE.y }), lower = [halfPlane(E, nE), halfPlane(W, { x: -dL.x, y: -dL.y })], hand = halfPlane(W, dL)
    const label = side === 'l' ? 'kiri' : 'kanan', slot = `arm_${side}`
    // the arm band: from a little above the shoulder (the shoulder cap) down past the wrist (the hand)
    const strip = band({ x: S.x - dU.x * r * 0.5, y: S.y - dU.y * r * 0.5 }, W, r, r * 3)
    // what the torso gives up: only the band OUTSIDE the side of the body (the line down from the shoulder, along the torso). The inner half
    // stays in the torso as well, so a raised arm does not leave a hole in the shirt where its sleeve was.
    const outward = { x: -up.y, y: up.x }
    const out_ = (S.x - J.neck.x) * outward.x + (S.y - J.neck.y) * outward.y >= 0 ? outward : { x: -outward.x, y: -outward.y }
    const cutOut = clipConvex(strip, S, out_)
    // what the sleeve takes from the clothes: the same side, a little over the line (the seam hides under the sleeve), not the chest
    const sideOf = halfPlane({ x: S.x - out_.x * 6, y: S.y - out_.y * 6 }, out_)
    if (has(slot)) {
      const order = zOf(slot) > zOf('top') ? 20 : -1
      out.push({ key: `arm_${side}_up`, name: `Lengan atas ${label}`, bone: `arm_${side}`, order, layers: [{ slot, within: [[upper]] }] })
      out.push({ key: `arm_${side}_low`, name: `Lengan bawah ${label}`, bone: `forearm_${side}`, order, layers: [{ slot, within: [[lower[0]], [lower[1]]] }] })
      out.push({ key: `hand_${side}`, name: `Tangan ${label}`, bone: `hand_${side}`, order, layers: [{ slot, within: [[hand]] }] })
      if (has('top') && zOf('top') > zOf(slot)) { // the sleeve of the top over this arm
        if (cutOut.length > 2) sleeves.push(cutOut)
        out.push({ key: `sleeve_${side}_up`, name: `Lengan baju atas ${label}`, bone: `arm_${side}`, order: 10, layers: [{ slot: 'top', within: [[strip], [sideOf], [upper]] }] })
        out.push({ key: `sleeve_${side}_low`, name: `Lengan baju bawah ${label}`, bone: `forearm_${side}`, order: 10, layers: [{ slot: 'top', within: [[strip], [sideOf], [halfPlane(E, nE)]] }] })
      }
    } else if (body.length) { // no arm part: the arm is in the clothes / body drawing
      if (cutOut.length > 2) armBands.push(cutOut)
      const armOf = (s: string, extra: Poly[][]): PieceLayer => ({ slot: s, within: [[strip], [sideOf], ...extra, ...(s === 'body' ? [[above(skinEnd)]] : [])] })
      out.push({ key: `arm_${side}_up`, name: `Lengan atas ${label}`, bone: `arm_${side}`, order: 0, layers: body.map((s) => armOf(s, [[upper]])) })
      out.push({ key: `arm_${side}_low`, name: `Lengan bawah ${label}`, bone: `forearm_${side}`, order: 0, layers: body.map((s) => armOf(s, [[lower[0]], [lower[1]]])) })
      out.push({ key: `hand_${side}`, name: `Tangan ${label}`, bone: `hand_${side}`, order: 0, layers: body.map((s) => armOf(s, [[hand]])) })
    }
  }

  // torso: the body parts minus the arm bands; the bare body above the hips (skirt: above the hem); trousers' waistband
  const trousers = !skirt && has('bottom')
  const torsoSlots = (trousers ? [...body, 'bottom'] : body).sort((a, b) => zOf(a) - zOf(b))
  out.push({
    key: 'torso', name: 'Badan', bone: 'torso', order: 5,
    layers: torsoSlots.map((s): PieceLayer => {
      const within = s === 'body' ? [[above(trousers ? waist : skinEnd)]] : s === 'bottom' ? [[above(waist)]] : undefined
      // the sleeves / arms cut out of the clothes. (The bare body is only cut on a side without an arm part: with one, it has no arm.)
      const minus = s === 'top' ? [...sleeves, ...armBands] : s === 'torso' || s === 'body' ? armBands : []
      return { slot: s, ...(within ? { within } : {}), ...(minus.length ? { minus } : {}) }
    }),
  })

  // legs: left / right of the line between the hip joints, thigh above the knee, shin below it
  const mid = { x: (J.hip_l.x + J.hip_r.x) / 2, y: (J.hip_l.y + J.hip_r.y) / 2 }
  const toL = unit(sub(J.hip_l, J.hip_r))
  const pair = has('shoes') && !has('shoes_r')
  const legSlots = ['body', ...(trousers ? ['bottom'] : []), ...(pair ? ['shoes'] : [])].filter(has).sort((a, b) => zOf(a) - zOf(b))
  for (const side of ['l', 'r'] as const) {
    const H = J[`hip_${side}`], K = J[`knee_${side}`], A = J[`ankle_${side}`]
    const nK = unit({ x: unit(sub(K, H)).x + unit(sub(A, K)).x, y: unit(sub(K, H)).y + unit(sub(A, K)).y })
    const sideP = halfPlane(mid, side === 'l' ? toL : { x: -toL.x, y: -toL.y })
    const label = side === 'l' ? 'kiri' : 'kanan'
    const start = (s: string) => below(s === 'bottom' ? waist : J.hip)
    out.push({ key: `leg_${side}_up`, name: `Paha ${label}`, bone: `leg_${side}`, order: 0, layers: legSlots.map((s) => ({ slot: s, within: [[sideP], [start(s)], [halfPlane(K, { x: -nK.x, y: -nK.y })]] })) })
    out.push({ key: `leg_${side}_low`, name: `Betis ${label}`, bone: `shin_${side}`, order: 0, layers: legSlots.map((s) => ({ slot: s, within: [[sideP], [start(s)], [halfPlane(K, nK)]] })) })
  }
  // a single shoe per foot: each part is its own piece in front of the shin
  if (has('shoes') && !pair) out.push({ key: 'shoe_l', name: 'Sepatu kiri', bone: 'shin_l', order: 10, layers: [{ slot: 'shoes' }] })
  if (has('shoes_r')) out.push({ key: 'shoe_r', name: 'Sepatu kanan', bone: 'shin_r', order: 10, layers: [{ slot: 'shoes_r' }] })
  if (skirt && has('bottom')) out.push({ key: 'skirt', name: labelOf('bottom'), bone: 'root', order: 5, layers: [{ slot: 'bottom' }] })
  return out
}

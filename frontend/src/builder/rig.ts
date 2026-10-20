import type { Layer } from '../types'

/** Everything here is in character-canvas units (400x800, y down) until `buildRigLayers` converts to scene pixels. */
export interface Pt { x: number; y: number }
export interface Box { x0: number; y0: number; x1: number; y1: number }

export interface BoneSpec {
  key: string
  name: string
  parent: string | null
  /** the joint (rotation centre) at rest */
  joint: Pt
  /** absolute direction of the bone at rest, degrees (screen coordinates: 90 = pointing down, -90 = up) */
  angle: number
  length: number
  /** drawing order among the siblings of the same parent (low = behind) */
  order: number
}

/**
 * Default skeleton. Left/right are as seen on screen (x < 200 = "kiri"). The torso bone and the leg bones are children
 * of the hip root, so the root moves the whole character; arms hang from the torso so they follow its lean.
 * Arms and legs have two bones (upper + lower) which also makes the editor's 2-bone IK usable on them.
 */
export const SKELETON: BoneSpec[] = [
  { key: 'root', name: 'Pinggul (root)', parent: null, joint: { x: 200, y: 556 }, angle: -90, length: 34, order: 0 },
  { key: 'leg_l', name: 'Paha kiri', parent: 'root', joint: { x: 172, y: 556 }, angle: 90, length: 105, order: 0 },
  { key: 'shin_l', name: 'Betis kiri', parent: 'leg_l', joint: { x: 172, y: 661 }, angle: 90, length: 125, order: 10 },
  { key: 'leg_r', name: 'Paha kanan', parent: 'root', joint: { x: 228, y: 556 }, angle: 90, length: 105, order: 1 },
  { key: 'shin_r', name: 'Betis kanan', parent: 'leg_r', joint: { x: 228, y: 661 }, angle: 90, length: 125, order: 10 },
  { key: 'torso', name: 'Badan', parent: 'root', joint: { x: 200, y: 556 }, angle: -90, length: 230, order: 10 },
  { key: 'head', name: 'Kepala', parent: 'torso', joint: { x: 200, y: 320 }, angle: -90, length: 150, order: 20 },
  { key: 'arm_l', name: 'Lengan atas kiri', parent: 'torso', joint: { x: 106, y: 340 }, angle: 90, length: 112, order: 30 },
  { key: 'forearm_l', name: 'Lengan bawah kiri', parent: 'arm_l', joint: { x: 106, y: 452 }, angle: 90, length: 160, order: 10 },
  { key: 'arm_r', name: 'Lengan atas kanan', parent: 'torso', joint: { x: 294, y: 340 }, angle: 90, length: 112, order: 31 },
  { key: 'forearm_r', name: 'Lengan bawah kanan', parent: 'arm_r', joint: { x: 294, y: 452 }, angle: 90, length: 160, order: 10 },
]

/** One image of the rig: attached to a bone, covering `box` on the character canvas. */
export interface PieceSpec {
  key: string
  name: string
  bone: string
  order: number
  assetId: number
  box: Box
  /** expression id -> asset id of the same piece drawn for that expression (eyes / brows / mouth) */
  expr?: Record<string, number>
}

export interface RigOptions {
  scene: { width: number; height: number }
  /** scene pixels per character-canvas unit */
  k: number
  /** pixels per canvas unit of the piece images */
  pxPerUnit: number
  name: string
  pieces: PieceSpec[]
  newId: () => string
  bones?: BoneSpec[]
  /** identifies this character instance in the scene (tags every layer); generated when omitted */
  rigId?: string
}

const rad = (deg: number) => (deg * Math.PI) / 180
const rot = (p: Pt, deg: number): Pt => ({ x: p.x * Math.cos(rad(deg)) - p.y * Math.sin(rad(deg)), y: p.x * Math.sin(rad(deg)) + p.y * Math.cos(rad(deg)) })
const r3 = (n: number) => Math.round(n * 1000) / 1000

/** Scene position of a character-canvas point (the figure is centred vertically at canvas y = 415). */
export function sceneOf(o: Pick<RigOptions, 'scene' | 'k'>, p: Pt): Pt {
  return { x: o.scene.width / 2 + o.k * (p.x - 200), y: o.scene.height / 2 + o.k * (p.y - 415) }
}

/** Natural scale for a full figure (canvas y 30..800) to fill ~90% of the scene height. */
export const fitScale = (sceneHeight: number) => Math.min(1.2, (sceneHeight * 0.9) / 770)

/**
 * Builds the layers (bones + images) in document order. Positions follow the editor's convention: a layer's x/y is where
 * its pivot sits in its PARENT's content space, which for a bone is the frame at its joint, rotated by the bone angle.
 * Images get the inverse rotation so they stay upright at rest and swing with the bone when it is rotated.
 */
export function buildRigLayers(o: RigOptions): Layer[] {
  const bones = o.bones ?? SKELETON
  const rigId = o.rigId ?? o.newId()
  const byKey = new Map(bones.map((b) => [b.key, b]))
  const ids = new Map<string, string>()
  for (const b of bones) ids.set(`bone:${b.key}`, o.newId())
  for (const p of o.pieces) ids.set(`piece:${p.key}`, o.newId())

  const base = { scaleX: 1, scaleY: 1, opacity: 1, visible: true, locked: false }
  const boneLayer = (b: BoneSpec): Layer => {
    const j = sceneOf(o, b.joint)
    const parent = b.parent ? byKey.get(b.parent) : undefined
    if (!parent) return { ...base, id: ids.get(`bone:${b.key}`)!, type: 'bone', name: `${o.name} · ${b.name}`, x: r3(j.x), y: r3(j.y), rotation: b.angle, length: r3(b.length * o.k), pivotX: 0, pivotY: 0, parentId: null, rig: { id: rigId, role: `bone:${b.key}` } }
    const pj = sceneOf(o, parent.joint)
    const local = rot({ x: j.x - pj.x, y: j.y - pj.y }, -parent.angle)
    return { ...base, id: ids.get(`bone:${b.key}`)!, type: 'bone', name: `${o.name} · ${b.name}`, x: r3(local.x), y: r3(local.y), rotation: r3(b.angle - parent.angle), length: r3(b.length * o.k), pivotX: 0, pivotY: 0, parentId: ids.get(`bone:${parent.key}`)!, rig: { id: rigId, role: `bone:${b.key}` } }
  }
  const pieceLayer = (p: PieceSpec): Layer => {
    const bone = byKey.get(p.bone)!
    const c = sceneOf(o, { x: (p.box.x0 + p.box.x1) / 2, y: (p.box.y0 + p.box.y1) / 2 })
    const bj = sceneOf(o, bone.joint)
    const local = rot({ x: c.x - bj.x, y: c.y - bj.y }, -bone.angle)
    const s = o.k / o.pxPerUnit
    return { ...base, id: ids.get(`piece:${p.key}`)!, type: 'image', name: `${o.name} · ${p.name}`, assetId: p.assetId, x: r3(local.x), y: r3(local.y), scaleX: s, scaleY: s, rotation: r3(-bone.angle), pivotX: 0, pivotY: 0, parentId: ids.get(`bone:${bone.key}`)!, rig: { id: rigId, role: `piece:${p.key}` }, ...(p.expr ? { expr: { ...p.expr, default: p.assetId } } : {}) }
  }

  // depth-first, siblings by `order`: this is also the stacking order in the editor (children are drawn above their parent)
  type Node = { order: number; build: () => Layer; children: () => Node[] }
  const nodesOf = (parent: string | null): Node[] => [
    ...bones.filter((b) => (b.parent ?? null) === parent).map((b): Node => ({ order: b.order, build: () => boneLayer(b), children: () => nodesOf(b.key) })),
    ...(parent ? o.pieces.filter((p) => p.bone === parent).map((p): Node => ({ order: p.order, build: () => pieceLayer(p), children: () => [] })) : []),
  ].sort((a, b) => a.order - b.order)
  const out: Layer[] = []
  const walk = (nodes: Node[]) => nodes.forEach((n) => { out.push(n.build()); walk(n.children()) })
  walk(nodesOf(null))
  return out
}

import type { Keyframe, Layer } from '../types'

/**
 * 2.5D card characters: ready-made PNG cards (a body per pose, a head per expression, mouth shapes, an eyelid overlay)
 * described by karakter/<name>/character.json. In a scene they become a small rig:
 *   root bone (at the feet) → body (swaps per pose) → head (swaps per expression) → mouth overlay + eyelid overlay
 * The rig roles are `piece:card_*`, so the editor's expression buttons (EXPR_SLOTS) and the root-bone motions work on them.
 */

export interface CardMeta {
  name?: string
  style?: string
  body: { canvas: [number, number]; feet_y: number; center_x: number; char_height_px?: number; poses: string[]; head_dx?: Record<string, number> }
  head: { canvas: [number, number]; paste_on_body: [number, number]; expressions: string[] }
  mouth?: { canvas: [number, number]; paste_on_head_topleft: [number, number]; shapes: string[] }
  blink?: { canvas: [number, number]; paste_on_head_topleft: [number, number]; blink_ok?: string[]; skip?: string[] }
}

export interface CardUrls { body: Record<string, string>; head: Record<string, string>; mouth: Record<string, string>; blink: string | null }

export interface CardSummary { id: number; kind: 'card'; name: string; current_version: number; updated_at: string; source: string | null; thumbnail: string | null }
export interface CardDetail extends CardSummary {
  versions: { number: number; note: string | null; created_at: string; thumbnail: string | null }[]
  viewing: number | null
  meta: CardMeta | null
  urls: CardUrls | null
}
export interface CardAvailable { slug: string; name: string; ok: boolean; problem: string | null; style?: string | null; poses?: string[]; expressions?: string[]; imported_id: number | null }

export const CARD_ROLES = { body: 'card_body', head: 'card_head', mouth: 'card_mouth', blink: 'card_blink' } as const

/** Where the head sits on the body for `pose` (top-left, body pixels). */
export function headOffset(meta: CardMeta, pose: string): { x: number; y: number } {
  const [px, py] = meta.head.paste_on_body
  return { x: px + (meta.body.head_dx?.[pose] ?? 0), y: py }
}

/** Average head shift over all poses: the rig uses one head position (the poses differ by a few pixels only). */
export function meanHeadDx(meta: CardMeta): number {
  const v = Object.values(meta.body.head_dx ?? {})
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0
}

export interface CardView { pose: string; expression: string; mouth: string | null; blink: boolean }

/** Draws one look of the character (pose + expression + optional mouth shape and closed eyes) on `ctx`, body pixels. */
export function drawCard(ctx: CanvasRenderingContext2D, meta: CardMeta, img: (url: string) => HTMLImageElement | undefined, urls: CardUrls, v: CardView): void {
  const body = img(urls.body[v.pose])
  const head = img(urls.head[v.expression])
  if (body) ctx.drawImage(body, 0, 0)
  if (!head) return
  const h = headOffset(meta, v.pose)
  ctx.drawImage(head, h.x, h.y)
  const m = v.mouth && meta.mouth ? img(urls.mouth[v.mouth]) : undefined
  if (m && meta.mouth) ctx.drawImage(m, h.x + meta.mouth.paste_on_head_topleft[0], h.y + meta.mouth.paste_on_head_topleft[1])
  const b = v.blink && urls.blink && meta.blink ? img(urls.blink) : undefined
  if (b && meta.blink) ctx.drawImage(b, h.x + meta.blink.paste_on_head_topleft[0], h.y + meta.blink.paste_on_head_topleft[1])
}

/** Project asset ids of every card image, after they were uploaded to the project. */
export interface CardAssets { body: Record<string, number>; head: Record<string, number>; mouth: Record<string, number>; blink: number | null }

export interface PreparedCard { name: string; version: number | null; meta: CardMeta; assets: CardAssets }

const r3 = (n: number) => Math.round(n * 1000) / 1000

/**
 * Layers for one placement of a prepared card character. `xFrac` = where it stands (0..1 of the scene width), `footY` = scene
 * y of the feet (default: near the bottom), `height` = figure height as a fraction of the scene height.
 */
export function cardLayers(p: PreparedCard, scene: { width: number; height: number; duration?: number; fps?: number }, newId: () => string, opts: { xFrac?: number; footY?: number; height?: number; blink?: boolean } = {}): Layer[] {
  const m = p.meta
  const [bw, bh] = m.body.canvas
  const [hw, hh] = m.head.canvas
  const figure = m.body.char_height_px ?? bh
  const k = (scene.height * (opts.height ?? 0.78)) / figure
  const rigId = newId()
  const label = p.version ? `${p.name} v${p.version}` : p.name
  const base = { scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, visible: true, locked: false, pivotX: 0, pivotY: 0 }
  const pose0 = m.body.poses.includes('diam') ? 'diam' : m.body.poses[0]
  const expr0 = m.head.expressions.includes('netral') ? 'netral' : m.head.expressions[0]

  const root: Layer = { ...base, id: newId(), type: 'bone', name: `${label} · Akar`, x: r3(scene.width * (opts.xFrac ?? 0.5)), y: r3(opts.footY ?? scene.height * 0.93), length: r3(Math.max(20, figure * k * 0.12)), parentId: null, rig: { id: rigId, role: 'bone:root' } }
  const body: Layer = {
    ...base, id: newId(), type: 'image', name: `${label} · Badan`, assetId: p.assets.body[pose0], parentId: root.id,
    // body centre relative to the feet (the root bone)
    x: r3((bw / 2 - m.body.center_x) * k), y: r3((bh / 2 - m.body.feet_y) * k),
    scaleX: r3(k), scaleY: r3(k), rig: { id: rigId, role: `piece:${CARD_ROLES.body}` }, expr: { ...p.assets.body, default: p.assets.body[pose0] },
  }
  const hx = m.head.paste_on_body[0] + meanHeadDx(m) + hw / 2 - bw / 2
  const hy = m.head.paste_on_body[1] + hh / 2 - bh / 2
  const head: Layer = { ...base, id: newId(), type: 'image', name: `${label} · Kepala`, assetId: p.assets.head[expr0], parentId: body.id, x: r3(hx), y: r3(hy), rig: { id: rigId, role: `piece:${CARD_ROLES.head}` }, expr: { ...p.assets.head, default: p.assets.head[expr0] } }
  const out: Layer[] = [root, body, head]

  if (m.mouth && Object.keys(p.assets.mouth).length) {
    const [mw, mh] = m.mouth.canvas
    const [mx, my] = m.mouth.paste_on_head_topleft
    const first = m.mouth.shapes[0]
    // hidden while silent (the head image has its own closed mouth); lip sync shows a shape and swaps between them
    out.push({ ...base, id: newId(), type: 'image', name: `${label} · Mulut`, assetId: p.assets.mouth[first], parentId: head.id, x: r3(mx + mw / 2 - hw / 2), y: r3(my + mh / 2 - hh / 2), opacity: 0, rig: { id: rigId, role: `piece:${CARD_ROLES.mouth}` }, expr: { ...p.assets.mouth } })
  }
  if (m.blink && p.assets.blink) {
    const [ew, eh] = m.blink.canvas
    const [ex, ey] = m.blink.paste_on_head_topleft
    const lid: Layer = { ...base, id: newId(), type: 'image', name: `${label} · Kedip`, assetId: p.assets.blink, parentId: head.id, x: r3(ex + ew / 2 - hw / 2), y: r3(ey + eh / 2 - hh / 2), opacity: 0, rig: { id: rigId, role: `piece:${CARD_ROLES.blink}` } }
    if (opts.blink !== false && scene.duration && scene.fps) lid.keyframes = { opacity: blinkKeys(scene.duration, scene.fps) }
    out.push(lid)
  }
  return out
}

/** Opacity step keys of the eyelid overlay: a 3-frame blink every 2.5–4.5 s (deterministic, so re-inserting gives the same film). */
export function blinkKeys(duration: number, fps: number, seed = 7): Keyframe[] {
  const keys: Keyframe[] = [{ f: 0, v: 0, e: 'step' }]
  let s = seed
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280 }
  const end = Math.floor(duration * fps)
  for (let f = Math.round(fps * (1.2 + rnd())); f + 3 < end; f += Math.round(fps * (2.5 + rnd() * 2))) {
    keys.push({ f, v: 1, e: 'step' }, { f: f + Math.max(2, Math.round(fps / 8)), v: 0, e: 'step' })
  }
  return keys
}

/**
 * Lip sync on a card mouth: per frame opening (0..1, from lipsync.openings) -> hidden when 0, else a mouth shape
 * (small = i/e, medium = o/u, wide = a). Replaces the mouth's opacity keys and swaps inside the spoken range. Mutates `mouth`.
 */
export function applyCardLipSync(mouth: Layer, open: number[], f0: number): number {
  const shapes = mouth.expr ?? {}
  const pick = (x: number, i: number): number | undefined => {
    const alt = (a: string, b: string) => shapes[i % 6 < 3 ? a : b] ?? shapes[a] ?? shapes[b]
    if (x >= 0.95) return shapes.a ?? alt('o', 'e')
    if (x >= 0.6) return alt('o', 'u') ?? shapes.a
    return alt('e', 'i') ?? shapes.a
  }
  if (open.length === 0) return 0
  const lo = f0
  const hi = f0 + open.length
  const opacity: Keyframe[] = (mouth.keyframes?.opacity ?? []).filter((k) => k.f < lo || k.f > hi)
  const swaps = (mouth.swaps ?? []).filter((k) => k.f < lo || k.f > hi)
  let lastShown = -1
  let lastAsset: number | undefined
  let n = 0
  open.forEach((x, i) => {
    const f = f0 + i
    const shown = x > 0 ? 1 : 0
    if (shown !== lastShown) { opacity.push({ f, v: shown, e: 'step' }); lastShown = shown; n++ }
    if (shown) {
      const a = pick(x, i)
      if (a !== undefined && a !== lastAsset) { swaps.push({ f, assetId: a }); lastAsset = a; n++ }
    }
  })
  opacity.push({ f: hi, v: 0, e: 'step' })
  mouth.keyframes ??= {}
  mouth.keyframes.opacity = dedupe(opacity.sort((a, b) => a.f - b.f))
  mouth.swaps = swaps.sort((a, b) => a.f - b.f).filter((k, i, arr) => i === 0 || k.f > arr[i - 1].f)
  return n
}

const dedupe = (keys: Keyframe[]) => keys.filter((k, i, arr) => i === arr.length - 1 || k.f < arr[i + 1].f)

// ---- acting a script (auto-director) ------------------------------------------------------

/** acting pose id (POSES in rigMotion) -> card body poses to try, in order */
const POSE_ALIAS: Record<string, string[]> = {
  berdiri: ['diam'], lambai: ['lambai'], pinggang: ['pinggang'], tunjuk: ['tunjuk'], berpikir: ['dagu', 'pelipis'],
  kaget: ['angkat'], angkat: ['angkat', 'jempol'], miring: ['pelipis', 'dagu'],
}
/** acting emotion id -> card head expressions to try, in order */
const EXPR_ALIAS: Record<string, string[]> = {
  tertawa: ['senang'], serius: ['bingung', 'sedih'], teriak: ['marah', 'kaget'], berpikir: ['bingung'], kesal: ['marah'],
}

/** The body pose of the card for an acting pose (null: the card has nothing like it). */
export function cardPose(id: string, poses: string[]): string | null {
  return [id, ...(POSE_ALIAS[id] ?? [])].find((p) => poses.includes(p)) ?? null
}

/** The head expression of the card for an acting emotion ('default' stays 'default'). */
export function cardExpression(id: string, expressions: string[]): string | null {
  if (id === 'default') return 'default'
  return [id, ...(EXPR_ALIAS[id] ?? [])].find((e) => expressions.includes(e)) ?? null
}

/** Swaps the card body to the pose for acting pose `id` from `frame` on. False when the card has no such pose. */
export function applyCardPose(body: Layer, id: string, frame: number): boolean {
  const poses = Object.keys(body.expr ?? {}).filter((k) => k !== 'default')
  const p = id === 'berdiri' ? 'default' : cardPose(id, poses)
  const asset = p && body.expr?.[p]
  if (!asset) return false
  const list = (body.swaps ??= [])
  const i = list.findIndex((k) => k.f === frame)
  if (i >= 0) list[i] = { f: frame, assetId: asset }
  else { list.push({ f: frame, assetId: asset }); list.sort((a, b) => a.f - b.f) }
  return true
}

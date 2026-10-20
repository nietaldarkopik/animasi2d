import { Application, Container, Graphics, Matrix, Point, Polygon, Rectangle, Sprite, Text, Texture, type FederatedPointerEvent } from 'pixi.js'
import { evalAll, evalCamera, totalFrames, worldMatrix } from './anim'
import type { Effect } from './movie'
import type { Asset, Layer, SceneDocument } from './types'

export interface CanvasCallbacks {
  /** `additive` = Shift/Ctrl/Cmd was held: toggle the layer in the selection */
  onSelect: (id: string | null, additive?: boolean) => void
  /** rubber band result */
  onSelectMany: (ids: string[], additive: boolean) => void
  /** Called once when a gesture ends. Only changed properties are included. */
  onCommit: (id: string, patch: Partial<Layer>) => void
  /** group move / resize / rotate: one entry per layer that changed */
  onCommitMany: (patches: Record<string, Partial<Layer>>) => void
}

type Gesture =
  | { kind: 'move'; id: string; dx: number; dy: number }
  | { kind: 'scale'; id: string; d0: number; sx: number; sy: number }
  | { kind: 'rotate'; id: string; a0: number; r0: number }
  | { kind: 'pivot'; id: string }
  | { kind: 'gmove'; ids: string[]; start: Point; orig: Map<string, Point> }
  | { kind: 'gscale'; ids: string[]; c: Point; d0: number; orig: Map<string, { p: Point; sx: number; sy: number }> }
  | { kind: 'grotate'; ids: string[]; c: Point; a0: number; orig: Map<string, { p: Point; r: number }> }
  | { kind: 'marquee'; x0: number; y0: number; x1: number; y1: number; additive: boolean; /** a locked layer under the pointer: a plain click still selects it */ click?: string }

/** bone drawing (from the joint at 0,0 along +X): tapered body + joint disc */
function drawBone(g: Graphics, len: number, selected: boolean) {
  const w = Math.min(14, len * 0.18)
  g.clear().poly([0, 0, w * 1.2, -w, len, 0, w * 1.2, w]).fill({ color: selected ? 0xffd166 : BONE_COLOR, alpha: 0.85 }).stroke({ width: selected ? 2.5 : 1.5, color: selected ? 0xffffff : 0x7a4a00 })
  g.circle(0, 0, 5).fill(0xffffff).stroke({ width: 1.5, color: 0x7a4a00 })
  const pad = Math.max(6, w * 1.6) // a more generous click target than the drawing (bones are thin)
  g.hitArea = new Polygon([-pad, -pad, len + pad, -pad * 0.6, len + pad, pad * 0.6, -pad, pad])
}

const hex = (c: string) => parseInt(c.replace('#', ''), 16)
const deg = (r: number) => (r * 180) / Math.PI
const round = (n: number, p = 100) => Math.round(n * p) / p
const BONE_COLOR = 0xffb020

/** deterministic pseudo-random in [0,1): effects look the same in the editor and in every export */
const rnd = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x) }

let vignetteTex: Texture | null = null
function vignetteTexture(): Texture {
  if (!vignetteTex) {
    const c = document.createElement('canvas')
    c.width = c.height = 256
    const g = c.getContext('2d')!
    const grad = g.createRadialGradient(128, 128, 60, 128, 128, 182)
    grad.addColorStop(0, 'rgba(0,0,0,0)')
    grad.addColorStop(1, 'rgba(0,0,0,1)')
    g.fillStyle = grad
    g.fillRect(0, 0, 256, 256)
    vignetteTex = Texture.from(c)
  }
  return vignetteTex
}

/** Speech / thought / shout balloon: a body, a tail pointing at `tailX,tailY` (relative to the centre) and centred text. */
class BalloonNode extends Container {
  gfx = new Graphics()
  caption = new Text({ text: '', style: { fontSize: 32, fill: '#111111', align: 'center', wordWrap: true, wordWrapWidth: 300 } })
  constructor() {
    super()
    this.caption.anchor.set(0.5)
    this.addChild(this.gfx, this.caption)
  }
  draw(l: Layer) {
    const w = l.width ?? 320
    const h = l.height ?? 160
    const fill = hex(l.bubbleFill ?? '#ffffff')
    const kind = l.bubble ?? 'speech'
    const tx = l.tailX ?? -w * 0.25
    const ty = l.tailY ?? h * 0.9
    const g = this.gfx.clear()
    const line = { width: 4, color: 0x26262e, join: 'round' as const }
    if (kind === 'thought') {
      g.ellipse(0, 0, w / 2, h / 2).fill(fill).stroke(line)
      const n = 3
      for (let i = 1; i <= n; i++) g.circle(tx * (i / (n + 0.6)), (h / 2) + (ty - h / 2) * (i / (n + 0.6)), Math.max(5, 16 - i * 4)).fill(fill).stroke({ ...line, width: 3 })
    } else if (kind === 'shout') {
      const pts: number[] = []
      const spikes = 14
      for (let i = 0; i < spikes * 2; i++) {
        const a = (i / (spikes * 2)) * Math.PI * 2
        const k = i % 2 === 0 ? 1 : 0.82
        pts.push(Math.cos(a) * (w / 2) * k, Math.sin(a) * (h / 2) * k)
      }
      g.poly(pts).fill(fill).stroke(line)
    } else {
      g.roundRect(-w / 2, -h / 2, w, h, Math.min(40, h / 2)).fill(fill).stroke(line)
      // tail: a triangle from the nearest edge point towards the target, re-filled over the outline
      const bx = Math.max(-w / 2 + 30, Math.min(w / 2 - 30, tx * 0.5))
      const by = ty >= 0 ? h / 2 : -h / 2
      g.poly([bx - 22, by, bx + 22, by, tx, ty]).fill(fill).stroke(line)
      g.poly([bx - 20, by - (ty >= 0 ? 3 : -3), bx + 20, by - (ty >= 0 ? 3 : -3), bx + 20, by + (ty >= 0 ? -5 : 5), bx - 20, by + (ty >= 0 ? -5 : 5)]).fill(fill)
    }
    this.caption.text = l.text ?? ''
    this.caption.style.fontSize = l.fontSize ?? 32
    this.caption.style.fill = l.fill ?? '#111111'
    this.caption.style.wordWrapWidth = Math.max(40, w - 40)
  }
}

/** The active editor canvas, so UI outside the canvas (e.g. re-parenting) can ask for world-space math. */
export const canvasRef: { current: StudioCanvas | null } = { current: null }

/**
 * Imperative PixiJS scene. React owns the document; this class mirrors it and reports
 * finished gestures back through callbacks.
 *
 * Every layer is a `holder` Container carrying the layer's transform (so children can be nested
 * inside it — that nesting *is* forward kinematics) with the visible `content` as its first child.
 */
export class StudioCanvas {
  app = new Application()
  /** scene transitions (slide / zoom) move this whole root; the camera moves only `world` */
  private root = new Container()
  private world = new Container()
  private ghosts = new Container()
  /** bones are drawn here, ABOVE every layer (an image can never hide a bone); editor only */
  private boneLayer = new Container()
  private boneGfx = new Map<string, Graphics>()
  private boneKey = new Map<string, string>()
  private selIds: string[] = []
  private fx = new Container()
  private fade = new Graphics()
  private ready_tex = new Map<number, Texture>()
  private overlay = new Container()
  private frame = new Graphics()
  private holders = new Map<string, Container>()
  private contents = new Map<string, Container>()
  private textures = new Map<number, Promise<Texture>>()
  private layers = new Map<string, Layer>()
  private selectedId: string | null = null
  private gesture: Gesture | null = null
  private zoom = 1
  private ready = false
  private destroyed = false
  private showBones = true
  private cb: CanvasCallbacks

  constructor(cb: CanvasCallbacks) {
    this.cb = cb
  }

  get canvas(): HTMLCanvasElement {
    return this.app.canvas
  }

  async init(host: HTMLElement, width: number, height: number, background: string) {
    await this.app.init({ width, height, background, antialias: true, preference: 'webgl', preserveDrawingBuffer: true, resolution: 1 })
    if (this.destroyed) {
      this.app.destroy(true)
      return
    }
    host.appendChild(this.app.canvas)
    const stage = this.app.stage
    stage.eventMode = 'static'
    stage.hitArea = this.app.screen
    this.root.addChild(this.world, this.ghosts, this.boneLayer)
    stage.addChild(this.root, this.fx, this.fade, this.overlay)
    this.fx.eventMode = 'none'
    this.ghosts.eventMode = 'none'
    this.fade.eventMode = 'none'
    this.overlay.eventMode = 'static'
    this.overlay.addChild(this.frame)

    stage.on('pointerdown', (e) => {
      if (e.target === stage) this.gesture = { kind: 'marquee', x0: e.global.x, y0: e.global.y, x1: e.global.x, y1: e.global.y, additive: e.shiftKey || e.ctrlKey || e.metaKey }
    })
    stage.on('globalpointermove', (e) => this.onMove(e))
    stage.on('pointerup', () => this.endGesture())
    stage.on('pointerupoutside', () => this.endGesture())
    this.ready = true
  }

  destroy() {
    this.destroyed = true
    if (this.ready) this.app.destroy(true, { children: true })
    this.ready = false
  }

  setZoom(z: number) {
    this.zoom = z
    this.drawOverlay()
  }

  // ---- document sync -------------------------------------------------------

  sync(doc: SceneDocument, assets: Record<number, Asset>, selectedId: string | null, frame = 0, onion = false, showBones = true, effect: Effect | null = null, useCamera = false, selection: string[] = selectedId ? [selectedId] : []) {
    if (!this.ready) return
    this.showBones = showBones
    this.selIds = selection
    const { width, height, background } = doc.settings
    if (this.app.renderer.width !== width || this.app.renderer.height !== height) {
      this.app.renderer.resize(width, height)
      this.app.stage.hitArea = this.app.screen
    }
    this.app.renderer.background.color = hex(background)

    const ids = new Set(doc.layers.map((l) => l.id))
    const evaluated = evalAll(doc, frame) // keyframes + IK

    // 1) create / update holders
    for (const base of doc.layers) {
      const layer = evaluated.get(base.id)!
      let holder = this.holders.get(layer.id)
      if (!holder) {
        holder = this.createNode(layer)
      }
      this.updateNode(holder, layer, this.layers.get(layer.id), assets)
      this.layers.set(layer.id, layer)
    }

    // 2) attach to the right parent, in document order among siblings
    const counters = new Map<Container, number>()
    for (const base of doc.layers) {
      const holder = this.holders.get(base.id)!
      const parent = base.parentId && ids.has(base.parentId) ? this.holders.get(base.parentId)! : this.world
      if (holder.parent !== parent) parent.addChild(holder)
      // content is child 0 of a holder; sibling layers follow it
      const idx = (counters.get(parent) ?? (parent === this.world ? 0 : 1))
      counters.set(parent, idx + 1)
      if (parent.getChildIndex(holder) !== idx) parent.setChildIndex(holder, idx)
    }

    // 3) drop removed layers (children are removed with their parent holder, so detach survivors first — none exist: server/store cascade)
    for (const [id, holder] of this.holders) {
      if (!ids.has(id)) {
        holder.destroy({ children: true })
        this.holders.delete(id)
        this.contents.delete(id)
        this.layers.delete(id)
      }
    }
    this.syncBones(doc, evaluated, frame)

    this.selectedId = selectedId
    // camera: the scene point `x,y` goes to the middle of the view, zoomed and rolled (only when previewing / exporting)
    const cam = useCamera ? evalCamera(doc.camera, frame, width, height) : { x: width / 2, y: height / 2, zoom: 1, rot: 0 }
    this.world.pivot.set(cam.x, cam.y)
    this.world.position.set(width / 2, height / 2)
    this.world.scale.set(cam.zoom)
    this.world.rotation = (-cam.rot * Math.PI) / 180
    this.ghosts.pivot.copyFrom(this.world.pivot)
    this.ghosts.position.copyFrom(this.world.position)
    this.ghosts.scale.copyFrom(this.world.scale)
    this.ghosts.rotation = this.world.rotation
    this.boneLayer.pivot.copyFrom(this.world.pivot)
    this.boneLayer.position.copyFrom(this.world.position)
    this.boneLayer.scale.copyFrom(this.world.scale)
    this.boneLayer.rotation = this.world.rotation
    // scene transitions: slide / zoom move the whole scene, fade and wipe lay a coloured sheet over it
    this.root.pivot.set(width / 2, height / 2)
    this.root.position.set(width / 2 + (effect?.kind === 'slide' ? effect.offsetX : 0), height / 2)
    this.root.scale.set(effect?.kind === 'zoom' ? effect.scale : 1)
    this.fade.clear()
    if (effect?.kind === 'fade') this.fade.rect(0, 0, width, height).fill({ color: hex(effect.color), alpha: effect.alpha })
    else if (effect?.kind === 'zoom') this.fade.rect(0, 0, width, height).fill({ color: 0x000000, alpha: effect.alpha })
    else if (effect?.kind === 'wipe') {
      const w = width * effect.progress
      this.fade.rect(effect.side < 0 ? 0 : width - w, 0, w, height).fill(0x000000)
    }
    this.drawFx(doc, frame)
    this.drawGhosts(doc, frame, onion)
    this.drawOverlay()
  }

  /** One drawing per bone in `boneLayer`, positioned from the layer hierarchy (not nested), so it is always on top. */
  private syncBones(doc: SceneDocument, evaluated: Map<string, Layer>, frame: number) {
    const alive = new Set<string>()
    for (const base of doc.layers) {
      if (base.type !== 'bone') continue
      alive.add(base.id)
      let g = this.boneGfx.get(base.id)
      if (!g) {
        g = new Graphics()
        g.eventMode = 'static'
        g.cursor = 'move'
        const id = base.id
        g.on('pointerdown', (e: FederatedPointerEvent) => this.pointerOnLayer(id, e))
        this.boneLayer.addChild(g)
        this.boneGfx.set(base.id, g)
      }
      const l = evaluated.get(base.id)!
      const sel = this.selIds.includes(base.id)
      const key = `${l.length ?? 100}|${sel}`
      if (this.boneKey.get(base.id) !== key) { drawBone(g, l.length ?? 100, sel); this.boneKey.set(base.id, key) }
      const m = worldMatrix(doc, base, frame, evaluated)
      g.setFromMatrix(new Matrix(m.a, m.b, m.c, m.d, m.tx, m.ty))
      let shown = this.showBones
      for (let p: Layer | undefined = l, n = 0; p && shown && n < 256; p = p.parentId ? evaluated.get(p.parentId) : undefined, n++) if (!p.visible) shown = false
      g.visible = shown
    }
    for (const [id, g] of this.boneGfx) {
      if (!alive.has(id)) { g.destroy(); this.boneGfx.delete(id); this.boneKey.delete(id) }
    }
  }

  /** Scene effects (rain, snow, colour tint, vignette) and subtitles, drawn above the scene in screen space. */
  private drawFx(doc: SceneDocument, frame: number) {
    this.fx.removeChildren().forEach((c) => c.destroy())
    const { width: W, height: H, fps } = doc.settings
    const t = frame / fps
    for (const e of doc.effects ?? []) {
      const k = Math.max(0, Math.min(1, e.intensity))
      if (e.kind === 'rain') {
        const g = new Graphics()
        const n = Math.round(40 + k * 260)
        for (let i = 0; i < n; i++) {
          const r1 = rnd(i * 3 + 1), r2 = rnd(i * 3 + 2), r3 = rnd(i * 3 + 3)
          const speed = 900 + 600 * r3
          const len = 26 + 24 * r2
          const y = ((r2 * (H + 80) + speed * t) % (H + 80)) - 40
          const x = r1 * (W + 300) - 150 - y * 0.2
          g.moveTo(x, y).lineTo(x - len * 0.2, y + len)
        }
        g.stroke({ width: 2, color: hex(e.color ?? '#cfe3ff'), alpha: 0.55 })
        this.fx.addChild(g)
      } else if (e.kind === 'snow') {
        const g = new Graphics()
        const n = Math.round(30 + k * 220)
        for (let i = 0; i < n; i++) {
          const r1 = rnd(i * 3 + 1), r2 = rnd(i * 3 + 2), r3 = rnd(i * 3 + 3)
          const speed = 40 + 70 * r3
          const y = ((r2 * (H + 20) + speed * t) % (H + 20)) - 10
          const x = (((r1 * W + Math.sin(t * 0.8 + i) * 22 - 12 * t) % W) + W) % W
          g.circle(x, y, 1.5 + 3 * r3)
        }
        g.fill({ color: hex(e.color ?? '#ffffff'), alpha: 0.85 })
        this.fx.addChild(g)
      } else if (e.kind === 'tint') {
        const g = new Graphics().rect(0, 0, W, H).fill({ color: hex(e.color ?? '#1c2a66'), alpha: e.blend === 'multiply' ? 1 : k })
        if (e.blend === 'multiply') { g.blendMode = 'multiply'; g.alpha = k }
        this.fx.addChild(g)
      } else if (e.kind === 'vignette') {
        const s = new Sprite(vignetteTexture())
        s.width = W
        s.height = H
        s.alpha = k
        this.fx.addChild(s)
      }
    }
    const sub = (doc.subtitles ?? []).find((x) => t >= x.start && t < x.end)
    if (sub) {
      const size = Math.max(14, Math.round(H * 0.05))
      const label = new Text({ text: sub.text, style: { fontSize: size, fill: '#ffffff', align: 'center', wordWrap: true, wordWrapWidth: W * 0.82, stroke: { color: '#000000', width: Math.max(2, size / 8) } } })
      label.anchor.set(0.5, 1)
      label.position.set(W / 2, H - H * 0.05)
      const pad = size * 0.5
      const bg = new Graphics().roundRect(label.x - label.width / 2 - pad, label.y - label.height - pad / 2, label.width + pad * 2, label.height + pad, pad).fill({ color: 0x000000, alpha: 0.45 })
      this.fx.addChild(bg, label)
    }
  }

  /** Load every texture a document will need (also the swap images) so an export never shows a missing image. */
  async preload(layers: Layer[], assets: Record<number, Asset>) {
    const ids = new Set<number>()
    for (const l of layers) {
      if (l.assetId) ids.add(l.assetId)
      for (const s of l.swaps ?? []) ids.add(s.assetId)
    }
    await Promise.all([...ids].map((id) => (assets[id] ? this.texture(assets[id]).catch(() => null) : null)))
  }

  /** Onion skin: translucent previous (red) and next (green) frames, honouring the rig hierarchy. */
  private drawGhosts(doc: SceneDocument, frame: number, on: boolean) {
    this.ghosts.removeChildren().forEach((c) => c.destroy())
    if (!on) return
    const last = totalFrames(doc)
    for (const [off, tint] of [[-1, 0xff5555], [1, 0x55dd77]] as const) {
      const f = Math.round(frame) + off
      if (f < 0 || f > last) continue
      const evf = evalAll(doc, f)
      for (const base of doc.layers) {
        if (base.type === 'bone') continue
        const l = evf.get(base.id)!
        const content = this.contents.get(l.id)
        if (!content || !l.visible) continue
        let g: Container
        if (content instanceof Sprite) g = new Sprite(content.texture)
        else if (content instanceof Text) g = new Text({ text: l.text ?? '', style: { fontSize: l.fontSize ?? 48 } })
        else {
          const w = l.width ?? 200
          const h = l.height ?? 200
          g = new Graphics().rect(-w / 2, -h / 2, w, h).fill(0xffffff)
        }
        if (g instanceof Sprite || g instanceof Text) g.anchor.set(0.5)
        ;(g as Sprite).tint = tint
        const m = worldMatrix(doc, base, f, evf)
        g.setFromMatrix(new Matrix(m.a, m.b, m.c, m.d, m.tx, m.ty))
        g.alpha = 0.3 * l.opacity
        this.ghosts.addChild(g)
      }
    }
  }

  private createNode(layer: Layer): Container {
    let content: Container
    if (layer.type === 'balloon') content = new BalloonNode()
    else if (layer.type === 'image') content = new Sprite(Texture.EMPTY)
    else if (layer.type === 'text') content = new Text({ text: layer.text ?? '' })
    else content = new Graphics()
    if (content instanceof Sprite || content instanceof Text) content.anchor.set(0.5)

    const holder = new Container()
    holder.addChild(content)
    content.eventMode = 'static'
    content.cursor = 'move'
    content.on('pointerdown', (e: FederatedPointerEvent) => this.pointerOnLayer(layer.id, e))
    this.holders.set(layer.id, holder)
    this.contents.set(layer.id, content)
    return holder
  }

  private updateNode(holder: Container, l: Layer, prev: Layer | undefined, assets: Record<number, Asset>) {
    const content = this.contents.get(l.id)!
    holder.position.set(l.x, l.y)
    holder.pivot.set(l.pivotX ?? 0, l.pivotY ?? 0)
    holder.scale.set(l.scaleX, l.scaleY)
    holder.rotation = (l.rotation * Math.PI) / 180
    holder.alpha = l.opacity
    // a hidden holder hides its whole subtree. A bone's own drawing lives in `boneLayer` (always on top), so the nested copy is
    // never rendered or clicked; it stays only to measure the selection frame
    holder.visible = l.visible
    content.visible = true
    content.renderable = l.type !== 'bone'
    content.eventMode = l.type === 'bone' ? 'none' : 'static'
    content.cursor = l.locked ? 'default' : 'move'

    if (content instanceof BalloonNode) {
      const changed = !prev || (['width', 'height', 'text', 'fontSize', 'fill', 'bubble', 'bubbleFill', 'tailX', 'tailY'] as const).some((k) => prev[k] !== l[k])
      if (changed) content.draw(l)
    } else if (content instanceof Sprite && l.assetId && (!prev || prev.assetId !== l.assetId || content.texture === Texture.EMPTY)) {
      const asset = assets[l.assetId]
      const ready = asset && this.ready_tex.get(asset.id)
      if (ready) {
        content.texture = ready // already decoded: swap in the same frame (no one-frame lag when keyed images change)
      } else if (asset) {
        void this.texture(asset).then((t) => {
          if (!content.destroyed && this.layers.get(l.id)?.assetId === l.assetId) {
            content.texture = t
            this.drawOverlay()
          }
        }).catch((e) => console.error('Gagal memuat gambar', e))
      }
    } else if (content instanceof Text) {
      if (content.text !== (l.text ?? '')) content.text = l.text ?? ''
      content.style.fontSize = l.fontSize ?? 48
      content.style.fill = l.fill ?? '#111111'
    } else if (content instanceof Graphics) {
      const changed = !prev || prev.width !== l.width || prev.height !== l.height || prev.fill !== l.fill || prev.length !== l.length || prev.shape !== l.shape
      if (changed && l.type === 'bone') {
        // tapered bone from the joint (0,0) along +X, with a joint disc
        const len = l.length ?? 100
        const w = Math.min(14, len * 0.18)
        content.clear().poly([0, 0, w * 1.2, -w, len, 0, w * 1.2, w]).fill({ color: BONE_COLOR, alpha: 0.75 }).stroke({ width: 1.5, color: 0x7a4a00 })
        content.circle(0, 0, 5).fill(0xffffff).stroke({ width: 1.5, color: 0x7a4a00 })
      } else if (changed && l.type === 'shape') {
        const w = l.width ?? 200
        const h = l.height ?? 200
        if (l.shape === 'ellipse') content.clear().ellipse(0, 0, w / 2, h / 2).fill(hex(l.fill ?? '#4f8cff'))
        else content.clear().rect(-w / 2, -h / 2, w, h).fill(hex(l.fill ?? '#4f8cff'))
      }
    }
  }

  private texture(asset: Asset): Promise<Texture> {
    let p = this.textures.get(asset.id)
    if (!p) {
      p = fetch(asset.url)
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          return r.blob()
        })
        .then((b) => createImageBitmap(b))
        .then((bmp) => Texture.from(bmp))
        .then((t) => { this.ready_tex.set(asset.id, t); return t })
      p.catch(() => this.textures.delete(asset.id))
      this.textures.set(asset.id, p)
    }
    return p
  }

  // ---- world-space helpers (used for re-parenting) --------------------------

  /** Local transform that keeps `id` exactly where it is on screen once parented to `parentId`. */
  localFor(id: string, parentId: string | null): Partial<Layer> | null {
    const holder = this.holders.get(id)
    const parent = parentId ? this.holders.get(parentId) : this.world
    if (!holder || !parent) return null
    const wm = holder.worldTransform
    const pw = parent.worldTransform
    const wRot = Math.atan2(wm.b, wm.a)
    const pRot = Math.atan2(pw.b, pw.a)
    const wsx = Math.hypot(wm.a, wm.b)
    const wsy = Math.hypot(wm.c, wm.d)
    const psx = Math.hypot(pw.a, pw.b) || 1
    const psy = Math.hypot(pw.c, pw.d) || 1
    // world position of this layer's pivot point -> parent's local space
    const world = holder.toGlobal(holder.pivot)
    const local = parent.toLocal(world)
    return {
      x: round(local.x),
      y: round(local.y),
      rotation: round(((deg(wRot - pRot) % 360) + 360) % 360),
      scaleX: round(wsx / psx, 1000),
      scaleY: round(wsy / psy, 1000),
    }
  }

  // ---- selection overlay & gestures -----------------------------------------

  /** Click on a layer (or bone): Shift/Ctrl toggles it in the selection; a click on a member of a multi-selection drags them all. */
  private pointerOnLayer(id: string, e: FederatedPointerEvent) {
    const l = this.layers.get(id)
    const holder = this.holders.get(id)
    if (!l || !holder) return
    e.stopPropagation()
    if (e.shiftKey || e.ctrlKey || e.metaKey) return this.cb.onSelect(id, true)
    if (this.selIds.length > 1 && this.selIds.includes(id)) return this.beginGroupMove(e)
    if (l.locked) {
      // locked layers (a background) are see-through for dragging: the press starts a rubber band; a plain click still selects it
      this.gesture = { kind: 'marquee', x0: e.global.x, y0: e.global.y, x1: e.global.x, y1: e.global.y, additive: false, click: id }
      return
    }
    this.cb.onSelect(id)
    const p = holder.parent!.toLocal(e.global)
    this.gesture = { kind: 'move', id, dx: holder.x - p.x, dy: holder.y - p.y }
  }

  /** Selected layers that a group gesture moves: unlocked, and not a child of another selected layer (children follow their parent). */
  private movable(): string[] {
    const set = new Set(this.selIds)
    return this.selIds.filter((id) => {
      const l = this.layers.get(id)
      if (!l || l.locked || !this.holders.get(id)) return false
      for (let p = l.parentId, n = 0; p && n < 256; p = this.layers.get(p)?.parentId, n++) if (set.has(p)) return false
      return true
    })
  }

  private gpos(id: string): Point {
    const h = this.holders.get(id)!
    return h.parent!.toGlobal(h.position)
  }

  private beginGroupMove(e: FederatedPointerEvent) {
    const ids = this.movable()
    if (ids.length === 0) return
    this.gesture = { kind: 'gmove', ids, start: e.global.clone(), orig: new Map(ids.map((i) => [i, this.gpos(i)])) }
  }

  /** On-screen box of a layer (stage coordinates); bones are measured on their own drawing. */
  private boundsOf(id: string): Rectangle | null {
    const l = this.layers.get(id)
    const h = this.holders.get(id)
    if (!l || !h || !h.visible) return null
    if (l.type === 'bone') { const g = this.boneGfx.get(id); return g?.visible ? g.getBounds().rectangle : null }
    return this.contents.get(id)?.getBounds().rectangle ?? null
  }

  private handles() {
    if (this.selIds.length > 1) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      for (const id of this.selIds) {
        const b = this.boundsOf(id)
        if (!b) continue
        x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.width); y1 = Math.max(y1, b.y + b.height)
      }
      if (!Number.isFinite(x0)) return null
      const corners = [new Point(x0, y0), new Point(x1, y0), new Point(x1, y1), new Point(x0, y1)]
      const center = new Point((x0 + x1) / 2, (y0 + y1) / 2)
      return { corners, scale: corners[2], center, pivot: null as Point | null, rotate: new Point(center.x, y0 - 28 / this.zoom) }
    }
    const content = this.selectedId ? this.contents.get(this.selectedId) : undefined
    const holder = this.selectedId ? this.holders.get(this.selectedId) : undefined
    if (!content || !holder || !holder.visible) return null
    const b = content.getLocalBounds()
    const corners = [new Point(b.minX, b.minY), new Point(b.maxX, b.minY), new Point(b.maxX, b.maxY), new Point(b.minX, b.maxY)].map((p) => content.toGlobal(p))
    const topMid = new Point((corners[0].x + corners[1].x) / 2, (corners[0].y + corners[1].y) / 2)
    const center = new Point((corners[0].x + corners[2].x) / 2, (corners[0].y + corners[2].y) / 2)
    const vx = topMid.x - center.x
    const vy = topMid.y - center.y
    const len = Math.hypot(vx, vy) || 1
    const off = 28 / this.zoom
    const pivot: Point | null = holder.toGlobal(holder.pivot)
    return { corners, scale: corners[2], center, pivot, rotate: new Point(topMid.x + (vx / len) * off, topMid.y + (vy / len) * off) }
  }

  private drawOverlay() {
    const g = this.frame
    const o = this.overlay
    for (const c of o.children.slice(1)) c.destroy()
    g.clear()
    const lw = 1.5 / this.zoom
    const gs = this.gesture
    if (gs?.kind === 'marquee') {
      g.rect(Math.min(gs.x0, gs.x1), Math.min(gs.y0, gs.y1), Math.abs(gs.x1 - gs.x0), Math.abs(gs.y1 - gs.y0)).fill({ color: 0x4f8cff, alpha: 0.12 }).stroke({ width: lw, color: 0x4f8cff })
    }
    const h = this.handles()
    if (!h) return
    const r = 7 / this.zoom
    if (this.selIds.length > 1) {
      for (const id of this.selIds) { // a thin frame around every member
        const b = this.boundsOf(id)
        if (b) g.rect(b.x, b.y, b.width, b.height).stroke({ width: lw, color: 0x4f8cff, alpha: 0.55 })
      }
    }
    g.poly(h.corners).stroke({ width: lw, color: 0x4f8cff })
    const topMid = new Point((h.corners[0].x + h.corners[1].x) / 2, (h.corners[0].y + h.corners[1].y) / 2)
    g.moveTo(topMid.x, topMid.y).lineTo(h.rotate.x, h.rotate.y).stroke({ width: lw, color: 0x4f8cff })

    const mk = (p: Point, kind: 'scale' | 'rotate' | 'pivot') => {
      const hd = new Graphics()
      if (kind === 'scale') hd.rect(-r, -r, r * 2, r * 2).fill(0xffffff).stroke({ width: lw, color: 0x4f8cff })
      else if (kind === 'rotate') hd.circle(0, 0, r).fill(0xffffff).stroke({ width: lw, color: 0x4f8cff })
      else {
        // pivot / joint marker: crosshair in a ring
        hd.circle(0, 0, r * 1.1).fill({ color: 0xffb020, alpha: 0.35 }).stroke({ width: lw, color: 0xffb020 })
        hd.moveTo(-r * 1.8, 0).lineTo(r * 1.8, 0).moveTo(0, -r * 1.8).lineTo(0, r * 1.8).stroke({ width: lw, color: 0xffb020 })
      }
      hd.position.copyFrom(p)
      hd.eventMode = 'static'
      hd.cursor = kind === 'scale' ? 'nwse-resize' : kind === 'rotate' ? 'grab' : 'crosshair'
      hd.on('pointerdown', (e: FederatedPointerEvent) => {
        e.stopPropagation()
        if (this.selIds.length > 1) {
          const ids = this.movable()
          if (ids.length === 0) return
          if (kind === 'scale') this.gesture = { kind: 'gscale', ids, c: h.center.clone(), d0: Math.hypot(e.global.x - h.center.x, e.global.y - h.center.y) || 1, orig: new Map(ids.map((i) => [i, { p: this.gpos(i), sx: this.holders.get(i)!.scale.x, sy: this.holders.get(i)!.scale.y }])) }
          else if (kind === 'rotate') this.gesture = { kind: 'grotate', ids, c: h.center.clone(), a0: Math.atan2(e.global.y - h.center.y, e.global.x - h.center.x), orig: new Map(ids.map((i) => [i, { p: this.gpos(i), r: this.holders.get(i)!.rotation }])) }
          return
        }
        const id = this.selectedId!
        const l = this.layers.get(id)
        if (!l || l.locked) return
        if (kind === 'scale') this.gesture = { kind, id, d0: Math.hypot(e.global.x - h.center.x, e.global.y - h.center.y) || 1, sx: l.scaleX, sy: l.scaleY }
        else if (kind === 'rotate') this.gesture = { kind, id, a0: Math.atan2(e.global.y - h.pivot!.y, e.global.x - h.pivot!.x), r0: l.rotation }
        else this.gesture = { kind, id }
      })
      o.addChild(hd)
    }
    mk(h.scale, 'scale')
    mk(h.rotate, 'rotate')
    if (h.pivot) mk(h.pivot, 'pivot')
  }

  private onMove(e: FederatedPointerEvent) {
    const gs = this.gesture
    if (!gs) return
    if (gs.kind === 'marquee') {
      gs.x1 = e.global.x
      gs.y1 = e.global.y
      return this.drawOverlay()
    }
    if (gs.kind === 'gmove' || gs.kind === 'gscale' || gs.kind === 'grotate') {
      for (const id of gs.ids) {
        const h = this.holders.get(id)
        if (!h) continue
        if (gs.kind === 'gmove') {
          const o = gs.orig.get(id)!
          h.position.copyFrom(h.parent!.toLocal(new Point(o.x + e.global.x - gs.start.x, o.y + e.global.y - gs.start.y)))
        } else if (gs.kind === 'gscale') {
          const f = Math.max(0.02, Math.hypot(e.global.x - gs.c.x, e.global.y - gs.c.y) / gs.d0)
          const o = gs.orig.get(id)!
          h.position.copyFrom(h.parent!.toLocal(new Point(gs.c.x + f * (o.p.x - gs.c.x), gs.c.y + f * (o.p.y - gs.c.y))))
          h.scale.set(o.sx * f, o.sy * f)
        } else {
          const d = Math.atan2(e.global.y - gs.c.y, e.global.x - gs.c.x) - gs.a0
          const o = gs.orig.get(id)!
          const dx = o.p.x - gs.c.x, dy = o.p.y - gs.c.y
          h.position.copyFrom(h.parent!.toLocal(new Point(gs.c.x + dx * Math.cos(d) - dy * Math.sin(d), gs.c.y + dx * Math.sin(d) + dy * Math.cos(d))))
          h.rotation = o.r + d
        }
      }
      return this.drawOverlay()
    }
    const holder = this.holders.get(gs.id)
    if (!holder) return
    if (gs.kind === 'move') {
      const p = holder.parent!.toLocal(e.global)
      holder.position.set(p.x + gs.dx, p.y + gs.dy)
    } else if (gs.kind === 'pivot') {
      // move the pivot while keeping the artwork exactly where it is on screen
      const world = holder.toGlobal(holder.pivot) // current pivot in world
      const content = holder.toLocal(e.global) // new pivot candidate in holder-local space
      const oldPivot = holder.pivot.clone()
      const newWorldOfOld = holder.parent!.toLocal(world)
      holder.pivot.set(content.x, content.y)
      // restoring placement: shift position so the artwork does not move
      const shifted = holder.parent!.toLocal(holder.toGlobal(new Point(oldPivot.x, oldPivot.y)))
      holder.position.set(holder.x + (newWorldOfOld.x - shifted.x), holder.y + (newWorldOfOld.y - shifted.y))
    } else if (gs.kind === 'scale') {
      const c = this.handles()!.center
      const f = Math.max(0.02, Math.hypot(e.global.x - c.x, e.global.y - c.y) / gs.d0)
      holder.scale.set(gs.sx * f, gs.sy * f)
    } else {
      const piv = holder.toGlobal(holder.pivot)
      holder.rotation = ((gs.r0 + deg(Math.atan2(e.global.y - piv.y, e.global.x - piv.x) - gs.a0)) * Math.PI) / 180
    }
    this.drawOverlay()
  }

  private endGesture() {
    const gs = this.gesture
    this.gesture = null
    if (!gs) return
    if (gs.kind === 'marquee') {
      const x0 = Math.min(gs.x0, gs.x1), x1 = Math.max(gs.x0, gs.x1), y0 = Math.min(gs.y0, gs.y1), y1 = Math.max(gs.y0, gs.y1)
      this.drawOverlay()
      if (x1 - x0 < 4 && y1 - y0 < 4) { // a plain click
        if (gs.click) this.cb.onSelect(gs.click)
        else if (!gs.additive) this.cb.onSelect(null)
        return
      }
      const rect = new Rectangle(x0, y0, x1 - x0, y1 - y0)
      const hits: string[] = []
      for (const [id, l] of this.layers) {
        if (l.locked) continue // backgrounds and other locked layers are not picked up by the rubber band
        const b = this.boundsOf(id)
        if (b && b.right >= rect.x && b.x <= rect.right && b.bottom >= rect.y && b.y <= rect.bottom) hits.push(id)
      }
      this.cb.onSelectMany(hits, gs.additive)
      return
    }
    if (gs.kind === 'gmove' || gs.kind === 'gscale' || gs.kind === 'grotate') {
      const patches: Record<string, Partial<Layer>> = {}
      for (const id of gs.ids) {
        const h = this.holders.get(id)
        const before = this.layers.get(id)
        if (!h || !before) continue
        const patch: Partial<Layer> = {
          x: round(h.x), y: round(h.y),
          scaleX: round(h.scale.x, 1000) || before.scaleX, scaleY: round(h.scale.y, 1000) || before.scaleY,
          rotation: round(((deg(h.rotation) % 360) + 360) % 360),
        }
        const changed: Partial<Layer> = {}
        for (const k of Object.keys(patch) as (keyof Layer)[]) if (patch[k] !== before[k]) (changed as any)[k] = patch[k]
        if (Object.keys(changed).length) patches[id] = changed
      }
      if (Object.keys(patches).length) this.cb.onCommitMany(patches)
      return
    }
    const holder = this.holders.get(gs.id)
    const before = this.layers.get(gs.id)
    if (!holder || !before) return
    const patch: Partial<Layer> = {
      x: round(holder.x),
      y: round(holder.y),
      scaleX: round(holder.scale.x, 1000) || before.scaleX,
      scaleY: round(holder.scale.y, 1000) || before.scaleY,
      rotation: round(((deg(holder.rotation) % 360) + 360) % 360),
    }
    if (gs.kind === 'pivot') {
      patch.pivotX = round(holder.pivot.x)
      patch.pivotY = round(holder.pivot.y)
    }
    const changed: Partial<Layer> = {}
    for (const k of Object.keys(patch) as (keyof Layer)[]) {
      const b = (before[k] as number | undefined) ?? (k === 'pivotX' || k === 'pivotY' ? 0 : undefined)
      if (patch[k] !== b) (changed as any)[k] = patch[k]
    }
    if (Object.keys(changed).length) this.cb.onCommit(gs.id, changed)
  }

  // ---- export recording ----------------------------------------------------

  /**
   * Render `count` frames deterministically (frame i at i/fps) to PNG blobs. With `transparent` the scene background is
   * not drawn, so PNGs keep a real alpha channel. Bones, onion skin and handles are hidden like in record().
   */
  async renderFrames(count: number, fps: number, renderAt: (seconds: number) => void, transparent: boolean, onProgress?: (p: number) => void): Promise<Blob[]> {
    const wasVisible = this.overlay.visible
    const bg = this.app.renderer.background.alpha
    this.overlay.visible = false
    this.ghosts.visible = false
    this.app.ticker.stop()
    try {
      const out: Blob[] = []
      for (let i = 0; i < count; i++) {
        renderAt(i / fps)
        if (transparent) this.app.renderer.background.alpha = 0 // sync() may reset the colour, never the alpha
        this.app.render()
        out.push(await new Promise<Blob>((res, rej) => this.app.canvas.toBlob((b) => (b ? res(b) : rej(new Error('Gagal mengambil frame.'))), 'image/png')))
        onProgress?.((i + 1) / count)
      }
      return out
    } finally {
      this.app.renderer.background.alpha = bg
      this.overlay.visible = wasVisible
      this.ghosts.visible = true
      this.app.ticker.start()
    }
  }

  /**
   * Record the canvas to a WebM blob for `duration` seconds. Frames are pushed explicitly
   * (requestFrame) so a static scene still yields a constant-frame-rate video.
   * Bones, onion skin and selection handles are never part of the output.
   */
  async record(duration: number, fps: number, onProgress?: (p: number) => void, renderAt?: (seconds: number) => void): Promise<Blob> {
    const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m))
    if (!mime) throw new Error('Browser ini tidak mendukung perekaman WebM (MediaRecorder).')

    const wasVisible = this.overlay.visible
    this.overlay.visible = false
    this.ghosts.visible = false
    this.app.ticker.stop()
    try {
      const stream = this.app.canvas.captureStream(0)
      const track = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void }
      if (!track.requestFrame) throw new Error('Browser tidak mendukung CanvasCaptureMediaStreamTrack.requestFrame.')

      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 })
      const chunks: Blob[] = []
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
      const stopped = new Promise<void>((res, rej) => {
        rec.onstop = () => res()
        rec.onerror = () => rej(new Error('Perekaman gagal.'))
      })

      rec.start(250)
      const t0 = performance.now()
      await new Promise<void>((resolve) => {
        const tick = () => {
          const elapsed = (performance.now() - t0) / 1000
          renderAt?.(Math.min(elapsed, duration))
          this.app.render()
          track.requestFrame!()
          onProgress?.(Math.min(1, elapsed / duration))
          if (elapsed >= duration) return resolve()
          setTimeout(tick, 1000 / fps)
        }
        tick()
      })
      rec.stop()
      await stopped
      stream.getTracks().forEach((t) => t.stop())
      return new Blob(chunks, { type: 'video/webm' })
    } finally {
      this.overlay.visible = wasVisible
      this.ghosts.visible = true
      this.app.ticker.start()
    }
  }
}

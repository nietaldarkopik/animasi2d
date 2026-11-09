import { api } from '../api'
import { uid, useEditor } from '../store'
import type { Layer } from '../types'
import { buildRigLayers, fitScale, type BoneSpec, type PieceSpec } from './rig'
import { canvasBlob, renderCharacter } from './render'
import { bonesFromJoints, rigOf } from './charRig'
import { alphaBounds, pieceBlob, renderPartPieces, RIG_PX } from './rigRender'
import type { BuilderSummary } from './types'

/** A character whose pieces are already rendered and uploaded to the project: it can be placed in any number of scenes. */
export interface PreparedRig {
  name: string
  version: number | null
  specs: PieceSpec[]
  /** the skeleton, built from the character's joints; default skeleton when omitted */
  bones?: BoneSpec[]
}

/**
 * Renders a Character Builder character into rig pieces (and one image per saved expression of eyes / brows / mouth) and
 * uploads them as project assets. Slow (a few seconds): do it once per character, then call `rigLayers` per scene.
 * Every part is cut ON ITS OWN at the character's joints (config.rig, set in the Builder; guessed from where the parts are when the
 * character has none), and the bones are built on those joints: it works for any design template.
 */
export async function prepareRig(projectId: number, c: Pick<BuilderSummary, 'id'>, onProgress?: (msg: string) => void): Promise<PreparedRig> {
  const [d, cats] = await Promise.all([api.builderGet(c.id), api.libCategories()])
  if (!d.config) throw new Error(`Karakter "${d.name}" belum punya versi.`)
  const z = Object.fromEntries(cats.map((x) => [x.slug, x.z_order]))
  const name = Object.fromEntries(cats.map((x) => [x.slug, x.name]))
  const own = rigOf(d.config)
  const { pieces, joints } = await renderPartPieces({
    config: d.config, assets: d.assets, zOf: (k) => z[k] ?? 0, labelOf: (k) => name[k] ?? k,
    onProgress: (a, b) => onProgress?.(`${d.name}: memotong bagian ${a}/${b}…`),
  }, own ?? null)
  if (pieces.length === 0) throw new Error(`Karakter "${d.name}" belum punya bagian yang terlihat.`)

  const specs: PieceSpec[] = []
  for (let i = 0; i < pieces.length; i++) {
    onProgress?.(`${d.name}: mengunggah gambar ${i + 1}/${pieces.length}…`)
    const asset = await api.uploadAsset(projectId, await pieceBlob(pieces[i]), `${d.name}-${pieces[i].spec.key}.png`)
    useEditor.getState().addAsset(asset)
    const expr: Record<string, number> = {}
    for (const [eid, cv] of Object.entries(pieces[i].variants ?? {})) {
      const va = await api.uploadAsset(projectId, await canvasBlob(cv), `${d.name}-${pieces[i].spec.key}-${eid}.png`)
      useEditor.getState().addAsset(va)
      expr[eid] = va.id
    }
    specs.push({ ...pieces[i].spec, assetId: asset.id, ...(Object.keys(expr).length ? { expr } : {}) })
  }
  return { name: d.name, version: d.viewing, specs, bones: bonesFromJoints(joints) }
}

/** A character drawn as ONE image (a member of a crowd: it only stands and breathes, so it needs no bones). */
export interface FlatFigure { name: string; assetId: number; box: { x0: number; y0: number; x1: number; y1: number } }

export async function prepareFlat(projectId: number, c: Pick<BuilderSummary, 'id'>): Promise<FlatFigure> {
  const [d, cats] = await Promise.all([api.builderGet(c.id), api.libCategories()])
  if (!d.config) throw new Error(`Karakter "${d.name}" belum punya versi.`)
  const z = Object.fromEntries(cats.map((x) => [x.slug, x.z_order]))
  const cv = await renderCharacter(d.config, d.assets, { scale: RIG_PX, zOf: (k) => z[k] ?? 0, transparent: true, rect: { x: 0, y: 0, w: 400, h: 800 } })
  const b = alphaBounds(cv)
  if (!b) throw new Error(`Karakter "${d.name}" belum punya bagian yang terlihat.`)
  const out = document.createElement('canvas')
  out.width = b.w
  out.height = b.h
  out.getContext('2d')!.drawImage(cv, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h)
  const asset = await api.uploadAsset(projectId, await canvasBlob(out), `${d.name}-utuh.png`)
  useEditor.getState().addAsset(asset)
  return { name: d.name, assetId: asset.id, box: { x0: b.x / RIG_PX, y0: b.y / RIG_PX, x1: (b.x + b.w) / RIG_PX, y1: (b.y + b.h) / RIG_PX } }
}

/** Top and bottom of the figure (feet) in character-canvas units, from the pieces it is made of. */
export function figureExtent(p: PreparedRig): { top: number; bottom: number } {
  return { top: Math.min(...p.specs.map((s) => s.box.y0)), bottom: Math.max(...p.specs.map((s) => s.box.y1)) }
}

/**
 * Fresh layers (bones + images) for one placement of a prepared character. `xFrac` = where it stands (0..1 of the scene width);
 * `footY` = the scene y its feet should touch (otherwise the figure is centred vertically).
 */
export function rigLayers(p: PreparedRig, scene: { width: number; height: number }, opts: { xFrac?: number; scale?: number; footY?: number } = {}): Layer[] {
  const k = fitScale(scene.height) * (opts.scale ?? 1)
  const layers = buildRigLayers({ scene, k, pxPerUnit: RIG_PX, name: p.version ? `${p.name} v${p.version}` : p.name, pieces: p.specs, bones: p.bones, newId: uid })
  const dx = ((opts.xFrac ?? 0.5) - 0.5) * scene.width
  // the figure is built centred on scene.height / 2 at canvas y = 415, so its feet are at: height / 2 + k * (bottom - 415)
  const dy = opts.footY === undefined ? 0 : opts.footY - (scene.height / 2 + k * (figureExtent(p).bottom - 415))
  if (dx !== 0 || dy !== 0) for (const l of layers) if (!l.parentId) { l.x += dx; l.y += dy } // only the root bone has no parent; everything else follows it
  return layers
}

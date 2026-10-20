import { api } from '../api'
import { uid, useEditor } from '../store'
import type { Layer } from '../types'
import { detectKit, kitFileUrl, loadKit, loadKitIndex, placeKit, withoutSlots } from './kitRig'
import { buildRigLayers, fitScale, type BoneSpec, type PieceSpec } from './rig'
import { canvasBlob } from './render'
import { pieceBlob, renderRigPieces, RIG_PX } from './rigRender'
import type { BuilderSummary } from './types'

/** A character whose pieces are already rendered and uploaded to the project: it can be placed in any number of scenes. */
export interface PreparedRig {
  name: string
  version: number | null
  specs: PieceSpec[]
  /** the skeleton (a body kit brings its own); default skeleton when omitted */
  bones?: BoneSpec[]
  /** label of the body kit used, if any */
  kit?: string
}

/** A kit piece image, resampled when the kit was scaled in the Builder (rig images are always RIG_PX per canvas unit). */
async function kitPieceBlob(url: string, scale: number): Promise<Blob> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`Gambar kit tidak ditemukan: ${url}`)
  const blob = await r.blob()
  if (Math.abs(scale - 1) < 1e-3) return blob
  const bmp = await createImageBitmap(blob)
  const cv = document.createElement('canvas')
  cv.width = Math.max(1, Math.round(bmp.width * scale))
  cv.height = Math.max(1, Math.round(bmp.height * scale))
  const ctx = cv.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bmp, 0, 0, cv.width, cv.height)
  return canvasBlob(cv)
}

/**
 * Renders a Character Builder character into rig pieces (and one image per saved expression of eyes / brows / mouth) and
 * uploads them as project assets. Slow (a few seconds): do it once per character, then call `rigLayers` per scene.
 * A character wearing a body kit ("Kit SMA …" library assets) gets the kit's skeleton and ready-cut body pieces; only the
 * rest (head, accessories) is cut by the generic renderer.
 */
export async function prepareRig(projectId: number, c: Pick<BuilderSummary, 'id'>, onProgress?: (msg: string) => void): Promise<PreparedRig> {
  const [d, cats, kits] = await Promise.all([api.builderGet(c.id), api.libCategories(), loadKitIndex()])
  if (!d.config) throw new Error(`Karakter "${d.name}" belum punya versi.`)
  const z = Object.fromEntries(cats.map((x) => [x.slug, x.z_order]))
  const name = Object.fromEntries(cats.map((x) => [x.slug, x.name]))
  const found = detectKit(d.config, d.assets, kits)

  const pieces = await renderRigPieces({
    config: found ? withoutSlots(d.config, found.slots) : d.config, assets: d.assets, zOf: (k) => z[k] ?? 0, labelOf: (k) => name[k] ?? k,
    onProgress: (a, b) => onProgress?.(`${d.name}: memotong bagian ${a}/${b}…`),
  })
  if (pieces.length === 0 && !found) throw new Error(`Karakter "${d.name}" belum punya bagian yang terlihat.`)
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
  if (!found) return { name: d.name, version: d.viewing, specs }

  // body kit: its own bones + pieces, moved/scaled the way the kit was placed in the Builder
  const kit = await loadKit(found.kit.id)
  const anchorSlot = found.slots.includes('top') ? 'top' : found.slots[0]
  const placed = placeKit(kit, anchorSlot, d.config.parts[anchorSlot])
  const kitParts = placed.parts.filter((p) => found.slots.includes(p.slot))
  for (let i = 0; i < kitParts.length; i++) {
    const p = kitParts[i]
    onProgress?.(`${d.name}: memasang kit badan ${i + 1}/${kitParts.length}…`)
    const asset = await api.uploadAsset(projectId, await kitPieceBlob(kitFileUrl(kit.id, p.file), placed.scale), `${d.name}-kit-${p.key}.png`)
    useEditor.getState().addAsset(asset)
    specs.push({ key: `kit_${p.key}`, name: p.name, bone: p.bone, order: p.order, box: p.box, assetId: asset.id })
  }
  // generic pieces may hang on bones a kit doesn't have: fall back to the kit's torso
  const keys = new Set(placed.bones.map((b) => b.key))
  for (const s of specs) if (!keys.has(s.bone)) s.bone = keys.has('torso') ? 'torso' : placed.bones[0].key
  return { name: d.name, version: d.viewing, specs, bones: placed.bones, kit: kit.label }
}

/** Fresh layers (bones + images) for one placement of a prepared character. `xFrac` = where it stands (0..1 of the scene width). */
export function rigLayers(p: PreparedRig, scene: { width: number; height: number }, opts: { xFrac?: number; scale?: number } = {}): Layer[] {
  const k = fitScale(scene.height) * (opts.scale ?? 1)
  const layers = buildRigLayers({ scene, k, pxPerUnit: RIG_PX, name: p.version ? `${p.name} v${p.version}` : p.name, pieces: p.specs, bones: p.bones, newId: uid })
  const dx = ((opts.xFrac ?? 0.5) - 0.5) * scene.width
  if (dx !== 0) for (const l of layers) if (!l.parentId) l.x += dx // only the root bone has no parent; everything else follows it
  return layers
}

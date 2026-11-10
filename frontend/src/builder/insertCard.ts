import { api } from '../api'
import { useEditor } from '../store'
import { absUrl, canvasBlob } from './render'
import { drawCard, type CardAssets, type PreparedCard } from './card'
import { alphaBounds, RIG_PX } from './rigRender'
import type { FlatFigure } from './insertRig'

/**
 * Uploads every PNG of a 2.5D card character (bodies, heads, mouth shapes, eyelid) to the project as assets. Do it once per
 * character and project, then call `cardLayers` per placement.
 */
export async function prepareCard(projectId: number, c: { id: number }, onProgress?: (msg: string) => void): Promise<PreparedCard> {
  const d = await api.cardGet(c.id)
  if (!d.meta || !d.urls) throw new Error(`Karakter "${d.name}" belum punya versi.`)
  const urls = d.urls
  const jobs: { group: 'body' | 'head' | 'mouth' | 'blink'; key: string; url: string }[] = [
    ...Object.entries(urls.body).map(([key, url]) => ({ group: 'body' as const, key, url })),
    ...Object.entries(urls.head).map(([key, url]) => ({ group: 'head' as const, key, url })),
    ...Object.entries(urls.mouth).map(([key, url]) => ({ group: 'mouth' as const, key, url })),
    ...(urls.blink ? [{ group: 'blink' as const, key: 'kelopak', url: urls.blink }] : []),
  ]
  const assets: CardAssets = { body: {}, head: {}, mouth: {}, blink: null }
  let done = 0
  // a few at a time: ~25 small PNGs
  const queue = [...jobs]
  const worker = async () => {
    for (let j = queue.shift(); j; j = queue.shift()) {
      const blob = await fetch(absUrl(j.url)).then((r) => { if (!r.ok) throw new Error(`Gagal mengambil gambar ${j.key} (${r.status}).`); return r.blob() })
      const asset = await api.uploadAsset(projectId, blob, `${d.name}-${j.group}-${j.key}.png`)
      useEditor.getState().addAsset(asset)
      if (j.group === 'blink') assets.blink = asset.id
      else assets[j.group][j.key] = asset.id
      onProgress?.(`${d.name}: mengunggah gambar ${++done}/${jobs.length}…`)
    }
  }
  await Promise.all([worker(), worker(), worker()])
  return { name: d.name, version: d.viewing, meta: d.meta, assets }
}

const loadImg = (url: string) => new Promise<HTMLImageElement>((ok, fail) => {
  const im = new Image()
  im.onload = () => ok(im)
  im.onerror = () => fail(new Error('Gagal memuat gambar karakter 2.5D.'))
  im.src = absUrl(url)
})

/**
 * A card character as ONE image (standing, neutral face) for the crowd. The box is in rig canvas units (RIG_PX image px per unit,
 * centred on x = 200 like a Builder character), so the auto-director sizes and places it with the same rule as other figures.
 */
export async function prepareCardFlat(projectId: number, c: { id: number }): Promise<FlatFigure> {
  const d = await api.cardGet(c.id)
  if (!d.meta || !d.urls) throw new Error(`Karakter "${d.name}" belum punya versi.`)
  const m = d.meta
  const pose = m.body.poses.includes('diam') ? 'diam' : m.body.poses[0]
  const expression = m.head.expressions.includes('netral') ? 'netral' : m.head.expressions[0]
  const loaded = new Map<string, HTMLImageElement>()
  for (const u of [d.urls.body[pose], d.urls.head[expression]]) loaded.set(u, await loadImg(u))
  const cv = document.createElement('canvas')
  ;[cv.width, cv.height] = m.body.canvas
  drawCard(cv.getContext('2d')!, m, (u) => loaded.get(u), d.urls, { pose, expression, mouth: null, blink: false })
  const b = alphaBounds(cv)
  if (!b) throw new Error(`Karakter "${d.name}" kosong.`)
  const out = document.createElement('canvas')
  out.width = b.w
  out.height = b.h
  out.getContext('2d')!.drawImage(cv, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h)
  const asset = await api.uploadAsset(projectId, await canvasBlob(out), `${d.name}-utuh.png`)
  useEditor.getState().addAsset(asset)
  const halfW = b.w / RIG_PX / 2
  return { name: d.name, assetId: asset.id, box: { x0: 200 - halfW, y0: 0, x1: 200 + halfW, y1: b.h / RIG_PX } }
}

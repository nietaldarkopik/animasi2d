import { useEffect, useState } from 'react'
import { api } from '../api'
import { canvasBlob, renderCharacter } from '../builder/render'
import { prepareRig, rigLayers } from '../builder/insertRig'
import type { BuilderSummary } from '../builder/types'
import { uid, useEditor } from '../store'
import type { Layer } from '../types'
import { Link } from 'react-router-dom'

export interface CharacterInfo { id: number; name: string; method: 'rig' | 'frame_by_frame'; parts: number }

/** The selected layer's whole tree: climb to the root, then take every descendant (the server needs a parent-closed set). */
export function characterTree(layers: Layer[], selectedId: string): string[] {
  const byId = new Map(layers.map((l) => [l.id, l]))
  let root = byId.get(selectedId)
  for (let i = 0; root?.parentId && byId.has(root.parentId) && i < 1000; i++) root = byId.get(root.parentId)
  if (!root) return []
  const out = [root.id]
  for (let i = 0; i < out.length; i++) for (const l of layers) if (l.parentId === out[i] && !out.includes(l.id)) out.push(l.id)
  return out
}

export function CharacterLibraryDialog({ projectId, onClose }: { projectId: number; onClose: () => void }) {
  const s = useEditor()
  const [list, setList] = useState<CharacterInfo[]>([])
  const [built, setBuilt] = useState<BuilderSummary[]>([])
  const [name, setName] = useState('')
  const [method, setMethod] = useState<'rig' | 'frame_by_frame'>('rig')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [progress, setProgress] = useState('')

  const load = () => api.characters().then(setList).catch((e) => setError((e as Error).message))
  useEffect(() => { void load(); api.builderList().then(setBuilt).catch(() => {}) }, [])

  const ids = s.doc && s.selectedId ? characterTree(s.doc.layers, s.selectedId) : []

  async function save() {
    setBusy(true)
    setError('')
    setNote('')
    try {
      if (!(await s.save())) throw new Error('Simpan project gagal; coba lagi.') // the server reads the saved document
      await api.saveCharacter(projectId, { name: name.trim(), method, scene_id: s.activeSceneId!, layer_ids: ids })
      setName('')
      setNote(`Karakter disimpan (${ids.length} layer).`)
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function insert(c: CharacterInfo) {
    setBusy(true)
    setError('')
    setNote('')
    try {
      const r = await api.instantiateCharacter(c.id, projectId)
      r.assets.forEach((a) => useEditor.getState().addAsset(a))
      r.layers.forEach((l) => useEditor.getState().addLayer(l))
      setNote(`"${c.name}" disisipkan ke scene aktif (${r.layers.length} layer).`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  /** Renders the builder character's current version to a transparent PNG, stores it as a project asset and adds an image layer. */
  async function insertBuilt(c: BuilderSummary) {
    if (!s.doc) return
    setBusy(true); setError(''); setNote('')
    try {
      const [d, cats] = await Promise.all([api.builderGet(c.id), api.libCategories()])
      if (!d.config) throw new Error('Karakter belum punya versi.')
      const z = Object.fromEntries(cats.map((x) => [x.slug, x.z_order]))
      const cv = await renderCharacter(d.config, d.assets, { scale: 2.5, zOf: (k) => z[k] ?? 0, transparent: true })
      const asset = await api.uploadAsset(projectId, await canvasBlob(cv), `${d.name}-v${d.viewing}.png`)
      useEditor.getState().addAsset(asset)
      const { width: W, height: H } = s.doc.settings
      const k = Math.min((H * 0.8) / asset.height, (W * 0.5) / asset.width)
      useEditor.getState().addLayer({ id: uid(), type: 'image', name: `${d.name} v${d.viewing}`, assetId: asset.id, x: W / 2, y: H / 2, scaleX: k, scaleY: k, rotation: 0, opacity: 1, visible: true, locked: false })
      setNote(`"${d.name}" v${d.viewing} disisipkan sebagai layer gambar. Perubahan karakter nanti tidak mengubah layer ini.`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  /**
   * Inserts the character as a rig: bones (hips -> torso -> head, arms and legs with two bones each) plus one image layer
   * per piece, so it can be posed, keyframed and given motion presets right away. Saved expressions become image variants.
   */
  async function insertRigged(c: BuilderSummary) {
    if (!s.doc) return
    setBusy(true); setError(''); setNote(''); setProgress('Menyiapkan…')
    try {
      const prepared = await prepareRig(projectId, c, setProgress)
      const layers = rigLayers(prepared, s.doc.settings)
      useEditor.getState().edit((doc) => { doc.layers.push(...layers) })
      const root = layers.find((l) => l.type === 'bone' && !l.parentId)
      if (root) useEditor.getState().select(root.id)
      const nExpr = new Set(prepared.specs.flatMap((p) => Object.keys(p.expr ?? {}))).size
      setNote(`"${prepared.name}" disisipkan sebagai rig${prepared.kit ? ` (badan dari ${prepared.kit})` : ''}: ${layers.filter((l) => l.type === 'bone').length} bone + ${prepared.specs.length} gambar${nExpr ? `, ${nExpr} ekspresi` : ''}. Pilih karakternya lalu pakai panel Alat film (Pose, Gerakan, Ekspresi) di sisi kanan. Catatan: rambut belakang menempel di badan (tidak ikut miring bersama kepala).`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false); setProgress('')
    }
  }

  async function remove(c: CharacterInfo) {
    if (!confirm(`Hapus karakter "${c.name}" dari library? Layer di project tidak terpengaruh.`)) return
    try { await api.deleteCharacter(c.id); await load() } catch (e) { setError((e as Error).message) }
  }

  return (
    <div className="modal" onClick={() => !busy && onClose()}>
      <div role="dialog" aria-modal="true" className="card dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Library karakter</h2>
        <p className="muted small">Simpan satu karakter (layer terpilih beserta seluruh bone/bagian dalam hierarkinya, termasuk keyframe) lalu sisipkan ke project atau scene mana pun.</p>

        <h3>Dari Character Builder</h3>
        {built.length === 0 ? <p className="muted small">Belum ada. Buat di <Link to="/builder">Character Builder</Link>.</p> : (
          <ul className="plain">
            {built.map((c) => (
              <li key={c.id} className="row between">
                <span>{c.name} <span className="badge">v{c.current_version}</span></span>
                <span className="row" style={{ gap: 4 }}>
                  <button className="primary" disabled={busy} onClick={() => void insertRigged(c)} title="Bagian terpisah + tulang (bone): langsung bisa digerakkan, di-keyframe, dan diberi preset gerak">Sisipkan + bone</button>
                  <button disabled={busy} onClick={() => void insertBuilt(c)} title="Satu gambar utuh (tidak bisa digerakkan per bagian)">Gambar saja</button>
                </span>
              </li>
            ))}
          </ul>
        )}

        <h3>Simpan layer terpilih (rig)</h3>
        {ids.length === 0 ? <p className="muted small">Pilih salah satu layer karakter (bone atau bagian) di scene.</p> : (
          <>
            <p className="small">{ids.length} layer akan disimpan.</p>
            <label className="field"><span>Nama</span><input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /></label>
            <label className="field"><span>Metode animasi</span>
              <select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
                <option value="rig">Rig (bagian terpisah + bone)</option>
                <option value="frame_by_frame">Frame-by-frame</option>
              </select>
            </label>
            <button className="primary" disabled={busy || !name.trim()} onClick={() => void save()}>Simpan ke library</button>
          </>
        )}

        {progress && <p className="small" role="status">{progress}</p>}
        {error && <div className="error" role="alert">{error}</div>}
        {note && <p className="small" style={{ color: 'var(--ok)' }}>{note}</p>}

        <h3>Karakter rig tersimpan</h3>
        {list.length === 0 ? <p className="muted small">Belum ada.</p> : (
          <ul className="plain">
            {list.map((c) => (
              <li key={c.id} className="row between">
                <span>{c.name} <span className="muted small">· {c.method === 'rig' ? 'rig' : 'frame-by-frame'} · {c.parts} layer</span></span>
                <span className="row">
                  <button disabled={busy} onClick={() => void insert(c)}>Sisipkan ke scene</button>
                  <button disabled={busy} onClick={() => void remove(c)} aria-label={`Hapus ${c.name}`}>🗑</button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="row end"><button onClick={onClose} disabled={busy}>Tutup</button></div>
      </div>
    </div>
  )
}

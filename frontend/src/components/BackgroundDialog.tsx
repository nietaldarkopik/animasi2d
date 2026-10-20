import { useEffect, useState } from 'react'
import { api } from '../api'
import { absUrl, backgroundPng } from '../builder/render'
import type { LibAsset, LibCategory } from '../builder/types'
import { uid, useEditor } from '../store'

/** Pick a location (school, home, park…) from the library and place it as the bottom, locked layer of the active scene. */
export function BackgroundDialog({ projectId, onClose }: { projectId: number; onClose: () => void }) {
  const s = useEditor()
  const [bgs, setBgs] = useState<LibAsset[] | null>(null)
  const [cats, setCats] = useState<LibCategory[]>([])
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')

  useEffect(() => {
    Promise.all([api.libAssets({ kind: 'background' }), api.libCategories()]).then(([a, c]) => { setBgs(a); setCats(c) }).catch((e) => setError((e as Error).message))
  }, [])

  async function use(a: LibAsset) {
    if (!s.doc) return
    setBusy(a.id); setError(''); setNote('')
    try {
      const { width: W, height: H } = s.doc.settings
      const asset = await api.uploadAsset(projectId, await backgroundPng(a, W, H), `latar-${a.key ?? a.id}.png`)
      useEditor.getState().addAsset(asset)
      useEditor.getState().edit((d) => {
        // replace a previous location layer instead of stacking them
        d.layers = d.layers.filter((l) => !l.name.startsWith('Latar: '))
        d.layers.unshift({ id: uid(), type: 'image', name: `Latar: ${a.name}`, assetId: asset.id, x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, visible: true, locked: true })
      })
      setNote(`Latar “${a.name}” dipasang di scene aktif (layer paling bawah, terkunci).`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const catName = (slug: string) => cats.find((c) => c.slug === slug)?.name ?? slug
  return (
    <div className="modal" onClick={() => busy === null && onClose()}>
      <div role="dialog" aria-modal="true" className="card dialog wide" onClick={(e) => e.stopPropagation()}>
        <h2>Latar / lokasi</h2>
        <p className="muted small">Pilih lokasi untuk scene aktif. Gambar dibuat sesuai ukuran kanvas proyek. Tambah lokasi sendiri atau dengan AI di halaman Library Aset.</p>
        {error && <div className="error" role="alert">{error}</div>}
        {note && <p className="small" style={{ color: 'var(--ok)' }}>{note}</p>}
        {bgs === null ? <p className="muted">Memuat…</p> : bgs.length === 0 ? <p className="muted">Belum ada lokasi.</p> : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 12 }}>
            {bgs.map((a) => (
              <button key={a.id} disabled={busy !== null} onClick={() => void use(a)} style={{ padding: 6, textAlign: 'left' }}>
                <img src={absUrl(a.url)} alt={a.name} style={{ width: '100%', aspectRatio: '16 / 9', objectFit: 'cover', borderRadius: 4 }} loading="lazy" />
                <div className="small"><strong>{a.name}</strong><br /><span className="muted">{catName(a.category)}{busy === a.id ? ' · memasang…' : ''}</span></div>
              </button>
            ))}
          </div>
        )}
        <div className="row end"><button onClick={onClose} disabled={busy !== null}>Tutup</button></div>
      </div>
    </div>
  )
}

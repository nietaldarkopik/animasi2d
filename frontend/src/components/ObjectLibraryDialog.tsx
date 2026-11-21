import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { absUrl } from '../builder/render'
import type { LibAsset, LibCategory } from '../builder/types'
import { uid, useEditor } from '../store'

/** Reusable scene props live in the shared asset library, never in a character version. */
export function ObjectLibraryDialog({ projectId, onClose }: { projectId: number; onClose: () => void }) {
  const [categories, setCategories] = useState<LibCategory[]>([])
  const [assets, setAssets] = useState<LibAsset[]>([])
  const [category, setCategory] = useState('')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const uploadRef = useRef<HTMLInputElement>(null)
  const doc = useEditor((s) => s.doc)

  const propCategories = useMemo(() => categories.filter((c) => c.kind === 'prop'), [categories])
  const filtered = useMemo(() => assets.filter((a) => !category || a.category === category).filter((a) => {
    const q = query.trim().toLocaleLowerCase('id')
    return !q || a.name.toLocaleLowerCase('id').includes(q) || a.tags.some((t) => t.toLocaleLowerCase('id').includes(q))
  }), [assets, category, query])

  async function load() {
    const [cats, items] = await Promise.all([api.libCategories(), api.libAssets({ kind: 'prop' })])
    setCategories(cats)
    setAssets(items)
    setCategory((current) => current || cats.find((c) => c.kind === 'prop')?.slug || '')
  }

  useEffect(() => { void load().catch((e) => setError((e as Error).message)) }, [])

  async function insert(asset: LibAsset) {
    if (!doc) return
    setBusy(true); setError(''); setNote('')
    try {
      const image = new Image()
      image.crossOrigin = 'anonymous'
      image.src = absUrl(asset.url)
      await image.decode()
      const limit = 2400
      const scale = Math.min(1, limit / Math.max(image.naturalWidth, image.naturalHeight))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Tidak dapat menyiapkan gambar object.')
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => b ? resolve(b) : reject(new Error('Gagal mengubah object menjadi PNG.')), 'image/png'))
      const projectAsset = await api.uploadAsset(projectId, blob, asset.name.replace(/[\\/:*?"<>|]/g, '_') + '.png')
      useEditor.getState().addAsset(projectAsset)
      const { width: W, height: H } = doc.settings
      const fit = Math.min(1, (W * 0.55) / projectAsset.width, (H * 0.65) / projectAsset.height)
      useEditor.getState().addLayer({
        id: uid(), type: 'image', name: asset.name, assetId: projectAsset.id,
        x: W / 2, y: H / 2, scaleX: fit, scaleY: fit,
        rotation: 0, opacity: 1, visible: true, locked: false,
      })
      setNote(`"${asset.name}" ditambahkan ke scene aktif sebagai layer object.`)
    } catch (e) {
      setError((e as Error).message || 'Gagal menyisipkan object.')
    } finally { setBusy(false) }
  }

  async function upload(file?: File) {
    if (!file) return
    if (!category) { setError('Kategori object belum tersedia.'); return }
    setBusy(true); setError(''); setNote('')
    try {
      const name = file.name.replace(/\\.[^.]+$/, '').replace(/[_-]+/g, ' ')
      const asset = await api.libUpload(file, category, name, 'object, properti')
      setAssets((old) => [asset, ...old.filter((a) => a.id !== asset.id)])
      setNote(`"${asset.name}" tersimpan di Object Library.`)
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false); if (uploadRef.current) uploadRef.current.value = '' }
  }

  return (
    <div className="modal" onClick={() => !busy && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="object-library-title" className="card dialog" style={{ width: 'min(920px, 94vw)', maxHeight: '88vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <h2 id="object-library-title">Object Library</h2>
        <p className="muted small">Pilih object untuk scene aktif. Object disimpan terpisah dari karakter dan dapat digunakan ulang di scene atau project lain.</p>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <select aria-label="Kategori object" value={category} onChange={(e) => setCategory(e.target.value)}>
            {propCategories.map((c) => <option key={c.id} value={c.slug}>{c.name}</option>)}
          </select>
          <input aria-label="Cari object" placeholder="Cari nama atau tag…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <button disabled={busy || propCategories.length === 0} onClick={() => uploadRef.current?.click()}>+ Upload object</button>
          <input ref={uploadRef} hidden type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg" onChange={(e) => void upload(e.target.files?.[0])} />
        </div>
        {busy && <p className="small" role="status">Memproses object…</p>}
        {error && <div className="error" role="alert">{error}</div>}
        {note && <p className="small" style={{ color: 'var(--ok)' }}>{note}</p>}
        {filtered.length === 0 ? <p className="muted small">Belum ada object pada kategori ini. Upload PNG, JPG, WebP, atau SVG untuk mulai mengisi library.</p> : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(145px, 1fr))', gap: 12, marginTop: 14 }}>
            {filtered.map((asset) => (
              <button key={asset.id} type="button" disabled={busy} onClick={() => void insert(asset)} title={`Tambahkan ${asset.name} ke scene`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 6, padding: 8, minWidth: 0 }}>
                <span style={{ height: 112, display: 'grid', placeItems: 'center', background: 'repeating-conic-gradient(#ddd 0% 25%, #fff 0% 50%) 50% / 16px 16px', borderRadius: 6, overflow: 'hidden' }}>
                  <img src={absUrl(asset.url)} alt="" loading="lazy" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                </span>
                <strong style={{ fontSize: 13, textAlign: 'left' }}>{asset.name}</strong>
                <span className="muted small" style={{ textAlign: 'left' }}>{asset.width} × {asset.height} · {asset.source === 'system' ? 'Bawaan' : 'Library'}</span>
              </button>
            ))}
          </div>
        )}
        <div className="row end" style={{ marginTop: 16 }}><button onClick={onClose} disabled={busy}>Tutup</button></div>
      </div>
    </div>
  )
}

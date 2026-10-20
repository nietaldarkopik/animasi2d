import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, setToken } from '../api'
import { absUrl } from '../builder/render'
import type { LibAsset, LibCategory } from '../builder/types'
import { AppNav } from '../components/AppNav'
import { AssetEditDialog } from '../components/AssetEditDialog'
import { ImageToSvgDialog } from '../components/ImageToSvgDialog'

const CHECKER = 'repeating-conic-gradient(#2b2f3a 0 25%, #20232c 0 50%) 0 0 / 14px 14px'

function Thumb({ a, size = 120 }: { a: LibAsset; size?: number }) {
  const bg = a.category.startsWith('bg_')
  return (
    <div style={{ width: size, height: bg ? size * 0.5625 : size * 1.3, background: CHECKER, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}>
      <img src={absUrl(a.url)} alt={a.name} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
    </div>
  )
}

export function LibraryPage() {
  const nav = useNavigate()
  const [cats, setCats] = useState<LibCategory[]>([])
  const [kind, setKind] = useState<'part' | 'background' | 'reference' | 'prop'>('part')
  const [category, setCategory] = useState('')
  const [q, setQ] = useState('')
  const [assets, setAssets] = useState<LibAsset[] | null>(null)
  const [pending, setPending] = useState<LibAsset[]>([])
  const [upscaler, setUpscaler] = useState<{ available: boolean; reason?: string | null } | null>(null)
  const [hd, setHd] = useState<{ id: number; factor: number } | null>(null)
  const [editing, setEditing] = useState<LibAsset | null>(null)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')

  // upload
  const file = useRef<HTMLInputElement>(null)
  const [upCat, setUpCat] = useState('hat')
  const [upName, setUpName] = useState('')
  const [upTags, setUpTags] = useState('')
  const [busy, setBusy] = useState(false)

  // AI
  const [aiCat, setAiCat] = useState('hat')
  const [trace, setTrace] = useState<File | null>(null)
  const traceInput = useRef<HTMLInputElement>(null)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiState, setAiState] = useState<'idle' | 'working'>('idle')
  const alive = useRef(true)

  useEffect(() => { document.title = 'Library Aset — Cartoon Maker AI'; alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => { api.libCategories().then(setCats).catch((e) => setError(e.message)) }, [])
  useEffect(() => { api.enhanceModes().then((r) => { const m = r.modes.find((x) => x.id === 'upscale_ai'); setUpscaler({ available: !!m?.available, reason: m?.unavailable_reason }) }).catch(() => {}) }, [])

  const load = () => {
    api.libAssets({ kind, category, q }).then(setAssets).catch((e) => setError(e.message))
    api.libAssets({ status: 'pending', mine: true }).then(setPending).catch(() => {})
  }
  useEffect(() => { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t) }, [kind, category, q]) // eslint-disable-line react-hooks/exhaustive-deps

  const kindCats = cats.filter((c) => c.kind === kind)
  const partCats = cats.filter((c) => c.kind === 'part')

  async function upload(e: FormEvent) {
    e.preventDefault()
    const f = file.current?.files?.[0]
    if (!f) return setError('Pilih file SVG/PNG dulu.')
    if (!upName.trim()) return setError('Isi nama aset.')
    setBusy(true); setError(''); setNote('')
    try {
      await api.libUpload(f, upCat, upName.trim(), upTags)
      setNote('Aset diunggah.'); setUpName(''); setUpTags(''); if (file.current) file.current.value = ''
      load()
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }

  async function generate(e: FormEvent) {
    e.preventDefault()
    if (aiPrompt.trim().length < 3) return setError('Tulis deskripsi aset (min. 3 huruf).')
    setAiState('working'); setError(''); setNote('')
    try {
      const job = await api.libGenerate(aiCat, aiPrompt.trim())
      for (;;) {
        await new Promise((r) => setTimeout(r, 2000))
        if (!alive.current) return
        const j = await api.aiJob(job.id)
        if (j.status === 'failed') throw new Error(j.error ?? 'Pembuatan aset gagal.')
        if (j.status === 'done') break
      }
      setNote('Aset AI selesai dan menunggu review Anda di bawah. Aset baru dipakai di builder setelah disetujui.')
      setAiPrompt('')
      load()
    } catch (err) { setError((err as Error).message) } finally { if (alive.current) setAiState('idle') }
  }

  async function review(a: LibAsset, status: 'approved' | 'rejected') {
    setError('')
    try { await api.libUpdate(a.id, { status }); load() } catch (err) { setError((err as Error).message) }
  }

  async function makeHd(a: LibAsset, factor: number) {
    setError(''); setNote(''); setHd({ id: a.id, factor })
    try {
      const job = await api.libUpscale(a.id, factor)
      for (;;) {
        await new Promise((r) => setTimeout(r, 2500))
        if (!alive.current) return
        const j = await api.aiJob(job.id)
        if (j.status === 'failed') throw new Error(j.error ?? 'Peningkatan resolusi gagal.')
        if (j.status === 'done') break
      }
      setNote(`Salinan HD dari “${a.name}” dibuat (aset asli tidak berubah). Pakai di builder dengan memilihnya menggantikan aset lama.`)
      load()
    } catch (err) { setError((err as Error).message) } finally { if (alive.current) setHd(null) }
  }

  async function duplicate(a: LibAsset) {
    setError(''); setNote('')
    try { const c = await api.libDuplicate(a.id); setNote(`Salinan “${c.name}” dibuat di aset Anda. Klik Edit untuk merapikannya.`); load() } catch (err) { setError((err as Error).message) }
  }

  async function remove(a: LibAsset) {
    if (!confirm(`Hapus aset "${a.name}"?`)) return
    setError('')
    try {
      const r = await api.libDelete(a.id)
      setNote(r.archived ? 'Aset dipakai oleh versi karakter, jadi diarsipkan (disembunyikan) dan versi lama tetap utuh.' : 'Aset dihapus.')
      load()
    } catch (err) { setError((err as Error).message) }
  }

  return (
    <div className="page">
      <header className="topbar">
        <strong>Cartoon Maker AI</strong>
        <span style={{ width: 16 }} />
        <AppNav />
        <span className="spacer" />
        <button onClick={async () => { await api.logout().catch(() => {}); setToken(null); nav('/login', { replace: true }) }}>Keluar</button>
      </header>

      <main style={{ maxWidth: 1180, margin: '0 auto', padding: 16, display: 'grid', gap: 16 }}>
        <h1 style={{ margin: 0 }}>Library Aset</h1>
        {error && <div className="error" role="alert">{error}</div>}
        {note && <p className="small" style={{ color: 'var(--ok)', margin: 0 }}>{note}</p>}

        <div className="grid2" style={{ alignItems: 'start', gap: 16 }}>
          <form className="card" onSubmit={upload}>
            <h2 style={{ marginTop: 0 }}>Unggah manual</h2>
            <p className="muted small">SVG (disanitasi otomatis; kanvas karakter 400×800 agar langsung pas) atau PNG/JPEG/WebP (diposisikan otomatis, bisa digeser di builder).</p>
            <label className="field"><span>File</span><input ref={file} type="file" accept=".svg,image/svg+xml,image/png,image/jpeg,image/webp" /></label>
            <label className="field"><span>Kategori</span>
              <select value={upCat} onChange={(e) => setUpCat(e.target.value)}>{cats.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}</select>
            </label>
            <label className="field"><span>Nama</span><input value={upName} maxLength={120} onChange={(e) => setUpName(e.target.value)} /></label>
            <label className="field"><span>Tag (pisahkan koma)</span><input value={upTags} maxLength={200} onChange={(e) => setUpTags(e.target.value)} placeholder="topi, sekolah" /></label>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <button className="primary" disabled={busy}>{busy ? 'Mengunggah…' : 'Unggah'}</button>
              <button type="button" onClick={() => traceInput.current?.click()} title="Pilih JPG/PNG/WebP, ubah jadi SVG vektor (pelacakan), lalu simpan ke Library atau unduh">Ubah JPG/PNG jadi SVG…</button>
              <input ref={traceInput} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={(e) => { const f = e.target.files?.[0]; if (f) setTrace(f); e.target.value = '' }} />
            </div>
          </form>

          <form className="card" onSubmit={generate}>
            <h2 style={{ marginTop: 0 }}>AI Asset Studio</h2>
            <p className="muted small">Model AI menulis SVG di kanvas karakter yang sama. Hasil disanitasi lalu <strong>menunggu review</strong>; kualitas bervariasi, jadi periksa sebelum menyetujui.</p>
            <label className="field"><span>Kategori</span>
              <select value={aiCat} onChange={(e) => setAiCat(e.target.value)}>{cats.filter((c) => c.kind === 'part' || c.kind === 'background').map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}</select>
            </label>
            <label className="field"><span>Deskripsi</span>
              <textarea rows={3} value={aiPrompt} maxLength={400} onChange={(e) => setAiPrompt(e.target.value)} placeholder={cats.find((c) => c.slug === aiCat)?.kind === 'background' ? 'Perpustakaan sekolah dengan rak buku dan meja baca' : 'Topi rimba hijau dengan tali dagu'} />
            </label>
            <button className="primary" disabled={aiState === 'working'}>{aiState === 'working' ? 'AI sedang membuat…' : 'Buat dengan AI'}</button>
          </form>
        </div>

        {pending.length > 0 && (
          <section className="card">
            <h2 style={{ marginTop: 0 }}>Menunggu review ({pending.length})</h2>
            <div className="row" style={{ alignItems: 'start', gap: 16 }}>
              {pending.map((a) => (
                <div key={a.id} style={{ width: 150 }}>
                  <Thumb a={a} size={150} />
                  <div className="small" style={{ margin: '4px 0' }}><strong>{a.name}</strong><br /><span className="muted">{a.category}{a.meta?.model ? ` · ${a.meta.model}` : ''}</span></div>
                  <div className="row"><button className="primary" onClick={() => void review(a, 'approved')}>Setujui</button><button onClick={() => void review(a, 'rejected')}>Tolak</button></div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="card">
          <div className="row between">
            <div className="row">
              <button className={kind === 'part' ? 'primary' : ''} onClick={() => { setKind('part'); setCategory('') }}>Bagian karakter</button>
              <button className={kind === 'background' ? 'primary' : ''} onClick={() => { setKind('background'); setCategory('') }}>Lokasi / latar</button>
              <button className={kind === 'prop' ? 'primary' : ''} onClick={() => { setKind('prop'); setCategory('') }} title="Benda untuk scene film: buku, laptop, bola, payung…">Properti</button>
              <button className={kind === 'reference' ? 'primary' : ''} onClick={() => { setKind('reference'); setCategory('') }} title="Karakter utuh (pose, ekspresi): referensi gambar, bukan bagian builder">Referensi</button>
            </div>
            <div className="row">
              <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ width: 'auto' }} aria-label="Filter kategori">
                <option value="">Semua kategori</option>{kindCats.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
              </select>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama / tag…" style={{ width: 200 }} aria-label="Cari aset" />
            </div>
          </div>

          {assets === null ? <p className="muted">Memuat…</p> : assets.length === 0 ? <p className="muted">Tidak ada aset.</p> : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 14, marginTop: 12 }}>
              {assets.map((a) => (
                <div key={a.id} title={a.tags.join(', ')}>
                  <Thumb a={a} />
                  <div className="small" style={{ marginTop: 4 }}>
                    {a.name}
                    <div className="muted">{partCats.concat(cats).find((c) => c.slug === a.category)?.name}{a.source !== 'system' ? ` · ${a.source}` : ''}{a.status === 'pending' ? ' · pending' : ''}</div>
                  </div>
                  {a.mine && a.mime !== 'image/svg+xml' && Math.max(a.width, a.height) <= 1100 && (
                    <div className="row" style={{ gap: 4, margin: '2px 0' }}>
                      <button disabled={!upscaler?.available || hd !== null} title={upscaler?.available ? 'Buat salinan resolusi tinggi dengan AI lokal (Real-ESRGAN)' : (upscaler?.reason ?? 'Upscaler AI lokal belum tersedia')} onClick={() => void makeHd(a, 3)}>
                        {hd?.id === a.id ? 'Memproses…' : 'HD 3× (AI)'}
                      </button>
                    </div>
                  )}
                  <div className="row" style={{ gap: 8 }}>
                    {a.mine ? <button className="link" onClick={() => setEditing(a)}>edit</button> : <button className="link" onClick={() => void duplicate(a)} title="Buat salinan milik Anda yang bisa diedit">duplikat</button>}
                    {a.mine && <button className="link" onClick={() => void remove(a)}>hapus</button>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
      {trace && (
        <ImageToSvgDialog
          name={trace.name}
          file={trace}
          library={{ categories: cats, save: async (svg, category, name, tags) => { await api.libUpload(new File([svg], `${name}.svg`, { type: 'image/svg+xml' }), category, name, tags); load() } }}
          onClose={() => setTrace(null)}
        />
      )}
      {editing && <AssetEditDialog asset={editing} cats={cats} onClose={() => { setEditing(null); load() }} onSaved={({ asset }) => setEditing(asset)} />}
    </div>
  )
}

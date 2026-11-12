import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, setToken } from '../api'
import { absUrl } from '../builder/render'
import type { DesignFamilyInfo, Facing, LibAsset, LibCategory } from '../builder/types'
import { isFullCanvas, SLOT_ANCHORS } from '../builder/spec'
import { summarize } from '../builder/validation'
import { AppNav } from '../components/AppNav'
import { AssetEditDialog } from '../components/AssetEditDialog'
import { ImageToSvgDialog } from '../components/ImageToSvgDialog'

const FACINGS: [Facing, string][] = [['front', 'Depan'], ['right', 'Kanan'], ['left', 'Kiri'], ['back', 'Belakang']]
const CHECKER = 'repeating-conic-gradient(#2b2f3a 0 25%, #20232c 0 50%) 0 0 / 14px 14px'

function Thumb({ a, size = 120 }: { a: LibAsset; size?: number }) {
  const bg = a.category.startsWith('bg_')
  const an = SLOT_ANCHORS[a.category]
  const k = size / Math.max((an?.maxW ?? 260) * 1.15, 110)
  return (
    <div style={{ position: 'relative', width: size, height: bg ? size * 0.5625 : size * 1.3, background: CHECKER, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}>
      {an && isFullCanvas(a)
        // parts live on the shared 400x800 canvas: zoom to the region of their slot so the art fills the tile
        ? <>
            <img src={absUrl(a.url)} alt={a.name} loading="lazy" draggable={false} style={{ position: 'relative', maxWidth: 'none', width: 400 * k, height: 800 * k, left: size / 2 - an.cx * k, top: size * 0.65 - an.cy * k }} />
            {a.mirror && <img src={absUrl(a.url)} alt="" aria-hidden loading="lazy" draggable={false} style={{ position: 'absolute', maxWidth: 'none', width: 400 * k, height: 800 * k, left: size / 2 - an.cx * k, top: size * 0.65 - an.cy * k, transform: 'scaleX(-1)' }} />}
          </>
        : <img src={absUrl(a.url)} alt={a.name} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />}
    </div>
  )
}

/** The design-template findings of a part (review list): what is wrong, and a button to check again after fixing the file. */
function Findings({ a, onRecheck }: { a: LibAsset; onRecheck: () => void }) {
  const s = summarize(a.validation)
  if (s.level === 'ok') return a.validation ? <p className="small" style={{ margin: '0 0 4px', color: 'var(--ok)' }}>✓ Lolos validasi template</p> : null
  return (
    <div className="small" style={{ margin: '0 0 6px' }}>
      <strong style={{ color: s.level === 'error' ? 'var(--danger, #e5484d)' : 'var(--warn, #d9a40e)' }}>{s.level === 'error' ? '✗ Belum lolos validasi' : '! Catatan validasi'}</strong>
      <ul style={{ margin: '2px 0', paddingLeft: 16 }}>{s.messages.map((m, i) => <li key={i}>{m}</li>)}</ul>
      <button className="link" onClick={onRecheck}>Periksa ulang</button>
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
  const [historyAsset, setHistoryAsset] = useState<LibAsset | null>(null)
  const [historyVersions, setHistoryVersions] = useState<LibAsset[]>([])
  const [restoringVersion, setRestoringVersion] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')

  // upload
  const file = useRef<HTMLInputElement>(null)
  const [upCat, setUpCat] = useState('hat')
  const [upName, setUpName] = useState('')
  const [upTags, setUpTags] = useState('')
  const [upView, setUpView] = useState<Facing>('front')
  const [upFamily, setUpFamily] = useState('')
  const [families, setFamilies] = useState<Record<string, DesignFamilyInfo>>({})
  const [busy, setBusy] = useState(false)

  // AI
  const [aiCat, setAiCat] = useState('hat')
  const [trace, setTrace] = useState<File | null>(null)
  const traceInput = useRef<HTMLInputElement>(null)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiView, setAiView] = useState<Facing>('front')
  const [aiChar, setAiChar] = useState('')
  const [aiState, setAiState] = useState<'idle' | 'working'>('idle')
  const alive = useRef(true)

  useEffect(() => { document.title = 'Library Aset — Cartoon Maker AI'; alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => { api.designTemplate().then((t) => setFamilies(t.families)).catch(() => {}) }, [])
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
      await api.libUpload(f, upCat, upName.trim(), upTags, upView, upFamily)
      setNote('Aset diunggah.'); setUpName(''); setUpTags(''); if (file.current) file.current.value = ''
      load()
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }

  async function generate(e: FormEvent) {
    e.preventDefault()
    if (aiPrompt.trim().length < 3) return setError('Tulis deskripsi aset (min. 3 huruf).')
    setAiState('working'); setError(''); setNote('')
    try {
      const job = await api.libGenerate(aiCat, aiPrompt.trim(), aiView, aiChar.trim() || undefined)
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

  async function showHistory(a: LibAsset) {
    setError('')
    try {
      const versions = await api.libVersions(a.id)
      setHistoryAsset(a)
      setHistoryVersions(versions)
    } catch (err) { setError((err as Error).message) }
  }

  async function restoreVersion(version: LibAsset) {
    if (!confirm(`Restore “${version.name}” ke versi ${version.version_number}? Versi sekarang tetap tersimpan di history.`)) return
    setRestoringVersion(version.id); setError('')
    try {
      const restored = await api.libRestore(version.id, `Restore dari versi ${version.version_number}`)
      setHistoryAsset(restored)
      setHistoryVersions(await api.libVersions(restored.id))
      setNote(`Versi ${restored.version_number} berhasil dibuat dari snapshot lama. Riwayat sebelumnya tetap tersimpan.`)
      load()
    } catch (err) { setError((err as Error).message) } finally { setRestoringVersion(null) }
  }

  async function remove(a: LibAsset) {
    if (!confirm(`Hapus aset "${a.name}"?`)) return
    setError('')
    try {
      const r = await api.libDelete(a.id)
      setNote(r.archived ? 'Aset memiliki riwayat versi atau dipakai karakter, jadi diarsipkan. Snapshot lama tetap tersedia.' : 'Aset dihapus.')
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
            <p className="muted small">Bagian karakter apa pun (SVG, PNG, JPEG, WebP, ukuran bebas) otomatis dipas ke format standar slot-nya: kanvas 400×800, ukuran dan posisi tetap, sehingga bisa ditukar dengan bagian lain tanpa resize.</p>
            <label className="field"><span>File</span><input ref={file} type="file" accept=".svg,image/svg+xml,image/png,image/jpeg,image/webp" /></label>
            <label className="field"><span>Kategori</span>
              <select value={upCat} onChange={(e) => setUpCat(e.target.value)}>{cats.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}</select>
            </label>
            <label className="field"><span>Menghadap</span>
              <select value={upView} onChange={(e) => setUpView(e.target.value as Facing)}>{FACINGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            </label>
            <label className="field"><span>Keluarga desain</span>
              <select value={upFamily} onChange={(e) => setUpFamily(e.target.value)} title="Bagian yang digambar bersama (lembar laki-laki, lembar perempuan, kit…): hanya dibandingkan dengan bagian sekeluarga">
                <option value="">Otomatis (dari nama)</option>{Object.entries(families).map(([id, f]) => <option key={id} value={id}>{f.label}</option>)}
              </select>
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
            <p className="muted small">Semua bagian dibuat dengan gaya anime yang sama dan otomatis dipas ke format standar bagian (kanvas 400×800, posisi tetap per slot) agar bisa ditukar tanpa resize. Model AI menulis SVG di kanvas karakter yang sama. Hasil disanitasi lalu <strong>menunggu review</strong>; kualitas bervariasi, jadi periksa sebelum menyetujui.</p>
            <label className="field"><span>Kategori</span>
              <select value={aiCat} onChange={(e) => setAiCat(e.target.value)}>{cats.filter((c) => c.kind === 'part' || c.kind === 'background').map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}</select>
            </label>
            <label className="field"><span>Menghadap</span>
              <select value={aiView} onChange={(e) => setAiView(e.target.value as Facing)}>{FACINGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            </label>
            <label className="field"><span>Karakter (opsional)</span><input value={aiChar} maxLength={200} onChange={(e) => setAiChar(e.target.value)} placeholder="female, teenager, slim" /></label>
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
                  <Findings a={a} onRecheck={async () => { try { await api.libValidate(a.id); load() } catch (e) { setError((e as Error).message) } }} />
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
                    <div className="muted">{partCats.concat(cats).find((c) => c.slug === a.category)?.name}{a.source !== 'system' ? ` · ${a.source}` : ''}{a.status === 'pending' ? ' · pending' : ''}{a.family && a.family !== 'general' && families[a.family] ? ` · ${families[a.family].label}` : ''}{summarize(a.validation).level !== 'ok' ? <span title={summarize(a.validation).messages.join('\n')} style={{ color: summarize(a.validation).level === 'error' ? 'var(--danger, #e5484d)' : 'var(--warn, #d9a40e)' }}> · ⚠ validasi</span> : null}</div>
                  </div>
                  {a.mine && a.mime !== 'image/svg+xml' && Math.max(a.width, a.height) <= 1100 && (
                    <div className="row" style={{ gap: 4, margin: '2px 0' }}>
                      <button disabled={!upscaler?.available || hd !== null} title={upscaler?.available ? 'Buat salinan resolusi tinggi dengan AI lokal (Real-ESRGAN)' : (upscaler?.reason ?? 'Upscaler AI lokal belum tersedia')} onClick={() => void makeHd(a, 3)}>
                        {hd?.id === a.id ? 'Memproses…' : 'HD 3× (AI)'}
                      </button>
                    </div>
                  )}
                  <div className="row" style={{ gap: 8 }}>
                    {a.mine ? <>
                      <button className="link" onClick={() => setEditing(a)}>edit</button>
                      <button className="link" onClick={() => void showHistory(a)}>history · v{a.version_number}</button>
                    </> : <button className="link" onClick={() => void duplicate(a)} title="Buat salinan milik Anda yang bisa diedit">duplikat</button>}
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
      {historyAsset && (
        <div role="presentation" onClick={() => setHistoryAsset(null)} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.68)', display: 'grid', placeItems: 'center', padding: 16 }}>
          <section role="dialog" aria-modal="true" aria-labelledby="asset-history-title" onClick={(e) => e.stopPropagation()} className="card" style={{ width: 'min(720px, 96vw)', maxHeight: '85vh', overflow: 'auto', background: 'var(--panel, #20232c)' }}>
            <div className="row between" style={{ alignItems: 'center' }}>
              <div>
                <h2 id="asset-history-title" style={{ margin: 0 }}>Riwayat aset</h2>
                <p className="muted small" style={{ margin: '4px 0 0' }}>{historyAsset.name} · {historyVersions.length} versi</p>
              </div>
              <button onClick={() => setHistoryAsset(null)}>Tutup</button>
            </div>
            <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
              {historyVersions.map((v) => (
                <div key={v.id} className="row" style={{ alignItems: 'center', gap: 12, padding: 8, border: '1px solid var(--border)', borderRadius: 8 }}>
                  <Thumb a={v} size={64} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong>Versi {v.version_number}</strong> {v.is_current && <span className="small" style={{ color: 'var(--ok)' }}>· Aktif</span>}
                    <div className="muted small">{v.change_note || 'Versi awal'} · {v.status} · {new Date(v.created_at).toLocaleString('id-ID')}</div>
                    <div className="muted small">{v.hash.slice(0, 12)}</div>
                  </div>
                  <button disabled={v.is_current || restoringVersion !== null} onClick={() => void restoreVersion(v)}>
                    {restoringVersion === v.id ? 'Memulihkan…' : 'Restore'}
                  </button>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

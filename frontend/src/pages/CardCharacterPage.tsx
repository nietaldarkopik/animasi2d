import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { absUrl } from '../builder/render'
import { drawCard, type CardDetail, type CardView } from '../builder/card'
import { AppNav } from '../components/AppNav'

const CHECKER = 'repeating-conic-gradient(#2b2f3a 0 25%, #20232c 0 50%) 0 0 / 14px 14px'

/** Preview of a 2.5D card character: pick a pose, an expression, a mouth shape and closed eyes; versions; refresh from the folder. */
export function CardCharacterPage() {
  const { id } = useParams()
  const nav = useNavigate()
  const [d, setD] = useState<CardDetail | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [view, setView] = useState<CardView>({ pose: '', expression: '', mouth: null, blink: false })
  const [, setTick] = useState(0)
  const imgs = useRef(new Map<string, HTMLImageElement>())
  const canvas = useRef<HTMLCanvasElement>(null)

  async function load(version?: number) {
    try {
      const x = await api.cardGet(Number(id), version)
      setD(x)
      setName(x.name)
      document.title = `${x.name} (2.5D) — Cartoon Maker AI`
      if (x.meta) {
        const m = x.meta
        setView((v) => ({
          pose: m.body.poses.includes(v.pose) ? v.pose : m.body.poses.includes('diam') ? 'diam' : m.body.poses[0],
          expression: m.head.expressions.includes(v.expression) ? v.expression : m.head.expressions.includes('netral') ? 'netral' : m.head.expressions[0],
          mouth: null,
          blink: false,
        }))
      }
    } catch (e) { setError((e as Error).message) }
  }
  useEffect(() => { void load() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  // load every image of the version once; redraw as they arrive
  useEffect(() => {
    if (!d?.urls) return
    imgs.current = new Map()
    const all = [...Object.values(d.urls.body), ...Object.values(d.urls.head), ...Object.values(d.urls.mouth), ...(d.urls.blink ? [d.urls.blink] : [])]
    for (const u of all) {
      const im = new Image()
      im.onload = () => { imgs.current.set(u, im); setTick((t) => t + 1) }
      im.src = absUrl(u)
    }
  }, [d])

  useEffect(() => {
    const cv = canvas.current
    if (!cv || !d?.meta || !d.urls || !view.pose) return
    const [w, h] = d.meta.body.canvas
    cv.width = w
    cv.height = h
    const ctx = cv.getContext('2d')!
    ctx.clearRect(0, 0, w, h)
    drawCard(ctx, d.meta, (u) => imgs.current.get(u), d.urls, view)
  })

  async function act(fn: () => Promise<unknown>) {
    setBusy(true); setError('')
    try { await fn() } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  const m = d?.meta
  const pick = (label: string, items: string[], cur: string | null, set: (x: string | null) => void, allowNone?: string) => (
    <div>
      <h4 className="small" style={{ margin: '8px 0 4px' }}>{label}</h4>
      <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
        {allowNone && <button className={cur === null ? 'primary' : ''} onClick={() => set(null)}>{allowNone}</button>}
        {items.map((x) => <button key={x} className={cur === x ? 'primary' : ''} onClick={() => set(x)}>{x}</button>)}
      </div>
    </div>
  )

  return (
    <div className="page">
      <header className="topbar">
        <strong>Cartoon Maker AI</strong>
        <span style={{ width: 16 }} />
        <AppNav />
      </header>
      <main style={{ maxWidth: 1100, margin: '0 auto', padding: 16 }}>
        <p className="small"><Link to="/builder">← Semua karakter</Link></p>
        {error && <div className="error" role="alert">{error}</div>}
        {!d ? <p className="muted">Memuat…</p> : (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 380px) 1fr', gap: 20, alignItems: 'start' }}>
            <div style={{ background: CHECKER, borderRadius: 8, padding: 8 }}>
              <canvas ref={canvas} style={{ width: '100%', height: 'auto', display: 'block' }} aria-label={`Pratinjau ${d.name}`} />
            </div>
            <div>
              <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                <input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} aria-label="Nama karakter" style={{ fontSize: 20, fontWeight: 600 }} />
                {name.trim() && name !== d.name && <button disabled={busy} onClick={() => void act(async () => { await api.cardRename(d.id, name.trim()); await load(d.viewing ?? undefined) })}>Simpan nama</button>}
                <span className="badge">2.5D</span>
              </div>
              {m?.style && <p className="muted small" style={{ margin: '4px 0' }}>{m.style}</p>}
              <p className="muted small" style={{ margin: '4px 0' }}>Sumber: folder <code>karakter/{d.source}</code>. Gambar sudah disalin ke versi ini; menggambar ulang PNG di folder tidak mengubahnya sampai Anda klik <em>Perbarui dari folder</em>.</p>

              {m && (
                <>
                  {pick(`Pose badan (${m.body.poses.length})`, m.body.poses, view.pose, (x) => x && setView((v) => ({ ...v, pose: x })))}
                  {pick(`Ekspresi kepala (${m.head.expressions.length})`, m.head.expressions, view.expression, (x) => x && setView((v) => ({ ...v, expression: x })))}
                  {m.mouth && pick('Bentuk mulut (lip-sync)', m.mouth.shapes, view.mouth, (x) => setView((v) => ({ ...v, mouth: x })), 'tutup')}
                  {d.urls?.blink && (
                    <label className="row small" style={{ gap: 6, marginTop: 8 }}>
                      <input type="checkbox" checked={view.blink} onChange={(e) => setView((v) => ({ ...v, blink: e.target.checked }))} /> Mata terpejam (kedip)
                      {m.blink?.skip?.includes(view.expression) && <span className="muted">· ekspresi ini tidak dirancang untuk kedip</span>}
                    </label>
                  )}
                </>
              )}

              <div className="row" style={{ gap: 6, marginTop: 16, flexWrap: 'wrap' }}>
                <button className="primary" disabled={busy} onClick={() => void act(async () => { const x = await api.cardRefresh(d.id); setD(x) })} title="Buat versi baru dari isi folder karakter saat ini">{busy ? 'Memproses…' : 'Perbarui dari folder'}</button>
                <button disabled={busy} onClick={() => void act(async () => { const x = await api.cardDuplicate(d.id); nav(`/builder/card/${x.id}`) })}>Duplikat</button>
                <button disabled={busy} onClick={() => { if (confirm(`Hapus karakter "${d.name}" beserta semua versinya?`)) void act(async () => { await api.cardDelete(d.id); nav('/builder') }) }}>Hapus</button>
              </div>
              <p className="muted small">Pakai di film: buka project → tombol <strong>Karakter</strong> → bagian <em>Karakter 2.5D</em> → <strong>Sisipkan 2.5D</strong>. Lalu ganti pose, ekspresi, dan lip-sync dari panel <em>Alat film → Karakter</em>.</p>

              <h3 style={{ marginTop: 20 }}>Versi</h3>
              <ul className="plain">
                {d.versions.slice().reverse().map((v) => (
                  <li key={v.number} className="row between">
                    <span><span className="badge">v{v.number}</span> {v.note} <span className="muted small">· {new Date(v.created_at).toLocaleString()}</span></span>
                    {v.number === d.viewing ? <span className="small muted">{v.number === d.current_version ? 'aktif' : 'dilihat'}</span> : <button onClick={() => void load(v.number)}>Lihat</button>}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

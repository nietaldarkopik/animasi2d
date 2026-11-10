import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, setToken } from '../api'
import { absUrl } from '../builder/render'
import type { BuilderSummary } from '../builder/types'
import type { CardAvailable, CardSummary } from '../builder/card'
import { AppNav } from '../components/AppNav'

const CHECKER = 'repeating-conic-gradient(#2b2f3a 0 25%, #20232c 0 50%) 0 0 / 14px 14px'

type Row = (BuilderSummary & { kind: 'builder' }) | CardSummary

export function BuilderListPage() {
  const nav = useNavigate()
  const [list, setList] = useState<Row[] | null>(null)
  const [available, setAvailable] = useState<CardAvailable[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')

  const load = async () => {
    const [b, c, a] = await Promise.all([api.builderList(), api.cardList().catch(() => [] as CardSummary[]), api.cardAvailable().catch(() => [] as CardAvailable[])])
    const rows: Row[] = [...b.map((x) => ({ ...x, kind: 'builder' as const })), ...c]
    rows.sort((x, y) => String(y.updated_at).localeCompare(String(x.updated_at)))
    setList(rows)
    setAvailable(a)
  }
  useEffect(() => { load().catch((e) => setError(e.message)); document.title = 'Character Builder — Cartoon Maker AI' }, [])

  async function act(fn: () => Promise<unknown>, label = '') {
    setError(''); setBusy(label)
    try { await fn(); await load() } catch (e) { setError((e as Error).message) } finally { setBusy('') }
  }

  const notImported = available.filter((a) => a.ok && !a.imported_id)
  const broken = available.filter((a) => !a.ok)

  return (
    <div className="page">
      <header className="topbar">
        <strong>Cartoon Maker AI</strong>
        <span style={{ width: 16 }} />
        <AppNav />
        <span className="spacer" />
        <button onClick={async () => { await api.logout().catch(() => {}); setToken(null); nav('/login', { replace: true }) }}>Keluar</button>
      </header>
      <main style={{ maxWidth: 1100, margin: '0 auto', padding: 16 }}>
        <div className="row between">
          <h1 style={{ margin: 0 }}>Karakter</h1>
          <button className="primary" onClick={() => nav('/builder/new')}>+ Karakter baru</button>
        </div>
        <p className="muted small">Setiap kali disimpan, karakter mendapat <strong>versi baru</strong>; versi lama tidak berubah. Karakter bisa disisipkan ke scene film dari editor (tombol “Karakter”).</p>
        {error && <div className="error" role="alert">{error}</div>}

        {(notImported.length > 0 || broken.length > 0) && (
          <section className="card" style={{ padding: 12, marginTop: 12 }} aria-label="Impor karakter 2.5D">
            <strong>Karakter 2.5D di folder <code>karakter/</code></strong>
            <p className="muted small" style={{ margin: '4px 0 8px' }}>Kartu PNG siap pakai (badan per pose, kepala per ekspresi, mulut, kedip). Impor sekali untuk memakainya di film; gambar disalin, jadi mengubah folder tidak mengubah versi yang sudah ada.</p>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {notImported.map((a) => (
                <button key={a.slug} disabled={!!busy} onClick={() => void act(() => api.cardImport(a.slug), a.slug)} title={`${a.poses?.length ?? 0} pose · ${a.expressions?.length ?? 0} ekspresi${a.style ? ` · ${a.style}` : ''}`}>
                  {busy === a.slug ? 'Mengimpor…' : `+ Impor ${a.name}`}
                </button>
              ))}
              {notImported.length > 1 && <button className="primary" disabled={!!busy} onClick={() => void act(async () => { for (const a of notImported) await api.cardImport(a.slug) }, '*')}>{busy === '*' ? 'Mengimpor…' : 'Impor semua'}</button>}
            </div>
            {broken.map((a) => <p key={a.slug} className="small" style={{ color: 'var(--warn, #e0a030)', margin: '6px 0 0' }}>{a.name}: {a.problem}</p>)}
          </section>
        )}

        {list === null ? <p className="muted">Memuat…</p> : list.length === 0 ? <p className="muted">Belum ada karakter. Klik “Karakter baru”{notImported.length ? ' atau impor karakter 2.5D di atas' : ''}.</p> : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 14, marginTop: 12 }}>
            {list.map((c) => {
              const card = c.kind === 'card'
              const href = card ? `/builder/card/${c.id}` : `/builder/${c.id}`
              return (
                <div key={`${c.kind}-${c.id}`} className="card" style={{ padding: 10 }}>
                  <Link to={href} style={{ display: 'block', height: 220, background: CHECKER, borderRadius: 6, overflow: 'hidden' }}>
                    {c.thumbnail ? <img src={absUrl(c.thumbnail)} alt={c.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : null}
                  </Link>
                  <div style={{ margin: '8px 0 4px' }}><strong>{c.name}</strong> {card && <span className="badge" title="Karakter kartu 2.5D dari folder karakter/">2.5D</span>} <span className="badge">v{c.current_version}</span></div>
                  <div className="row">
                    <Link to={href}><button>{card ? 'Lihat' : 'Edit'}</button></Link>
                    <button disabled={!!busy} onClick={() => void act(() => (card ? api.cardDuplicate(c.id) : api.builderDuplicate(c.id)))}>Duplikat</button>
                    <button disabled={!!busy} onClick={() => { if (confirm(`Hapus karakter "${c.name}" beserta semua versinya?`)) void act(() => (card ? api.cardDelete(c.id) : api.builderDelete(c.id))) }} aria-label={`Hapus ${c.name}`}>🗑</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}

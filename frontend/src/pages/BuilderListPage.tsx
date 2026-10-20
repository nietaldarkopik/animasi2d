import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, setToken } from '../api'
import { absUrl } from '../builder/render'
import type { BuilderSummary } from '../builder/types'
import { AppNav } from '../components/AppNav'

const CHECKER = 'repeating-conic-gradient(#2b2f3a 0 25%, #20232c 0 50%) 0 0 / 14px 14px'

export function BuilderListPage() {
  const nav = useNavigate()
  const [list, setList] = useState<BuilderSummary[] | null>(null)
  const [error, setError] = useState('')

  const load = () => api.builderList().then(setList).catch((e) => setError(e.message))
  useEffect(() => { void load(); document.title = 'Character Builder — Cartoon Maker AI' }, [])

  async function act(fn: () => Promise<unknown>) {
    setError('')
    try { await fn(); await load() } catch (e) { setError((e as Error).message) }
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
      <main style={{ maxWidth: 1100, margin: '0 auto', padding: 16 }}>
        <div className="row between">
          <h1 style={{ margin: 0 }}>Karakter</h1>
          <button className="primary" onClick={() => nav('/builder/new')}>+ Karakter baru</button>
        </div>
        <p className="muted small">Setiap kali disimpan, karakter mendapat <strong>versi baru</strong>; versi lama tidak berubah. Karakter bisa disisipkan ke scene film dari editor (tombol “Karakter”).</p>
        {error && <div className="error" role="alert">{error}</div>}
        {list === null ? <p className="muted">Memuat…</p> : list.length === 0 ? <p className="muted">Belum ada karakter. Klik “Karakter baru”.</p> : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 14, marginTop: 12 }}>
            {list.map((c) => (
              <div key={c.id} className="card" style={{ padding: 10 }}>
                <Link to={`/builder/${c.id}`} style={{ display: 'block', height: 220, background: CHECKER, borderRadius: 6, overflow: 'hidden' }}>
                  {c.thumbnail ? <img src={absUrl(c.thumbnail)} alt={c.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : null}
                </Link>
                <div style={{ margin: '8px 0 4px' }}><strong>{c.name}</strong> <span className="badge">v{c.current_version}</span></div>
                <div className="row">
                  <Link to={`/builder/${c.id}`}><button>Edit</button></Link>
                  <button onClick={() => void act(() => api.builderDuplicate(c.id))}>Duplikat</button>
                  <button onClick={() => { if (confirm(`Hapus karakter "${c.name}" beserta semua versinya?`)) void act(() => api.builderDelete(c.id)) }} aria-label={`Hapus ${c.name}`}>🗑</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

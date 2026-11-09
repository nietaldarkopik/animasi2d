import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, setToken } from '../api'
import { AppNav } from '../components/AppNav'
import type { StorySeries } from '../story/types'

export function StoriesPage() {
  const nav = useNavigate()
  const [list, setList] = useState<StorySeries[] | null>(null)
  const [error, setError] = useState('')

  const load = () => api.storyList().then(setList).catch((e) => setError(e.message))
  useEffect(() => { void load(); document.title = 'Cerita — Cartoon Maker AI' }, [])

  async function create() {
    setError('')
    try {
      const chars = await api.builderList()
      if (chars.length === 0) return setError('Buat dulu minimal satu karakter di Character Builder: karakter cerita diambil dari sana.')
      const s = await api.storyCreate({
        title: 'Cerita baru',
        premise: 'Tulis alur ceritamu di sini: siapa tokohnya, apa yang terjadi, ke mana ceritanya bergerak.',
        characters: chars.slice(0, 2).map((c) => ({ name: c.name })),
      })
      nav(`/stories/${s.id}`)
    } catch (e) { setError((e as Error).message) }
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
      <main style={{ maxWidth: 1000, margin: '0 auto', padding: 16 }}>
        <div className="row between">
          <h1 style={{ margin: 0 }}>Cerita berseri</h1>
          <button className="primary" onClick={() => void create()}>+ Cerita baru</button>
        </div>
        <p className="muted small">Isi alur cerita, karakter, dan gaya narasi. Dari situ AI menulis episode dan naskahnya, lalu tiap episode difilmkan otomatis sesuai jadwal.</p>
        {error && <div className="error" role="alert">{error}</div>}
        {list === null ? <p className="muted">Memuat…</p> : list.length === 0 ? <p className="muted">Belum ada cerita. Klik “Cerita baru”.</p> : (
          <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
            {list.map((s) => (
              <div key={s.id} className="card">
                <div className="row between">
                  <div>
                    <Link to={`/stories/${s.id}`} style={{ fontSize: 18, fontWeight: 700 }}>{s.title}</Link>
                    <div className="muted small">{s.characters.map((c) => c.name).join(', ')} · {s.episodes_count} episode · {s.done_count} sudah difilmkan{s.auto_run && s.schedule_time ? ` · film otomatis tiap hari ${s.schedule_time}` : ''}</div>
                  </div>
                  <span className="row">
                    {s.ai_status === 'working' && <span className="badge">AI menulis…</span>}
                    <Link to={`/stories/${s.id}`}><button>Buka</button></Link>
                    <button aria-label={`Hapus ${s.title}`} onClick={async () => { if (confirm(`Hapus cerita "${s.title}" beserta semua episodenya? Film yang sudah jadi tidak ikut terhapus.`)) { await api.storyDelete(s.id).catch((e) => setError(e.message)); void load() } }}>🗑</button>
                  </span>
                </div>
                <p className="muted small" style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>{s.premise.length > 240 ? `${s.premise.slice(0, 240)}…` : s.premise}</p>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

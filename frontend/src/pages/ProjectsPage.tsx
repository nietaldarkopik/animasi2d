import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, setToken } from '../api'
import { AppNav } from '../components/AppNav'
import { DailyCartoonDialog } from '../components/DailyCartoonDialog'
import { sampleCharacter } from '../templates'
import type { ProjectSummary } from '../types'

export function ProjectsPage() {
  const nav = useNavigate()
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [showDailyModal, setShowDailyModal] = useState(false)

  const refresh = () => api.projects().then(setProjects).catch((e) => setError(e.message))
  useEffect(() => void refresh(), [])
  useEffect(() => { document.title = 'Project — Cartoon Maker AI' }, [])

  async function createSample() {
    setError('')
    try {
      const p = await api.createProject('Contoh: karakter melambai')
      await api.saveProject(p.id, { document: sampleCharacter(), base_revision: p.revision })
      nav(`/projects/${p.id}`)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function create(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    try {
      const p = await api.createProject(name.trim())
      nav(`/projects/${p.id}`)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function act(fn: () => Promise<unknown>) {
    setError('')
    try {
      await fn()
      await refresh()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function logout() {
    await api.logout().catch(() => {})
    setToken(null)
    nav('/login', { replace: true })
  }

  return (
    <div className="page">
      <header className="topbar">
        <strong>Cartoon Maker AI</strong>
        <span style={{ width: 16 }} />
        <AppNav />
        <span className="spacer" />
        <button onClick={logout}>Keluar</button>
      </header>
      <main className="container">
        <form className="row" onSubmit={create}>
          <input placeholder="Nama project baru" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          <button className="primary">Buat project</button>
          <button type="button" onClick={() => void createSample()} title="Karakter ber-rig yang melambai: contoh hierarki, bone, dan keyframe yang bisa diedit">Coba contoh karakter</button>
          <button type="button" onClick={() => setShowDailyModal(true)} style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)', color: '#fff', border: 'none', fontWeight: 600 }}>🎬 Kartun Harian (Auto)</button>
        </form>
        {showDailyModal && <DailyCartoonDialog onClose={() => { setShowDailyModal(false); refresh(); }} />}
        {error && <div className="error" role="alert">{error}</div>}
        {projects === null ? (
          <p className="muted">Memuat…</p>
        ) : projects.length === 0 ? (
          <div className="card empty">
            <h2>Selamat datang 👋</h2>
            <p>Buat project kosong di atas, atau lihat dulu apa yang bisa dilakukan dengan <strong>karakter contoh</strong> — lengkap dengan rig, bone, dan animasi melambai yang bisa Anda edit.</p>
            <div className="row"><button className="primary" onClick={() => void createSample()}>Coba contoh karakter</button></div>
          </div>
        ) : (
          <ul className="project-list">
            {projects.map((p) => (
              <li key={p.id} className="card">
                <div className="project-name" onClick={() => nav(`/projects/${p.id}`)}>
                  <strong>{p.name}</strong>
                  <span className="muted">Diubah {new Date(p.updated_at).toLocaleString('id-ID')}</span>
                </div>
                <div className="row">
                  <button onClick={() => nav(`/projects/${p.id}`)}>Buka</button>
                  <button onClick={() => act(() => api.duplicateProject(p.id))}>Gandakan</button>
                  <button className="danger" onClick={() => confirm(`Hapus "${p.name}" beserta semua asetnya?`) && act(() => api.deleteProject(p.id))}>Hapus</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}

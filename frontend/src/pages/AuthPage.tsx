import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, setToken } from '../api'

export function AuthPage() {
  const nav = useNavigate()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [canRegister, setCanRegister] = useState(true)
  useEffect(() => { document.title = 'Masuk — Cartoon Maker AI' }, [])
  useEffect(() => { api.authOptions().then((o) => setCanRegister(o.registration)).catch(() => {}) }, [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const r = mode === 'login' ? await api.login({ email, password }) : await api.register({ name, email, password })
      setToken(r.token)
      nav('/', { replace: true })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth">
      <form className="card auth-card" onSubmit={submit}>
        <h1>Cartoon Maker AI</h1>
        <p className="muted">{mode === 'login' ? 'Masuk ke studio animasi Anda.' : 'Buat akun baru.'}</p>
        {mode === 'register' && (
          <label>Nama<input value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} /></label>
        )}
        <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={mode === 'register' ? 8 : 1} /></label>
        {error && <div className="error" role="alert">{error}</div>}
        <button className="primary" disabled={busy}>{busy ? 'Memproses…' : mode === 'login' ? 'Masuk' : 'Daftar'}</button>
        {(canRegister || mode === 'register') && <button type="button" className="link" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError('') }}>
          {mode === 'login' ? 'Belum punya akun? Daftar' : 'Sudah punya akun? Masuk'}
        </button>}
      </form>
    </div>
  )
}

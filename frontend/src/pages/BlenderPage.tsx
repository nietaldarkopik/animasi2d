import { AppNav } from '../components/AppNav'
import { BlenderStudioDialog } from '../components/BlenderStudioDialog'
import { useNavigate } from 'react-router-dom'
import { api, setToken } from '../api'

export function BlenderPage() {
  const nav = useNavigate()

  async function logout() {
    await api.logout().catch(() => {})
    setToken(null)
    nav('/login', { replace: true })
  }

  return (
    <div className="page" style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header className="topbar">
        <strong>Cartoon Maker AI</strong>
        <span style={{ width: 16 }} />
        <AppNav />
        <span className="spacer" />
        <button onClick={logout}>Keluar</button>
      </header>
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {/* Render BlenderStudio embedded directly in page */}
        <BlenderStudioDialog onClose={() => nav('/')} />
      </div>
    </div>
  )
}


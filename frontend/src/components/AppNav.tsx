import { Link, useLocation } from 'react-router-dom'

const LINKS = [
  { to: '/', label: 'Project' },
  { to: '/builder', label: 'Character Builder' },
  { to: '/library', label: 'Library Aset' },
]

export function AppNav() {
  const { pathname } = useLocation()
  const active = (to: string) => (to === '/' ? pathname === '/' : pathname.startsWith(to))
  return (
    <nav className="row" aria-label="Navigasi utama" style={{ gap: 4 }}>
      {LINKS.map((l) => (
        <Link key={l.to} to={l.to} aria-current={active(l.to) ? 'page' : undefined}
          style={{ padding: '4px 10px', borderRadius: 6, color: 'inherit', textDecoration: 'none', background: active(l.to) ? 'var(--panel2)' : 'transparent', border: `1px solid ${active(l.to) ? 'var(--accent)' : 'transparent'}` }}>
          {l.label}
        </Link>
      ))}
    </nav>
  )
}

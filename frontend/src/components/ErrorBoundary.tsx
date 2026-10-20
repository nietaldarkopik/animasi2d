import { Component, type ErrorInfo, type ReactNode } from 'react'

/** Last line of defence: a render error must not leave a blank screen (autosave keeps the work). */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI error:', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="center" role="alert">
        <h2>Terjadi kesalahan tak terduga</h2>
        <p className="muted">Perubahan Anda disimpan otomatis. Muat ulang halaman untuk melanjutkan.</p>
        <p className="small error">{this.state.error.message}</p>
        <div className="row" style={{ justifyContent: 'center' }}>
          <button className="primary" onClick={() => window.location.reload()}>Muat ulang</button>
          <button onClick={() => window.location.assign('/')}>Ke daftar project</button>
        </div>
      </div>
    )
  }
}
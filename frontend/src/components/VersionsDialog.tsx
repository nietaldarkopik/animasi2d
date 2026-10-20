import { useEffect, useState } from 'react'
import { api } from '../api'
import { useEditor } from '../store'
import type { VersionInfo } from '../types'

export function VersionsDialog({ projectId, onClose }: { projectId: number; onClose: () => void }) {
  const [versions, setVersions] = useState<VersionInfo[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api.versions(projectId).then(setVersions).catch((e) => setError(e.message))
  }, [projectId])

  async function restore(n: number) {
    if (!confirm(`Kembalikan project ke versi ${n}? Kondisi saat ini disimpan dulu sebagai versi baru.`)) return
    try {
      await useEditor.getState().save()
      const p = await api.restoreVersion(projectId, n)
      useEditor.getState().adopt(p)
      onClose()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="modal" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="card dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Riwayat versi</h2>
        {error && <div className="error">{error}</div>}
        {versions === null ? <p className="muted">Memuat…</p> : versions.length === 0 ? (
          <p className="muted">Belum ada versi. Tekan "Simpan versi" untuk membuat snapshot.</p>
        ) : (
          <ul className="plain">
            {versions.map((v) => (
              <li key={v.id} className="row between">
                <span>v{v.number} — {v.label ?? 'Tanpa label'} <span className="muted small">{new Date(v.created_at).toLocaleString('id-ID')}</span></span>
                <button onClick={() => void restore(v.number)}>Kembalikan</button>
              </li>
            ))}
          </ul>
        )}
        <div className="row end"><button onClick={onClose}>Tutup</button></div>
      </div>
    </div>
  )
}

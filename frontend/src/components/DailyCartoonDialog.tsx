import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { directCartoonProject } from '../autoDirector'

interface DailyStatus {
  today: string
  today_project: { id: number; name: string; created_at: string } | null
  history: Array<{
    id: number
    name: string
    created_at: string
    scenes_count: number
    has_export: boolean
    export_status?: string
    export_id?: number
  }>
  characters: string[]
}

export function DailyCartoonDialog({ onClose }: { onClose: () => void }) {
  const nav = useNavigate()
  const [status, setStatus] = useState<DailyStatus | null>(null)
  const [topic, setTopic] = useState('')
  const [selectedChars, setSelectedChars] = useState<string[]>(['Sekar', 'Uki'])
  const [busy, setBusy] = useState(false)
  const [progressMsg, setProgressMsg] = useState('')
  const [error, setError] = useState('')
  const [successResult, setSuccessResult] = useState<{ id: number; title: string; duration: number } | null>(null)

  const loadStatus = () => {
    api.cartoonStatus()
      .then((res) => {
        setStatus(res)
        if (res.characters && res.characters.length >= 2) {
          setSelectedChars([res.characters[0], res.characters[1]])
        }
      })
      .catch((e) => setError(e.message))
  }

  useEffect(() => {
    loadStatus()
  }, [])

  const toggleChar = (char: string) => {
    if (selectedChars.includes(char)) {
      if (selectedChars.length > 1) {
        setSelectedChars(selectedChars.filter((c) => c !== char))
      }
    } else {
      if (selectedChars.length < 3) {
        setSelectedChars([...selectedChars, char])
      }
    }
  }

  async function handleGenerate() {
    setError('')
    setBusy(true)
    setProgressMsg('1/4 Menyusun naskah & cerita kartun...')
    try {
      const res = await api.generateCartoon({
        topic: topic.trim() || undefined,
        characters: selectedChars,
      })

      setProgressMsg('2/4 Memuat dokumen proyek & suara dialog...')
      const projectDetail = await api.project(res.project_id)

      setProgressMsg('3/4 Memasang rig karakter & animasi gerak bicara...')
      const directedDoc = await directCartoonProject(res.project_id, projectDetail.document, setProgressMsg)

      setProgressMsg('4/4 Menyimpan film animasi...')
      await api.saveProject(res.project_id, {
        document: directedDoc,
        base_revision: projectDetail.revision,
      })

      setSuccessResult({
        id: res.project_id,
        title: res.title,
        duration: res.duration,
      })
      loadStatus()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal" onClick={() => !busy && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        className="card dialog"
        style={{ maxWidth: 640, width: '92vw' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>🎬 Pembuat Film Kartun Otomatis</h2>
          <button className="small" disabled={busy} onClick={onClose}>✕</button>
        </div>

        <p className="muted small" style={{ marginTop: 6 }}>
          Setiap hari dibuatkan film kartun otomatis lengkap dengan naskah cerita, pengisi suara (TTS), latar tempat, dan karakter ber-rig yang berbicara sesuai audio.
        </p>

        {error && <div className="error" role="alert" style={{ marginBottom: 12 }}>{error}</div>}

        {successResult ? (
          <div className="card" style={{ background: 'var(--panel2)', padding: 16, textAlign: 'center', marginTop: 12 }}>
            <h3 style={{ margin: '0 0 8px 0', color: 'var(--accent)' }}>🎉 Kartun Berhasil Dibuat!</h3>
            <p style={{ margin: '0 0 16px 0' }}>
              <strong>{successResult.title}</strong> (~{successResult.duration} detik)
            </p>
            <div className="row" style={{ justifyContent: 'center', gap: 10 }}>
              <button
                className="primary"
                onClick={() => {
                  onClose()
                  nav(`/projects/${successResult.id}`)
                }}
              >
                ▶ Buka & Tonton di Studio
              </button>
              <button
                onClick={() => {
                  setSuccessResult(null)
                  setTopic('')
                }}
              >
                Buat Lagi
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="field" style={{ marginTop: 12 }}>
              <label>
                <strong>Topik / Tema Kartun (Opsional)</strong>
                <input
                  type="text"
                  disabled={busy}
                  placeholder="Contoh: Tips Semangat Pagi, Misteri Sekolah, atau kosongkan (otomatis AI)"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  maxLength={150}
                />
              </label>
              <span className="muted small">
                Kosongkan kolom di atas jika ingin AI memilihkan cerita kejutan harian secara otomatis.
              </span>
            </div>

            <div className="field" style={{ marginTop: 14 }}>
              <strong>Pilih Karakter (Maks. 2-3)</strong>
              <div className="row" style={{ flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                {(status?.characters ?? ['Sekar', 'Uki']).map((c) => {
                  const active = selectedChars.includes(c)
                  return (
                    <button
                      key={c}
                      type="button"
                      disabled={busy}
                      className={active ? 'primary' : ''}
                      style={{
                        padding: '6px 14px',
                        borderRadius: 20,
                        fontSize: 13,
                        border: active ? '1px solid var(--accent)' : '1px solid var(--border)',
                      }}
                      onClick={() => toggleChar(c)}
                    >
                      {active ? '✓ ' : '+ '}
                      {c}
                    </button>
                  )
                })}
              </div>
            </div>

            {busy && (
              <div style={{ marginTop: 16, padding: 12, borderRadius: 8, background: 'var(--panel2)' }}>
                <div className="row" style={{ alignItems: 'center', gap: 8 }}>
                  <span className="spinner" style={{ width: 16, height: 16 }} />
                  <strong>{progressMsg}</strong>
                </div>
                <div className="muted small" style={{ marginTop: 6 }}>
                  Sedang memproses suara Edge-TTS dan memasang rig tulang... mohon tunggu sebentar.
                </div>
              </div>
            )}

            <div className="row" style={{ marginTop: 20, justifyContent: 'flex-end', gap: 8 }}>
              <button disabled={busy} onClick={onClose}>Batal</button>
              <button
                className="primary"
                disabled={busy || selectedChars.length === 0}
                onClick={handleGenerate}
              >
                ⚡ Buat Film Kartun Sekarang
              </button>
            </div>
          </>
        )}

        {status?.history && status.history.length > 0 && (
          <div style={{ marginTop: 24, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
            <h4 style={{ margin: '0 0 10px 0' }}>Riwayat Kartun Harian</h4>
            <div style={{ maxHeight: 150, overflowY: 'auto' }}>
              {status.history.map((h) => (
                <div
                  key={h.id}
                  className="row"
                  style={{
                    justifyContent: 'space-between',
                    padding: '6px 0',
                    borderBottom: '1px solid var(--border)',
                    fontSize: 13,
                  }}
                >
                  <div>
                    <strong>{h.name}</strong>
                    <span className="muted" style={{ marginLeft: 8 }}>
                      ({h.scenes_count} adegan)
                    </span>
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    <button
                      className="small"
                      onClick={() => {
                        onClose()
                        nav(`/projects/${h.id}`)
                      }}
                    >
                      Buka
                    </button>
                    {h.has_export && h.export_status === 'done' && (
                      <button
                        className="small"
                        onClick={() => api.downloadExport(h.export_id!, `${h.name}.mp4`)}
                      >
                        Unduh MP4
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

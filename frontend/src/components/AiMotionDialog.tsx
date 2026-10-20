import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { applyMotionPlan } from '../anim'
import { useEditor } from '../store'
import type { AiJobInfo, AiStatus } from '../types'

const EXAMPLES = [
  'karakter melambaikan tangan sambil tersenyum, loop 2 detik',
  'berjalan ke kanan, berhenti, lalu melambaikan tangan',
  'melompat kecil dua kali dengan mendarat lembut',
  'mengangguk pelan tiga kali',
]

export function AiMotionDialog({ projectId, onClose }: { projectId: number; onClose: () => void }) {
  const s = useEditor()
  const doc = s.doc!
  const start = Math.round(s.frame)
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [prompt, setPrompt] = useState('')
  const [job, setJob] = useState<AiJobInfo | null>(null)
  const [error, setError] = useState('')
  const [applied, setApplied] = useState('')
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    api.aiStatus().then((r) => alive.current && setStatus(r)).catch((e) => setError(e.message))
    return () => void (alive.current = false)
  }, [])

  const running = job?.status === 'queued' || job?.status === 'processing'

  // poll while the job is running
  useEffect(() => {
    if (!job || !running) return
    const t = setInterval(async () => {
      try {
        const j = await api.aiJob(job.id)
        if (alive.current) setJob(j)
      } catch (e) {
        if (alive.current) setError((e as Error).message)
      }
    }, 1200)
    return () => clearInterval(t)
  }, [job?.id, running]) // eslint-disable-line react-hooks/exhaustive-deps

  async function submit() {
    setError('')
    setApplied('')
    setJob(null)
    try {
      // the server plans against the *saved* project, so flush pending edits first
      if (!(await useEditor.getState().save())) return setError('Simpan project gagal; coba lagi.')
      setJob(await api.aiMotion(projectId, prompt.trim(), useEditor.getState().activeSceneId))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  function apply() {
    if (!job?.result) return
    let res = { applied: 0, skipped: 0 }
    s.edit((d) => void (res = applyMotionPlan(d, job.result!, start)))
    setApplied(`${res.applied} track diterapkan${res.skipped ? `, ${res.skipped} dilewati (layer hilang atau rotasi dikendalikan IK)` : ''}. Tekan Play untuk melihat; semuanya keyframe biasa yang bisa diedit/di-undo.`)
  }

  const plan = job?.status === 'done' ? job.result : null
  const nameOf = (id: string) => doc.layers.find((l) => l.id === id)?.name ?? id

  return (
    <div className="modal" onClick={() => !running && onClose()}>
      <div role="dialog" aria-modal="true" className="card dialog wide" onClick={(e) => e.stopPropagation()}>
        <h2>AI Gerak — Prompt-to-Motion</h2>
        <p className="muted small">
          Model AI (lewat 9router di server) menerjemahkan perintah menjadi <strong>keyframe pada rig Anda</strong> — bukan video AI. Hasilnya ditinjau dulu, lalu diterapkan sebagai keyframe biasa mulai frame {start}. Gerakkan bone/layer yang ada: semakin jelas nama layer, semakin baik hasilnya.
        </p>

        {status && !status.configured && (
          <div className="error" role="alert">AI belum dikonfigurasi di server: isi <code>AI_API_KEY</code> (API key dari dashboard 9router) di <code>backend/.env</code>.</div>
        )}

        <label className="field">
          <span>Perintah gerak</span>
          <textarea rows={3} value={prompt} maxLength={1000} disabled={running} placeholder="mis. karakter berjalan, berhenti, lalu melambaikan tangan" onChange={(e) => setPrompt(e.target.value)} />
        </label>
        <div className="row">
          {EXAMPLES.map((x) => <button key={x} className="chip" disabled={running} onClick={() => setPrompt(x)}>{x}</button>)}
        </div>

        {error && <div className="error" role="alert">{error}</div>}
        {running && <div className="progress"><div style={{ width: '100%', opacity: 0.35 }} /><span>AI sedang menyusun gerakan… (biasanya 5–30 detik)</span></div>}
        {job?.status === 'failed' && <div className="error" role="alert">{job.error}</div>}

        {plan && (
          <div className="plan">
            <p className="small"><strong>{plan.notes || 'Rencana gerak'}</strong> — {plan.duration}s, {plan.tracks.length} track{plan.model ? ` · model ${plan.model}` : ''}</p>
            <table className="small">
              <tbody>
                {plan.tracks.map((t, i) => (
                  <tr key={i}><td>{nameOf(t.layer)}</td><td className="muted">{t.prop}</td><td>{t.keys.length} key</td><td className="muted">{Math.min(...t.keys.map((k) => k.v))} … {Math.max(...t.keys.map((k) => k.v))}</td></tr>
                ))}
              </tbody>
            </table>
            {plan.dropped.length > 0 && <p className="muted small">Dibuang otomatis: {plan.dropped.join('; ')}</p>}
            <p className="muted small">Nilai dari AI bersifat absolut dan mungkin berbeda dari pose saat ini; sesuaikan di timeline bila perlu.</p>
            <button className="primary" onClick={apply} disabled={!!applied}>Terapkan ke timeline (frame {start})</button>
            {applied && <p className="small" style={{ color: 'var(--ok)' }}>{applied}</p>}
          </div>
        )}

        <div className="row end">
          <button onClick={onClose} disabled={running}>Tutup</button>
          <button className="primary" disabled={running || prompt.trim().length < 3 || status?.configured === false} onClick={() => void submit()}>
            {job ? 'Buat ulang' : 'Buat gerakan'}
          </button>
        </div>
      </div>
    </div>
  )
}

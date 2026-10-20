import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { SFX, sfxBlob, startMic, type MicRecording } from '../audioTools'
import { sceneStart, totalDuration } from '../movie'
import { useEditor } from '../store'
import type { AudioClip } from '../types'

const KINDS: { v: NonNullable<AudioClip['kind']>; label: string }[] = [
  { v: 'voice', label: 'Suara / dialog' },
  { v: 'sfx', label: 'Efek suara' },
  { v: 'music', label: 'Musik' },
]

/** Audio tracks: upload, record from the microphone, synthesised sound effects; per clip kind, volume, fades and start time. */
export function AudioPanel({ projectId }: { projectId: number }) {
  const s = useEditor()
  const p = s.currentProject()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [rec, setRec] = useState<MicRecording | null>(null)
  const [recSecs, setRecSecs] = useState(0)
  const [sfx, setSfx] = useState(SFX[0].id)
  useEffect(() => {
    if (!rec) return
    const t0 = Date.now()
    const t = setInterval(() => setRecSecs(Math.floor((Date.now() - t0) / 1000)), 250)
    return () => clearInterval(t)
  }, [rec])
  if (!p) return null
  const total = totalDuration(p)

  /** the playhead on the film timeline (seconds): new recordings and effects start here */
  const playhead = () => {
    const st = useEditor.getState()
    const pr = st.currentProject()!
    const i = Math.max(0, pr.scenes.findIndex((x) => x.id === st.activeSceneId))
    return sceneStart(pr, i) + st.frame / pr.settings.fps
  }

  async function add(blob: Blob, name: string, kind: AudioClip['kind'], at?: number) {
    const a = await api.uploadAudio(projectId, new File([blob], name, { type: blob.type || 'audio/wav' }))
    useEditor.getState().addAsset(a)
    useEditor.getState().addAudio(a, { start: at, kind })
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return
    setBusy(true)
    setError('')
    try {
      for (const f of Array.from(files)) {
        const a = await api.uploadAudio(projectId, f)
        useEditor.getState().addAsset(a)
        useEditor.getState().addAudio(a)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  async function toggleRecord() {
    setError('')
    if (!rec) {
      try { setRecSecs(0); setRec(await startMic()) } catch (e) { setError((e as Error).message) }
      return
    }
    const r = rec
    const at = playhead() - recSecs // the sound started when recording started
    setRec(null)
    setBusy(true)
    try {
      const wav = await r.stop()
      await add(wav, `Rekaman ${new Date().toLocaleTimeString('id-ID')}.wav`, 'voice', Math.max(0, at))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function addSfx() {
    setBusy(true)
    setError('')
    try {
      await add(sfxBlob(sfx), `${SFX.find((x) => x.id === sfx)!.label}.wav`, 'sfx', playhead())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const num = (e: React.ChangeEvent<HTMLInputElement>) => e.target.valueAsNumber

  return (
    <section>
      <h3>Audio</h3>
      <input ref={input} type="file" accept="audio/*" multiple hidden onChange={(e) => void upload(e.target.files)} />
      <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
        <button disabled={busy || !!rec} onClick={() => input.current?.click()}>{busy ? 'Memproses…' : '+ Audio'}</button>
        <button className={rec ? 'danger' : ''} disabled={busy} onClick={() => void toggleRecord()} title="Rekam suara dari mikrofon; klip diletakkan di posisi playhead saat rekaman dimulai">{rec ? `■ Selesai (${recSecs}s)` : '● Rekam suara'}</button>
      </div>
      <div className="row" style={{ gap: 4, marginTop: 4 }}>
        <select value={sfx} onChange={(e) => setSfx(e.target.value)} aria-label="Efek suara" disabled={busy || !!rec}>{SFX.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>
        <button disabled={busy || !!rec} onClick={() => void addSfx()} title="Tambahkan efek suara di posisi playhead">+ Efek</button>
      </div>
      {error && <p className="error small" role="alert">{error}</p>}
      {p.audio.length === 0 && <p className="muted small">Belum ada audio. Unggah musik (MP3, WAV, OGG, M4A, FLAC), rekam dialog, atau tambah efek suara. Diputar saat "Putar film" dan ikut ke MP4/WebM saat export.</p>}
      <ul className="plain audio-list">
        {p.audio.map((c) => {
          const a = s.assets[c.assetId]
          const dur = a?.duration ?? 0
          return (
            <li key={c.id}>
              <div className="row between"><strong className="lname" title={c.name}>{c.kind === 'sfx' ? '🔔' : c.kind === 'voice' ? '🎤' : '♪'} {c.name}</strong>
                <button className="ico" title="Hapus klip" aria-label="Hapus klip" onClick={() => s.removeAudio(c.id)}>×</button></div>
              <label className="field"><span>Jenis</span>
                <select value={c.kind ?? 'music'} onChange={(e) => s.updateAudio(c.id, { kind: e.target.value as AudioClip['kind'] })}>{KINDS.map((k) => <option key={k.v} value={k.v}>{k.label}</option>)}</select>
              </label>
              <label className="field"><span>Mulai (detik){dur ? ` · durasi ${dur.toFixed(1)}s` : ''}</span>
                <input type="number" min={0} max={7200} step={0.1} value={c.start} onChange={(e) => { const v = num(e); if (Number.isFinite(v) && v >= 0) s.updateAudio(c.id, { start: Math.round(v * 100) / 100 }) }} />
              </label>
              <label className="field"><span>Volume {Math.round(c.volume * 100)}%</span>
                <input type="range" min={0} max={100} value={Math.round(c.volume * 100)} onChange={(e) => s.updateAudio(c.id, { volume: +e.target.value / 100 })} />
              </label>
              <div className="row" style={{ gap: 4 }}>
                <label className="field" style={{ flex: 1 }}><span>Fade in (s)</span>
                  <input type="number" min={0} max={Math.max(0, Math.min(30, dur || 30))} step={0.1} value={c.fadeIn ?? 0} onChange={(e) => { const v = num(e); if (Number.isFinite(v) && v >= 0) s.updateAudio(c.id, { fadeIn: Math.round(Math.min(v, dur || 30) * 10) / 10 }) }} />
                </label>
                <label className="field" style={{ flex: 1 }}><span>Fade out (s)</span>
                  <input type="number" min={0} max={Math.max(0, Math.min(30, dur || 30))} step={0.1} value={c.fadeOut ?? 0} onChange={(e) => { const v = num(e); if (Number.isFinite(v) && v >= 0) s.updateAudio(c.id, { fadeOut: Math.round(Math.min(v, dur || 30) * 10) / 10 }) }} />
                </label>
              </div>
              {a?.duration && c.start >= total && <p className="small" style={{ color: 'var(--warn)' }}>Mulai setelah film berakhir — tidak akan terdengar.</p>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

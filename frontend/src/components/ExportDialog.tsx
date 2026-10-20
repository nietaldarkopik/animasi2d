import { useEffect, useRef, useState, type RefObject } from 'react'
import { api } from '../api'
import type { StudioCanvas } from '../canvas'
import { effectAt, locate, sceneView, totalDuration } from '../movie'
import { useEditor } from '../store'
import { makeZip } from '../zip'
import type { ExportInfo } from '../types'

const FORMATS = [
  { v: 'mp4', label: 'MP4 (H.264)', ext: 'mp4' },
  { v: 'webm', label: 'WebM (VP9)', ext: 'webm' },
  { v: 'png_sequence', label: 'PNG sequence (.zip)', ext: 'zip' },
  { v: 'gif', label: 'GIF animasi (tanpa audio, maks. 720px & 30 fps)', ext: 'gif' },
  { v: 'sprite_sheet', label: 'Sprite sheet (.zip: sheet.png + sheet.json)', ext: 'zip' },
] as const

export function ExportDialog({ projectId, studio, onClose }: { projectId: number; studio: RefObject<StudioCanvas | null>; onClose: () => void }) {
  const doc = useEditor((s) => s.doc)!
  const [format, setFormat] = useState<(typeof FORMATS)[number]['v']>('mp4')
  const [width, setWidth] = useState(doc.settings.width)
  const [height, setHeight] = useState(doc.settings.height)
  const [fps, setFps] = useState(doc.settings.fps)
  const [alpha, setAlpha] = useState(false)
  const [scope, setScope] = useState<'film' | 'scene'>('film')
  const project = useEditor.getState().currentProject()!
  const [withAudio, setWithAudio] = useState(project.audio.length > 0)
  const [phase, setPhase] = useState<'idle' | 'recording' | 'uploading'>('idle')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const [history, setHistory] = useState<ExportInfo[]>([])
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => void (alive.current = false)
  }, [])

  const refresh = () => api.exports(projectId).then((l) => alive.current && setHistory(l)).catch(() => {})
  useEffect(() => void refresh(), [projectId]) // eslint-disable-line react-hooks/exhaustive-deps

  // poll while any export is in progress
  const active = history.some((e) => e.status === 'queued' || e.status === 'processing' || e.status === 'uploaded')
  useEffect(() => {
    if (!active) return
    const t = setInterval(refresh, 1500)
    return () => clearInterval(t)
  }, [active]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const latest = history[0]
    if (latest && latest.status === 'done') {
      ;(window as any).__EXPORT_DONE__ = latest
    } else if (latest && latest.status === 'failed') {
      ;(window as any).__EXPORT_FAILED__ = latest.error || 'Export gagal'
    }
  }, [history])

  useEffect(() => {
    if (window.location.search.includes('auto_export=1')) {
      const t = setTimeout(() => {
        void start()
      }, 1200)
      return () => clearTimeout(t)
    }
  }, [])

  async function start() {
    setError('')
    const sc = studio.current
    if (!sc) return setError('Kanvas belum siap.')
    const ev = (n: number, lo: number, hi: number) => Number.isFinite(n) && n >= lo && n <= hi
    const st0 = useEditor.getState()
    const p = st0.currentProject()!
    const activeId = st0.activeSceneId!
    const duration = scope === 'film' ? totalDuration(p) : p.scenes.find((x) => x.id === activeId)!.duration
    if (!ev(width, 64, 3840) || !ev(height, 64, 2160) || !ev(fps, 1, 60)) return setError('Resolusi 64–3840×64–2160, FPS 1–60.')
    if (!ev(duration, 0.5, 600)) return setError('Durasi export harus 0,5–600 detik.')
    try {
      setPhase('recording')
      setProgress(0)
      const st = useEditor.getState()
      const views = new Map(p.scenes.map((x) => [x.id, sceneView(p, x.id)]))
      await sc.preload(p.scenes.flatMap((x) => x.layers), st.assets) // every image (also expression swaps) decoded before recording
      const renderAt = (t: number) => {
        if (scope === 'film') {
          const loc = locate(p, t)
          sc.sync(views.get(loc.scene.id)!, st.assets, null, loc.local * p.settings.fps, false, false, effectAt(p, loc.index, loc.local, p.settings.width), true)
        } else {
          sc.sync(views.get(activeId)!, st.assets, null, t * p.settings.fps, false, false, null, true)
        }
      }
      if (format === 'png_sequence' && alpha) {
        // frame-exact PNGs with a real alpha channel, zipped in the browser and stored as-is by the server
        const count = Math.round(duration * fps)
        if (count > 600) throw new Error('PNG transparan dibatasi 600 frame (turunkan FPS atau durasi).')
        const frames = await sc.renderFrames(count, fps, renderAt, true, setProgress)
        const files = await Promise.all(frames.map(async (b, i) => ({ name: `frame_${String(i + 1).padStart(5, '0')}.png`, data: new Uint8Array(await b.arrayBuffer()) })))
        const cw = useEditor.getState().doc!.settings
        setPhase('uploading')
        await api.createExport(projectId, { format, width: cw.width, height: cw.height, fps, transparent: 1 }, makeZip(files), 'frames.zip')
        await refresh()
        return
      }
      const blob = await sc.record(duration, fps, setProgress, renderAt)
      // audio is mixed in by the server (FFmpeg); only for the whole film
      const clips = scope === 'film' && withAudio && (format === 'mp4' || format === 'webm') ? p.audio.filter((c) => c.start < duration) : []
      setPhase('uploading')
      await api.createExport(projectId, { format, width, height, fps, audio: clips.length ? JSON.stringify(clips.map((c) => ({ asset_id: c.assetId, start: c.start, volume: c.volume, fade_in: c.fadeIn ?? 0, fade_out: c.fadeOut ?? 0 }))) : undefined }, blob)
      await refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      const st = useEditor.getState()
      sc.sync(st.doc!, st.assets, st.selectedId, st.frame, st.onion, st.showBones, null, st.camPreview)
      if (alive.current) setPhase('idle')
    }
  }

  const ext = (f: string) => FORMATS.find((x) => x.v === f)!.ext
  const busy = phase !== 'idle'

  return (
    <div className="modal" onClick={() => !busy && onClose()}>
      <div role="dialog" aria-modal="true" className="card dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Export</h2>
        <p className="muted small">
          Kanvas direkam di browser selama durasi export (biarkan tab ini terbuka), lalu dikonversi dan audionya dicampur oleh worker server (FFmpeg). Animasi, scene, dan transisi dirender sesuai waktu.
        </p>
        <label className="field">
          <span>Format</span>
          <select value={format} disabled={busy} onChange={(e) => setFormat(e.target.value as typeof format)}>
            {FORMATS.map((f) => <option key={f.v} value={f.v}>{f.label}</option>)}
          </select>
        </label>
        <div className="grid2">
          <label className="field"><span>Lebar</span><input type="number" disabled={busy} value={width} onChange={(e) => setWidth(e.target.valueAsNumber)} /></label>
          <label className="field"><span>Tinggi</span><input type="number" disabled={busy} value={height} onChange={(e) => setHeight(e.target.valueAsNumber)} /></label>
          <label className="field"><span>FPS</span><input type="number" disabled={busy} value={fps} onChange={(e) => setFps(e.target.valueAsNumber)} /></label>
        </div>
        {format === 'png_sequence' && (
          <label className="inline"><input type="checkbox" disabled={busy} checked={alpha} onChange={(e) => setAlpha(e.target.checked)} /> Latar transparan (PNG beralfa, frame-exact, maks. 600 frame; ukuran = ukuran kanvas proyek)</label>
        )}
        <label className="field">
          <span>Yang diexport</span>
          <select value={scope} disabled={busy} onChange={(e) => setScope(e.target.value as typeof scope)}>
            <option value="film">Seluruh film ({project.scenes.length} scene, {totalDuration(project).toFixed(1)} detik, dengan transisi)</option>
            <option value="scene">Scene aktif saja</option>
          </select>
        </label>
        {project.audio.length > 0 && (format === 'mp4' || format === 'webm') && scope === 'film' && (
          <label className="inline"><input type="checkbox" disabled={busy} checked={withAudio} onChange={(e) => setWithAudio(e.target.checked)} /> Sertakan audio ({project.audio.length} klip, dicampur server dengan FFmpeg)</label>
        )}
        {error && <div className="error" role="alert">{error}</div>}
        {busy && (
          <div className="progress"><div style={{ width: `${phase === 'recording' ? progress * 100 : 100}%` }} /><span>{phase === 'recording' ? `Merekam ${Math.round(progress * 100)}%` : 'Mengunggah…'}</span></div>
        )}

        <h3>Hasil export</h3>
        {history.length === 0 ? <p className="muted small">Belum ada.</p> : (
          <ul className="plain">
            {history.map((e) => (
              <li key={e.id} className="row between">
                <span>#{e.id} {e.format} {e.width}×{e.height} <span className={`badge ${e.status}`}>{e.status}</span>{e.error && <span className="error small"> {e.error}</span>}</span>
                {e.status === 'done' && <button onClick={() => api.downloadExport(e.id, `export-${e.id}.${ext(e.format)}`).catch((x) => setError(x.message))}>Unduh</button>}
              </li>
            ))}
          </ul>
        )}
        <div className="row end">
          <button onClick={onClose} disabled={busy}>Tutup</button>
          <button className="primary" onClick={() => void start()} disabled={busy}>Mulai export</button>
        </div>
      </div>
    </div>
  )
}

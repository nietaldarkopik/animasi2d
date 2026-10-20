import { sceneStart, totalDuration } from '../movie'
import { useEditor } from '../store'

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/** Scene tabs + scene actions + a film overview (scenes and audio clips on one time axis). */
export function SceneBar() {
  const s = useEditor()
  const p = s.currentProject()
  if (!p || !s.doc) return null
  const total = totalDuration(p)
  const activeIndex = p.scenes.findIndex((x) => x.id === s.activeSceneId)
  const active = p.scenes[activeIndex]
  const nowT = sceneStart(p, activeIndex) + s.frame / p.settings.fps
  const pct = (t: number) => `${(t / total) * 100}%`

  const restart = () => {
    s.setPlaying(false)
    s.selectScene(p.scenes[0].id)
    s.setFrame(0)
    s.setMovie(true)
  }

  return (
    <div className="scenebar">
      <div className="scene-tabs" role="tablist" aria-label="Scene">
        {p.scenes.map((sc, i) => (
          <span key={sc.id} className="scene-item">
            <button role="tab" aria-selected={sc.id === s.activeSceneId} className={`scene-tab ${sc.id === s.activeSceneId ? 'on' : ''}`} onClick={() => s.selectScene(sc.id)} title={`${sc.name} — ${sc.duration}s`}>
              {i + 1}. {sc.name} <small>{sc.duration}s</small>
            </button>
            {i < p.scenes.length - 1 && (
              <i className={`tr-chip ${sc.transition && sc.transition.type !== 'none' ? 'on' : ''}`} title={sc.transition && sc.transition.type !== 'none' ? `Transisi: ${sc.transition.type} (${sc.transition.duration}s)` : 'Tanpa transisi'}>
                {sc.transition && sc.transition.type !== 'none' ? '⇄' : '›'}
              </i>
            )}
          </span>
        ))}
        <button onClick={s.addScene} title="Tambah scene kosong setelah scene ini">+ Scene</button>
        <button onClick={() => s.duplicateScene(active.id)} title="Gandakan scene aktif">⧉</button>
        <button onClick={() => s.moveScene(active.id, -1)} disabled={activeIndex === 0} title="Geser ke kiri">◀</button>
        <button onClick={() => s.moveScene(active.id, 1)} disabled={activeIndex === p.scenes.length - 1} title="Geser ke kanan">▶</button>
        <button className="danger" disabled={p.scenes.length <= 1} title="Hapus scene aktif" onClick={() => confirm(`Hapus scene "${active.name}" beserta isinya? (Undo untuk scene dihapus tidak tersedia; tersimpan di Riwayat versi bila Anda sudah menyimpan versi.)`) && s.deleteScene(active.id)}>🗑</button>
        <span className="spacer" />
        {s.movie ? (
          <button onClick={() => { s.setMovie(false); s.setPlaying(false) }} title="Berhenti memutar film">■ Stop film</button>
        ) : (
          <button className="primary" onClick={restart} title="Putar seluruh film dari awal (semua scene, transisi, audio)">▶ Putar film</button>
        )}
        <span className="muted small">Film {fmt(total)}</span>
      </div>

      <div className="film" title="Ikhtisar film: scene (atas) dan klip audio (bawah)">
        <div className="film-row">
          {p.scenes.map((sc, i) => (
            <button key={sc.id} className={`film-scene ${sc.id === s.activeSceneId ? 'on' : ''}`} style={{ left: pct(sceneStart(p, i)), width: pct(sc.duration) }} onClick={() => s.selectScene(sc.id)}>
              {sc.name}
            </button>
          ))}
        </div>
        {p.audio.length > 0 && (
          <div className="film-row audio">
            {p.audio.map((c) => {
              const d = s.assets[c.assetId]?.duration ?? 0
              return <i key={c.id} className="film-audio" style={{ left: pct(Math.min(c.start, total)), width: pct(Math.min(d, Math.max(0, total - c.start))) }} title={`${c.name} — mulai ${c.start}s`}>♪ {c.name}</i>
            })}
          </div>
        )}
        <i className="film-head" style={{ left: pct(nowT) }} />
      </div>
    </div>
  )
}
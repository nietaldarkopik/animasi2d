import { useEffect, useState } from 'react'
import { api } from '../api'
import { backgroundPng } from '../builder/render'
import { prepareRig, rigLayers, type PreparedRig } from '../builder/insertRig'
import type { BuilderSummary, LibAsset } from '../builder/types'
import { boardFromScript, parseScript, pickBackground, sceneSecondsFor, spreadX, subtitlesFromDialog } from '../filmTools'
import { sceneUid } from '../movie'
import { uid, useEditor } from '../store'
import type { Layer, Scene, SceneBoard } from '../types'

const SAMPLE = `# Pagi di sekolah | lokasi: Halaman sekolah
(Uki tiba di sekolah dan melambai)
Uki: Selamat pagi, Sekar!
Sekar: Pagi, Uki. Sudah mengerjakan tugas?

# Di kelas | lokasi: Ruang kelas
Uki: Belum... aku lupa membawa laptop.
Sekar: Pakai punyaku dulu, ya.
`

/** Storyboard: notes and dialogue per scene, and a script that creates the scenes (location, characters, subtitles) for you. */
export function StoryboardDialog({ projectId, onClose, onOpenScene }: { projectId: number; onClose: () => void; onOpenScene: () => void }) {
  const s = useEditor()
  const p = s.currentProject()
  const [tab, setTab] = useState<'papan' | 'skrip'>('papan')
  const [script, setScript] = useState(SAMPLE)
  const [useBg, setUseBg] = useState(true)
  const [useChars, setUseChars] = useState(true)
  const [useSubs, setUseSubs] = useState(true)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [notes, setNotes] = useState<string[]>([])
  const [builders, setBuilders] = useState<BuilderSummary[]>([])
  useEffect(() => { api.builderList().then(setBuilders).catch(() => {}) }, [])
  if (!p) return null

  const patchBoard = (sceneId: string, fn: (b: SceneBoard) => SceneBoard) => {
    const sc = useEditor.getState().currentProject()!.scenes.find((x) => x.id === sceneId)!
    useEditor.getState().updateScene(sceneId, { board: fn({ ...(sc.board ?? {}) }) })
  }
  const setDuration = (sc: Scene, v: number) => {
    if (!Number.isFinite(v)) return
    const d = Math.max(0.5, Math.min(600, Math.round(v * 2) / 2))
    if (sc.id === s.activeSceneId) s.updateSettings({ duration: d })
    else s.updateScene(sc.id, { duration: d })
  }

  async function build() {
    setError(''); setNotes([])
    const parsed = parseScript(script)
    if (parsed.length === 0) return setError('Skrip kosong. Tulis minimal satu baris dialog "Nama: kalimat" atau judul "# Nama scene".')
    if (p!.scenes.length + parsed.length > 50) return setError('Maksimal 50 scene per proyek.')
    setBusy(true)
    const warn: string[] = []
    try {
      const { width: W, height: H } = p!.settings
      const bgs = useBg ? await api.libAssets({ kind: 'background' }) : []
      const bgAssets = new Map<number, number>() // library bg id -> project asset id (uploaded once)
      const prepared = new Map<string, PreparedRig | null>()
      const out: Scene[] = []
      for (const [i, ps] of parsed.entries()) {
        setProgress(`Scene ${i + 1}/${parsed.length}: ${ps.name}`)
        const layers: Layer[] = []
        if (useBg && ps.location) {
          const bg: LibAsset | null = pickBackground(ps.location, bgs)
          if (bg) {
            if (!bgAssets.has(bg.id)) {
              const a = await api.uploadAsset(projectId, await backgroundPng(bg, W, H), `latar-${bg.key ?? bg.id}.png`)
              useEditor.getState().addAsset(a)
              bgAssets.set(bg.id, a.id)
            }
            layers.push({ id: uid(), type: 'image', name: `Latar: ${bg.name}`, assetId: bgAssets.get(bg.id)!, x: W / 2, y: H / 2, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, visible: true, locked: true })
          } else warn.push(`Scene "${ps.name}": tidak ada latar yang cocok dengan "${ps.location}" (latar dikosongkan; pasang manual lewat tombol Latar).`)
        }
        const here: PreparedRig[] = []
        if (useChars) {
          for (const who of ps.characters) {
            const key = who.toLowerCase()
            if (!prepared.has(key)) {
              const b = builders.find((x) => x.name.toLowerCase() === key)
              prepared.set(key, b ? await prepareRig(projectId, b, setProgress) : null)
              if (!b) warn.push(`Tokoh "${who}" belum ada di Character Builder, jadi tidak ditempatkan (dialognya tetap tercatat).`)
            }
            const pr = prepared.get(key)
            if (pr) here.push(pr)
          }
          const xs = spreadX(here.length)
          here.forEach((pr, j) => layers.push(...rigLayers(pr, { width: W, height: H }, { xFrac: xs[j], scale: here.length > 2 ? 0.8 : 1 })))
        }
        const duration = sceneSecondsFor(ps)
        out.push({
          id: sceneUid(), name: ps.name, duration, background: '#ffffff', transition: i < parsed.length - 1 ? { type: 'fade', duration: 0.6 } : null, layers,
          board: boardFromScript(ps, uid),
          ...(useSubs && ps.dialog.length ? { subtitles: subtitlesFromDialog(ps.dialog, 0.5, duration, uid) } : {}),
        })
      }
      useEditor.getState().addScenes(out)
      setNotes([`${out.length} scene dibuat dan dibuka. Selanjutnya: beri pose/gerakan di panel Alat film, rekam dialog atau tambah audio, lalu Putar film.`, ...warn])
      setTab('papan')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false); setProgress('')
    }
  }

  return (
    <div className="modal" onClick={() => !busy && onClose()}>
      <div role="dialog" aria-modal="true" className="card dialog wide" style={{ maxHeight: '88vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <h2>Papan cerita</h2>
        <div className="row" style={{ gap: 4, marginBottom: 8 }}>
          <button className={tab === 'papan' ? 'primary' : ''} onClick={() => setTab('papan')}>Papan ({p.scenes.length} scene)</button>
          <button className={tab === 'skrip' ? 'primary' : ''} onClick={() => setTab('skrip')}>Buat dari skrip</button>
        </div>
        {error && <div className="error" role="alert">{error}</div>}
        {notes.map((n, i) => <p key={i} className="small" style={{ color: i === 0 ? 'var(--ok)' : 'var(--warn)' }}>{n}</p>)}

        {tab === 'skrip' && (
          <div style={{ display: 'grid', gap: 8 }}>
            <p className="muted small" style={{ margin: 0 }}>Tulis alur film. <code>#</code> memulai scene (<code>| lokasi: …</code> memilih latar), <code>(…)</code> adalah aksi/catatan, <code>Nama: kalimat</code> adalah dialog. Nama yang sama dengan karakter di Character Builder otomatis ditempatkan di scene.</p>
            <textarea rows={12} value={script} onChange={(e) => setScript(e.target.value)} aria-label="Skrip" style={{ fontFamily: 'monospace' }} disabled={busy} />
            <label className="inline"><input type="checkbox" checked={useBg} onChange={(e) => setUseBg(e.target.checked)} disabled={busy} /> Pasang latar yang cocok dengan lokasi</label>
            <label className="inline"><input type="checkbox" checked={useChars} onChange={(e) => setUseChars(e.target.checked)} disabled={busy} /> Tempatkan karakter ber-bone ({builders.length ? builders.map((b) => b.name).join(', ') : 'belum ada karakter'})</label>
            <label className="inline"><input type="checkbox" checked={useSubs} onChange={(e) => setUseSubs(e.target.checked)} disabled={busy} /> Buat subtitle dari dialog</label>
            {progress && <p className="small" role="status">{progress}</p>}
            <div className="row end"><button className="primary" disabled={busy} onClick={() => void build()}>{busy ? 'Membuat…' : 'Buat scene dari skrip'}</button></div>
          </div>
        )}

        {tab === 'papan' && (
          <div style={{ display: 'grid', gap: 10 }}>
            {p.scenes.map((sc, i) => {
              const b = sc.board ?? {}
              return (
                <div key={sc.id} className="card" style={{ padding: 10, display: 'grid', gap: 6, outline: sc.id === s.activeSceneId ? '2px solid var(--accent, #4f8cff)' : 'none' }}>
                  <div className="row" style={{ gap: 6 }}>
                    <strong>{i + 1}.</strong>
                    <input value={sc.name} maxLength={80} onChange={(e) => s.updateScene(sc.id, { name: e.target.value || `Scene ${i + 1}` })} aria-label={`Nama scene ${i + 1}`} />
                    <label className="inline small">durasi <input type="number" min={0.5} max={600} step={0.5} style={{ width: 70 }} value={sc.duration} onChange={(e) => setDuration(sc, e.target.valueAsNumber)} /> s</label>
                    <button onClick={() => { s.selectScene(sc.id); onOpenScene() }}>Buka</button>
                  </div>
                  <input placeholder="Lokasi (mis. Ruang kelas)" value={b.location ?? ''} maxLength={120} onChange={(e) => patchBoard(sc.id, (x) => ({ ...x, location: e.target.value || undefined }))} aria-label={`Lokasi scene ${i + 1}`} />
                  <textarea rows={2} placeholder="Apa yang terjadi di scene ini" value={b.summary ?? ''} maxLength={2000} onChange={(e) => patchBoard(sc.id, (x) => ({ ...x, summary: e.target.value || undefined }))} aria-label={`Ringkasan scene ${i + 1}`} />
                  {(b.dialog ?? []).map((d) => (
                    <div key={d.id} className="row" style={{ gap: 4 }}>
                      <input style={{ width: 110 }} placeholder="Tokoh" value={d.who} maxLength={60} onChange={(e) => patchBoard(sc.id, (x) => ({ ...x, dialog: x.dialog!.map((y) => (y.id === d.id ? { ...y, who: e.target.value } : y)) }))} aria-label="Tokoh" />
                      <input placeholder="Dialog" value={d.text} maxLength={500} onChange={(e) => patchBoard(sc.id, (x) => ({ ...x, dialog: x.dialog!.map((y) => (y.id === d.id ? { ...y, text: e.target.value || ' ' } : y)) }))} aria-label="Dialog" />
                      <button aria-label="Hapus dialog" onClick={() => patchBoard(sc.id, (x) => ({ ...x, dialog: x.dialog!.filter((y) => y.id !== d.id) }))}>×</button>
                    </div>
                  ))}
                  <div className="row" style={{ gap: 4 }}>
                    <button onClick={() => patchBoard(sc.id, (x) => ({ ...x, dialog: [...(x.dialog ?? []), { id: uid(), who: '', text: '' }] }))}>+ Dialog</button>
                    <button disabled={!(b.dialog ?? []).some((d) => d.text.trim())} title="Ganti subtitle scene ini dengan dialog di atas, berurutan"
                      onClick={() => s.setSceneExtras(sc.id, { subtitles: subtitlesFromDialog((b.dialog ?? []).filter((d) => d.text.trim()), 0.5, sc.duration, uid) })}>Buat subtitle dari dialog</button>
                    <span className="muted small">{sc.subtitles?.length ?? 0} subtitle · {sc.layers.length} layer</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        <div className="row end" style={{ marginTop: 10 }}><button onClick={onClose} disabled={busy}>Tutup</button></div>
      </div>
    </div>
  )
}

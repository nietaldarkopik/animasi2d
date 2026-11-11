import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, setToken } from '../api'
import type { BuilderSummary } from '../builder/types'
import { SFX } from '../audioTools'
import { AppNav } from '../components/AppNav'
import { addCrowdPerson, checkScript, formatScript, parseScript } from '../story/storyScript'
import type { SeriesInput, StoryCharacter, StoryEpisode, StorySeries } from '../story/types'

const STATUS: Record<StoryEpisode['status'], string> = { planned: 'Direncanakan', scripted: 'Naskah siap', queued: 'Antre', producing: 'Difilmkan…', done: 'Selesai', failed: 'Gagal' }
const LOCATIONS = ['Halaman sekolah', 'Ruang kelas', 'Lab komputer', 'Kantin sekolah', 'Perpustakaan', 'Lapangan upacara', 'Ruang tamu', 'Kamar tidur', 'Dapur', 'Taman', 'Jalan raya']

/** ISO string -> value of <input type="datetime-local"> (local time) and back */
const toLocalInput = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '')

export function StoryPage() {
  const { id } = useParams()
  const nav = useNavigate()
  const sid = Number(id)
  const [series, setSeries] = useState<StorySeries | null>(null)
  const [draft, setDraft] = useState<SeriesInput | null>(null)
  const [dirty, setDirty] = useState(false)
  const [builders, setBuilders] = useState<BuilderSummary[]>([])
  const [count, setCount] = useState(5)
  const [promptText, setPromptText] = useState('')
  const [promptBusy, setPromptBusy] = useState(false)
  const [promptCount, setPromptCount] = useState(1)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [editing, setEditing] = useState<StoryEpisode | null>(null)
  const [viewingVideo, setViewingVideo] = useState<string | null>(null)
  const [viewingPlan, setViewingPlan] = useState<StoryEpisode | null>(null)
  const alive = useRef(true)

  const refresh = useCallback(async (initial = false) => {
    try {
      const s = await api.storyGet(sid)
      if (!alive.current) return
      setSeries(s)
      if (initial) { setDraft({ title: s.title, premise: s.premise, master_script: s.master_script ?? '', genre: s.genre, tone: s.tone, narration_style: s.narration_style, use_narrator: s.use_narrator, narrator_voice: s.narrator_voice, characters: s.characters, notes: s.notes, episodes_planned: s.episodes_planned, auto_run: s.auto_run, schedule_time: s.schedule_time, auto_publish: s.auto_publish }); setCount(s.episodes_planned); setPromptText(s.master_script ?? '') }
    } catch (e) { if (alive.current) setError((e as Error).message) }
  }, [sid])

  useEffect(() => { alive.current = true; void refresh(true); api.castList().then(setBuilders).catch(() => {}); return () => { alive.current = false } }, [refresh])
  useEffect(() => { if (series) document.title = `${series.title} — Cerita` }, [series?.title]) // eslint-disable-line react-hooks/exhaustive-deps

  // while the AI writes or a film is being made, look again every few seconds
  const busy = !!series && (series.ai_status === 'working' || (series.episodes ?? []).some((e) => e.status === 'queued' || e.status === 'producing'))
  useEffect(() => {
    if (!busy) return
    const t = setInterval(() => void refresh(), 4000)
    return () => clearInterval(t)
  }, [busy, refresh])

  const set = (patch: SeriesInput) => { setDraft((d) => ({ ...d, ...patch })); setDirty(true) }
  const setChar = (i: number, patch: Partial<StoryCharacter>) => set({ characters: (draft?.characters ?? []).map((c, j) => (j === i ? { ...c, ...patch } : c)) })

  async function save(): Promise<boolean> {
    setError(''); setNote('')
    try { const s = await api.storyUpdate(sid, draft ?? {}); setSeries(s); setDirty(false); setNote('Tersimpan.'); return true } catch (e) { setError((e as Error).message); return false }
  }
  async function act(fn: () => Promise<unknown>, ok?: string) {
    setError(''); setNote('')
    try { if (dirty && !(await save())) return; await fn(); if (ok) setNote(ok); await refresh() } catch (e) { setError((e as Error).message) }
  }

  if (!series || !draft) return <div className="page"><main style={{ padding: 24 }}>{error ? <div className="error" role="alert">{error} <Link to="/stories">Kembali</Link></div> : <p className="muted">Memuat…</p>}</main></div>

  const caps = series.capabilities
  const episodes = series.episodes ?? []
  const free = builders.filter((b) => !(draft.characters ?? []).some((c) => c.id === b.id || (!c.id && c.name.toLowerCase() === b.name.toLowerCase())))
  const sameName = (name: string) => builders.filter((b) => b.name.toLowerCase() === name.toLowerCase()).length > 1

  return (
    <div className="page">
      <header className="topbar">
        <strong>Cartoon Maker AI</strong>
        <span style={{ width: 16 }} />
        <AppNav />
        <span className="spacer" />
        <button onClick={async () => { await api.logout().catch(() => {}); setToken(null); nav('/login', { replace: true }) }}>Keluar</button>
      </header>
      <main style={{ maxWidth: 1100, margin: '0 auto', padding: 16, display: 'grid', gap: 16 }}>
        <div className="row between">
          <h1 style={{ margin: 0 }}><Link to="/stories" style={{ color: 'inherit' }} aria-label="Kembali ke daftar cerita">←</Link> {series.title}</h1>
          <button className="primary" disabled={!dirty} onClick={() => void save()}>{dirty ? 'Simpan perubahan' : 'Tersimpan'}</button>
        </div>
        {error && <div className="error" role="alert">{error}</div>}
        {note && <p className="small" style={{ color: 'var(--ok)', margin: 0 }}>{note}</p>}

        <section className="card" style={{ border: '1px solid var(--accent, #777)' }}>
          <h2 style={{ marginTop: 0 }}>✨ Generate dari naskah / prompt</h2>
          <p className="muted small">Tempel naskah atau tulis ide. AI menyusun premis, episode, dialog, visual, kamera, dan lighting berdasarkan karakter yang dipilih di bawah.</p>
          <label className="field"><span>Naskah atau prompt</span><textarea rows={6} value={promptText} maxLength={20000} onChange={(e) => { setPromptText(e.target.value); set({ master_script: e.target.value }) }} placeholder="Tempel naskah lengkap atau tulis arahan film yang ingin dibuat…" /></label>
          <label className="field"><span>Atau unggah file (.txt / .md)</span><input type="file" accept=".txt,.md,text/plain,text/markdown" onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; if (file.size > 1024 * 1024) { setError('Ukuran file maksimal 1 MB.'); return } const text = await file.text(); setPromptText(text); set({ master_script: text }); setNote('Naskah dimuat. Simpan perubahan agar Master Naskah tersimpan permanen.'); e.target.value = '' }} /></label>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <label className="row small" style={{ gap: 6 }}>Jumlah episode <input type="number" min={1} max={10} value={promptCount} onChange={(e) => setPromptCount(Math.max(1, Math.min(10, Number(e.target.value) || 1)))} style={{ width: 70 }} /></label>
            <button className="primary" disabled={!caps?.ai || promptBusy || busy || promptText.trim().length < 20 || (draft.characters ?? []).length === 0}
              onClick={async () => { setError(''); setNote(''); setPromptBusy(true); try { if (dirty && !(await save())) return; const s = await api.storyGenerateFromPrompt(sid, promptText.trim(), promptCount); setSeries(s); setDraft({ title: s.title, premise: s.premise, master_script: s.master_script ?? '', genre: s.genre, tone: s.tone, narration_style: s.narration_style, use_narrator: s.use_narrator, narrator_voice: s.narrator_voice, characters: s.characters, notes: s.notes, episodes_planned: s.episodes_planned, auto_run: s.auto_run, schedule_time: s.schedule_time, auto_publish: s.auto_publish }); setDirty(false); setNote('Draft cerita dan naskah episode berhasil dibuat. Periksa lalu edit sebelum produksi.') } catch (e) { setError((e as Error).message) } finally { setPromptBusy(false) } }}>
              {promptBusy ? '⏳ AI sedang menyusun cerita…' : '✨ Generate dan isi form'}
            </button>
          </div>
          <p className="muted small" style={{ marginBottom: 0 }}>AI hanya memakai karakter yang sudah dipilih di bagian Karakter. Maksimal 10 episode per proses. Generate tidak memulai render film.</p>
        </section>

        <section className="card">
          <h2 style={{ marginTop: 0 }}>1. Ide cerita</h2>
          <label className="field"><span>Judul seri</span><input value={draft.title ?? ''} maxLength={120} onChange={(e) => set({ title: e.target.value })} /></label>
          <label className="field"><span>Alur cerita / premis</span>
            <textarea rows={6} value={draft.premise ?? ''} maxLength={6000} onChange={(e) => set({ premise: e.target.value })} placeholder="Apa yang terjadi dari awal sampai akhir seri? Konflik, tujuan tokoh, ke mana ceritanya bergerak." />
          </label>
          <div className="grid2" style={{ gap: 12 }}>
            <label className="field"><span>Genre</span><input value={draft.genre ?? ''} maxLength={60} placeholder="komedi sekolah, petualangan…" onChange={(e) => set({ genre: e.target.value })} /></label>
            <label className="field"><span>Nada cerita</span><input value={draft.tone ?? ''} maxLength={120} placeholder="hangat, lucu, mendidik" onChange={(e) => set({ tone: e.target.value })} /></label>
          </div>
          <label className="field"><span>Catatan untuk setiap episode (opsional)</span>
            <textarea rows={2} value={draft.notes ?? ''} maxLength={2000} onChange={(e) => set({ notes: e.target.value })} placeholder="mis. selalu ada pesan moral di akhir; jangan ada adegan berkelahi" />
          </label>

          <h3 style={{ marginBottom: 6 }}>Karakter</h3>
          <p className="muted small" style={{ marginTop: 0 }}>Karakter diambil dari <Link to="/builder">Character Builder</Link>; hanya mereka yang boleh berbicara. Suara: laki-laki / perempuan.</p>
          <div style={{ display: 'grid', gap: 8 }}>
            {(draft.characters ?? []).map((c, i) => (
              <div key={c.name} className="row" style={{ gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <strong style={{ minWidth: 90, alignSelf: 'center' }} title={c.id ? `Karakter #${c.id} di Character Builder` : undefined}>{c.name}{c.id && sameName(c.name) ? <span className="muted small"> #{c.id}</span> : null}</strong>
                <input style={{ flex: '1 1 140px' }} aria-label={`Peran ${c.name}`} placeholder="peran (tokoh utama, kepala sekolah…)" value={c.role ?? ''} maxLength={80} onChange={(e) => setChar(i, { role: e.target.value })} />
                <input style={{ flex: '2 1 240px' }} aria-label={`Sifat ${c.name}`} placeholder="sifat / latar (periang, pelupa, bapaknya teman kuliah Bu Tina…)" value={c.traits ?? ''} maxLength={300} onChange={(e) => setChar(i, { traits: e.target.value })} />
                <select aria-label={`Suara ${c.name}`} value={c.voice ?? ''} onChange={(e) => setChar(i, { voice: (e.target.value || null) as StoryCharacter['voice'] })} style={{ width: 'auto' }}>
                  <option value="">Suara otomatis</option><option value="male">Suara laki-laki</option><option value="female">Suara perempuan</option>
                </select>
                <button aria-label={`Keluarkan ${c.name}`} onClick={() => set({ characters: (draft.characters ?? []).filter((_, j) => j !== i) })}>✕</button>
              </div>
            ))}
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <select aria-label="Tambah karakter" value="" onChange={(e) => { const b = builders.find((x) => String(x.id) === e.target.value); if (b) set({ characters: [...(draft.characters ?? []), { id: b.id, name: b.name }] }) }} style={{ width: 'auto' }} disabled={free.length === 0}>
              <option value="">{free.length ? '+ Tambah karakter…' : 'Semua karakter sudah dipakai'}</option>
              {free.map((b) => <option key={b.id} value={b.id}>{b.name}{sameName(b.name) ? ` (#${b.id}, v${b.current_version})` : ''}</option>)}
            </select>
          </div>

          <h3 style={{ marginBottom: 6 }}>Narasi</h3>
          <label className="inline"><input type="checkbox" checked={!!draft.use_narrator} onChange={(e) => set({ use_narrator: e.target.checked })} /> Pakai narator (suara dan teks narasi di bawah layar, tanpa tokoh)</label>
          {draft.use_narrator && (
            <div className="grid2" style={{ gap: 12, marginTop: 8 }}>
              <label className="field"><span>Gaya narasi</span><input value={draft.narration_style ?? ''} maxLength={600} placeholder="tenang seperti dongeng, sesekali bercanda" onChange={(e) => set({ narration_style: e.target.value })} /></label>
              <label className="field"><span>Suara narator</span>
                <select value={draft.narrator_voice ?? 'id-ID-ArdiNeural'} onChange={(e) => set({ narrator_voice: e.target.value })}><option value="id-ID-ArdiNeural">Laki-laki</option><option value="id-ID-GadisNeural">Perempuan</option></select>
              </label>
            </div>
          )}
        </section>

        <section className="card">
          <h2 style={{ marginTop: 0 }}>2. Tulis ceritanya</h2>
          {!caps?.ai && <p className="muted small" role="status">AI sedang tidak tersedia (9router belum menyala atau AI_API_KEY belum diisi). Anda tetap bisa menambah episode dan menulis naskahnya sendiri di bawah.</p>}
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <label className="row" style={{ gap: 6 }}><span className="small">Jumlah episode</span>
              <input type="number" min={1} max={30} value={count} onChange={(e) => { const n = Math.max(1, Math.min(30, Number(e.target.value) || 1)); setCount(n); set({ episodes_planned: n }) }} style={{ width: 70 }} aria-label="Jumlah episode" />
            </label>
            <button className="primary" disabled={!caps?.ai || series.ai_status === 'working'} onClick={() => void act(() => api.storyGenerate(sid, 'all', count), 'AI mulai menulis: alur episode lalu naskah tiap episode.')}
              title="Menyusun alur semua episode, lalu menulis naskah lengkap tiap episode">✨ Generate cerita lengkap</button>
            <button disabled={!caps?.ai || series.ai_status === 'working'} onClick={() => void act(() => api.storyGenerate(sid, 'outline', count), 'AI menyusun alur episode.')}>Alur episode saja</button>
            <button disabled={!caps?.ai || series.ai_status === 'working' || episodes.length === 0} onClick={() => void act(() => api.storyGenerate(sid, 'scripts'), 'AI menulis naskah episode yang belum punya naskah.')}>Naskah semua episode</button>
          </div>
          {series.ai_status === 'working' && <p className="small" role="status" style={{ marginBottom: 0 }}>⏳ {series.ai_message ?? 'AI sedang menulis…'}</p>}
          {series.ai_status === 'failed' && <div className="error" role="alert" style={{ marginTop: 8 }}>{series.ai_message}</div>}
        </section>

        <section className="card">
          <h2 style={{ marginTop: 0 }}>3. Jadwal film</h2>
          <label className="inline"><input type="checkbox" checked={!!draft.auto_run} onChange={(e) => set({ auto_run: e.target.checked, schedule_time: draft.schedule_time || '07:00' })} /> Filmkan <strong>satu episode berikutnya setiap hari</strong> pada jam</label>{' '}
          <input type="time" value={draft.schedule_time ?? ''} disabled={!draft.auto_run} onChange={(e) => set({ schedule_time: e.target.value })} aria-label="Jam film harian" style={{ width: 'auto' }} />
          <div style={{ marginTop: 6 }}>
            <label className="inline" title={caps?.publish ? '' : 'Isi CLIPPER_PATH dan CLIPPER_YOUTUBE_ACCOUNT di backend/.env'}>
              <input type="checkbox" disabled={!caps?.publish} checked={!!draft.auto_publish && !!caps?.publish} onChange={(e) => set({ auto_publish: e.target.checked })} /> Unggah ke YouTube setelah jadi (privasi: {caps?.privacy ?? 'private'})
            </label>
          </div>
          <p className="muted small" style={{ marginBottom: 0 }}>Penjadwal harus berjalan (jendela “Scheduler” di start.bat). Episode juga bisa diberi tanggal dan jam sendiri di daftar di bawah. Satu film butuh sekitar 10–20 menit.</p>
        </section>

        <section>
          <div className="row between">
            <h2 style={{ margin: '0 0 8px' }}>Episode ({episodes.length})</h2>
            <button onClick={() => { const t = prompt('Judul episode baru:'); if (t) void act(() => api.storyAddEpisode(sid, { title: t })) }}>+ Tambah episode</button>
          </div>
          {episodes.length === 0 && <p className="muted">Belum ada episode. Klik “Generate cerita lengkap”, atau tambah sendiri.</p>}
          <div style={{ display: 'grid', gap: 10 }}>
            {episodes.map((e) => (
              <EpisodeCard key={e.id} ep={e} aiOn={!!caps?.ai} canPublish={!!caps?.publish} sid={sid}
                onChange={(fn, ok) => void act(fn, ok)} onEdit={() => setEditing(e)}
                onViewVideo={(p) => setViewingVideo(p)} onViewPlan={(ep) => setViewingPlan(ep)} />
            ))}
          </div>
        </section>
      </main>

      {viewingVideo && (
        <div role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'grid', placeItems: 'center', zIndex: 1200 }} onClick={() => setViewingVideo(null)}>
          <div className="card" onClick={(e) => e.stopPropagation()} style={{ width: 'min(920px, 94vw)', background: '#181825', padding: 20, borderRadius: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <strong>🎬 Pemutar Film Kartun (Hasil Blender MCP / 3D Scene)</strong>
              <button onClick={() => setViewingVideo(null)}>✕</button>
            </div>
            <video controls autoPlay src={`/api/blender/file/${viewingVideo.split(/[/\\\\]/).pop()}`} style={{ width: '100%', maxHeight: '72vh', background: '#000', borderRadius: 8 }} />
            <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="muted small">File: {viewingVideo}</span>
              <a href={`/api/blender/file/${viewingVideo.split(/[/\\\\]/).pop()}`} download className="primary" style={{ padding: '6px 14px', borderRadius: 6, textDecoration: 'none', fontWeight: 600 }}>⬇ Unduh Video MP4</a>
            </div>
          </div>
        </div>
      )}

      {viewingPlan && (
        <div role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'grid', placeItems: 'center', zIndex: 1200 }} onClick={() => setViewingPlan(null)}>
          <div className="card" onClick={(e) => e.stopPropagation()} style={{ width: 'min(900px, 94vw)', maxHeight: '88vh', overflowY: 'auto', background: '#1e1e2e', padding: 22, borderRadius: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <strong style={{ fontSize: 18 }}>🏛 Rencana Produksi 3D: {viewingPlan.title}</strong>
                <div style={{ fontSize: 12, opacity: 0.7 }}>AI Director: Environment 3D, Props, Pencahayaan & Sinematografi Kamera</div>
              </div>
              <button onClick={() => setViewingPlan(null)}>✕</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {viewingPlan.script?.scenes?.map((sc: any, idx: number) => (
                <div key={idx} style={{ padding: 14, borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <strong>Scene {idx + 1}: {sc.name}</strong>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: '#4f46e5', color: '#fff' }}>Lokasi: {sc.location}</span>
                      <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: '#059669', color: '#fff' }}>Waktu: {sc.time}</span>
                    </div>
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 8 }}>
                    <strong>Environment 3D:</strong> {sc.location.toLowerCase().includes('kamar mandi') ? 'Interior Kamar Mandi (Ubin porselen, wastafel, cermin, shower, ember, gayung)' : sc.location.toLowerCase().includes('dapur') ? 'Interior Dapur (Kitchen counter, kompor, wajan, kulkas, ventilasi)' : sc.location.toLowerCase().includes('kamar') ? 'Interior Kamar Tidur (Tempat tidur, bantal, selimut, lemari pakaian)' : sc.location.toLowerCase().includes('taman') ? 'Eksterior Taman (Tanah berumput, jalan setapak, pepohonan 3D)' : 'Interior Ruang Tamu (Sofa santai, meja tamu)'}
                  </div>
                  {sc.visual && <div style={{ fontSize: 12, marginBottom: 7 }}><strong>Visual:</strong> {sc.visual}</div>}
                  {sc.camera && Object.keys(sc.camera).length > 0 && <div style={{ fontSize: 12, marginBottom: 7 }}><strong>Kamera:</strong> {JSON.stringify(sc.camera)}</div>}
                  {sc.lighting && Object.keys(sc.lighting).length > 0 && <div style={{ fontSize: 12, marginBottom: 7 }}><strong>Lighting:</strong> {JSON.stringify(sc.lighting)}</div>}
                  <div style={{ fontSize: 12, opacity: 0.75 }}>
                    <strong>Dialog ({sc.dialog?.length || 0} line):</strong>
                    <div style={{ marginTop: 4, paddingLeft: 8 }}>
                      {sc.dialog?.slice(0, 3).map((d: any, dIdx: number) => (
                        <div key={dIdx}>• <em>{d.who}:</em> "{d.text}"</div>
                      ))}
                      {(sc.dialog?.length || 0) > 3 && <div className="muted small">... dan {sc.dialog.length - 3} dialog lainnya</div>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {editing && <ScriptDialog ep={editing} people={builders.map((b) => b.name)} cast={[...(draft.characters ?? []).map((c) => c.name), ...(draft.use_narrator ? ['Narator'] : [])]} onClose={() => setEditing(null)}
        onSave={async (text) => { try { await api.storyEpisodeUpdate(editing.id, { script: parseScript(text) }); setEditing(null); await refresh(); setNote('Naskah disimpan.') } catch (e) { return (e as Error).message } return null }} />}
    </div>
  )
}

function EpisodeCard({ ep, aiOn, canPublish, onChange, onEdit, onViewVideo, onViewPlan }: { ep: StoryEpisode; aiOn: boolean; canPublish: boolean; sid: number; onChange: (fn: () => Promise<unknown>, ok?: string) => void; onEdit: () => void; onViewVideo?: (path: string) => void; onViewPlan?: (ep: StoryEpisode) => void }) {
  const [title, setTitle] = useState(ep.title)
  const [syn, setSyn] = useState(ep.synopsis ?? '')
  const running = ep.status === 'queued' || ep.status === 'producing'
  const when = toLocalInput(ep.scheduled_at)
  return (
    <div className="card" style={{ padding: 12 }}>
      <div className="row between" style={{ gap: 8, flexWrap: 'wrap' }}>
        <div className="row" style={{ gap: 8, flex: '1 1 320px' }}>
          <strong>#{ep.number}</strong>
          <input value={title} disabled={running} onChange={(e) => setTitle(e.target.value)} onBlur={() => { if (title.trim() && title !== ep.title) onChange(() => api.storyEpisodeUpdate(ep.id, { title })) }} aria-label={`Judul episode ${ep.number}`} style={{ flex: 1 }} />
        </div>
        <span className="row" style={{ gap: 6 }}>
          <span className="badge" role="status">{STATUS[ep.status]}</span>
          {ep.script && <span className="muted small">{ep.scenes} scene</span>}
        </span>
      </div>
      <textarea rows={2} value={syn} disabled={running} onChange={(e) => setSyn(e.target.value)} onBlur={() => { if (syn !== (ep.synopsis ?? '')) onChange(() => api.storyEpisodeUpdate(ep.id, { synopsis: syn })) }} aria-label={`Ringkasan episode ${ep.number}`} placeholder="Ringkasan isi episode" style={{ marginTop: 8 }} />
      {ep.error && <div className="error" role="alert" style={{ marginTop: 6 }}>{ep.error}</div>}
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
        <button disabled={running || !aiOn} onClick={() => onChange(() => api.storyEpisodeWrite(ep.id), 'AI menulis naskah episode ini.')} title={aiOn ? 'Tulis (atau tulis ulang) naskah dengan AI' : 'AI tidak tersedia'}>{ep.script ? 'Tulis ulang (AI)' : 'Tulis naskah (AI)'}</button>
        <button disabled={running} onClick={onEdit}>{ep.script ? 'Lihat/edit naskah' : 'Tulis naskah sendiri'}</button>
        <button className="primary" disabled={running || (!ep.script && !aiOn)} onClick={() => onChange(() => api.storyEpisodeProduce(ep.id, ep.publish), 'Episode masuk antrean pembuatan film.')}>🎬 Buat film sekarang</button>
        <label className="inline small" title={canPublish ? '' : 'Isi CLIPPER_* di backend/.env'}><input type="checkbox" disabled={running || !canPublish} checked={ep.publish && canPublish} onChange={(e) => onChange(() => api.storyEpisodeUpdate(ep.id, { publish: e.target.checked }))} /> unggah YouTube</label>
        <label className="row small" style={{ gap: 4 }}>Jadwal
          <input type="datetime-local" disabled={running} value={when} onChange={(e) => onChange(() => api.storyEpisodeUpdate(ep.id, { scheduled_at: e.target.value ? new Date(e.target.value).toISOString() : null }), e.target.value ? 'Episode dijadwalkan.' : 'Jadwal dihapus.')} style={{ width: 'auto' }} aria-label={`Jadwal episode ${ep.number}`} />
        </label>
        {ep.project_id && <Link to={`/projects/${ep.project_id}`}>Buka project</Link>}
        {ep.output_path && <span className="muted small" title="Folder daily_output di komputer ini">📁 {ep.output_path}</span>}
        {ep.status === 'done' && ep.output_path && onViewVideo && (
          <button onClick={() => onViewVideo(ep.output_path as string)} title="Tonton hasil film di video player">▶ Tonton Film</button>
        )}
        {ep.script && onViewPlan && (
          <button onClick={() => onViewPlan(ep)} title="Lihat rencana 3D scene AI Director untuk episode ini">🏛 Rencana 3D</button>
        )}
        {ep.published && <span className="badge">terunggah</span>}
        <span className="spacer" />
        <button disabled={running} aria-label={`Hapus episode ${ep.number}`} onClick={() => { if (confirm(`Hapus episode ${ep.number}?`)) onChange(() => api.storyEpisodeDelete(ep.id)) }}>🗑</button>
      </div>
    </div>
  )
}

function ScriptDialog({ ep, cast, people, onClose, onSave }: { ep: StoryEpisode; cast: string[]; people: string[]; onClose: () => void; onSave: (text: string) => Promise<string | null> }) {
  const [text, setText] = useState(formatScript(ep.script) || `# ${ep.title} | Ruang tamu | siang\n${cast[0] ?? 'Nama'}: Halo!`)
  const [err, setErr] = useState<string | null>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  const warnings = checkScript(text, { speakers: cast, people, locations: LOCATIONS })
  const names = [...new Set(people)].sort((a, b) => a.localeCompare(b))
  return (
    <div role="dialog" aria-modal="true" aria-label={`Naskah episode ${ep.number}`} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', display: 'grid', placeItems: 'center', zIndex: 50 }}>
      <div className="card" style={{ width: 'min(820px, 94vw)', maxHeight: '90vh', overflow: 'auto' }}>
        <h2 style={{ marginTop: 0 }}>Naskah episode {ep.number}: {ep.title}</h2>
        <ul className="muted small" style={{ margin: '0 0 8px', paddingLeft: 18 }}>
          <li>Scene baru: <code>{'# Nama scene | Lokasi | waktu | latar: Kris, Arum'}</code> (<code>latar:</code> berisi orang yang berdiri di belakang tanpa bicara)</li>
          <li>Dialog: <code>Nama: kalimat</code>. Pembicara: {cast.join(', ')}</li>
          <li>Aksi: <code>(Uki melambai)</code> atau <code>(semua melompat)</code>. Gerakan: melambai, melompat, berlari, berjalan, mengangguk, menunjuk, berpikir, kaget, tersenyum, tertawa, serius</li>
          <li>Efek suara: <code>[bel]</code>. Pilihan: {SFX.map((s) => s.id).join(', ')}</li>
          <li>Lokasi: {LOCATIONS.join(', ')}. Waktu: pagi, siang, sore, malam</li>
        </ul>
        <textarea ref={box} rows={16} value={text} onChange={(e) => setText(e.target.value)} aria-label="Naskah" style={{ fontFamily: 'monospace', width: '100%' }} />
        <label className="row small" style={{ gap: 6, marginTop: 6 }}>Tambah orang latar ke scene yang sedang diketik:
          <select aria-label="Tambah orang latar" value="" style={{ width: 'auto' }} disabled={names.length === 0} onChange={(e) => { if (e.target.value) setText(addCrowdPerson(text, box.current?.selectionStart ?? text.length, e.target.value)) }}>
            <option value="">Pilih karakter…</option>
            {names.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        {warnings.length > 0 && (
          <div role="status" className="small" style={{ marginTop: 8, color: 'var(--warn)' }}>
            <strong>Perlu dicek ({warnings.length}):</strong>
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{warnings.slice(0, 30).map((w) => <li key={w}>{w}</li>)}</ul>
          </div>
        )}
        {err && <div className="error" role="alert">{err}</div>}
        <div className="row" style={{ marginTop: 8, justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose}>Batal</button>
          <button className="primary" onClick={async () => setErr(await onSave(text))}>Simpan naskah</button>
        </div>
      </div>
    </div>
  )
}

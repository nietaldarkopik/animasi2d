import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { evalCamera, removeCamKey, setCamKey, worldPoint } from '../anim'
import { camFocus, camKeyFrames, camPan, camShake, camZoom } from '../camera'
import { canvasRef } from '../canvas'
import { absUrl, assetPng } from '../builder/render'
import type { LibAsset } from '../builder/types'
import { applyExpression, applyPose, applyRigMotion, clearExpression, MOTIONS, POSES, rigExpressions, rigOf } from '../builder/rigMotion'
import { addEffect, EFFECT_LABEL, makeBalloon, makeShadow, makeTitle, propPlacement, setTimeOfDay, TIME_PRESETS, timeOfDay } from '../filmTools'
import { applyLipSync, envelope, mouthKeys, openings } from '../lipsync'
import { sceneStart } from '../movie'
import { uid, useEditor } from '../store'
import type { CameraProp, EffectKind, Layer } from '../types'

type Tab = 'karakter' | 'kamera' | 'efek' | 'teks' | 'properti'
const TABS: { id: Tab; label: string }[] = [
  { id: 'karakter', label: 'Karakter' },
  { id: 'kamera', label: 'Kamera' },
  { id: 'efek', label: 'Efek' },
  { id: 'teks', label: 'Teks' },
  { id: 'properti', label: 'Properti' },
]

const f2 = (n: number) => Math.round(n * 100) / 100

/** Film tools: poses and movements for rigged characters, camera, effects and time of day, balloons / titles / subtitles, props. */
export function FilmTools({ projectId }: { projectId: number }) {
  const [tab, setTab] = useState<Tab>(() => (localStorage.getItem('film_tab') as Tab) || 'karakter')
  const [open, setOpen] = useState(() => { try { return localStorage.getItem('film_open') !== '0' } catch { return true } })
  const pick = (t: Tab) => { setTab(t); try { localStorage.setItem('film_tab', t) } catch { /* private mode */ } }
  return (
    <details className="filmtools" aria-label="Alat film" open={open} onToggle={(e) => { const o = (e.currentTarget as HTMLDetailsElement).open; setOpen(o); try { localStorage.setItem('film_open', o ? '1' : '0') } catch { /* private mode */ } }} style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
      <summary style={{ cursor: 'pointer', fontWeight: 600, marginBottom: 6 }}>Alat film: karakter, kamera, efek, teks, properti</summary>
      <div className="row" style={{ gap: 2, flexWrap: 'wrap', marginBottom: 6 }} role="tablist">
        {TABS.map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'primary' : ''} onClick={() => pick(t.id)}>{t.label}</button>)}
      </div>
      {tab === 'karakter' && <CharacterTab />}
      {tab === 'kamera' && <CameraTab />}
      {tab === 'efek' && <EffectsTab />}
      {tab === 'teks' && <TextTab />}
      {tab === 'properti' && <PropsTab projectId={projectId} />}
    </details>
  )
}

// ---------------------------------------------------------------------------------------- character

function CharacterTab() {
  const s = useEditor()
  const doc = s.doc!
  const project = s.currentProject()!
  const rig = useMemo(() => rigOf(doc.layers, s.selectedId), [doc.layers, s.selectedId])
  const frame = Math.round(s.frame)
  const fps = doc.settings.fps
  const [motionId, setMotionId] = useState(MOTIONS[0].id)
  const motion = MOTIONS.find((m) => m.id === motionId)!
  const [duration, setDuration] = useState(motion.duration)
  const [distance, setDistance] = useState(motion.distance)
  const [dir, setDir] = useState<1 | -1>(1)
  const [clipId, setClipId] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { setDuration(motion.duration); setDistance(motion.distance) }, [motionId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!rig) {
    return <p className="muted small">Pilih bagian karakter yang disisipkan <strong>dengan bone</strong> (Karakter → Sisipkan + bone). Jika ada beberapa karakter di scene, klik salah satunya dulu.</p>
  }
  const exprs = rigExpressions(rig)
  const mouth = rig.pieces.mouth
  const voice = project.audio.filter((c) => s.assets[c.assetId])

  const growTo = (d: typeof doc, endFrame: number) => { const need = endFrame / d.settings.fps; if (need > d.settings.duration) d.settings.duration = Math.min(600, Math.ceil(need * 2) / 2) }

  async function lipSync() {
    const clip = voice.find((c) => c.id === clipId) ?? voice[0]
    if (!clip || !mouth) return
    setBusy(true); setMsg('')
    try {
      const asset = s.assets[clip.assetId]
      const buf = await fetch(absUrl(asset.url)).then((r) => { if (!r.ok) throw new Error('Gagal mengambil audio.'); return r.arrayBuffer() })
      const audio = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(buf)
      const idx = project.scenes.findIndex((x) => x.id === s.activeSceneId)
      const t0 = clip.start - sceneStart(project, idx) // where the sound begins inside this scene
      const from = Math.max(0, -t0)
      const to = Math.min(audio.duration, doc.settings.duration - t0)
      if (to - from < 0.1) throw new Error('Klip suara ini tidak berada di scene yang sedang dibuka (atur "Mulai" klip atau buka scene yang tepat).')
      const mono = new Float32Array(audio.length)
      for (let c = 0; c < audio.numberOfChannels; c++) { const ch = audio.getChannelData(c); for (let i = 0; i < mono.length; i++) mono[i] += ch[i] / audio.numberOfChannels }
      const open = openings(envelope(mono, audio.sampleRate, fps, from, to))
      const layer = doc.layers.find((l) => l.id === mouth.id)!
      const keys = mouthKeys(open, Math.round((t0 + from) * fps), layer.scaleY)
      if (keys.length === 0) throw new Error('Tidak ada suara yang terdeteksi pada klip ini.')
      s.edit((d) => { applyLipSync(d.layers.find((l) => l.id === mouth.id)!, keys) })
      setMsg(`Mulut digerakkan mengikuti volume suara: ${keys.length} keyframe (frame ${keys[0].f}–${keys[keys.length - 1].f}). Bisa diedit di timeline.`)
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <p className="small" style={{ margin: 0 }}>Karakter: <strong>{rig.name}</strong> · frame {frame}</p>

      <div>
        <h4 className="small" style={{ margin: '0 0 4px' }}>Pose (di frame ini)</h4>
        <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
          {POSES.map((p) => <button key={p.id} onClick={() => s.edit((d) => { applyPose(d, rig, p, frame) })} title="Memasang keyframe rotasi di semua bone pada frame ini">{p.label}</button>)}
        </div>
        <p className="muted small" style={{ margin: '4px 0 0' }}>Pindahkan playhead ke frame lain lalu pilih pose lain: gerakan di antaranya dihaluskan otomatis.</p>
      </div>

      <div>
        <h4 className="small" style={{ margin: '0 0 4px' }}>Gerakan siap pakai</h4>
        <select value={motionId} onChange={(e) => setMotionId(e.target.value)} aria-label="Pilih gerakan">{MOTIONS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select>
        <p className="muted small" style={{ margin: '2px 0 4px' }}>{motion.hint}</p>
        <div className="grid2">
          <label className="field"><span>Durasi (detik)</span><input type="number" min={0.5} max={30} step={0.5} value={duration} onChange={(e) => Number.isFinite(e.target.valueAsNumber) && setDuration(Math.max(0.5, Math.min(30, e.target.valueAsNumber)))} /></label>
          {motion.distance > 0 && <label className="field"><span>Jarak (px)</span><input type="number" min={0} max={3000} step={20} value={distance} onChange={(e) => Number.isFinite(e.target.valueAsNumber) && setDistance(Math.max(0, Math.min(3000, e.target.valueAsNumber)))} /></label>}
        </div>
        {motion.distance > 0 && (
          <div className="row" style={{ gap: 4, margin: '4px 0' }}>
            <button className={dir === 1 ? 'primary' : ''} onClick={() => setDir(1)}>Ke kanan →</button>
            <button className={dir === -1 ? 'primary' : ''} onClick={() => setDir(-1)}>← Ke kiri</button>
          </div>
        )}
        <button className="primary" onClick={() => { s.edit((d) => { if (applyRigMotion(d, rig, motionId, frame, { duration, distance, dir })) growTo(d, frame + Math.round(duration * d.settings.fps)) }); setMsg(`"${motion.label}" dipasang mulai frame ${frame}.`) }}>Terapkan mulai frame {frame}</button>
      </div>

      <div>
        <h4 className="small" style={{ margin: '0 0 4px' }}>Ekspresi wajah</h4>
        {exprs.length <= 1 ? (
          <p className="muted small" style={{ margin: 0 }}>Karakter ini belum punya ekspresi. Di Character Builder: atur mata/alis/mulut → <em>Simpan ekspresi saat ini</em>, simpan versi, lalu sisipkan karakter lagi.</p>
        ) : (
          <>
            <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
              {exprs.map((id) => <button key={id} onClick={() => s.edit((d) => { applyExpression(d, rig, id, frame) })} title={`Ganti ke ekspresi ini mulai frame ${frame}`}>{id === 'default' ? 'Biasa' : id}</button>)}
            </div>
            <button style={{ marginTop: 4 }} onClick={() => s.edit((d) => clearExpression(d, rig, frame))}>Hapus pergantian di frame ini</button>
          </>
        )}
      </div>

      <div>
        <h4 className="small" style={{ margin: '0 0 4px' }}>Lip-sync dari suara</h4>
        {!mouth ? <p className="muted small" style={{ margin: 0 }}>Karakter ini tidak punya bagian mulut.</p> : voice.length === 0 ? (
          <p className="muted small" style={{ margin: 0 }}>Tambahkan klip suara (unggah atau rekam) di panel Audio dulu.</p>
        ) : (
          <>
            <select value={clipId || voice[0].id} onChange={(e) => setClipId(e.target.value)} aria-label="Klip suara">{voice.map((c) => <option key={c.id} value={c.id}>{c.name} (mulai {c.start}s)</option>)}</select>
            <button className="primary" style={{ marginTop: 4 }} disabled={busy} onClick={() => void lipSync()}>{busy ? 'Menganalisis…' : 'Gerakkan mulut mengikuti suara'}</button>
            <p className="muted small" style={{ margin: '4px 0 0' }}>Mulut membuka sesuai <em>volume</em> suara (bukan huruf/fonem): lebar saat keras, menutup saat jeda.</p>
          </>
        )}
      </div>
      {msg && <p className="small" role="status" style={{ margin: 0 }}>{msg}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------------------- camera

const CAM_NUMS: { prop: CameraProp; label: string; step: number; min?: number }[] = [
  { prop: 'x', label: 'Titik tengah X', step: 10 },
  { prop: 'y', label: 'Titik tengah Y', step: 10 },
  { prop: 'zoom', label: 'Zoom', step: 0.05, min: 0.2 },
  { prop: 'rot', label: 'Putar °', step: 1 },
]

function CameraTab() {
  const s = useEditor()
  const doc = s.doc!
  const { width: W, height: H, fps } = doc.settings
  const f = Math.round(s.frame)
  const cam = evalCamera(doc.camera, f, W, H)
  const [secs, setSecs] = useState(2)
  const frames = Math.max(2, Math.round(secs * fps))
  const edit = (fn: (c: NonNullable<typeof doc.camera>) => void) => s.edit((d) => { d.camera ??= {}; fn(d.camera) })
  const keys = camKeyFrames(doc.camera)
  const sel = s.selectedId ? doc.layers.find((l) => l.id === s.selectedId) : undefined

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <label className="inline"><input type="checkbox" checked={s.camPreview} onChange={(e) => s.setCamPreview(e.target.checked)} /> Lihat lewat kamera (saat menyunting)</label>
      <p className="muted small" style={{ margin: 0 }}>Kamera selalu aktif saat Putar film dan Export. Mengubah angka di bawah memasang keyframe kamera di frame {f}.</p>
      <div className="grid2">
        {CAM_NUMS.map((c) => (
          <label className="field" key={c.prop}><span>{c.label}</span>
            <input type="number" step={c.step} min={c.min} value={f2(cam[c.prop])} onChange={(e) => { const v = e.target.valueAsNumber; if (Number.isFinite(v)) edit((k) => setCamKey(k, c.prop, f, c.min !== undefined ? Math.max(c.min, v) : v)) }} />
          </label>
        ))}
      </div>
      <label className="field"><span>Lama gerakan (detik)</span><input type="number" min={0.5} max={20} step={0.5} value={secs} onChange={(e) => Number.isFinite(e.target.valueAsNumber) && setSecs(Math.max(0.5, Math.min(20, e.target.valueAsNumber)))} /></label>
      <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
        <button onClick={() => edit((k) => camZoom(k, f, f + frames, cam.zoom, cam.zoom * 1.6))}>Zoom in</button>
        <button onClick={() => edit((k) => camZoom(k, f, f + frames, cam.zoom, Math.max(0.2, cam.zoom / 1.6)))}>Zoom out</button>
        <button onClick={() => edit((k) => camPan(k, f, f + frames, { x: cam.x, y: cam.y }, { x: cam.x + W * 0.25, y: cam.y }))}>Geser →</button>
        <button onClick={() => edit((k) => camPan(k, f, f + frames, { x: cam.x, y: cam.y }, { x: cam.x - W * 0.25, y: cam.y }))}>← Geser</button>
        <button onClick={() => edit((k) => camShake(k, f, frames, 14, { x: cam.x, y: cam.y }))} title="Getar seperti gempa / benturan">Getar</button>
        <button disabled={!sel} title="Terbang ke layer terpilih dan perbesar" onClick={() => {
          if (!sel) return
          const p = worldPoint(doc, sel.id, f, 0, 0)
          edit((k) => camFocus(k, f, frames, p.x, p.y, Math.max(1.4, cam.zoom), W, H))
        }}>Fokus ke layer terpilih</button>
      </div>
      <div>
        <h4 className="small" style={{ margin: '0 0 4px' }}>Keyframe kamera</h4>
        {keys.length === 0 ? <p className="muted small" style={{ margin: 0 }}>Belum ada: kamera diam, melihat seluruh scene.</p> : (
          <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
            {keys.map((k) => (
              <span key={k} className="row" style={{ gap: 0 }}>
                <button className={k === f ? 'primary' : ''} onClick={() => s.setFrame(k)} title="Lompat ke frame ini">f{k}</button>
                <button aria-label={`Hapus key kamera frame ${k}`} title="Hapus" onClick={() => edit((c) => (['x', 'y', 'zoom', 'rot'] as const).forEach((p) => removeCamKey(c, p, k)))}>×</button>
              </span>
            ))}
          </div>
        )}
        {keys.length > 0 && <button style={{ marginTop: 4 }} onClick={() => s.edit((d) => { delete d.camera })}>Reset kamera</button>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------- effects

function EffectsTab() {
  const s = useEditor()
  const doc = s.doc!
  const effects = doc.effects ?? []
  const set = (fn: (e: NonNullable<typeof doc.effects>) => NonNullable<typeof doc.effects>) => s.edit((d) => { d.effects = fn(d.effects ?? []) })
  const label = timeOfDay(effects)
  const kinds: EffectKind[] = ['rain', 'snow', 'vignette']
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div>
        <h4 className="small" style={{ margin: '0 0 4px' }}>Waktu (warna seluruh scene)</h4>
        <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
          {TIME_PRESETS.map((p) => <button key={p.id} className={label === (p.effect?.label ?? 'Siang (normal)') ? 'primary' : ''} onClick={() => set((e) => setTimeOfDay(e, p.id, uid))}>{p.label}</button>)}
        </div>
        <p className="muted small" style={{ margin: '4px 0 0' }}>Satu latar bisa jadi pagi, sore, atau malam tanpa membuat gambar baru.</p>
      </div>
      <div>
        <h4 className="small" style={{ margin: '0 0 4px' }}>Efek</h4>
        <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
          {kinds.map((k) => <button key={k} className={effects.some((e) => e.kind === k) ? 'primary' : ''} onClick={() => set((e) => (e.some((x) => x.kind === k) ? e.filter((x) => x.kind !== k) : addEffect(e, k, k === 'vignette' ? 0.5 : 0.5, uid)))}>{EFFECT_LABEL[k]}</button>)}
        </div>
        {effects.map((e) => (
          <label className="field" key={e.id}><span>{e.label ?? EFFECT_LABEL[e.kind]} · {Math.round(e.intensity * 100)}%</span>
            <input type="range" min={0} max={100} value={Math.round(e.intensity * 100)} onChange={(ev) => set((list) => list.map((x) => (x.id === e.id ? { ...x, intensity: +ev.target.value / 100 } : x)))} />
          </label>
        ))}
        {effects.length === 0 && <p className="muted small" style={{ margin: '4px 0 0' }}>Belum ada efek di scene ini. Efek tampil juga di Export.</p>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------- text

/** Where a character's head is on screen (for placing a balloon), or null when the selection is not a rig. */
function headOf(doc: NonNullable<ReturnType<typeof useEditor.getState>['doc']>, selectedId: string | null, frame: number) {
  const rig = rigOf(doc.layers, selectedId)
  const ref = rig?.pieces.face ?? rig?.bones.head
  return ref ? worldPoint(doc, ref.id, frame, 0, 0) : null
}

function TextTab() {
  const s = useEditor()
  const doc = s.doc!
  const f = Math.round(s.frame)
  const { width: W, height: H, fps } = doc.settings
  const [text, setText] = useState('Halo semuanya!')
  const [kind, setKind] = useState<'speech' | 'thought' | 'shout'>('speech')
  const [title, setTitle] = useState('Judul Film')
  const subs = doc.subtitles ?? []
  const t = f / fps

  function addBalloon() {
    const head = headOf(doc, s.selectedId, f)
    const at = head ? { x: Math.max(220, Math.min(W - 220, head.x + 170)), y: Math.max(110, head.y - 150) } : { x: W / 2, y: H * 0.2 }
    s.addLayer(makeBalloon(uid(), text.trim() || '...', kind, at, head ? { x: head.x, y: head.y - 70 } : null))
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div>
        <h4 className="small" style={{ margin: '0 0 4px' }}>Balon dialog</h4>
        <textarea rows={2} maxLength={300} value={text} onChange={(e) => setText(e.target.value)} aria-label="Isi balon" />
        <div className="row" style={{ gap: 4, margin: '4px 0' }}>
          {([['speech', 'Bicara'], ['thought', 'Pikir'], ['shout', 'Teriak']] as const).map(([k, l]) => <button key={k} className={kind === k ? 'primary' : ''} onClick={() => setKind(k)}>{l}</button>)}
        </div>
        <button className="primary" onClick={addBalloon}>+ Balon dialog{headOf(doc, s.selectedId, f) ? ' di dekat kepala' : ''}</button>
        <p className="muted small" style={{ margin: '4px 0 0' }}>Balon adalah layer biasa: geser, ubah ukuran, beri keyframe/fade. Ujung ekor bisa diatur di panel properti bila perlu.</p>
      </div>

      <div>
        <h4 className="small" style={{ margin: '0 0 4px' }}>Judul</h4>
        <div className="row" style={{ gap: 4 }}>
          <input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} aria-label="Teks judul" />
          <button onClick={() => s.addLayer(makeTitle(uid(), title.trim() || 'Judul', W, H, fps, doc.settings.duration))}>+ Judul</button>
        </div>
        <p className="muted small" style={{ margin: '4px 0 0' }}>Teks besar di tengah yang muncul dan menghilang perlahan (atur warna di properti).</p>
      </div>

      <div>
        <h4 className="small" style={{ margin: '0 0 4px' }}>Subtitle (teks di bawah layar)</h4>
        {subs.map((u) => (
          <div key={u.id} style={{ display: 'grid', gap: 2, marginBottom: 6, padding: 4, border: '1px solid var(--border)', borderRadius: 6 }}>
            <input value={u.text} maxLength={300} aria-label="Teks subtitle" onChange={(e) => s.edit((d) => { const x = d.subtitles!.find((y) => y.id === u.id); if (x) x.text = e.target.value || ' ' }, 'sub:' + u.id)} />
            <div className="row" style={{ gap: 4 }}>
              <label className="field" style={{ flex: 1 }}><span>Mulai (s)</span><input type="number" min={0} step={0.1} value={u.start} onChange={(e) => Number.isFinite(e.target.valueAsNumber) && s.edit((d) => { const x = d.subtitles!.find((y) => y.id === u.id); if (x) { x.start = Math.max(0, f2(e.target.valueAsNumber)); x.end = Math.max(x.end, x.start + 0.2) } })} /></label>
              <label className="field" style={{ flex: 1 }}><span>Selesai (s)</span><input type="number" min={0} step={0.1} value={u.end} onChange={(e) => Number.isFinite(e.target.valueAsNumber) && s.edit((d) => { const x = d.subtitles!.find((y) => y.id === u.id); if (x) x.end = Math.max(x.start + 0.2, f2(e.target.valueAsNumber)) })} /></label>
              <button aria-label="Hapus subtitle" onClick={() => s.edit((d) => { d.subtitles = d.subtitles!.filter((y) => y.id !== u.id) })}>×</button>
            </div>
          </div>
        ))}
        <button onClick={() => s.edit((d) => { (d.subtitles ??= []).push({ id: uid(), start: f2(t), end: f2(Math.min(d.settings.duration, t + 2)), text: 'Teks subtitle' }) })}>+ Subtitle di playhead</button>
        {subs.length === 0 && <p className="muted small" style={{ margin: '4px 0 0' }}>Subtitle tampil di preview dan di export. Papan cerita bisa membuatnya otomatis dari dialog.</p>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------- props

function PropsTab({ projectId }: { projectId: number }) {
  const s = useEditor()
  const doc = s.doc!
  const f = Math.round(s.frame)
  const [props, setProps] = useState<LibAsset[] | null>(null)
  const [busy, setBusy] = useState<number | null>(null)
  const [msg, setMsg] = useState('')
  useEffect(() => { api.libAssets({ kind: 'prop' }).then(setProps).catch((e) => setMsg((e as Error).message)) }, [])

  const sel = s.selectedId ? doc.layers.find((l) => l.id === s.selectedId) : undefined
  const rig = rigOf(doc.layers, s.selectedId)

  async function insert(a: LibAsset) {
    setBusy(a.id); setMsg('')
    try {
      const png = await assetPng(a, 640)
      const asset = await api.uploadAsset(projectId, png.blob, `prop-${a.key ?? a.id}.png`)
      useEditor.getState().addAsset(asset)
      const pl = propPlacement(doc, f, png.width, png.height)
      s.addLayer({ id: uid(), type: 'image', name: `Properti: ${a.name}`, assetId: asset.id, x: pl.x, y: pl.y, scaleX: pl.scale, scaleY: pl.scale, rotation: 0, opacity: 1, visible: true, locked: false })
      setMsg(`"${a.name}" ditambahkan. Pilih layernya untuk menggeser, atau tempelkan ke tangan karakter.`)
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  function hold(side: 'l' | 'r') {
    if (!sel || sel.type === 'bone' || !rig) return
    const hand = rig.bones[`forearm_${side}`]
    if (!hand) return
    const local = canvasRef.current?.localFor(sel.id, hand.id)
    if (!local) return
    const err = s.reparent(sel.id, hand.id, { ...local, x: (hand.length ?? 100) * 0.92, y: 0 })
    setMsg(err ?? `Dipegang di tangan ${side === 'l' ? 'kiri' : 'kanan'} (ikut bergerak bersama lengan). Geser/putar sedikit bila perlu.`)
  }

  function release() {
    if (!sel) return
    const local = canvasRef.current?.localFor(sel.id, null)
    if (!local) return
    const err = s.reparent(sel.id, null, local)
    setMsg(err ?? 'Dilepas dari karakter.')
  }

  function shadow() {
    if (!rig) return
    const shins = [rig.bones.shin_l, rig.bones.shin_r].filter(Boolean) as Layer[]
    if (shins.length === 0) return
    const tips = shins.map((b) => worldPoint(doc, b.id, f, b.length ?? 0, 0))
    const x = tips.reduce((a, p) => a + p.x, 0) / tips.length
    const y = Math.max(...tips.map((p) => p.y)) - 6
    const width = Math.max(120, (Math.max(...tips.map((p) => p.x)) - Math.min(...tips.map((p) => p.x))) * 2.4 + 80)
    const layer = makeShadow(uid(), { x, y }, width)
    s.edit((d) => {
      const own = new Set([...Object.values(rig.bones), ...Object.values(rig.pieces)].map((l) => l.id))
      const first = d.layers.findIndex((l) => own.has(l.id))
      d.layers.splice(Math.max(0, first), 0, layer) // behind the whole character
    })
    s.select(layer.id)
    setMsg('Bayangan dipasang di kaki (di belakang karakter).')
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {props === null ? <p className="muted small">Memuat…</p> : props.length === 0 ? <p className="muted small">Belum ada properti di library.</p> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))', gap: 6 }}>
          {props.map((a) => (
            <button key={a.id} disabled={busy !== null} onClick={() => void insert(a)} title={a.name} style={{ padding: 4 }}>
              <img src={absUrl(a.url)} alt={a.name} style={{ width: '100%', aspectRatio: '1', objectFit: 'contain' }} loading="lazy" />
              <div className="small" style={{ fontSize: 10, lineHeight: 1.1 }}>{busy === a.id ? '…' : a.name}</div>
            </button>
          ))}
        </div>
      )}
      <div>
        <h4 className="small" style={{ margin: '0 0 4px' }}>Layer terpilih{sel ? `: ${sel.name}` : ''}</h4>
        <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
          <button disabled={!sel || sel.type === 'bone' || !rig} onClick={() => hold('r')} title="Tempelkan ke lengan bawah kanan karakter">Pegang di tangan kanan</button>
          <button disabled={!sel || sel.type === 'bone' || !rig} onClick={() => hold('l')} title="Tempelkan ke lengan bawah kiri karakter">Pegang di tangan kiri</button>
          <button disabled={!sel?.parentId} onClick={release}>Lepas</button>
        </div>
        {!rig && <p className="muted small" style={{ margin: '4px 0 0' }}>Untuk memegang benda, scene harus berisi satu karakter ber-bone (atau pilih bagian karakter itu lebih dulu).</p>}
      </div>
      <div>
        <button disabled={!rig} onClick={shadow}>+ Bayangan di kaki karakter</button>
      </div>
      {msg && <p className="small" role="status" style={{ margin: 0 }}>{msg}</p>}
    </div>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { AudioMixer } from '../audio'
import { canvasRef, StudioCanvas } from '../canvas'
import { uid, useEditor } from '../store'
import { effectAt, locate, sceneStart, totalDuration } from '../movie'
import { isImageAsset, type Layer } from '../types'
import { directCartoonProject } from '../autoDirector'
import { SceneBar } from '../components/SceneBar'
import { HelpDialog } from '../components/HelpDialog'
import { Tour, tourDone } from '../components/Tour'
import { AudioPanel } from '../components/AudioPanel'
import { Properties } from '../components/Properties'
import { FilmTools } from '../components/FilmTools'
import { ExportDialog } from '../components/ExportDialog'
import { BackgroundDialog } from '../components/BackgroundDialog'
import { StoryboardDialog } from '../components/StoryboardDialog'
import { ImageToSvgDialog } from '../components/ImageToSvgDialog'
import { absUrl } from '../builder/render'
import { CharacterLibraryDialog } from '../components/CharacterLibraryDialog'
import { VersionsDialog } from '../components/VersionsDialog'
import { Timeline } from '../components/Timeline'
import { fitZoom as fitZoomFor, wheelFactor, zoomAt, type StageView } from '../stageView'
import { nudgePatches, selectableIds } from '../layerSelect'
import { PresetDialog } from '../components/PresetDialog'
import { EnhanceDialog } from '../components/EnhanceDialog'
import { ImageEditDialog } from '../components/ImageEditDialog'
import { AiMotionDialog } from '../components/AiMotionDialog'
import { SegmentDialog } from '../components/SegmentDialog'
import { RetouchDialog } from '../components/RetouchDialog'
import { evalAll, evalLayer, flatten, totalFrames } from '../anim'

const ACCEPT = 'image/jpeg,image/png,image/webp'

function baseLayer(over: Partial<Layer> & Pick<Layer, 'type' | 'name'>, w: number, h: number): Layer {
  return { id: uid(), x: w / 2, y: h / 2, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, visible: true, locked: false, ...over }
}

export function EditorPage() {
  const { id } = useParams()
  const projectId = Number(id)
  const nav = useNavigate()
  const s = useEditor()
  const [loadError, setLoadError] = useState('')
  const [toast, setToast] = useState('')
  const [dialog, setDialog] = useState<'export' | 'versions' | 'presets' | 'ai' | 'help' | 'characters' | 'background' | 'board' | null>(null)
  const [tour, setTour] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const [zoom, setZoom] = useState(1)
  const [fit, setFit] = useState(true)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [svgAsset, setSvgAsset] = useState<{ id: number; name: string; url: string } | null>(null)
  const [hand, setHand] = useState(false) // hand tool: dragging pans the canvas
  const [panning, setPanning] = useState(false)
  const host = useRef<HTMLDivElement>(null)
  const stageBox = useRef<HTMLDivElement>(null)
  const studio = useRef<StudioCanvas | null>(null)
  const [canvasReady, setCanvasReady] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const mixer = useRef<AudioMixer | null>(null)
  useEffect(() => () => mixer.current?.dispose(), [])

  const flash = (m: string) => {
    setToast(m)
    setTimeout(() => setToast(''), 4000)
  }

  // first visit: offer the guided tour once the editor is on screen
  useEffect(() => {
    if (!canvasReady || tourDone()) return
    const t = setTimeout(() => setTour(true), 700)
    return () => clearTimeout(t)
  }, [canvasReady])

  // Esc closes the top-most dialog (each dialog already guards against closing while busy)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('.tour')) return
      const modal = [...document.querySelectorAll<HTMLElement>('.modal')].pop()
      if (modal) return modal.click()
      const t = e.target as HTMLElement
      if (t.tagName !== 'INPUT' && t.tagName !== 'TEXTAREA' && t.tagName !== 'SELECT') useEditor.getState().select(null) // Esc clears the selection
    }
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('keydown', h)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('keydown', h); window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  useEffect(() => { document.title = `${s.name || 'Editor'} — Cartoon Maker AI` }, [s.name])

  // load project
  useEffect(() => {
    useEditor
      .getState()
      .load(projectId)
      .then(async () => {
        const p = useEditor.getState().currentProject()
        if (p && p.auto_generated) {
          try {
            const directed = await directCartoonProject(projectId, p)
            const saved = await api.saveProject(projectId, {
              document: directed,
              base_revision: useEditor.getState().revision,
            })
            useEditor.getState().adopt(saved)
          } catch (e) {
            console.warn('Auto direct warning:', e)
          }
        }
        if (window.location.search.includes('auto_export=1')) {
          setTimeout(() => setDialog('export'), 600)
        }
      })
      .catch((e) => setLoadError(e.message))
    return () => {
      void useEditor.getState().save()
      useEditor.getState().reset()
    }
  }, [projectId])

  // create the Pixi canvas once the document is available
  const hasDoc = !!s.doc
  useEffect(() => {
    if (!hasDoc || !host.current) return
    const st = useEditor.getState()
    const sc = new StudioCanvas({
      onSelect: (sel, additive) => (additive && sel ? useEditor.getState().toggleSelect(sel) : useEditor.getState().select(sel)),
      onSelectMany: (ids, additive) => useEditor.getState().selectMany(ids, additive),
      onCommit: (lid, patch) => useEditor.getState().setProps(lid, patch),
      onCommitMany: (patches) => useEditor.getState().setPropsMany(patches, 'group-gesture'),
    })
    studio.current = sc
    canvasRef.current = sc
    const { width, height, background } = st.doc!.settings
    sc.init(host.current, width, height, background).then(() => setCanvasReady(true))
    return () => {
      setCanvasReady(false)
      studio.current = null
      canvasRef.current = null
      sc.destroy()
    }
  }, [hasDoc])

  // mirror document -> canvas
  useEffect(() => {
    if (!canvasReady || !s.doc) return
    const st = useEditor.getState()
    let effect = null
    if (st.movie) {
      // film preview: scene transitions are visible, editing chrome is not
      const p = st.currentProject()!
      effect = effectAt(p, p.scenes.findIndex((x) => x.id === st.activeSceneId), st.frame / s.doc.settings.fps, s.doc.settings.width)
    }
    studio.current?.sync(s.doc, s.assets, st.movie ? null : s.selectedId, s.frame, s.onion && !s.playing && !st.movie, s.showBones, effect, st.movie || s.camPreview, st.movie ? [] : s.selection)
  }, [canvasReady, s.doc, s.assets, s.selectedId, s.selection, s.frame, s.onion, s.playing, s.showBones, s.movie, s.activeSceneId, s.camPreview])

  // playback
  useEffect(() => {
    if (!s.playing) { mixer.current?.stopAll(); return }
    mixer.current ??= new AudioMixer()
    let raf = 0
    let last = performance.now()
    const step = (now: number) => {
      const st = useEditor.getState()
      if (!st.doc) return
      const dt = (now - last) / 1000
      last = now
      const fps = st.doc.settings.fps
      if (st.movie) {
        // whole film: one clock across all scenes (+ audio)
        const p = st.currentProject()!
        const idx = p.scenes.findIndex((x) => x.id === st.activeSceneId)
        const t = sceneStart(p, idx) + st.frame / fps + dt
        if (t >= totalDuration(p)) {
          mixer.current?.update(p.audio, st.assets, t, false)
          st.setFrame(totalFrames(st.doc))
          st.setMovie(false)
          st.setPlaying(false)
          return
        }
        const loc = locate(p, t)
        if (loc.index !== idx) st.selectScene(loc.scene.id)
        useEditor.getState().setFrame(loc.local * fps)
        mixer.current?.update(p.audio, st.assets, t, true)
      } else {
        const total = totalFrames(st.doc)
        let f = st.frame + dt * fps
        if (f >= total) f = f % total // loop the active scene
        st.setFrame(f)
      }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => { cancelAnimationFrame(raf); mixer.current?.stopAll() }
  }, [s.playing])

  // keep playhead inside the (possibly shortened) timeline
  const totalF = s.doc ? totalFrames(s.doc) : 0
  useEffect(() => {
    if (s.frame > totalF) useEditor.getState().setFrame(totalF)
  }, [totalF, s.frame])

  // fit canvas into the available area
  const doc = s.doc
  const fitZoom = useCallback(() => {
    const box = stageBox.current
    if (!box || !doc) return 1
    return fitZoomFor({ w: box.clientWidth, h: box.clientHeight }, { w: doc.settings.width, h: doc.settings.height })
  }, [doc?.settings.width, doc?.settings.height]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const box = stageBox.current
    if (!box) return
    const apply = () => { if (fit) { setZoom(fitZoom()); setPan({ x: 0, y: 0 }) } }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(box)
    return () => ro.disconnect()
  }, [fit, fitZoom, hasDoc])

  const view = useRef<StageView>({ zoom, pan })
  view.current = { zoom, pan }
  /** zoom about a point (offset from the centre of the work area, screen px); the cursor stays on the same scene point */
  const zoomBy = useCallback((factor: number, c?: { x: number; y: number }) => {
    const v = zoomAt(view.current, factor, c)
    view.current = v
    setFit(false); setZoom(v.zoom); setPan(v.pan)
  }, [])

  // wheel = zoom at the cursor (pinch on a trackpad too), Shift+wheel = pan sideways; panning by dragging: middle button, Alt+drag or the hand tool
  useEffect(() => {
    const box = stageBox.current
    if (!box) return
    const centre = (e: { clientX: number; clientY: number }) => { const r = box.getBoundingClientRect(); return { x: e.clientX - (r.left + r.width / 2), y: e.clientY - (r.top + r.height / 2) } }
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('.zoombar')) return
      e.preventDefault()
      if (e.shiftKey && !e.ctrlKey) {
        const d = e.deltaX || e.deltaY
        setFit(false); setPan((p) => ({ x: p.x - d, y: p.y }))
      } else zoomBy(wheelFactor(e.deltaY), centre(e))
    }
    let drag: { x: number; y: number; px: number; py: number } | null = null
    const onDown = (e: PointerEvent) => {
      const handOn = (box as HTMLElement).dataset.hand === '1'
      if (!(e.button === 1 || (e.button === 0 && (e.altKey || handOn)))) return
      if ((e.target as HTMLElement).closest('.zoombar')) return
      e.preventDefault(); e.stopPropagation() // the canvas must not also select / move something
      drag = { x: e.clientX, y: e.clientY, px: view.current.pan.x, py: view.current.pan.y }
      setPanning(true)
      window.addEventListener('pointermove', onMoveDrag)
      window.addEventListener('pointerup', onUp)
    }
    const onMoveDrag = (e: PointerEvent) => { if (drag) { setFit(false); setPan({ x: drag.px + e.clientX - drag.x, y: drag.py + e.clientY - drag.y }) } }
    const onUp = () => { drag = null; setPanning(false); window.removeEventListener('pointermove', onMoveDrag); window.removeEventListener('pointerup', onUp) }
    box.addEventListener('wheel', onWheel, { passive: false })
    box.addEventListener('pointerdown', onDown, true) // capture: runs before the canvas sees the press
    const noAux = (e: Event) => e.preventDefault()
    box.addEventListener('auxclick', noAux)
    return () => { box.removeEventListener('auxclick', noAux); box.removeEventListener('wheel', onWheel); box.removeEventListener('pointerdown', onDown, true); onUp() }
  }, [hasDoc, zoomBy])

  useEffect(() => {
    if (!canvasReady || !doc) return
    const c = studio.current!.canvas
    c.style.width = `${doc.settings.width * zoom}px`
    c.style.height = `${doc.settings.height * zoom}px`
    studio.current!.setZoom(zoom)
  }, [zoom, canvasReady, doc?.settings.width, doc?.settings.height]) // eslint-disable-line react-hooks/exhaustive-deps

  // warn about unsaved changes
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (useEditor.getState().dirty) e.preventDefault()
    }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [])

  const addImages = useCallback(async (files: FileList | File[]) => {
    for (const f of Array.from(files)) {
      if (!ACCEPT.split(',').includes(f.type)) {
        flash(`${f.name}: hanya JPG, PNG, atau WebP.`)
        continue
      }
      try {
        const a = await api.uploadAsset(projectId, f)
        useEditor.getState().addAsset(a)
        placeAsset(a.id)
      } catch (e) {
        flash(`${f.name}: ${(e as Error).message}`)
      }
    }
  }, [projectId])

  function addBone() {
    const st = useEditor.getState()
    const d = st.doc!
    const sel = d.layers.find((l) => l.id === st.selectedId)
    const parent = sel?.type === 'bone' ? sel : null
    st.addLayer(baseLayer({ type: 'bone', name: 'Bone', length: 120, pivotX: 0, pivotY: 0, parentId: parent?.id ?? null, ...(parent ? { x: parent.length ?? 100, y: 0 } : { x: d.settings.width / 2 - 60, y: d.settings.height / 2 }) }, d.settings.width, d.settings.height))
  }

  function placeAsset(assetId: number) {
    const st = useEditor.getState()
    const a = st.assets[assetId]
    const d = st.doc
    if (!a || !d) return
    const { width: W, height: H } = d.settings
    const k = Math.min(1, (W * 0.6) / a.width, (H * 0.6) / a.height)
    st.addLayer(baseLayer({ type: 'image', name: a.name, assetId, scaleX: k, scaleY: k }, W, H))
  }

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT'
      const st = useEditor.getState()
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z' && !typing) {
        e.preventDefault()
        e.shiftKey ? st.redo() : st.undo()
      } else if (mod && e.key.toLowerCase() === 'y' && !typing) {
        e.preventDefault()
        st.redo()
      } else if (e.code === 'Space' && !typing && !(t.tagName === 'BUTTON')) {
        e.preventDefault()
        st.setPlaying(!st.playing)
      } else if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void saveVersion()
      } else if (mod && e.key.toLowerCase() === 'a' && !typing && st.doc) {
        e.preventDefault()
        st.selectMany(selectableIds(st.doc.layers, st.showBones)) // Ctrl+A: every unlocked layer
      } else if (!typing && st.selKey && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault()
        st.deleteKey(st.selKey)
      } else if (!typing && st.selection.length > 1 && st.doc) {
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault()
          st.removeLayers(st.selection)
        } else if (e.key.startsWith('Arrow')) {
          e.preventDefault()
          const n = e.shiftKey ? 10 : 1
          const [dx, dy] = e.key === 'ArrowLeft' ? [-n, 0] : e.key === 'ArrowRight' ? [n, 0] : e.key === 'ArrowUp' ? [0, -n] : [0, n]
          st.setPropsMany(nudgePatches(st.doc.layers, st.selection, st.frame, dx, dy), 'nudge-group')
        }
      } else if (!typing && st.selectedId) {
        const base = st.doc?.layers.find((x) => x.id === st.selectedId)
        if (!base) return
        const l = evalLayer(base, st.frame)
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault()
          st.removeLayer(l.id)
        } else if (e.key.startsWith('Arrow') && !l.locked) {
          e.preventDefault()
          const n = e.shiftKey ? 10 : 1
          const patch = e.key === 'ArrowLeft' ? { x: l.x - n } : e.key === 'ArrowRight' ? { x: l.x + n } : e.key === 'ArrowUp' ? { y: l.y - n } : { y: l.y + n }
          st.setProps(l.id, patch, 'nudge:' + l.id)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  async function saveVersion() {
    const ok = await useEditor.getState().save({ snapshot: true, label: 'Simpan manual' })
    flash(ok ? 'Tersimpan sebagai versi baru.' : 'Gagal menyimpan.')
  }

  if (loadError) {
    return (
      <div className="center">
        <p className="error">{loadError}</p>
        <button onClick={() => nav('/')}>Kembali</button>
      </div>
    )
  }
  if (!doc) return <div className="center muted">Memuat project…</div>

  const selBase = doc.layers.find((l) => l.id === s.selectedId) ?? null
  const selected = selBase ? evalAll(doc, s.frame).get(selBase.id)! : null
  const assets = Object.values(s.assets).filter(isImageAsset)
  const saveLabel = { idle: s.dirty ? 'Belum tersimpan' : 'Tersimpan', saving: 'Menyimpan…', saved: 'Tersimpan', error: 'Gagal menyimpan', conflict: 'Konflik versi' }[s.saveState]

  return (
    <div className="editor">
      <header className="toolbar">
        <button onClick={() => nav('/')} title="Kembali ke daftar project">←</button>
        <input className="name" value={s.name} onChange={(e) => s.rename(e.target.value)} maxLength={120} aria-label="Nama project" />
        <span className={`status ${s.saveState}`} title={s.saveError ?? ''}>{saveLabel}</span>
        <span className="spacer" />
        <button onClick={() => fileInput.current?.click()}>Import gambar</button>
        <input ref={fileInput} type="file" accept={ACCEPT} multiple hidden onChange={(e) => { if (e.target.files) void addImages(e.target.files); e.target.value = '' }} />
        <button onClick={() => s.addLayer(baseLayer({ type: 'text', name: 'Teks', text: 'Teks baru', fontSize: 64, fill: '#111111' }, doc.settings.width, doc.settings.height))}>+ Teks</button>
        <button onClick={() => s.addLayer(baseLayer({ type: 'shape', name: 'Kotak', width: 240, height: 160, fill: '#4f8cff' }, doc.settings.width, doc.settings.height))}>+ Kotak</button>
        <button onClick={addBone} title="Tambah bone (anak dari bone terpilih, di ujungnya)">+ Bone</button>
        <label className="inline" title="Bone hanya tampil di editor, tidak ikut export"><input type="checkbox" checked={s.showBones} onChange={(e) => s.setShowBones(e.target.checked)} /> Bone</label>
        <button onClick={s.undo} disabled={!s.past.length} title="Undo (Ctrl+Z)">↶</button>
        <button onClick={s.redo} disabled={!s.future.length} title="Redo (Ctrl+Y)">↷</button>
        <button onClick={() => setDialog('ai')} title="Buat gerakan dari perintah teks (AI via 9router)">✨ AI Gerak</button>
        <button onClick={() => void saveVersion()} title="Simpan versi (Ctrl+S)">Simpan versi</button>
        <button onClick={() => setDialog('board')} title="Papan cerita: catatan scene, dialog, dan pembuat scene dari skrip">Papan cerita</button>
        <button onClick={() => setDialog('background')} title="Pasang lokasi/latar (sekolah, rumah, taman…)">Latar</button>
        <button onClick={() => setDialog('characters')} title="Simpan/sisipkan karakter reusable">Karakter</button>
        <button onClick={() => setDialog('versions')}>Riwayat</button>
        <button className="primary" onClick={() => void s.save().then(() => setDialog('export'))}>Export</button>
        <button onClick={() => setDialog('help')} aria-label="Bantuan dan tur" title="Bantuan, pintasan, tur singkat">?</button>
      </header>

      {!online && <div className="banner error" role="alert">Anda sedang offline. Perubahan akan disimpan otomatis begitu koneksi kembali.</div>}
      {online && s.saveState === 'error' && (
        <div className="banner error" role="alert">
          Gagal menyimpan: {s.saveError} <button onClick={() => void s.save()}>Coba lagi</button>
        </div>
      )}

      {s.saveState === 'conflict' && (
        <div className="banner error">
          Project diubah di tab/perangkat lain. <button onClick={() => api.project(projectId).then((p) => useEditor.getState().adopt(p))}>Muat versi terbaru (buang perubahan lokal)</button>
        </div>
      )}
      {toast && <div className="toast" role="status">{toast}</div>}

      <aside className="left">
        <section>
          <h3>Aset</h3>
          {assets.length === 0 && <p className="muted small">Belum ada gambar. Import atau seret file ke kanvas.</p>}
          <div className="asset-grid">
            {assets.map((a) => (
              <div key={a.id} className="asset" title={`${a.name} — klik untuk menambahkan`}>
                <img src={a.url} alt={a.name} tabIndex={0} onClick={() => placeAsset(a.id)} onKeyDown={(e) => e.key === 'Enter' && placeAsset(a.id)} />
                <span className="tools">
                  <button className="ed" title="Edit gambar (crop, resize, hapus latar)" aria-label="Edit gambar" onClick={() => s.openImageEditor(a.id)}>✎</button>
                  <button className="ed" title="Enhancement Studio (bersihkan sketsa, deskew, before/after)" aria-label="Perbaiki gambar" onClick={() => s.openEnhance(a.id)}>✨</button>
                  <button className="ed" title="Ubah gambar ini menjadi SVG (vektor)" aria-label="Ubah jadi SVG" onClick={() => setSvgAsset(a)}>SVG</button>
                </span>
                <button
                  className="x"
                  title="Hapus aset"
                  onClick={async () => {
                    const pr = useEditor.getState().currentProject()
                    if (pr?.scenes.some((sc) => sc.layers.some((l) => l.assetId === a.id || l.swaps?.some((w) => w.assetId === a.id) || Object.values(l.expr ?? {}).includes(a.id)))) return flash('Aset masih dipakai layer (di salah satu scene).')
                    await api.deleteAsset(a.id)
                    useEditor.setState((st) => {
                      const { [a.id]: _, ...rest } = st.assets
                      return { assets: rest }
                    })
                  }}
                >×</button>
              </div>
            ))}
          </div>
        </section>
        <AudioPanel projectId={projectId} />
        <section className="layers">
          <h3>Layer</h3>
          {doc.layers.length === 0 && <p className="muted small">Belum ada layer.</p>}
          <ul>
            {flatten(doc).map(({ layer: l, depth }) => (
              <li key={l.id} className={s.selection.includes(l.id) ? 'sel' : ''} style={{ paddingLeft: 4 + depth * 14 }} onClick={(e) => (e.shiftKey || e.ctrlKey || e.metaKey ? s.toggleSelect(l.id) : s.select(l.id))}>
                <button className="ico" title={l.visible ? 'Sembunyikan' : 'Tampilkan'} aria-label={l.visible ? 'Sembunyikan' : 'Tampilkan'} onClick={(e) => { e.stopPropagation(); s.updateLayer(l.id, { visible: !l.visible }) }}>{l.visible ? '👁' : '—'}</button>
                <button className="ico" title={l.locked ? 'Buka kunci' : 'Kunci'} aria-label={l.locked ? 'Buka kunci' : 'Kunci'} onClick={(e) => { e.stopPropagation(); s.updateLayer(l.id, { locked: !l.locked }) }}>{l.locked ? '🔒' : '🔓'}</button>
                <span className="lname">{l.type === 'bone' ? '🦴 ' : ''}{l.name}</span>
                <button className="ico" title="Naikkan" aria-label="Naikkan" onClick={(e) => { e.stopPropagation(); s.moveLayer(l.id, 1) }}>▲</button>
                <button className="ico" title="Turunkan" aria-label="Turunkan" onClick={(e) => { e.stopPropagation(); s.moveLayer(l.id, -1) }}>▼</button>
              </li>
            ))}
          </ul>
        </section>
      </aside>

      <main
        className="stage"
        ref={stageBox}
        data-hand={hand ? '1' : '0'}
        style={{ cursor: panning ? 'grabbing' : hand ? 'grab' : undefined }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          if (e.dataTransfer.files.length) void addImages(e.dataTransfer.files)
        }}
      >
        <div ref={host} className="canvas-host" style={{ transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px)` }} />
        <div className="zoombar" title="Roda mouse = zoom ke arah kursor · Shift+roda = geser · tombol tengah / Alt+seret / alat tangan = geser kanvas">
          <button onClick={() => zoomBy(1 / 1.25)} aria-label="Perkecil">−</button>
          <span>{Math.round(zoom * 100)}%</span>
          <button onClick={() => zoomBy(1.25)} aria-label="Perbesar">+</button>
          <button onClick={() => { setFit(false); setZoom(1); setPan({ x: 0, y: 0 }) }}>100%</button>
          <button onClick={() => setFit(true)}>Fit</button>
          <button className={hand ? 'primary' : ''} aria-pressed={hand} onClick={() => setHand((h) => !h)} title="Alat tangan: seret untuk menggeser kanvas (atau tahan Alt / tombol tengah mouse)">✋</button>
        </div>
      </main>

      <aside className="right">
        {s.selection.length > 1 && (
          <section>
            <h3>{s.selection.length} layer dipilih</h3>
            <p className="muted small">Seret salah satunya untuk menggeser semuanya; seret kotak putih (sudut) untuk mengubah ukuran bersama, bulatan di atas untuk memutar bersama. Panah menggeser, Delete menghapus. Properti di bawah milik layer terakhir yang dipilih. Shift/Ctrl+klik menambah atau melepas; Esc membatalkan.</p>
          </section>
        )}
        <Properties layer={selected} />
        <FilmTools projectId={projectId} />
      </aside>

      <footer className="timeline">
        <SceneBar />
        <Timeline onPresets={() => setDialog('presets')} />
      </footer>

      {dialog === 'export' && <ExportDialog projectId={projectId} studio={studio} onClose={() => setDialog(null)} />}
      {s.retouchLayerId !== null && <RetouchDialog layerId={s.retouchLayerId} onClose={() => s.openRetouch(null)} />}
      {s.segmentLayerId !== null && <SegmentDialog layerId={s.segmentLayerId} onClose={() => s.openSegment(null)} />}
      {s.enhanceAssetId !== null && <EnhanceDialog assetId={s.enhanceAssetId} onClose={() => s.openEnhance(null)} />}
      {s.editAssetId !== null && <ImageEditDialog assetId={s.editAssetId} onClose={() => s.openImageEditor(null)} />}
      {dialog === 'help' && <HelpDialog onClose={() => setDialog(null)} onTour={() => { setDialog(null); setTour(true) }} />}
      {tour && <Tour onClose={() => setTour(false)} />}
      {dialog === 'ai' && <AiMotionDialog projectId={projectId} onClose={() => setDialog(null)} />}
      {dialog === 'presets' && <PresetDialog onClose={() => setDialog(null)} />}
      {svgAsset && <ImageToSvgDialog name={svgAsset.name} url={absUrl(svgAsset.url)} onClose={() => setSvgAsset(null)} />}
      {dialog === 'board' && <StoryboardDialog projectId={projectId} onClose={() => setDialog(null)} onOpenScene={() => setDialog(null)} />}
      {dialog === 'background' && <BackgroundDialog projectId={projectId} onClose={() => setDialog(null)} />}
      {dialog === 'characters' && <CharacterLibraryDialog projectId={projectId} onClose={() => setDialog(null)} />}
      {dialog === 'versions' && <VersionsDialog projectId={projectId} onClose={() => setDialog(null)} />}
    </div>
  )
}

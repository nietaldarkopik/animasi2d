import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { composeParts, snapBox, type Box, type PartDraft } from '../rigparts'
import { uid, useEditor } from '../store'
import type { AiJobInfo, SegmentPlan } from '../types'

const DISP_W = 520
const color = (i: number) => `hsl(${(i * 47) % 360} 85% 60%)`
type Drag = { key: string; mode: 'move' | 'resize' | 'joint'; sx: number; sy: number; box: Box; joint: { x: number; y: number } | null }

export function SegmentDialog({ layerId, onClose }: { layerId: string; onClose: () => void }) {
  const s = useEditor()
  const layer = s.doc?.layers.find((l) => l.id === layerId)
  const asset = layer?.assetId ? s.assets[layer.assetId] : undefined

  const [job, setJob] = useState<AiJobInfo | null>(null)
  const [parts, setParts] = useState<PartDraft[]>([])
  const [sel, setSel] = useState<string | null>(null)
  const [notes, setNotes] = useState<string[]>([])
  const [hideSource, setHideSource] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState('')
  const pixels = useRef<ImageData | null>(null)
  const drag = useRef<Drag | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const alive = useRef(true)
  const loaded = useRef<number | null>(null)

  useEffect(() => { alive.current = true; return () => void (alive.current = false) }, [])

  const running = job?.status === 'queued' || job?.status === 'processing'
  useEffect(() => {
    if (!job || !running) return
    const t = setInterval(async () => {
      try { const j = await api.aiJob(job.id); if (alive.current) setJob(j) } catch (e) { if (alive.current) setError((e as Error).message) }
    }, 1200)
    return () => clearInterval(t)
  }, [job?.id, running]) // eslint-disable-line react-hooks/exhaustive-deps

  // when the plan arrives, turn it into editable drafts
  useEffect(() => {
    if (job?.status !== 'done' || !job.result || loaded.current === job.id) return
    loaded.current = job.id
    const plan = job.result as unknown as SegmentPlan
    const drafts: PartDraft[] = plan.parts.map((p, i) => ({ key: `p${i}`, name: p.name, parent: null, box: { ...p.box }, joint: p.joint ? { ...p.joint } : null }))
    plan.parts.forEach((p, i) => { drafts[i].parent = drafts.find((d) => d.name.toLowerCase() === p.parent?.toLowerCase())?.key ?? null })
    setParts(drafts)
    setNotes([plan.notes, ...plan.warnings].filter(Boolean))
    setSel(drafts[0]?.key ?? null)
  }, [job])

  if (!layer || !asset) return null
  const W = asset.width
  const H = asset.height
  const k = W / DISP_W // image px per display px
  const dispH = H / k

  async function start() {
    setError('')
    setJob(null)
    setParts([])
    setDone('')
    loaded.current = null
    try {
      if (!(await useEditor.getState().save())) return setError('Simpan project gagal; coba lagi.')
      setJob(await api.aiSegment(asset!.id))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function getPixels() {
    if (pixels.current) return pixels.current
    const bmp = await createImageBitmap(await (await fetch(asset!.url)).blob())
    const c = document.createElement('canvas')
    c.width = bmp.width
    c.height = bmp.height
    const g = c.getContext('2d')!
    g.drawImage(bmp, 0, 0)
    return (pixels.current = g.getImageData(0, 0, c.width, c.height))
  }

  async function snap(keys: string[]) {
    try {
      const img = await getPixels()
      setParts((ps) => ps.map((p) => (keys.includes(p.key) ? { ...p, box: snapBox(img, p.box) } : p)))
    } catch (e) {
      setError('Gagal membaca gambar: ' + (e as Error).message)
    }
  }

  const patch = (key: string, f: (p: PartDraft) => PartDraft) => setParts((ps) => ps.map((p) => (p.key === key ? f(p) : p)))
  const clampBox = (b: Box): Box => {
    const w = Math.max(4, Math.min(W, b.w)), h = Math.max(4, Math.min(H, b.h))
    return { x: Math.max(0, Math.min(W - w, b.x)), y: Math.max(0, Math.min(H - h, b.y)), w, h }
  }
  const descendants = (key: string): Set<string> => {
    const out = new Set<string>()
    const walk = (p: string) => parts.filter((x) => x.parent === p).forEach((c) => { out.add(c.key); walk(c.key) })
    walk(key)
    return out
  }
  function removePart(key: string) {
    const gone = parts.find((p) => p.key === key)
    setParts((ps) => ps.filter((p) => p.key !== key).map((p) => (p.parent === key ? { ...p, parent: gone?.parent ?? null } : p)))
    if (sel === key) setSel(null)
  }
  function addPart() {
    const key = 'n' + Math.random().toString(36).slice(2, 7)
    const w = Math.round(W * 0.2), h = Math.round(H * 0.2)
    setParts((ps) => [...ps, { key, name: `Bagian ${ps.length + 1}`, parent: ps[0]?.key ?? null, box: { x: Math.round((W - w) / 2), y: Math.round((H - h) / 2), w, h }, joint: null }])
    setSel(key)
  }

  // ---- pointer editing on the preview
  function startDrag(e: React.PointerEvent, key: string, mode: Drag['mode']) {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = parts.find((x) => x.key === key)!
    setSel(key)
    drag.current = { key, mode, sx: e.clientX, sy: e.clientY, box: { ...p.box }, joint: p.joint ? { ...p.joint } : null }
  }
  function onMove(e: React.PointerEvent) {
    const d = drag.current
    if (!d) return
    const dx = (e.clientX - d.sx) * k
    const dy = (e.clientY - d.sy) * k
    patch(d.key, (p) => {
      if (d.mode === 'move') return { ...p, box: clampBox({ ...d.box, x: d.box.x + dx, y: d.box.y + dy }), joint: d.joint ? { x: d.joint.x + dx, y: d.joint.y + dy } : null }
      if (d.mode === 'resize') return { ...p, box: clampBox({ ...d.box, w: d.box.w + dx, h: d.box.h + dy }) }
      const b = box.current!.getBoundingClientRect()
      return { ...p, joint: { x: Math.max(0, Math.min(W, (e.clientX - b.left) * k)), y: Math.max(0, Math.min(H, (e.clientY - b.top) * k)) } }
    })
  }
  const endDrag = () => { drag.current = null }

  async function apply() {
    setBusy(true)
    setError('')
    try {
      // unique, trimmed names (the server stores them in file names)
      const used = new Set<string>()
      const drafts = parts.map((p) => {
        let name = (p.name.trim() || 'Bagian').slice(0, 40)
        const base = name
        for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base.slice(0, 36)} ${n}`
        used.add(name.toLowerCase())
        const b = clampBox(p.box)
        return { ...p, name, box: { x: Math.round(b.x), y: Math.round(b.y), w: Math.max(1, Math.round(b.w)), h: Math.max(1, Math.round(b.h)) } }
      })
      const made = await api.aiSegmentApply(job!.id, drafts.map((p) => ({ name: p.name, ...p.box })))
      made.forEach((m) => useEditor.getState().addAsset(m.asset))
      const { layers } = composeParts(layer!, W, H, drafts, uid) as unknown as { layers: (import('../types').Layer & { key: string })[] }
      useEditor.getState().edit((d) => {
        for (const l of layers) {
          const idx = drafts.findIndex((p) => p.key === l.key)
          const { key: _k, ...rest } = l
          d.layers.push({ ...rest, type: 'image', assetId: made[idx].asset.id })
        }
        if (hideSource) { const src = d.layers.find((x) => x.id === layerId); if (src) src.visible = false }
      })
      setDone(`${layers.length} layer dibuat dengan hierarki dan pivot di sendi${hideSource ? '; gambar asli disembunyikan' : ''}. Putar bone/layer induk untuk mencoba FK.`)
      setParts([])
      setJob(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const animated = (['x', 'y', 'scaleX', 'scaleY', 'rotation'] as const).some((p) => layer.keyframes?.[p]?.length)
  const reviewing = job?.status === 'done' && parts.length > 0

  return (
    <div className="modal" onClick={() => !running && !busy && onClose()}>
      <div role="dialog" aria-modal="true" className="card dialog wide" onClick={(e) => e.stopPropagation()}>
        <h2>AI Pisahkan Bagian — {layer.name}</h2>
        <p className="muted small">
          Model vision (lewat 9router) mengusulkan bagian tubuh, induk, dan sendi. <strong>Usulan ini perkiraan</strong>: koordinat kotak dari AI sering meleset, jadi periksa dan koreksi (geser kotak, tarik sudut kanan-bawah, geser titik sendi) sebelum diterapkan.
          Hasil: layer gambar per bagian, berhierarki, pivot di sendi. Bagian yang saling menimpa dipotong persegi dan masih berisi piksel tetangga.
        </p>

        {!job && !reviewing && !done && (
          <div className="row"><button className="primary" onClick={() => void start()}>Analisis dengan AI</button>{animated && <span className="small" style={{ color: 'var(--warn)' }}>Layer ini punya keyframe transformasi; bagian baru memakai nilai dasarnya.</span>}</div>
        )}
        {running && <div className="progress"><div style={{ width: '100%', opacity: 0.35 }} /><span>AI sedang menganalisis gambar… (±10–40 detik)</span></div>}
        {job?.status === 'failed' && <div className="error" role="alert">{job.error} <button onClick={() => void start()}>Coba lagi</button></div>}
        {error && <div className="error" role="alert">{error}</div>}
        {done && <p className="small" style={{ color: 'var(--ok)' }}>{done}</p>}

        {reviewing && (
          <>
            {notes.length > 0 && <p className="muted small">{notes.join(' · ')}</p>}
            <div className="imgedit">
              <div style={{ flex: `0 0 ${DISP_W}px`, maxWidth: '100%' }}>
                <div
                  ref={box}
                  className="seg-stage"
                  style={{ width: DISP_W, height: dispH }}
                  onPointerMove={onMove}
                  onPointerUp={endDrag}
                  onPointerDown={() => setSel(null)}
                >
                  <img src={asset.url} alt="" draggable={false} />
                  {parts.map((p, i) => {
                    const on = p.key === sel
                    const j = p.joint ?? { x: p.box.x + p.box.w / 2, y: p.box.y + p.box.h / 2 }
                    return (
                      <div key={p.key}>
                        <div
                          className={`seg-box ${on ? 'on' : ''}`}
                          style={{ left: p.box.x / k, top: p.box.y / k, width: p.box.w / k, height: p.box.h / k, borderColor: color(i), background: on ? color(i).replace(')', ' / 18%)') : 'transparent' }}
                          onPointerDown={(e) => startDrag(e, p.key, 'move')}
                        >
                          <span className="seg-label" style={{ background: color(i) }}>{p.name}</span>
                          {on && <i className="seg-handle" onPointerDown={(e) => startDrag(e, p.key, 'resize')} />}
                        </div>
                        {(on || p.joint) && <i className="seg-joint" title={`Sendi ${p.name}`} style={{ left: j.x / k, top: j.y / k, borderColor: color(i) }} onPointerDown={(e) => startDrag(e, p.key, 'joint')} />}
                      </div>
                    )
                  })}
                </div>
                <p className="muted small">Kotak = area potong. Titik bulat = sendi (pivot rotasi); bila belum diatur, dipilih otomatis di tengah tumpang-tindih dengan induk.</p>
              </div>

              <div className="imgedit-opts seg-list">
                <div className="seg-rows">
                {parts.map((p, i) => (
                  <div key={p.key} className={`seg-row ${p.key === sel ? 'on' : ''}`} onClick={() => setSel(p.key)}>
                    <i className="dot" style={{ background: color(i) }} />
                    <input value={p.name} maxLength={40} onChange={(e) => patch(p.key, (x) => ({ ...x, name: e.target.value }))} aria-label="Nama bagian" />
                    <select value={p.parent ?? ''} onChange={(e) => patch(p.key, (x) => ({ ...x, parent: e.target.value || null }))} aria-label="Induk">
                      <option value="">(akar)</option>
                      {parts.filter((o) => o.key !== p.key && !descendants(p.key).has(o.key)).map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}
                    </select>
                    <button title="Rapatkan kotak ke isi gambar" onClick={(e) => { e.stopPropagation(); void snap([p.key]) }}>⤢</button>
                    <button className="danger" title="Hapus bagian" onClick={(e) => { e.stopPropagation(); removePart(p.key) }}>×</button>
                  </div>
                ))}
                </div>
                <div className="row">
                  <button onClick={addPart}>+ Bagian</button>
                  <button onClick={() => void snap(parts.map((p) => p.key))} title="Perkecil semua kotak ke piksel isi (bukan latar)">Rapatkan semua</button>
                </div>
                <label className="inline"><input type="checkbox" checked={hideSource} onChange={(e) => setHideSource(e.target.checked)} /> Sembunyikan gambar asli setelah dipisah</label>
                {parts.filter((p) => !p.parent).length > 1 && <p className="small" style={{ color: 'var(--warn)' }}>Ada lebih dari satu akar; tiap akar bergerak sendiri-sendiri.</p>}
                <button className="primary" disabled={busy || parts.length === 0} onClick={() => void apply()}>{busy ? 'Memotong…' : `Potong & buat ${parts.length} layer`}</button>
              </div>
            </div>
          </>
        )}

        <div className="row end"><button onClick={onClose} disabled={running || busy}>Tutup</button></div>
      </div>
    </div>
  )
}

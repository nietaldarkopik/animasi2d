import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { clonePixels, compensatePad, padPixels, padShift, stampLine, type Brush, type Pixels, type Tool } from '../retouch'
import { useEditor } from '../store'

type Mode = Tool | 'pick'
interface Snapshot { work: Pixels; orig: Pixels; pad: Pad }
interface Pad { top: number; right: number; bottom: number; left: number }
const NO_PAD: Pad = { top: 0, right: 0, bottom: 0, left: 0 }
const UNDO_LIMIT = 12
const MAX_PIXELS = 16_000_000
const hexToRgb = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const rgbToHex = (r: number, g: number, b: number) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')

const TOOLS: { id: Mode; label: string; hint: string }[] = [
  { id: 'erase', label: 'Hapus', hint: 'Hapus piksel (mis. bagian badan yang ikut terpotong)' },
  { id: 'restore', label: 'Pulihkan', hint: 'Kembalikan piksel asli yang terhapus' },
  { id: 'paint', label: 'Lukis', hint: 'Lukis bagian yang terpotong/tersembunyi dengan warna terpilih' },
  { id: 'pick', label: 'Pipet', hint: 'Ambil warna dari gambar' },
]

export function RetouchDialog({ layerId, onClose }: { layerId: string; onClose: () => void }) {
  const s = useEditor()
  const layer = s.doc?.layers.find((l) => l.id === layerId)
  const asset = layer?.assetId ? s.assets[layer.assetId] : undefined

  const work = useRef<Pixels | null>(null)
  const orig = useRef<Pixels | null>(null)
  const pad = useRef<Pad>({ ...NO_PAD })
  const initial = useRef<Snapshot | null>(null)
  const undo = useRef<Snapshot[]>([])
  const canvas = useRef<HTMLCanvasElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const last = useRef<{ x: number; y: number } | null>(null)

  const [ready, setReady] = useState(false)
  const [size, setSize] = useState<[number, number]>([0, 0])
  const [tool, setTool] = useState<Mode>('erase')
  const [radius, setRadius] = useState(20)
  const [softness, setSoftness] = useState(30)
  const [color, setColor] = useState('#ff0000')
  const [zoom, setZoom] = useState(1)
  const [padIn, setPadIn] = useState<Pad>({ ...NO_PAD })
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  const [undoCount, setUndoCount] = useState(0)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  const redraw = useCallback(() => {
    const w = work.current
    const c = canvas.current
    if (!w || !c) return
    if (c.width !== w.w || c.height !== w.h) { c.width = w.w; c.height = w.h }
    c.getContext('2d')!.putImageData(new ImageData(w.data as Uint8ClampedArray<ArrayBuffer>, w.w, w.h), 0, 0)
  }, [])

  // load the image into editable pixel buffers
  useEffect(() => {
    if (!asset) return
    let cancelled = false
    ;(async () => {
      try {
        if (asset.width * asset.height > MAX_PIXELS) throw new Error('Gambar terlalu besar untuk diretouch di browser (maks. 16 juta piksel). Perkecil dulu lewat Edit gambar.')
        const bmp = await createImageBitmap(await (await fetch(asset.url)).blob())
        const c = document.createElement('canvas')
        c.width = bmp.width
        c.height = bmp.height
        const g = c.getContext('2d', { willReadFrequently: true })!
        g.drawImage(bmp, 0, 0)
        const id = g.getImageData(0, 0, c.width, c.height)
        if (cancelled) return
        orig.current = { w: id.width, h: id.height, data: new Uint8ClampedArray(id.data) }
        work.current = clonePixels(orig.current)
        initial.current = { work: clonePixels(work.current), orig: clonePixels(orig.current), pad: { ...NO_PAD } }
        setSize([id.width, id.height])
        setZoom(Math.min(1, 640 / id.width, 520 / id.height))
        setReady(true)
      } catch (e) {
        if (!cancelled) setError((e as Error).message)
      }
    })()
    return () => { cancelled = true }
  }, [asset?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (ready) redraw() }, [ready, size, redraw])

  if (!layer || !asset) return null

  const snapshot = (): Snapshot => ({ work: clonePixels(work.current!), orig: clonePixels(orig.current!), pad: { ...pad.current } })
  const pushUndo = () => {
    undo.current.push(snapshot())
    if (undo.current.length > UNDO_LIMIT) undo.current.shift()
    setUndoCount(undo.current.length)
    setDirty(true)
  }
  const restoreSnap = (sn: Snapshot) => {
    work.current = clonePixels(sn.work)
    orig.current = clonePixels(sn.orig)
    pad.current = { ...sn.pad }
    setSize([work.current.w, work.current.h])
    redraw()
  }
  const doUndo = () => {
    const sn = undo.current.pop()
    if (!sn) return
    restoreSnap(sn)
    setUndoCount(undo.current.length)
  }
  const reset = () => {
    if (!initial.current) return
    pushUndo()
    restoreSnap(initial.current)
    setPadIn({ ...NO_PAD })
  }

  const pos = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * work.current!.w, y: ((e.clientY - r.top) / r.height) * work.current!.h }
  }
  const brush = (): Brush => ({ tool: tool === 'pick' ? 'paint' : tool, radius, softness: softness / 100, color: hexToRgb(color), flow: 1 })

  function down(e: React.PointerEvent) {
    if (!work.current) return
    const p = pos(e)
    if (tool === 'pick') {
      const w = work.current
      const x = Math.floor(p.x), y = Math.floor(p.y)
      if (x >= 0 && y >= 0 && x < w.w && y < w.h) {
        const i = (y * w.w + x) * 4
        if (w.data[i + 3] > 8) { setColor(rgbToHex(w.data[i], w.data[i + 1], w.data[i + 2])); setTool('paint') }
      }
      return
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    pushUndo()
    last.current = p
    stampLine(work.current, orig.current!, p.x, p.y, p.x, p.y, brush())
    redraw()
  }
  function move(e: React.PointerEvent) {
    const r = stage.current!.getBoundingClientRect()
    setCursor({ x: e.clientX - r.left + stage.current!.scrollLeft, y: e.clientY - r.top + stage.current!.scrollTop })
    if (!last.current || !work.current) return
    const p = pos(e)
    stampLine(work.current, orig.current!, last.current.x, last.current.y, p.x, p.y, brush())
    last.current = p
    redraw()
  }
  const up = () => { last.current = null }

  function extend() {
    const n = (v: number) => Math.max(0, Math.min(1000, Math.round(v || 0)))
    const p = { top: n(padIn.top), right: n(padIn.right), bottom: n(padIn.bottom), left: n(padIn.left) }
    if (!p.top && !p.right && !p.bottom && !p.left) return
    const w = work.current!.w + p.left + p.right
    const h = work.current!.h + p.top + p.bottom
    if (w * h > MAX_PIXELS || w > 4096 || h > 4096) return setError('Hasil perluasan melebihi batas (4096px / 16 juta piksel).')
    setError('')
    pushUndo()
    work.current = padPixels(work.current!, p.top, p.right, p.bottom, p.left)
    orig.current = padPixels(orig.current!, p.top, p.right, p.bottom, p.left)
    pad.current = { top: pad.current.top + p.top, right: pad.current.right + p.right, bottom: pad.current.bottom + p.bottom, left: pad.current.left + p.left }
    setSize([w, h])
    setPadIn({ ...NO_PAD })
    redraw()
  }

  async function save() {
    const w = work.current
    const pid = useEditor.getState().projectId
    if (!w || !pid) return
    setBusy(true)
    setError('')
    try {
      const c = document.createElement('canvas')
      c.width = w.w
      c.height = w.h
      c.getContext('2d')!.putImageData(new ImageData(w.data as Uint8ClampedArray<ArrayBuffer>, w.w, w.h), 0, 0)
      const blob: Blob = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Gagal membuat PNG.'))), 'image/png'))
      const base = asset!.name.replace(/\.[^.]+$/, '')
      const created = await api.uploadAsset(pid, blob, `${base}-retouch.png`)
      useEditor.getState().addAsset(created)
      const shift = padShift(pad.current.top, pad.current.right, pad.current.bottom, pad.current.left)
      useEditor.getState().edit((d) => {
        const l = d.layers.find((x) => x.id === layerId)
        if (!l) return
        l.assetId = created.id
        compensatePad(d, layerId, shift)
      })
      setDone('Retouch diterapkan ke layer (gambar asli tetap tersimpan sebagai aset).')
      setDirty(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const close = () => { if (!busy && (!dirty || confirm('Buang perubahan retouch yang belum diterapkan?'))) onClose() }
  const [w, h] = size

  return (
    <div className="modal top" onClick={close}>
      <div role="dialog" aria-modal="true" className="card dialog wide" onClick={(e) => e.stopPropagation()}>
        <h2>Retouch — {layer.name}</h2>
        <p className="muted small">
          Perbaiki bagian yang ikut terpotong atau tersembunyi: <strong>hapus</strong> piksel tetangga yang terbawa, <strong>lukis</strong> ujung bagian yang terpotong, dan <strong>perluas kanvas</strong> bila perlu ruang tambahan.
          Hasil disimpan sebagai aset baru; posisi, rig, dan keyframe layer tidak bergeser.
        </p>
        {error && <div className="error" role="alert">{error}</div>}
        {!ready && !error && <p className="muted">Memuat gambar…</p>}

        {ready && (
          <div className="imgedit">
            <div style={{ flex: '1 1 480px', minWidth: 0 }}>
              <div ref={stage} className="retouch-stage" onPointerLeave={() => setCursor(null)}>
                <canvas
                  ref={canvas}
                  style={{ width: w * zoom, height: h * zoom, cursor: tool === 'pick' ? 'crosshair' : 'none' }}
                  onPointerDown={down}
                  onPointerMove={move}
                  onPointerUp={up}
                />
                {cursor && tool !== 'pick' && (
                  <i className="brush-ring" style={{ left: cursor.x, top: cursor.y, width: radius * 2 * zoom, height: radius * 2 * zoom }} />
                )}
              </div>
              <p className="muted small">{w}×{h}px · zoom {Math.round(zoom * 100)}%</p>
            </div>

            <div className="imgedit-opts">
              <div className="row">
                {TOOLS.map((t) => (
                  <button key={t.id} className={tool === t.id ? 'primary' : ''} title={t.hint} onClick={() => setTool(t.id)}>{t.label}</button>
                ))}
              </div>
              <p className="muted small">{TOOLS.find((t) => t.id === tool)!.hint}</p>
              <label className="field"><span>Ukuran kuas: {radius}px</span><input type="range" min={1} max={150} value={radius} onChange={(e) => setRadius(+e.target.value)} /></label>
              <label className="field"><span>Kelembutan tepi: {softness}%</span><input type="range" min={0} max={100} value={softness} onChange={(e) => setSoftness(+e.target.value)} /></label>
              <label className="field"><span>Warna lukis</span><input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></label>
              <label className="field"><span>Zoom</span><input type="range" min={10} max={400} value={Math.round(zoom * 100)} onChange={(e) => setZoom(+e.target.value / 100)} /></label>

              <fieldset className="padbox">
                <legend className="small">Perluas kanvas (px)</legend>
                <div className="grid2">
                  {(['top', 'right', 'bottom', 'left'] as const).map((k) => (
                    <label key={k} className="field"><span>{{ top: 'Atas', right: 'Kanan', bottom: 'Bawah', left: 'Kiri' }[k]}</span>
                      <input type="number" min={0} max={1000} value={padIn[k]} onChange={(e) => setPadIn({ ...padIn, [k]: e.target.valueAsNumber || 0 })} />
                    </label>
                  ))}
                </div>
                <button onClick={extend}>Perluas</button>
              </fieldset>

              <div className="row">
                <button onClick={doUndo} disabled={undoCount === 0}>↶ Undo ({undoCount})</button>
                <button onClick={reset} disabled={!dirty}>Reset</button>
              </div>
              <button className="primary" disabled={busy || !dirty} onClick={() => void save()}>{busy ? 'Menyimpan…' : 'Terapkan ke layer'}</button>
              {done && <p className="small" style={{ color: 'var(--ok)' }}>{done}</p>}
            </div>
          </div>
        )}
        <div className="row end"><button onClick={close} disabled={busy}>Tutup</button></div>
      </div>
    </div>
  )
}

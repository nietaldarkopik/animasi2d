import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { despeckle, erodeAlpha, floodErase, toImageData } from '../builder/pixeledit'
import { absUrl } from '../builder/render'
import type { LibAsset, LibCategory } from '../builder/types'
import { clonePixels, stampLine, type Brush, type Pixels, type Tool } from '../retouch'

type Mode = Tool | 'wand' | 'wand_all'
type Tab = 'info' | 'image' | 'svg' | 'file'
const MAX_UNDO = 12
const CHECKER = 'repeating-conic-gradient(#3a3f4d 0 25%, #2b2f3a 0 50%) 0 0 / 16px 16px'

interface Saved { asset: LibAsset; archivedOld: boolean }

/** Edit one of the user's library assets: details, pixel clean-up (raster), SVG source, or re-upload. */
export function AssetEditDialog({ asset, cats, onClose, onSaved }: { asset: LibAsset; cats: LibCategory[]; onClose: () => void; onSaved: (s: Saved) => void }) {
  const isSvg = asset.mime === 'image/svg+xml'
  const [tab, setTab] = useState<Tab>(isSvg ? 'info' : 'image')
  const [cur, setCur] = useState(asset)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  /** Runs a save that replaces the file; the server keeps old character versions intact when the asset is in use. */
  async function replaceWith(blob: Blob, filename: string) {
    setBusy(true); setError(''); setNote('')
    try {
      const r = await api.libReplace(cur.id, blob, filename)
      setCur(r.data)
      onSaved({ asset: r.data, archivedOld: r.archived_old })
      setNote(r.archived_old
        ? 'Aset ini dipakai oleh versi karakter, jadi versi lama tetap utuh dan hasil edit disimpan sebagai aset baru (yang lama diarsipkan). Pilih ulang aset baru di builder.'
        : 'Tersimpan.')
      return r.data
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal" onClick={() => !busy && onClose()}>
      <div role="dialog" aria-modal="true" className="card dialog wide" style={{ maxWidth: 980, width: '96vw' }} onClick={(e) => e.stopPropagation()}>
        <div className="row between">
          <h2 style={{ margin: 0 }}>Edit aset — {cur.name}</h2>
          <button onClick={onClose} disabled={busy}>Tutup</button>
        </div>
        <div className="row" style={{ margin: '10px 0' }}>
          <button className={tab === 'info' ? 'primary' : ''} onClick={() => setTab('info')}>Detail</button>
          {!isSvg && <button className={tab === 'image' ? 'primary' : ''} onClick={() => setTab('image')}>Rapikan gambar</button>}
          {isSvg && <button className={tab === 'svg' ? 'primary' : ''} onClick={() => setTab('svg')}>Kode SVG</button>}
          <button className={tab === 'file' ? 'primary' : ''} onClick={() => setTab('file')}>Ganti file (unggah ulang)</button>
        </div>
        {error && <div className="error" role="alert">{error}</div>}
        {note && <p className="small" style={{ color: 'var(--ok)' }}>{note}</p>}

        {tab === 'info' && <InfoTab asset={cur} cats={cats} onSaved={(a) => { setCur(a); onSaved({ asset: a, archivedOld: false }); setNote('Tersimpan.') }} setError={setError} />}
        {tab === 'image' && !isSvg && <PixelEditor asset={cur} busy={busy} onSave={(b) => replaceWith(b, 'edit.png')} setError={setError} />}
        {tab === 'svg' && isSvg && <SvgEditor asset={cur} busy={busy} onSave={(b) => replaceWith(b, 'edit.svg')} />}
        {tab === 'file' && <ReuploadTab busy={busy} onSave={(f) => replaceWith(f, f.name)} />}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ details

function InfoTab({ asset, cats, onSaved, setError }: { asset: LibAsset; cats: LibCategory[]; onSaved: (a: LibAsset) => void; setError: (m: string) => void }) {
  const [name, setName] = useState(asset.name)
  const [tags, setTags] = useState(asset.tags.join(', '))
  const [category, setCategory] = useState(asset.category)
  const [busy, setBusy] = useState(false)
  const kind = cats.find((c) => c.slug === asset.category)?.kind
  async function save() {
    setBusy(true); setError('')
    try { onSaved(await api.libUpdate(asset.id, { name: name.trim(), tags, ...(category !== asset.category ? { category } : {}) })) } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <div style={{ maxWidth: 520 }}>
      <label className="field"><span>Nama</span><input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /></label>
      <label className="field"><span>Tag (pisahkan koma)</span><input value={tags} maxLength={200} onChange={(e) => setTags(e.target.value)} /></label>
      <label className="field"><span>Kategori</span>
        <select value={category} onChange={(e) => setCategory(e.target.value)}>{cats.filter((c) => c.kind === kind).map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}</select>
      </label>
      <button className="primary" disabled={busy || !name.trim()} onClick={() => void save()}>Simpan detail</button>
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ re-upload

function ReuploadTab({ busy, onSave }: { busy: boolean; onSave: (f: File) => Promise<unknown> }) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <div style={{ maxWidth: 520 }}>
      <p className="muted small">Pilih file SVG atau PNG/JPEG/WebP hasil rapian Anda di aplikasi lain. File ini <strong>menggantikan</strong> isi aset ini (SVG disanitasi). Karakter yang sudah disimpan sebagai versi tidak berubah.</p>
      <input ref={input} type="file" accept=".svg,image/svg+xml,image/png,image/jpeg,image/webp" />
      <div className="row" style={{ marginTop: 8 }}>
        <button className="primary" disabled={busy} onClick={() => { const f = input.current?.files?.[0]; if (f) void onSave(f) }}>{busy ? 'Mengunggah…' : 'Ganti dengan file ini'}</button>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ SVG source

function SvgEditor({ asset, busy, onSave }: { asset: LibAsset; busy: boolean; onSave: (b: Blob) => Promise<unknown> }) {
  const [src, setSrc] = useState<string | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    fetch(absUrl(asset.url)).then((r) => r.text()).then(setSrc).catch(() => setErr('Gagal memuat SVG.'))
  }, [asset.url])
  const preview = useMemo(() => (src ? 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(src) : ''), [src])
  if (src === null) return <p className="muted">{err || 'Memuat…'}</p>
  return (
    <div className="row" style={{ alignItems: 'start', gap: 16, flexWrap: 'nowrap' }}>
      <textarea value={src} onChange={(e) => setSrc(e.target.value)} spellCheck={false} aria-label="Kode SVG" style={{ flex: 1, minHeight: 420, fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12 }} />
      <div style={{ width: 280 }}>
        <div style={{ background: CHECKER, borderRadius: 6, aspectRatio: `${asset.width} / ${asset.height}`, maxHeight: 420 }}>
          <img src={preview} alt="Pratinjau SVG" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        </div>
        <p className="muted small">Atribut <code>data-tint</code> (skin, hair, top, bottom, hijab, tie, eye, shoe, accent) membuat area itu bisa diganti warnanya di builder. Elemen berbahaya (script, image, style…) akan ditolak server.</p>
        <button className="primary" disabled={busy} onClick={() => void onSave(new Blob([src], { type: 'image/svg+xml' }))}>{busy ? 'Menyimpan…' : 'Simpan SVG'}</button>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ pixel editor

function PixelEditor({ asset, busy, onSave, setError }: { asset: LibAsset; busy: boolean; onSave: (b: Blob) => Promise<unknown>; setError: (m: string) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const pix = useRef<Pixels | null>(null)
  const orig = useRef<Pixels | null>(null)
  const undo = useRef<Pixels[]>([])
  const redo = useRef<Pixels[]>([])
  const drawing = useRef<{ x: number; y: number } | null>(null)
  const [ready, setReady] = useState(false)
  const [mode, setMode] = useState<Mode>('wand')
  const [radius, setRadius] = useState(10)
  const [tol, setTol] = useState(40)
  const [color, setColor] = useState('#000000')
  const [zoom, setZoom] = useState(0.35)
  const [bg, setBg] = useState<'checker' | 'white' | 'dark'>('checker')
  const [info, setInfo] = useState('')
  const scroller = useRef<HTMLDivElement>(null)
  const pendingScroll = useRef<{ x: number; y: number } | null>(null)
  const [, bump] = useState(0)

  const paint = useCallback((r?: { x: number; y: number; w: number; h: number }) => {
    const c = canvas.current, p = pix.current
    if (!c || !p) return
    const ctx = c.getContext('2d')!
    const id = toImageData(p)
    if (r) ctx.putImageData(id, 0, 0, r.x, r.y, r.w, r.h)
    else ctx.putImageData(id, 0, 0)
  }, [])

  /** Zoom so the visible artwork fills the work area (canvas-aligned parts occupy a small part of a big canvas). */
  const fitContent = useCallback(() => {
    const p = pix.current
    if (!p) return
    let x0 = p.w, y0 = p.h, x1 = -1, y1 = -1
    for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) if (p.data[(y * p.w + x) * 4 + 3] > 20) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
    if (x1 < 0) return
    const z = Math.min(3, 520 / Math.max(x1 - x0 + 1, y1 - y0 + 1, 40))
    pendingScroll.current = { x: Math.max(0, x0 * z - 16), y: Math.max(0, y0 * z - 16) }
    setZoom(z)
  }, [])
  useEffect(() => {
    const s = pendingScroll.current
    if (s && scroller.current) { scroller.current.scrollLeft = s.x; scroller.current.scrollTop = s.y; pendingScroll.current = null }
  }, [zoom])

  useEffect(() => {
    let dead = false
    ;(async () => {
      try {
        const blob = await fetch(absUrl(asset.url)).then((r) => { if (!r.ok) throw new Error(); return r.blob() })
        const bmp = await createImageBitmap(blob)
        const c = document.createElement('canvas')
        c.width = bmp.width; c.height = bmp.height
        const ctx = c.getContext('2d')!
        ctx.drawImage(bmp, 0, 0)
        const d = ctx.getImageData(0, 0, bmp.width, bmp.height)
        if (dead) return
        pix.current = { w: d.width, h: d.height, data: d.data }
        orig.current = clonePixels(pix.current)
        const el = canvas.current!
        el.width = d.width; el.height = d.height
        setZoom(Math.min(1, 560 / Math.max(d.width, d.height)))
        setReady(true)
        requestAnimationFrame(() => { paint(); if (d.width * d.height > 250_000) fitContent() })
      } catch { if (!dead) setError('Gagal memuat gambar untuk diedit.') }
    })()
    return () => { dead = true }
  }, [asset.url, paint, setError, fitContent])

  const snapshot = () => {
    if (!pix.current) return
    undo.current.push(clonePixels(pix.current))
    if (undo.current.length > MAX_UNDO) undo.current.shift()
    redo.current = []
    bump((n) => n + 1)
  }
  const restore = (from: Pixels[], to: Pixels[]) => {
    const prev = from.pop()
    if (!prev || !pix.current) return
    to.push(clonePixels(pix.current))
    pix.current.data.set(prev.data)
    paint(); bump((n) => n + 1)
  }

  const toImg = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * pix.current!.w, y: ((e.clientY - r.top) / r.height) * pix.current!.h }
  }
  const brush = (): Brush => {
    const n = parseInt(color.slice(1), 16)
    return { tool: mode as Tool, radius, softness: 0.25, color: [(n >> 16) & 255, (n >> 8) & 255, n & 255], flow: 1 }
  }

  function down(e: React.PointerEvent) {
    if (!ready || !pix.current || !orig.current) return
    const { x, y } = toImg(e)
    if (mode === 'wand' || mode === 'wand_all') {
      snapshot()
      const n = floodErase(pix.current, x, y, tol, mode === 'wand', 1)
      setInfo(n ? `${n} piksel dihapus.` : 'Tidak ada yang dihapus (piksel itu sudah transparan).')
      if (!n) undo.current.pop()
      paint(); bump((k) => k + 1)
      return
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    snapshot()
    drawing.current = { x, y }
    stampLine(pix.current, orig.current, x, y, x, y, brush())
    paint({ x: Math.max(0, Math.floor(x - radius - 1)), y: Math.max(0, Math.floor(y - radius - 1)), w: Math.ceil(radius * 2 + 3), h: Math.ceil(radius * 2 + 3) })
  }
  function move(e: React.PointerEvent) {
    if (!drawing.current || !pix.current || !orig.current) return
    const { x, y } = toImg(e)
    const a = drawing.current
    stampLine(pix.current, orig.current, a.x, a.y, x, y, brush())
    const x0 = Math.max(0, Math.floor(Math.min(a.x, x) - radius - 1)), y0 = Math.max(0, Math.floor(Math.min(a.y, y) - radius - 1))
    paint({ x: x0, y: y0, w: Math.ceil(Math.abs(x - a.x) + radius * 2 + 3), h: Math.ceil(Math.abs(y - a.y) + radius * 2 + 3) })
    drawing.current = { x, y }
  }
  const up = () => { drawing.current = null }

  function auto(fn: (p: Pixels) => string) {
    if (!pix.current) return
    snapshot()
    setInfo(fn(pix.current))
    paint(); bump((n) => n + 1)
  }

  async function save() {
    const c = canvas.current
    if (!c) return
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'))
    if (!blob) return setError('Gagal membuat PNG.')
    await onSave(blob)
    undo.current = []; redo.current = []
    orig.current = pix.current ? clonePixels(pix.current) : null
  }

  const tools: [Mode, string, string][] = [
    ['wand', 'Tongkat ajaib', 'Klik area berwarna sama yang bersambung (mis. sisa latar) untuk dihapus'],
    ['wand_all', 'Hapus warna', 'Klik sebuah warna; semua piksel berwarna serupa di seluruh gambar dihapus'],
    ['erase', 'Penghapus', 'Seret untuk menghapus'],
    ['restore', 'Pulihkan', 'Seret untuk mengembalikan piksel asli sejak dialog dibuka'],
    ['paint', 'Kuas', 'Seret untuk melukis dengan warna terpilih'],
  ]
  const cursor = mode === 'wand' || mode === 'wand_all' ? 'crosshair' : 'cell'

  return (
    <div className="row" style={{ alignItems: 'start', gap: 16, flexWrap: 'nowrap' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="row" style={{ marginBottom: 6 }}>
          <label className="row small" style={{ gap: 4 }}>Zoom <input type="range" min={0.1} max={3} step={0.05} value={zoom} onChange={(e) => setZoom(+e.target.value)} style={{ width: 120 }} /> {Math.round(zoom * 100)}%</label>
          <button disabled={!ready} onClick={fitContent} title="Perbesar agar isi gambar memenuhi area kerja">Pas ke isi</button>
          <select value={bg} onChange={(e) => setBg(e.target.value as typeof bg)} style={{ width: 'auto' }} aria-label="Latar pratinjau">
            <option value="checker">Latar kotak-kotak</option><option value="white">Latar putih (cek serpihan)</option><option value="dark">Latar gelap</option>
          </select>
        </div>
        <div ref={scroller} style={{ overflow: 'auto', maxHeight: 520, border: '1px solid var(--border)', borderRadius: 6, background: bg === 'checker' ? CHECKER : bg === 'white' ? '#fff' : '#14161b' }}>
          <canvas ref={canvas} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} aria-label="Kanvas edit aset"
            style={{ width: pix.current ? pix.current.w * zoom : asset.width * zoom, height: pix.current ? pix.current.h * zoom : asset.height * zoom, display: 'block', cursor, touchAction: 'none' }} />
        </div>
        {!ready && <p className="muted">Memuat gambar…</p>}
      </div>

      <div style={{ width: 270 }}>
        {tools.map(([m, label, tip]) => <button key={m} title={tip} className={mode === m ? 'primary' : ''} aria-pressed={mode === m} onClick={() => setMode(m)} style={{ margin: '0 4px 4px 0' }}>{label}</button>)}
        <p className="muted small" style={{ minHeight: 34 }}>{tools.find((t) => t[0] === mode)![2]}</p>
        {(mode === 'wand' || mode === 'wand_all') && <label className="field"><span>Toleransi warna: {tol}</span><input type="range" min={0} max={120} value={tol} onChange={(e) => setTol(+e.target.value)} /></label>}
        {(mode === 'erase' || mode === 'restore' || mode === 'paint') && <label className="field"><span>Ukuran kuas: {radius}px</span><input type="range" min={2} max={80} value={radius} onChange={(e) => setRadius(+e.target.value)} /></label>}
        {mode === 'paint' && <label className="field"><span>Warna</span><input type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ height: 30 }} /></label>}

        <h4 style={{ margin: '10px 0 4px' }}>Otomatis</h4>
        <div className="row" style={{ gap: 4 }}>
          <button title="Hapus bintik/serpihan kecil yang terlepas dari bentuk utama" disabled={!ready} onClick={() => auto((p) => { const n = despeckle(p, 0.04); return n ? `${n} serpihan dihapus.` : 'Tidak ada serpihan terlepas.' })}>Hapus serpihan</button>
          <button title="Kikis tepi 1 piksel untuk membuang pinggiran pucat" disabled={!ready} onClick={() => auto((p) => { erodeAlpha(p, 1); return 'Tepi dikikis 1 piksel.' })}>Rapikan tepi</button>
        </div>
        {info && <p className="small" style={{ color: 'var(--ok)' }}>{info}</p>}

        <div className="row" style={{ marginTop: 10, gap: 4 }}>
          <button disabled={!undo.current.length} onClick={() => restore(undo.current, redo.current)}>↶ Undo</button>
          <button disabled={!redo.current.length} onClick={() => restore(redo.current, undo.current)}>↷ Redo</button>
          <button disabled={!undo.current.length} onClick={() => { if (pix.current && orig.current) { snapshot(); pix.current.data.set(orig.current.data); paint() } }}>Reset</button>
        </div>
        <button className="primary" style={{ marginTop: 12, width: '100%' }} disabled={busy || !ready} onClick={() => void save()}>{busy ? 'Menyimpan…' : 'Simpan perubahan'}</button>
        <p className="muted small">Menyimpan menggantikan isi aset ini. Jika sudah dipakai versi karakter, versi lama tetap utuh dan hasilnya jadi aset baru.</p>
      </div>
    </div>
  )
}

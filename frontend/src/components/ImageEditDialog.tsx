import { useRef, useState } from 'react'
import { api } from '../api'
import { replaceImagePatch } from '../imageedit'
import { uid, useEditor } from '../store'
import type { Asset, Geometry, ImageOp } from '../types'

type BgMode = 'none' | 'remove_bg' | 'sketch'
interface Crop { x: number; y: number; w: number; h: number }

const CHECKER = 'repeating-conic-gradient(#2b2f3a 0 25%, #20232c 0 50%) 0 0 / 16px 16px'

export function ImageEditDialog({ assetId, onClose }: { assetId: number; onClose: () => void }) {
  const s = useEditor()
  const asset = s.assets[assetId] as Asset | undefined
  const layer = s.doc?.layers.find((l) => l.id === s.selectedId)
  const layerUsesAsset = layer?.type === 'image' && layer.assetId === assetId

  const [crop, setCrop] = useState<Crop | null>(null)
  const [bg, setBg] = useState<BgMode>('none')
  const [tolerance, setTolerance] = useState(30)
  const [strength, setStrength] = useState(50)
  const [trim, setTrim] = useState(false)
  const [enhance, setEnhance] = useState(false)
  const [resizeW, setResizeW] = useState<number | ''>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ asset: Asset; geo: Geometry; notes: string[] } | null>(null)
  const [done, setDone] = useState('')
  const box = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number } | null>(null)

  if (!asset) return null

  const toImg = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect()
    const k = asset.width / r.width
    return { x: Math.max(0, Math.min(asset.width, (e.clientX - r.left) * k)), y: Math.max(0, Math.min(asset.height, (e.clientY - r.top) * k)) }
  }
  const down = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = toImg(e)
    setCrop(null)
  }
  const move = (e: React.PointerEvent) => {
    if (!drag.current) return
    const p = toImg(e)
    const a = drag.current
    setCrop({ x: Math.min(a.x, p.x), y: Math.min(a.y, p.y), w: Math.abs(p.x - a.x), h: Math.abs(p.y - a.y) })
  }
  const up = () => {
    drag.current = null
    setCrop((c) => (c && c.w >= 4 && c.h >= 4 ? c : null))
  }

  function buildOps(): ImageOp[] {
    const ops: ImageOp[] = []
    if (crop) ops.push({ op: 'crop', x: Math.round(crop.x), y: Math.round(crop.y), w: Math.max(1, Math.round(crop.w)), h: Math.max(1, Math.round(crop.h)) })
    if (enhance) ops.push({ op: 'enhance' })
    if (bg === 'remove_bg') ops.push({ op: 'remove_bg', tolerance })
    if (bg === 'sketch') ops.push({ op: 'sketch', strength })
    if (trim) ops.push({ op: 'trim' })
    if (resizeW !== '' && resizeW >= 8) ops.push({ op: 'resize', width: Math.round(resizeW) })
    return ops
  }
  const ops = buildOps()

  async function run() {
    setBusy(true)
    setError('')
    setResult(null)
    setDone('')
    try {
      const r = await api.processAsset(assetId, ops)
      useEditor.getState().addAsset(r.data)
      setResult({ asset: r.data, geo: r.geometry, notes: r.notes })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function replaceOnLayer() {
    if (!result || !layer || layer.type !== 'image') return
    const { patch, compensated } = replaceImagePatch(layer, result.asset.id, result.geo, result.asset.width, result.asset.height)
    s.edit((d) => Object.assign(d.layers.find((l) => l.id === layer.id)!, patch))
    setDone(compensated ? 'Gambar layer diganti; posisi dan ukuran tampilan dipertahankan.' : 'Gambar layer diganti. Layer memiliki keyframe/pivot, jadi posisi & skala tidak dikompensasi — periksa hasilnya.')
  }

  function addAsLayer() {
    if (!result || !s.doc) return
    const a = result.asset
    const { width: W, height: H } = s.doc.settings
    const k = Math.min(1, (W * 0.6) / a.width, (H * 0.6) / a.height)
    s.addLayer({ id: uid(), type: 'image', name: a.name, assetId: a.id, x: W / 2, y: H / 2, scaleX: k, scaleY: k, rotation: 0, opacity: 1, visible: true, locked: false })
    setDone('Ditambahkan sebagai layer baru.')
  }

  const dispW = 420
  const disp = dispW / asset.width

  return (
    <div className="modal" onClick={() => !busy && onClose()}>
      <div role="dialog" aria-modal="true" className="card dialog wide" onClick={(e) => e.stopPropagation()}>
        <h2>Edit gambar — {asset.name}</h2>
        <p className="muted small">Hasil disimpan sebagai aset baru; gambar asli tidak berubah. Seret pada pratinjau untuk memilih area crop.</p>
        <div className="imgedit">
          <div>
            <div
              ref={box}
              className="crop-box"
              style={{ width: dispW, height: asset.height * disp, background: CHECKER }}
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={up}
            >
              <img src={asset.url} alt="" draggable={false} />
              {crop && <div className="crop-rect" style={{ left: crop.x * disp, top: crop.y * disp, width: crop.w * disp, height: crop.h * disp }} />}
            </div>
            <p className="muted small">
              {asset.width}×{asset.height}px{crop ? ` — crop ${Math.round(crop.w)}×${Math.round(crop.h)}` : ''}
              {crop && <button className="link" onClick={() => setCrop(null)}>reset crop</button>}
            </p>
          </div>

          <div className="imgedit-opts">
            <label className="field">
              <span>Latar belakang</span>
              <select value={bg} disabled={busy} onChange={(e) => setBg(e.target.value as BgMode)}>
                <option value="none">Biarkan</option>
                <option value="remove_bg">Hapus latar polos (dari tepi)</option>
                <option value="sketch">Sketsa kertas/foto → garis transparan</option>
              </select>
            </label>
            {bg === 'remove_bg' && (
              <label className="field"><span>Toleransi warna: {tolerance}</span><input type="range" min={0} max={100} value={tolerance} disabled={busy} onChange={(e) => setTolerance(+e.target.value)} /></label>
            )}
            {bg === 'sketch' && (
              <label className="field"><span>Kekuatan garis: {strength}</span><input type="range" min={0} max={100} value={strength} disabled={busy} onChange={(e) => setStrength(+e.target.value)} /></label>
            )}
            <label className="inline"><input type="checkbox" checked={enhance} disabled={busy} onChange={(e) => setEnhance(e.target.checked)} /> Perjelas (auto-kontras + tajamkan)</label>
            <label className="inline"><input type="checkbox" checked={trim} disabled={busy} onChange={(e) => setTrim(e.target.checked)} /> Pangkas tepi transparan</label>
            <label className="field">
              <span>Lebar hasil (px, kosong = tetap)</span>
              <input type="number" min={8} max={4096} value={resizeW} disabled={busy} onChange={(e) => setResizeW(e.target.value === '' ? '' : e.target.valueAsNumber)} />
            </label>
            {bg !== 'none' && <p className="muted small">Hapus latar/sketsa memproses maksimal 2400px sisi terpanjang. Latar yang tidak menyentuh tepi (mis. lubang di dalam objek) tidak dihapus.</p>}
            <button className="primary" disabled={busy || ops.length === 0} onClick={() => void run()}>{busy ? 'Memproses…' : 'Proses'}</button>
          </div>
        </div>

        {error && <div className="error" role="alert">{error}</div>}
        {result && (
          <div className="imgedit-result">
            <div className="crop-box small-prev" style={{ background: CHECKER }}><img src={result.asset.url} alt="hasil" /></div>
            <div>
              <p className="small">Hasil: {result.asset.width}×{result.asset.height}px</p>
              {result.notes.map((n, i) => <p key={i} className="muted small">{n}</p>)}
              <div className="row">
                <button className="primary" disabled={!layerUsesAsset && !(layer?.type === 'image')} onClick={replaceOnLayer} title={layer?.type === 'image' ? '' : 'Pilih layer gambar terlebih dulu'}>Ganti gambar layer terpilih</button>
                <button onClick={addAsLayer}>Tambah sebagai layer baru</button>
              </div>
              {done && <p className="small" style={{ color: 'var(--ok)' }}>{done}</p>}
            </div>
          </div>
        )}
        <div className="row end"><button onClick={onClose} disabled={busy}>Tutup</button></div>
      </div>
    </div>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { IMG_DEFAULTS, IMG_DETAILS, imageToSvg, shrinkSteps, type ImgDetail, type ImgMode, type ImgToSvgResult } from '../builder/imageToSvg'
import type { LibCategory } from '../builder/types'

const LIBRARY_MAX_BYTES = 300_000
const CHECKER = 'repeating-conic-gradient(#d9dde3 0 25%, #eef0f3 0 50%) 0 0 / 16px 16px'
const kb = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
const stem = (n: string) => n.replace(/\.[^.]+$/, '') || 'gambar'

export interface LibrarySink {
  categories: LibCategory[]
  save: (svg: Blob, category: string, name: string, tags: string) => Promise<void>
}

/** JPG / PNG / WebP -> SVG: tracing with colour or black-and-white (line-art) mode, optional plain-background removal. */
export function ImageToSvgDialog({ name, file, url, library, onClose }: { name: string; file?: Blob; url?: string; library?: LibrarySink; onClose: () => void }) {
  const [mode, setMode] = useState<ImgMode>('color')
  const [detail, setDetail] = useState<ImgDetail>('medium')
  const [removeBg, setRemoveBg] = useState(true)
  const [tol, setTol] = useState(IMG_DEFAULTS.bgTolerance)
  const [threshold, setThreshold] = useState(IMG_DEFAULTS.threshold)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [res, setRes] = useState<(ImgToSvgResult & { url: string }) | null>(null)
  const [srcUrl, setSrcUrl] = useState('')
  const [dim, setDim] = useState('')
  const img = useRef<HTMLImageElement | null>(null)
  const resUrl = useRef<string | null>(null)
  const [cat, setCat] = useState(library?.categories.find((c) => c.slug === 'accessory')?.slug ?? library?.categories[0]?.slug ?? '')
  const [libName, setLibName] = useState(stem(name))
  const [tags, setTags] = useState('')

  const saveCats = useMemo(() => library?.categories.filter((c) => c.kind !== 'reference') ?? [], [library])

  useEffect(() => {
    let revoke: string | null = null
    let dead = false
    ;(async () => {
      // a picture from the server may live on another origin (a canvas would be "tainted" and unreadable): fetch it as a blob first
      let blob: Blob | undefined = file
      if (!blob && url) {
        const r = await fetch(url)
        if (!r.ok) throw new Error('Gambar tidak bisa diambil dari server.')
        blob = await r.blob()
      }
      if (!blob || dead) return
      const src = (revoke = URL.createObjectURL(blob))
      setSrcUrl(src)
      const im = new Image()
      im.onload = () => { img.current = im; setDim(`${im.naturalWidth}×${im.naturalHeight} px`) }
      im.onerror = () => setError('Gambar tidak bisa dibaca.')
      im.src = src
    })().catch((e) => setError((e as Error).message))
    return () => { dead = true; if (revoke) URL.revokeObjectURL(revoke); if (resUrl.current) URL.revokeObjectURL(resUrl.current) }
  }, [file, url])

  async function build() {
    if (!img.current) return setError('Gambar belum selesai dimuat.')
    setBusy(true); setError(''); setNote('')
    try {
      const d = IMG_DETAILS[detail]
      const out = await imageToSvg(img.current, { mode, colors: d.colors, maxSide: d.maxSide, pathomit: d.pathomit, removeBg, bgTolerance: tol, threshold })
      if (out.paths === 0) throw new Error(mode === 'lineart' ? 'Tidak ada garis yang terdeteksi: naikkan ambang gelap.' : 'Tidak ada bentuk yang terdeteksi.')
      if (resUrl.current) URL.revokeObjectURL(resUrl.current)
      resUrl.current = URL.createObjectURL(new Blob([out.svg], { type: 'image/svg+xml' }))
      setRes({ ...out, url: resUrl.current })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  /** library limit: try smaller and smaller settings until the SVG fits */
  async function shrink() {
    if (!img.current) return
    setBusy(true); setError(''); setNote('')
    try {
      let last: ImgToSvgResult | null = null
      for (const step of shrinkSteps(mode)) {
        last = await imageToSvg(img.current, { mode, ...step, removeBg, bgTolerance: tol, threshold })
        if (last.bytes <= LIBRARY_MAX_BYTES) break
      }
      if (!last) return
      if (resUrl.current) URL.revokeObjectURL(resUrl.current)
      resUrl.current = URL.createObjectURL(new Blob([last.svg], { type: 'image/svg+xml' }))
      setRes({ ...last, url: resUrl.current })
      if (last.bytes > LIBRARY_MAX_BYTES) setError('Gambar ini terlalu rumit untuk Library bahkan pada detail terendah. Kecilkan/sederhanakan gambarnya, pakai mode garis, atau unduh saja filenya.')
      else setNote(`Diperkecil menjadi ${kb(last.bytes)} agar muat di Library (detail lebih rendah).`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const download = () => {
    if (!res) return
    const a = document.createElement('a')
    a.href = res.url
    a.download = `${stem(name)}.svg`
    a.click()
  }

  async function toLibrary() {
    if (!res || !library) return
    setBusy(true); setError(''); setNote('')
    try {
      await library.save(new Blob([res.svg], { type: 'image/svg+xml' }), cat, libName.trim() || stem(name), tags)
      setNote('Disimpan ke Library sebagai aset SVG.')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const tooBig = !!res && res.bytes > LIBRARY_MAX_BYTES
  const inline = { display: 'flex', gap: 6, alignItems: 'center' } as const
  const raw = { width: 'auto', flex: 'none' } as const
  return (
    <div className="modal" onClick={() => !busy && onClose()}>
      <div role="dialog" aria-modal="true" className="card dialog wide" style={{ maxHeight: '90vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <h2>Gambar → SVG (vektor)</h2>
        <p className="muted small" style={{ marginTop: 0 }}>Mengubah JPG / PNG / WebP menjadi bentuk vektor dengan <strong>pelacakan</strong>. Hasilnya <em>mendekati</em> gambar asli (foto dan gradasi halus menjadi pita warna rata); paling bagus untuk kartun, logo, dan sketsa. {dim && <>Gambar: {dim}.</>}</p>

        <div className="row" style={{ gap: 6, margin: '6px 0' }}>
          <button className={mode === 'color' ? 'primary' : ''} onClick={() => setMode('color')} disabled={busy}>Berwarna</button>
          <button className={mode === 'lineart' ? 'primary' : ''} onClick={() => setMode('lineart')} disabled={busy} title="Sketsa / coretan / logo satu warna: hanya garis hitam di latar transparan">Garis hitam (sketsa)</button>
        </div>

        <div className="grid2">
          <label className="field"><span>Detail</span>
            <select value={detail} onChange={(e) => setDetail(e.target.value as ImgDetail)} disabled={busy}>
              {(Object.keys(IMG_DETAILS) as ImgDetail[]).map((k) => <option key={k} value={k}>{mode === 'lineart' ? IMG_DETAILS[k].label.replace(/\(.*warna[^)]*\)/, `(${IMG_DETAILS[k].maxSide}px)`) : IMG_DETAILS[k].label}</option>)}
            </select>
          </label>
          {mode === 'lineart' && (
            <label className="field"><span>Ambang gelap: {threshold}</span>
              <input type="range" min={40} max={220} value={threshold} onChange={(e) => setThreshold(+e.target.value)} disabled={busy} />
            </label>
          )}
        </div>
        <label className="inline" style={inline}><input type="checkbox" style={raw} checked={removeBg} onChange={(e) => setRemoveBg(e.target.checked)} disabled={busy} /> Hapus latar polos (dari keempat sudut; JPG tidak punya transparansi)</label>
        {removeBg && <label className="field"><span>Toleransi latar: {tol}</span><input type="range" min={5} max={90} value={tol} onChange={(e) => setTol(+e.target.value)} disabled={busy} /></label>}

        {error && <div className="error" role="alert">{error}</div>}
        {note && <p className="small" style={{ color: 'var(--ok)' }}>{note}</p>}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, margin: '10px 0' }}>
          <figure style={{ margin: 0 }}>
            <figcaption className="small muted">Asli</figcaption>
            <div style={{ background: CHECKER, borderRadius: 8, padding: 6, minHeight: 120 }}>{srcUrl && <img src={srcUrl} alt="Gambar asli" style={{ width: '100%', maxHeight: 360, objectFit: 'contain', display: 'block' }} />}</div>
          </figure>
          <figure style={{ margin: 0 }}>
            <figcaption className="small muted">Hasil SVG{res ? ` · ${res.width}×${res.height} · ${kb(res.bytes)} · ${res.paths.toLocaleString('id-ID')} bentuk` : ''}</figcaption>
            <div style={{ background: CHECKER, borderRadius: 8, padding: 6, minHeight: 120 }}>{res ? <img src={res.url} alt="Hasil SVG" data-testid="svg-result" style={{ width: '100%', maxHeight: 360, objectFit: 'contain', display: 'block' }} /> : <p className="muted small" style={{ margin: 8 }}>{busy ? 'Melacak…' : 'Klik “Buat SVG”.'}</p>}</div>
          </figure>
        </div>

        {res && library && (
          <fieldset style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
            <legend className="small">Simpan ke Library aset</legend>
            <div className="grid2">
              <label className="field"><span>Kategori</span><select value={cat} onChange={(e) => setCat(e.target.value)}>{saveCats.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}</select></label>
              <label className="field"><span>Nama</span><input value={libName} maxLength={120} onChange={(e) => setLibName(e.target.value)} /></label>
            </div>
            <label className="field"><span>Tag (pisahkan koma)</span><input value={tags} maxLength={200} onChange={(e) => setTags(e.target.value)} /></label>
            {tooBig && <p className="small" style={{ color: 'var(--warn)', margin: '4px 0' }}>Library menerima SVG maksimal 300 KB, hasil ini {kb(res.bytes)}.</p>}
            <div className="row" style={{ gap: 6 }}>
              <button className="primary" disabled={busy || tooBig || !cat} onClick={() => void toLibrary()}>Simpan ke Library</button>
              {tooBig && <button disabled={busy} onClick={() => void shrink()} title="Mencoba detail yang makin rendah sampai ukurannya muat">Perkecil agar muat Library</button>}
            </div>
          </fieldset>
        )}

        <div className="row end" style={{ marginTop: 10, gap: 6 }}>
          <button onClick={onClose} disabled={busy}>Tutup</button>
          {res && <button onClick={download}>Unduh .svg</button>}
          <button className="primary" disabled={busy || !srcUrl} onClick={() => void build()}>{busy ? 'Memproses…' : res ? 'Buat ulang' : 'Buat SVG'}</button>
        </div>
      </div>
    </div>
  )
}

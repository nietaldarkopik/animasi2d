import { useEffect, useMemo, useRef, useState } from 'react'
import { composeSvg } from '../builder/svgExport'
import { DETAILS, preparePartVectors, type Detail } from '../builder/vectorize'
import type { CharacterConfig, LibAsset } from '../builder/types'
import { makeZip } from '../zip'

interface Result { svg: string; url: string; bytes: number; width: number; height: number; layers: number; paths: number; embeds: number; zip: Blob | null }

const fileName = (s: string) => (s || 'karakter').replace(/[^A-Za-z0-9._ -]+/g, '_').trim() || 'karakter'
function save(blob: Blob, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}
const kb = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

/** Character -> layered SVG (vector). SVG parts stay vector; PNG parts are traced into paths or embedded. */
export function SvgExportDialog({ config, assets, zOf, labels, name, onClose }: { config: CharacterConfig; assets: Record<number, LibAsset>; zOf: (slot: string) => number; labels: Record<string, string>; name: string; onClose: () => void }) {
  const [mode, setMode] = useState<'trace' | 'embed'>('trace')
  const [detail, setDetail] = useState<Detail>('medium')
  const [bg, setBg] = useState<'transparent' | 'white'>('transparent')
  const [perPart, setPerPart] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [res, setRes] = useState<Result | null>(null)
  const cancelled = useRef(false)
  const urlRef = useRef<string | null>(null)
  useEffect(() => () => { cancelled.current = true; if (urlRef.current) URL.revokeObjectURL(urlRef.current) }, [])

  const slots = Object.keys(config.parts)
  const raster = useMemo(() => slots.filter((s) => assets[config.parts[s].assetId] && assets[config.parts[s].assetId].mime !== 'image/svg+xml'), [config, assets]) // eslint-disable-line react-hooks/exhaustive-deps
  const allVector = raster.length === 0

  async function build() {
    setBusy(true); setError(''); setRes(null); cancelled.current = false
    try {
      const parts = await preparePartVectors({
        config, assets, mode, detail, isCancelled: () => cancelled.current,
        onProgress: (done, total, label) => setProgress(label ? `Bagian ${done + 1}/${total}: ${labels[label] ?? label}${raster.includes(label) && mode === 'trace' ? ' (melacak gambar…)' : ''}` : 'Menyusun file…'),
      })
      const opts = { config, assets, zOf, parts, labels, title: name || 'Karakter', background: bg === 'white' ? '#ffffff' : null }
      const out = composeSvg(opts)
      let zip: Blob | null = null
      if (perPart) {
        const enc = new TextEncoder()
        const files = [{ name: `${fileName(name)}.svg`, data: enc.encode(out.svg) }]
        for (const s of slots) if (parts[s]) files.push({ name: `bagian/${s}.svg`, data: enc.encode(composeSvg({ ...opts, only: [s], background: null, title: `${name} - ${labels[s] ?? s}` }).svg) })
        zip = makeZip(files)
      }
      const blob = new Blob([out.svg], { type: 'image/svg+xml' })
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
      urlRef.current = URL.createObjectURL(blob)
      setRes({ ...out, url: urlRef.current, bytes: blob.size, zip })
    } catch (e) {
      if (!cancelled.current) setError((e as Error).message)
    } finally {
      setBusy(false); setProgress('')
    }
  }

  const base = `${fileName(name)}-${config.view}`
  return (
    <div className="modal" onClick={() => !busy && onClose()}>
      <div role="dialog" aria-modal="true" className="card dialog wide" style={{ maxHeight: '90vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <h2>Ekspor vektor (SVG)</h2>
        <p className="muted small" style={{ marginTop: 0 }}>Menghasilkan satu file SVG berlapis: tiap bagian karakter (rambut, baju, mata…) jadi layer bernama dengan urutan yang sama, jadi bisa diedit di Inkscape, Illustrator, Figma, atau CorelDRAW (di sana juga bisa disimpan sebagai PDF/EPS/AI).</p>

        {allVector ? (
          <p className="small" style={{ color: 'var(--ok)' }}>Semua bagian karakter ini adalah gambar vektor asli, jadi hasilnya vektor murni tanpa pelacakan.</p>
        ) : (
          <fieldset style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, margin: '8px 0' }}>
            <legend className="small">{raster.length} dari {slots.length} bagian berupa gambar PNG</legend>
            <label className="inline" style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginBottom: 6 }}>
              <input type="radio" style={{ width: 'auto', flex: 'none', marginTop: 3 }} name="mode" checked={mode === 'trace'} onChange={() => setMode('trace')} disabled={busy} />
              <span><strong>Vektor penuh</strong> — gambar PNG dilacak menjadi bentuk (path) berwarna. Bisa diperbesar tanpa pecah, tetapi hasilnya <em>aproksimasi</em>: gradasi halus menjadi pita warna rata dan garis sangat tipis bisa berubah.</span>
            </label>
            <label className="inline" style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
              <input type="radio" style={{ width: 'auto', flex: 'none', marginTop: 3 }} name="mode" checked={mode === 'embed'} onChange={() => setMode('embed')} disabled={busy} />
              <span><strong>Sematkan PNG</strong> — persis seperti aslinya dan cepat, tetapi bagian PNG <em>bukan vektor</em> (tetap pecah bila diperbesar). File lebih besar.</span>
            </label>
            {mode === 'trace' && (
              <label className="field" style={{ marginTop: 8 }}><span>Detail pelacakan</span>
                <select value={detail} onChange={(e) => setDetail(e.target.value as Detail)} disabled={busy}>
                  {(Object.keys(DETAILS) as Detail[]).map((d) => <option key={d} value={d}>{DETAILS[d].label}</option>)}
                </select>
              </label>
            )}
          </fieldset>
        )}

        <div className="row" style={{ gap: 16, flexWrap: 'wrap', margin: '6px 0' }}>
          <label className="inline" style={{ display: 'flex', gap: 6, alignItems: 'center' }}><span>Latar</span>
            <select value={bg} onChange={(e) => setBg(e.target.value as typeof bg)} disabled={busy} style={{ width: 'auto' }}><option value="transparent">Transparan</option><option value="white">Putih</option></select>
          </label>
          <label className="inline" style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto', flex: 'none' }} checked={perPart} onChange={(e) => setPerPart(e.target.checked)} disabled={busy} /> Simpan juga tiap bagian sebagai file terpisah (ZIP)</label>
        </div>
        <p className="muted small" style={{ margin: '0 0 6px' }}>Tampilan: {config.view === 'full' ? 'seluruh badan' : 'setengah badan'} · warna mengikuti palet dan pewarnaan bagian yang sedang aktif.</p>

        {progress && <p className="small" role="status">{progress}</p>}
        {error && <div className="error" role="alert">{error}</div>}

        {res && (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 220px) 1fr', gap: 12, alignItems: 'start', margin: '10px 0' }}>
            <div style={{ background: 'repeating-conic-gradient(#d9dde3 0 25%, #eef0f3 0 50%) 0 0 / 16px 16px', borderRadius: 8, padding: 6 }}>
              <img src={res.url} alt="Pratinjau SVG" style={{ width: '100%', display: 'block' }} data-testid="svg-preview" />
            </div>
            <div className="small" style={{ display: 'grid', gap: 4 }}>
              <div><strong>{res.width}×{res.height} px</strong> · {kb(res.bytes)}</div>
              <div>{res.layers} layer · {res.paths.toLocaleString('id-ID')} bentuk vektor{res.embeds ? ` · ${res.embeds} gambar PNG tersemat (bukan vektor)` : ''}</div>
              <div className="row" style={{ gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                <button className="primary" onClick={() => save(new Blob([res.svg], { type: 'image/svg+xml' }), `${base}.svg`)}>Unduh .svg</button>
                {res.zip && <button onClick={() => save(res.zip!, `${base}-bagian.zip`)}>Unduh ZIP (satu file + tiap bagian)</button>}
              </div>
            </div>
          </div>
        )}

        <div className="row end" style={{ marginTop: 10 }}>
          {busy ? <button onClick={() => { cancelled.current = true }}>Batalkan</button> : <button onClick={onClose}>Tutup</button>}
          <button className="primary" disabled={busy || slots.length === 0} onClick={() => void build()}>{busy ? 'Memproses…' : res ? 'Buat ulang' : 'Buat SVG'}</button>
        </div>
      </div>
    </div>
  )
}

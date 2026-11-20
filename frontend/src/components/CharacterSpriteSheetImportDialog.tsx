import { useEffect, useState } from 'react'
import { api, type CharacterSpritePackInfo } from '../api'
import type { Facing } from '../builder/types'

interface Props {
  characterId: number
  resource?: 'builder' | 'card'
  version: number | null
  onClose: () => void
  onImported: (pack: CharacterSpritePackInfo) => void
}

const FRAME = 1024

export function CharacterSpriteSheetImportDialog({ characterId, resource = 'builder', version, onClose, onImported }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [manifestFile, setManifestFile] = useState<File | null>(null)
  const [manifestText, setManifestText] = useState('')
  const [columns, setColumns] = useState(4)
  const [rows, setRows] = useState(4)
  const [fps, setFps] = useState(12)
  const [animationName, setAnimationName] = useState('idle')
  const [facing, setFacing] = useState<Facing>('front')
  const [outfitType, setOutfitType] = useState<'base' | 'outfit_variant'>('base')
  const [outfitId, setOutfitId] = useState('base')
  const [outfitName, setOutfitName] = useState('Pakaian dasar')
  const [previewUrl, setPreviewUrl] = useState('')
  const [loop, setLoop] = useState(true)
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null)
  const [previewFrame, setPreviewFrame] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')

  useEffect(() => {
    if (!file) { setPreviewUrl(''); return }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  useEffect(() => {
    if (!previewUrl) { setDimensions(null); return }
    const image = new Image()
    image.onload = () => {
      setDimensions({ width: image.naturalWidth, height: image.naturalHeight })
      setPreviewFrame(0)
      if (image.naturalWidth % FRAME === 0 && image.naturalHeight % FRAME === 0) {
        setColumns(image.naturalWidth / FRAME)
        setRows(image.naturalHeight / FRAME)
      }
    }
    image.onerror = () => setError('Gambar sprite sheet tidak dapat dibaca.')
    image.src = previewUrl
  }, [previewUrl])

  useEffect(() => {
    let cancelled = false
    if (!manifestFile) { setManifestText(''); return }
    manifestFile.text().then((value) => { if (!cancelled) setManifestText(value) }).catch(() => { if (!cancelled) setError('Manifest JSON tidak dapat dibaca.') })
    return () => { cancelled = true }
  }, [manifestFile])

  async function submit() {
    if (!file) return setError('Pilih file PNG sprite sheet terlebih dahulu.')
    if (!dimensions || dimensions.width !== columns * FRAME || dimensions.height !== rows * FRAME) {
      return setError('Ukuran gambar harus tepat sama dengan grid × 1024 px.')
    }
    setBusy(true); setError(''); setNote('')
    try {
      const pack = await api.builderImportSpritePack(characterId, {
        file, name: file.name.replace(/\.png$/i, ''), characterVersion: version,
        columns, rows, fps, facing, animationName, loop, outfitType, outfitId: outfitType === 'base' ? 'base' : outfitId, outfitName, manifest: manifestText || undefined,
      }, resource)
      setNote(pack.duplicate ? 'Sprite sheet ini sudah pernah diimpor. Data lama digunakan.' : 'Sprite sheet berhasil diimpor dan disimpan sebagai draft untuk pemeriksaan.')
      onImported(pack)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const validGrid = !!dimensions && dimensions.width === columns * FRAME && dimensions.height === rows * FRAME
  return (
    <div role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.72)', display: 'grid', placeItems: 'center', padding: 20 }}>
      <section role="dialog" aria-modal="true" aria-labelledby="sprite-import-title" style={{ width: 'min(760px, 96vw)', maxHeight: '92vh', overflow: 'auto', background: 'var(--panel)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, display: 'grid', gap: 14 }}>
        <header className="row between">
          <div>
            <h2 id="sprite-import-title" style={{ margin: 0 }}>Import Character Sprite Sheet</h2>
            <p className="muted small" style={{ margin: '4px 0 0' }}>Frame 1024 × 1024 px · PNG transparan · grid tanpa gutter</p>
          </div>
          <button onClick={onClose} aria-label="Tutup">×</button>
        </header>

        <label style={{ display: 'grid', gap: 6 }}>
          <strong>Sprite sheet PNG</strong>
          <input type="file" accept="image/png,.png" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError('') }} />
        </label>

        {dimensions && (
          <div className="row" style={{ gap: 12, alignItems: 'center' }}>
            <div style={{ width: 150, height: 150, flex: '0 0 150px', backgroundColor: '#777', backgroundImage: previewUrl ? `url("${previewUrl}")` : undefined, backgroundSize: `${columns * 100}% ${rows * 100}%`, backgroundPosition: `${columns > 1 ? (previewFrame % columns) / (columns - 1) * 100 : 0}% ${rows > 1 ? Math.floor(previewFrame / columns) / (rows - 1) * 100 : 0}%`, backgroundRepeat: 'no-repeat', border: '1px solid var(--border)' }} />
            <div className="small" style={{ flex: 1 }}>
              <div>Ukuran gambar: <strong>{dimensions.width} × {dimensions.height} px</strong></div>
              <div>Frame terdeteksi: <strong>{dimensions.width / FRAME} × {dimensions.height / FRAME}</strong></div>
              <div>Preview cell: <strong>{previewFrame + 1} / {columns * rows}</strong></div>
              <input aria-label="Pilih frame preview" type="range" min={0} max={Math.max(0, columns * rows - 1)} value={Math.min(previewFrame, Math.max(0, columns * rows - 1))} onChange={(e) => setPreviewFrame(Number(e.target.value))} />
              <div>{validGrid ? <span style={{ color: 'var(--success)' }}>Grid valid</span> : <span style={{ color: 'var(--danger)' }}>Grid belum cocok dengan 1024 px</span>}</div>
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 10 }}>
          <label>Kolom<input type="number" min={1} max={16} value={columns} onChange={(e) => setColumns(Number(e.target.value))} /></label>
          <label>Baris<input type="number" min={1} max={16} value={rows} onChange={(e) => setRows(Number(e.target.value))} /></label>
          <label>Nama animasi (mode tanpa manifest)<input value={animationName} maxLength={40} onChange={(e) => setAnimationName(e.target.value)} /></label>
          <label>FPS<input type="number" min={1} max={60} value={fps} onChange={(e) => setFps(Number(e.target.value))} /></label>
          <label>Arah karakter<select value={facing} onChange={(e) => setFacing(e.target.value as Facing)}><option value="front">Depan</option><option value="right">Kanan</option><option value="left">Kiri</option><option value="back">Belakang</option></select></label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}><input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} /> Loop animasi</label>
          <label>Jenis paket<select value={outfitType} onChange={(e) => { setOutfitType(e.target.value as 'base' | 'outfit_variant'); if (e.target.value === 'base') { setOutfitId('base'); setOutfitName('Pakaian dasar') } else { setOutfitId('hoodie'); setOutfitName('Hoodie') } }}><option value="base">Karakter dasar</option><option value="outfit_variant">Variasi pakaian karakter</option></select></label>
          {outfitType === 'outfit_variant' && <>
            <label>Outfit ID<input value={outfitId} maxLength={64} onChange={(e) => setOutfitId(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '-'))} /></label>
            <label>Nama pakaian<input value={outfitName} maxLength={120} onChange={(e) => setOutfitName(e.target.value)} /></label>
          </>}
        </div>

        <label style={{ display: 'grid', gap: 6 }}>
          <strong>Manifest JSON (opsional)</strong>
          <input type="file" accept="application/json,.json" onChange={(e) => setManifestFile(e.target.files?.[0] ?? null)} />
          <span className="muted small">Gunakan manifest animasi untuk mendefinisikan beberapa animasi dan urutan frame. Tanpa manifest, seluruh grid dianggap satu animasi berurutan.</span>
          {manifestFile && <span className="small">{manifestFile.name} · {manifestText.length.toLocaleString()} karakter</span>}
        </label>

        {error && <p role="alert" style={{ color: 'var(--danger)', margin: 0 }}>{error}</p>}
        {note && <p role="status" style={{ color: 'var(--success)', margin: 0 }}>{note}</p>}
        <footer className="row between">
          <span className="muted small">{outfitType === 'base' ? 'Paket karakter dasar.' : 'Variasi harus memiliki facing, animation ID, urutan frame, dan pivot yang sama dengan paket dasar.'} Disimpan sebagai draft QC.</span>
          <div className="row">
            <button onClick={onClose} disabled={busy}>Batal</button>
            <button className="primary" onClick={() => void submit()} disabled={busy || !file || !validGrid || (outfitType === 'outfit_variant' && !outfitId.trim())}>{busy ? 'Mengimpor…' : 'Import Sprite Sheet'}</button>
          </div>
        </footer>
      </section>
    </div>
  )
}

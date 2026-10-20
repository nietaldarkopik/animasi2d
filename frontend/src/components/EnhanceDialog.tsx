import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { uid, useEditor } from '../store'
import type { Asset, EnhanceModeId, EnhanceModeInfo, EnhanceOptions } from '../types'

const CHECKER = 'repeating-conic-gradient(#2b2f3a 0 25%, #20232c 0 50%) 0 0 / 16px 16px'
type Version = Asset & { notes?: string[] }

/** Enhancement Studio: pick a mode, run it, compare before/after, keep every version (the original is never touched). */
export function EnhanceDialog({ assetId, onClose }: { assetId: number; onClose: () => void }) {
  const s = useEditor()
  const source = s.assets[assetId] as Asset | undefined
  const layer = s.doc?.layers.find((l) => l.id === s.selectedId)

  const [modes, setModes] = useState<EnhanceModeInfo[]>([])
  const [provider, setProvider] = useState<{ configured: boolean; model: string | null; daily_limit: number } | null>(null)
  const [mode, setMode] = useState<EnhanceModeId>('preserve')
  const [deskew, setDeskew] = useState(true)
  const [strength, setStrength] = useState(50)
  const [upscale, setUpscale] = useState(1)
  const [removeBg, setRemoveBg] = useState(false)
  const [consent, setConsent] = useState(false)
  const [picking, setPicking] = useState(false)
  const [corners, setCorners] = useState<[number, number][]>([])
  const [versions, setVersions] = useState<Version[]>([])
  const [shown, setShown] = useState<Version | null>(null)
  const [notes, setNotes] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const [split, setSplit] = useState(50)
  const alive = useRef(true)

  const loadVersions = async (select?: number) => {
    const v = await api.assetVersions(assetId)
    if (!alive.current) return
    setVersions(v)
    const pick = v.find((x) => x.id === select) ?? null
    if (pick) setShown(pick)
  }

  useEffect(() => {
    alive.current = true
    api.enhanceModes().then((r) => { if (alive.current) { setModes(r.modes); setProvider(r.provider) } }).catch((e) => setError((e as Error).message))
    void loadVersions().catch((e) => setError((e as Error).message))
    return () => { alive.current = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId])

  if (!source) return null
  const info = modes.find((m) => m.id === mode)
  const original = versions.find((v) => !v.parent_id) ?? source
  const isAi = info?.engine === 'ai'
  const isLocalAi = info?.engine === 'local-ai'

  async function run() {
    setBusy(true)
    setError('')
    setDone('')
    setNotes([])
    try {
      const options: EnhanceOptions = { ...(corners.length === 4 && !isAi ? { perspective: corners } : {}), deskew, strength, upscale, remove_bg: removeBg && mode === 'preserve' }
      const r = await api.enhanceAsset(assetId, mode, options, consent)
      let result: Asset
      if (r.data.job) {
        // provider-backed modes run in the queue: poll the job
        const jobId = r.data.job.id
        for (;;) {
          await new Promise((res) => setTimeout(res, 2000))
          if (!alive.current) return
          const j = await api.aiJob(jobId)
          if (j.status === 'failed') throw new Error(j.error ?? 'Proses gagal.')
          if (j.status === 'done') {
            const res = j.result as unknown as { asset: Asset; notes: string[] }
            result = res.asset
            setNotes(res.notes)
            break
          }
        }
      } else {
        result = r.data
        setNotes(r.notes ?? [])
      }
      useEditor.getState().addAsset(result)
      await loadVersions(result.id)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  function addVersionAsLayer(a: Asset) {
    if (!s.doc) return
    const { width: W, height: H } = s.doc.settings
    const k = Math.min(1, (W * 0.6) / a.width, (H * 0.6) / a.height)
    s.addLayer({ id: uid(), type: 'image', name: a.name, assetId: a.id, x: W / 2, y: H / 2, scaleX: k, scaleY: k, rotation: 0, opacity: 1, visible: true, locked: false })
    setDone('Ditambahkan sebagai layer baru.')
  }

  function replaceLayer(a: Asset) {
    if (!layer || layer.type !== 'image') return
    // same visual size: pixel density may differ between versions (upscale/crop), so rescale to keep the on-screen size
    const cur = s.assets[layer.assetId ?? -1]
    const k = cur && a.width ? cur.width / a.width : 1
    s.edit((d) => {
      const l = d.layers.find((x) => x.id === layer.id)!
      l.assetId = a.id
      l.scaleX *= k
      l.scaleY *= k
    })
    setDone('Gambar layer diganti dengan versi ini (ukuran tampilan dipertahankan).')
  }

  return (
    <div className="modal" onClick={() => !busy && onClose()}>
      <div role="dialog" aria-modal="true" className="card dialog wide" onClick={(e) => e.stopPropagation()}>
        <h2>Enhancement Studio — {original.name}</h2>
        <p className="muted small">Setiap proses menghasilkan versi baru; gambar asli dan versi sebelumnya tetap tersimpan. Mode lokal tidak mengirim gambar ke mana pun.</p>

        <div className="imgedit">
          <div>
            <div className="compare" onClick={(e) => {
                if (!picking || corners.length >= 4) return
                const r = e.currentTarget.getBoundingClientRect()
                setCorners((c) => [...c, [Math.round(((e.clientX - r.left) / r.width) * original.width), Math.round(((e.clientY - r.top) / r.height) * original.height)]])
              }}
              style={{ cursor: picking && corners.length < 4 ? 'crosshair' : 'default', background: CHECKER, position: 'relative', width: 420, aspectRatio: `${original.width} / ${original.height}`, overflow: 'hidden' }}>
              <img src={original.url} alt="Sebelum" draggable={false} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }} />
              {shown && shown.id !== original.id && (
                <img src={shown.url} alt="Sesudah" draggable={false}
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', clipPath: `inset(0 0 0 ${split}%)` }} />
              )}
              {corners.map((c, i) => (
                <span key={i} style={{ position: 'absolute', left: `${(c[0] / original.width) * 100}%`, top: `${(c[1] / original.height) * 100}%`, transform: 'translate(-50%,-50%)', width: 18, height: 18, borderRadius: 9, background: '#e0b341', color: '#000', font: '700 11px sans-serif', display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>{i + 1}</span>
              ))}
              {shown && shown.id !== original.id && <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${split}%`, width: 2, background: '#fff', pointerEvents: 'none' }} />}
            </div>
            {shown && shown.id !== original.id ? (
              <label className="field"><span>Sebelum ◀ {split}% ▶ Sesudah ({shown.mode ?? 'edit'})</span>
                <input type="range" min={0} max={100} value={split} onChange={(e) => setSplit(+e.target.value)} aria-label="Geser perbandingan sebelum/sesudah" />
              </label>
            ) : <p className="muted small">Jalankan sebuah mode untuk melihat perbandingan sebelum/sesudah.</p>}
          </div>

          <div className="imgedit-opts">
            <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0 }}>
              {modes.map((m) => (
                <label key={m.id} className="inline" style={{ display: 'block', opacity: m.available ? 1 : 0.55 }} title={m.unavailable_reason ?? ''}>
                  <input type="radio" name="mode" checked={mode === m.id} onChange={() => setMode(m.id)} /> <strong>{m.label}</strong>
                  {m.engine === 'ai' && <span className="badge"> AI eksternal</span>}{m.engine === 'local-ai' && <span className="badge"> AI lokal</span>}
                  <span className="muted small" style={{ display: 'block', marginLeft: 22 }}>{m.available ? m.summary : m.unavailable_reason}</span>
                </label>
              ))}
              <hr />
              {!isAi && (
                <div>
                  <button type="button" onClick={() => { setPicking(true); setCorners([]) }} disabled={busy}>
                    {corners.length === 4 ? 'Pilih ulang sudut kertas' : picking ? `Klik sudut ${['kiri-atas', 'kanan-atas', 'kanan-bawah', 'kiri-bawah'][corners.length]} (${corners.length}/4)` : 'Koreksi perspektif kertas…'}
                  </button>
                  {corners.length > 0 && <button type="button" className="link" onClick={() => { setCorners([]); setPicking(false) }}>batal</button>}
                  <p className="muted small">Untuk foto kertas yang miring/trapesium: klik 4 sudut kertas berurutan dari kiri-atas searah jarum jam. Rasio hasil diambil dari sisi terpanjang, jadi periksa hasilnya.</p>
                </div>
              )}
              <label className="inline"><input type="checkbox" checked={deskew} onChange={(e) => setDeskew(e.target.checked)} disabled={isAi || isLocalAi} /> Luruskan kemiringan otomatis (deskew)</label>
              {(mode === 'clean_sketch' || mode === 'clean_line_art') && (
                <label className="field"><span>Kekuatan garis: {strength}</span><input type="range" min={0} max={100} value={strength} onChange={(e) => setStrength(+e.target.value)} /></label>
              )}
              {mode === 'preserve' && <label className="inline"><input type="checkbox" checked={removeBg} onChange={(e) => setRemoveBg(e.target.checked)} /> Hapus latar polos (transparan)</label>}
              <label className="field"><span>Perbesar resolusi: {upscale}× <span className="muted">{isLocalAi ? '(AI lokal; 1× dihitung 2×)' : '(interpolasi biasa; pakai mode AI lokal untuk hasil tajam)'}</span></span>
                <input type="range" min={1} max={4} step={0.5} value={upscale} onChange={(e) => setUpscale(+e.target.value)} disabled={isAi} /></label>
              {isAi && (
                <>
                  <p className="small" style={{ color: 'var(--warn, #e0b341)' }}>
                    {mode === 'ai_redraw' ? 'AI Redraw dapat mengubah bentuk & ekspresi karakter. ' : ''}
                    Gambar akan dikirim ke layanan AI eksternal{provider?.model ? ` (${provider.model})` : ''}. Batas harian: {provider?.daily_limit} permintaan.
                  </p>
                  <label className="inline"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> Saya setuju gambar ini dikirim ke layanan AI eksternal</label>
                </>
              )}
            </fieldset>
            <button className="primary" disabled={busy || !info?.available || (isAi && !consent)} onClick={() => void run()}>
              {busy ? (isAi ? 'Menunggu provider AI…' : isLocalAi ? 'AI lokal bekerja (bisa beberapa menit)…' : 'Memproses…') : 'Jalankan'}
            </button>
          </div>
        </div>

        {error && <div className="error" role="alert">{error}</div>}
        {notes.map((n, i) => <p key={i} className="muted small">{n}</p>)}
        {done && <p className="small" style={{ color: 'var(--ok)' }}>{done}</p>}

        <h3>Versi ({versions.length})</h3>
        <ul className="plain">
          {versions.map((v) => (
            <li key={v.id} className="row between">
              <button className="link" onClick={() => setShown(v)} aria-pressed={shown?.id === v.id}>
                {v.parent_id ? `#${v.id} ${v.mode ?? 'edit'}` : `#${v.id} asli`} · {v.width}×{v.height}
              </button>
              <span className="row">
                <button onClick={() => addVersionAsLayer(v)}>Tambah layer</button>
                <button disabled={!layer || layer.type !== 'image'} onClick={() => replaceLayer(v)} title={layer?.type === 'image' ? '' : 'Pilih layer gambar dulu'}>Ganti layer terpilih</button>
              </span>
            </li>
          ))}
        </ul>
        <div className="row end"><button onClick={onClose} disabled={busy}>Tutup</button></div>
      </div>
    </div>
  )
}

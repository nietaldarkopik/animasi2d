import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { absUrl } from '../builder/render'
import { AppNav } from '../components/AppNav'
import { applyCalib, calibChanged, calibPayload, clickToCanvas, livePreview, missingRequired, MOUTH_CANVAS, slugify, type CalibTarget, type Calibration, type DraftSheet, type DraftState } from '../builder/cardBuilder'

const CHECKER = 'repeating-conic-gradient(#2b2f3a 0 25%, #20232c 0 50%) 0 0 / 14px 14px'
/** Layers stacked over the head canvas; clicks pass through to the box that reads the calibration. */
const FILL = { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', display: 'block', pointerEvents: 'none' } as const
const TARGETS: { id: CalibTarget; label: string; color: string }[] = [
  { id: 'chin', label: 'Dagu', color: '#ffd166' },
  { id: 'mouth', label: 'Tengah mulut', color: '#ef476f' },
  { id: 'eyeL', label: 'Mata kiri', color: '#06d6a0' },
  { id: 'eyeR', label: 'Mata kanan', color: '#118ab2' },
]

/** New 2.5D character from Flow sheets: details → prompts + sheet upload → import → calibrate on the head → finish. */
export function CardNewPage() {
  const { slug: slugParam } = useParams()
  const nav = useNavigate()
  const [d, setD] = useState<DraftState | null>(null)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [appearance, setAppearance] = useState('')
  const [style, setStyle] = useState('')
  const [error, setError] = useState('')
  const [notes, setNotes] = useState<string[]>([])
  const [busy, setBusy] = useState('')
  const [fit, setFit] = useState(false)
  const [equal, setEqual] = useState(false)
  const [calib, setCalib] = useState<Calibration | null>(null)
  const [target, setTarget] = useState<CalibTarget>('mouth')
  const [preview, setPreview] = useState<'mouth' | 'lids' | 'none'>('mouth')
  const [showBody, setShowBody] = useState(true)
  const img = useRef<HTMLImageElement>(null)

  useEffect(() => {
    document.title = 'Karakter 2.5D baru — Cartoon Maker AI'
    if (!slugParam) return
    api.cbDraftGet(slugParam).then((x) => { setD(x); setCalib(x.calibration) }).catch((e: Error) => setError(e.message))
  }, [slugParam])

  async function act(label: string, fn: () => Promise<void>) {
    setBusy(label); setError('')
    try { await fn() } catch (e) { setError((e as Error).message) } finally { setBusy('') }
  }
  const refresh = async (s: string) => { const x = await api.cbDraftGet(s); setD(x); setCalib((c) => c ?? x.calibration); return x }

  const header = (
    <>
      <header className="topbar"><strong>Cartoon Maker AI</strong><span style={{ width: 16 }} /><AppNav /></header>
      <p className="small"><Link to="/builder">← Semua karakter</Link></p>
      {error && <div className="error" role="alert">{error}</div>}
    </>
  )

  // ---- step 1: details
  if (!slugParam || !d) {
    const ok = /^[a-z0-9][a-z0-9_-]*$/.test(slug) && name.trim() && appearance.trim().length >= 10
    return (
      <div className="page">
        <main style={{ maxWidth: 720, margin: '0 auto', padding: 16 }}>
          {header}
          <h2>Karakter 2.5D baru dari Flow</h2>
          <p className="muted small">Anda membuat gambar di Flow memakai prompt dari sini, mengunggah lembarnya, lalu alat memotong, menempatkan, dan merakit karakter secara otomatis (9 pose badan, 10 ekspresi, 5 bentuk mulut, kelopak mata).</p>
          {!d && slugParam ? <p className="muted">Memuat draf…</p> : (
            <>
              <label className="small">Nama karakter</label>
              <input value={name} maxLength={120} style={{ width: '100%' }} onChange={(e) => { setName(e.target.value); if (!slug || slug === slugify(name)) setSlug(slugify(e.target.value)) }} />
              <label className="small">Nama folder (huruf kecil, angka, _ atau -)</label>
              <input value={slug} maxLength={40} style={{ width: '100%' }} onChange={(e) => setSlug(slugify(e.target.value))} />
              <label className="small">Ciri tampilan (rambut, baju, aksesori, warna; dipakai di semua prompt)</label>
              <textarea rows={3} value={appearance} maxLength={1500} style={{ width: '100%' }} placeholder="long straight dark-purple hair with bangs, white sailor blouse, long grey pleated skirt" onChange={(e) => setAppearance(e.target.value)} />
              <label className="small">Gaya gambar (opsional)</label>
              <input value={style} maxLength={200} style={{ width: '100%' }} placeholder="anime" onChange={(e) => setStyle(e.target.value)} />
              <p className="muted small">Tulis ciri dalam bahasa Inggris agar Flow memahaminya paling baik.</p>
              <div className="row" style={{ gap: 6, marginTop: 10 }}>
                <button className="primary" disabled={!ok || !!busy} onClick={() => void act('start', async () => { const x = await api.cbDraftStart({ slug, name: name.trim(), appearance: appearance.trim(), ...(style.trim() ? { style: style.trim() } : {}) }); nav(`/builder/card-baru/${x.slug}`, { replace: true }) })}>{busy ? 'Membuat…' : 'Mulai'}</button>
              </div>
            </>
          )}
        </main>
      </div>
    )
  }

  const sheets = d.sheets_full
  const lack = missingRequired(sheets)
  const c = calib ?? d.calibration
  const pct = (x: number, total: number) => `${(x / total) * 100}%`
  const [cw, ch] = d.standard.head_canvas
  const live = livePreview(c, d.calibration)
  const changed = calibChanged(c, d.calibration)
  const markers: { t: (typeof TARGETS)[number]; p: [number, number] | null }[] = [
    { t: TARGETS[0], p: null }, { t: TARGETS[1], p: c.mouth }, { t: TARGETS[2], p: c.eyes[0] }, { t: TARGETS[3], p: c.eyes[1] },
  ]

  return (
    <div className="page">
      <main style={{ maxWidth: 980, margin: '0 auto', padding: 16 }}>
        {header}
        <div className="row between" style={{ flexWrap: 'wrap', gap: 6 }}>
          <h2 style={{ margin: 0 }}>{d.name} <span className="badge">draf</span></h2>
          <button disabled={!!busy} onClick={() => { if (confirm(d.exists_final ? 'Buang draf dan lembar mentahnya? Karakter yang sudah jadi tidak terhapus, tetapi revisi berikutnya harus unggah lembar lagi.' : 'Buang draf ini beserta lembar yang diunggah?')) void act('discard', async () => { await api.cbDraftDiscard(d.slug); nav('/builder') }) }}>Buang draf</button>
        </div>
        <p className="muted small">{d.appearance}</p>

        <h3>1. Lembar Flow</h3>
        <p className="muted small">Untuk tiap lembar: salin prompt, lampirkan gambar acuan yang disebut, buat di Flow, lalu unggah hasilnya. Lembar bertanda wajib harus ada; kelopak mata dan acuan opsional.</p>
        {sheets.map((s: DraftSheet) => (
          <div key={s.id} className="card" style={{ margin: '8px 0', padding: 8 }}>
            <div className="row between" style={{ flexWrap: 'wrap', gap: 6 }}>
              <strong className="small">{s.uploaded ? '✓' : s.required ? '✗' : '·'} {s.id} <span className="muted">· {s.cols}×{s.rows} · {s.required ? 'wajib' : 'opsional'}{s.attach.length ? ` · lampirkan: ${s.attach.join(', ')}` : ''}</span></strong>
              <span className="row" style={{ gap: 6 }}>
                <button onClick={() => void navigator.clipboard?.writeText(s.text).catch(() => {})}>Salin prompt</button>
                <label className="small">
                  <input type="file" accept="image/*" style={{ display: 'none' }} disabled={!!busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void act('up' + s.id, async () => { await api.cbDraftUpload(d.slug, s.id, f); await refresh(d.slug) }) }} />
                  <span className="badge" style={{ cursor: 'pointer' }}>{busy === 'up' + s.id ? 'Mengunggah…' : s.uploaded ? 'Ganti lembar' : 'Unggah lembar'}</span>
                </label>
              </span>
            </div>
            <textarea readOnly rows={2} value={s.text} style={{ width: '100%', marginTop: 6, fontSize: 11 }} onFocus={(e) => e.currentTarget.select()} />
          </div>
        ))}

        <h3>2. Rakit</h3>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap', margin: '4px 0' }}>
          <label className="small" style={{ display: "inline-flex", flexDirection: "row", whiteSpace: "nowrap", gap: 6, alignItems: "center" }}><input type="checkbox" checked={fit} onChange={(e) => setFit(e.target.checked)} /> Kecilkan agar muat (fit)</label>
          <label className="small" style={{ display: "inline-flex", flexDirection: "row", whiteSpace: "nowrap", gap: 6, alignItems: "center" }}><input type="checkbox" checked={equal} onChange={(e) => setEqual(e.target.checked)} /> Bagi sel rata (equal)</label>
        </div>
        <button className="primary" disabled={!!busy || lack.length > 0} title={lack.length ? `Belum ada: ${lack.join(', ')}` : ''} onClick={() => void act('imp', async () => {
          const r = await api.cbDraftImport(d.slug, { fit, equal }); setNotes(r.notes); setD(r.state); setCalib(r.calib)
        })}>{busy === 'imp' ? 'Merakit…' : d.imported ? 'Rakit ulang' : 'Rakit karakter'}</button>
        {lack.length > 0 && <span className="muted small"> Belum diunggah: {lack.join(', ')}</span>}
        {notes.map((n, i) => <div key={i} className="muted small">• {n}</div>)}

        {d.imported && (
          <>
            <h3>3. Kalibrasi kepala</h3>
            <p className="muted small">Pilih bagian, lalu klik tepat di gambar kepala. Geser skala bila mulut atau kelopak terlalu besar/kecil, lalu <em>Terapkan</em>. Cek hasil di gambar pratinjau di bawah.</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 360px) 1fr', gap: 16, alignItems: 'start' }}>
              <div>
                <div style={{ position: 'relative', overflow: 'hidden', background: CHECKER, borderRadius: 8, aspectRatio: `${cw} / ${ch}`, cursor: 'crosshair' }}
                  onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setCalib(applyCalib(c, target, clickToCanvas(e.clientX, e.clientY, r, [cw, ch]))) }}>
                  {showBody && d.assets.body && <img src={absUrl(d.assets.body)} alt="" draggable={false} style={{ ...FILL, left: '-50%', width: '200%', height: 'auto', opacity: 0.9 }} />}
                  {d.assets.head && <img ref={img} src={absUrl(d.assets.head)} alt="Kepala netral" draggable={false}
                    style={{ ...FILL, transformOrigin: `${pct(live.head.pivot[0], cw)} ${pct(live.head.pivot[1], ch)}`, transform: `translate(${pct(live.head.dx, cw)}, ${pct(live.head.dy, ch)}) rotate(${live.head.rot}deg)` }} />}
                  {preview === 'mouth' && d.assets.mouth && <img src={absUrl(d.assets.mouth)} alt="" draggable={false}
                    style={{ ...FILL, left: pct(live.mouth.center[0], cw), top: pct(live.mouth.center[1], ch), width: pct(MOUTH_CANVAS[0] * live.mouth.scale, cw), height: 'auto', transform: 'translate(-50%, -50%)' }} />}
                  {preview === 'lids' && d.assets.blink && live.lids.map((l, i) => (
                    <img key={i} src={absUrl(d.assets.blink!)} alt="" draggable={false}
                      style={{ ...FILL, transformOrigin: `${pct(l.from[0], cw)} ${pct(l.from[1], ch)}`, transform: `translate(${pct(l.to[0] - l.from[0], cw)}, ${pct(l.to[1] - l.from[1], ch)}) scale(${l.scale})`,
                        clipPath: i === 0 ? `inset(0 ${100 - (live.mid / cw) * 100}% 0 0)` : `inset(0 0 0 ${(live.mid / cw) * 100}%)` }} />
                  ))}
                  <div style={{ position: 'absolute', left: 0, right: 0, top: pct(c.chin_y, ch), borderTop: `2px dashed ${TARGETS[0].color}`, pointerEvents: 'none' }} />
                  {markers.slice(1).map(({ t, p }) => p && <span key={t.id} style={{ position: 'absolute', left: pct(p[0], cw), top: pct(p[1], ch), width: 12, height: 12, margin: -6, borderRadius: 6, background: t.color, border: '2px solid #fff', pointerEvents: 'none' }} />)}
                </div>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                  {([['mouth', 'Mulut A'], ['lids', 'Kelopak tertutup'], ['none', 'Kepala saja']] as const).map(([id, label]) => (
                    <button key={id} className={preview === id ? 'primary' : ''} disabled={(id === 'lids' && !d.assets.blink) || (id === 'mouth' && !d.assets.mouth)} onClick={() => setPreview(id)}>{label}</button>
                  ))}
                  <label className="small" style={{ display: 'inline-flex', flexDirection: 'row', whiteSpace: 'nowrap', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={showBody} onChange={(e) => setShowBody(e.target.checked)} /> Badan</label>
                </div>
                <p className="small muted" style={{ margin: '4px 0 0' }}>{changed ? 'Pratinjau langsung (perkiraan, belum diterapkan). Klik Terapkan untuk hasil akhir.' : 'Sesuai hasil terakhir yang diterapkan.'}</p>
              </div>
              <div>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {TARGETS.map((t) => <button key={t.id} className={target === t.id ? 'primary' : ''} onClick={() => setTarget(t.id)} style={{ borderLeft: `6px solid ${t.color}` }}>{t.label}</button>)}
                </div>
                <p className="small muted">Dagu y={c.chin_y} · mulut {c.mouth.join(',')} · mata {c.eyes[0].join(',')} / {c.eyes[1].join(',')}</p>
                <p className="small" style={{ margin: '10px 0 2px' }}><strong>Kepala miring atau tidak pas di leher?</strong> Atur ini dulu, klik Terapkan, baru tandai dagu, mulut, dan mata.</p>
                <label className="small">Geser kepala kiri/kanan: {c.head_dx ?? 0} px</label>
                <input type="range" min={-40} max={40} step={1} value={c.head_dx ?? 0} onChange={(e) => setCalib({ ...c, head_dx: Number(e.target.value) })} style={{ width: '100%' }} />
                <label className="small">Geser kepala atas/bawah: {c.head_dy ?? 0} px</label>
                <input type="range" min={-40} max={40} step={1} value={c.head_dy ?? 0} onChange={(e) => setCalib({ ...c, head_dy: Number(e.target.value) })} style={{ width: '100%' }} />
                <label className="small">Putar kepala (mengelilingi leher): {(c.head_rot ?? 0).toFixed(1)}°</label>
                <input type="range" min={-20} max={20} step={0.5} value={c.head_rot ?? 0} onChange={(e) => setCalib({ ...c, head_rot: Number(e.target.value) })} style={{ width: '100%' }} />
                <label className="small">Skala mulut: {(c.mouth_scale ?? 1).toFixed(2)}</label>
                <input type="range" min={0.5} max={2} step={0.05} value={c.mouth_scale ?? 1} onChange={(e) => setCalib({ ...c, mouth_scale: Number(e.target.value) })} style={{ width: '100%' }} />
                <label className="small">Skala kelopak: {(c.lid_scale ?? 1).toFixed(2)}</label>
                <input type="range" min={0.5} max={2} step={0.05} value={c.lid_scale ?? 1} onChange={(e) => setCalib({ ...c, lid_scale: Number(e.target.value) })} style={{ width: '100%' }} />
                <div className="row" style={{ gap: 6, marginTop: 8 }}>
                  <button className="primary" disabled={!!busy} onClick={() => void act('cal', async () => { const r = await api.cbDraftImport(d.slug, { fit, equal, calib: calibPayload(c) }); setNotes(r.notes); setD(r.state); setCalib(r.calib) })}>{busy === 'cal' ? 'Menerapkan…' : 'Terapkan'}</button>
                  <button disabled={!!busy} onClick={() => setCalib(d.standard.defaults)}>Atur ulang ke standar</button>
                </div>
              </div>
            </div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
              {d.previews.map((p) => <a key={p.name} href={absUrl(p.url)} target="_blank" rel="noreferrer"><img src={absUrl(p.url)} alt={p.name} style={{ maxHeight: 280, background: '#20232c', borderRadius: 6 }} /></a>)}
            </div>
            {d.validation && (
              <div className="small" style={{ margin: '8px 0' }}>
                <span className="badge">{d.validation.verdict}</span> {d.validation.fails} gagal · {d.validation.warnings} peringatan
                {d.validation.messages.filter((m) => m.level !== 'ok').slice(0, 6).map((m, i) => <div key={i} className={m.level === 'fail' ? 'error' : 'muted'}>• [{m.area}] {m.msg}</div>)}
              </div>
            )}

            <h3>4. Selesai</h3>
            {d.exists_final ? (
              <>
                <p className="muted small">Karakter <code>karakter/{d.slug}</code> sudah ada. Lembar mentah tetap tersimpan, jadi revisi tidak perlu unggah ulang: ubah kalibrasi atau unggah ganti lembar tertentu, <em>Terapkan</em>, lalu perbarui. Yang diganti hanya gambar kepala, badan, mulut, dan kelopak; paket gerak lain tidak disentuh. Hasilnya menjadi versi baru.</p>
                <button className="primary" disabled={!!busy || d.validation?.verdict === 'fail'} onClick={() => void act('fin', async () => { const x = await api.cbDraftFinish(d.slug, undefined, true); nav(`/builder/card/${x.id}`) })}>{busy === 'fin' ? 'Memperbarui…' : 'Perbarui karakter yang sudah ada'}</button>
              </>
            ) : (
              <button className="primary" disabled={!!busy || d.validation?.verdict === 'fail'} onClick={() => void act('fin', async () => { const x = await api.cbDraftFinish(d.slug); nav(`/builder/card/${x.id}`) })}>{busy === 'fin' ? 'Menyelesaikan…' : 'Selesai dan tambahkan ke karakter'}</button>
            )}
          </>
        )}
      </main>
    </div>
  )
}

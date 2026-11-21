import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { absUrl } from '../builder/render'
import { drawCard, type CardDetail, type CardView } from '../builder/card'
import { AppNav } from '../components/AppNav'
import { CharacterSpriteSheetImportDialog } from '../components/CharacterSpriteSheetImportDialog'
import { CharacterSpritePackPreview } from '../components/CharacterSpritePackPreview'
import type { CharacterSpritePackInfo } from '../api'

const CHECKER = 'repeating-conic-gradient(#2b2f3a 0 25%, #20232c 0 50%) 0 0 / 14px 14px'

/** Preview of a 2.5D card character: pick a pose, an expression, a mouth shape and closed eyes; versions; refresh from the folder. */
export function CardCharacterPage() {
  const { id } = useParams()
  const nav = useNavigate()
  const [d, setD] = useState<CardDetail | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [spriteImportOpen, setSpriteImportOpen] = useState(false)
  const [spritePacks, setSpritePacks] = useState<CharacterSpritePackInfo[]>([])
  const [spritePreviewPack, setSpritePreviewPack] = useState<CharacterSpritePackInfo | null>(null)
  const [name, setName] = useState('')
  const [view, setView] = useState<CardView>({ pose: '', expression: '', mouth: null, blink: false })
  const [sittingFamily, setSittingFamily] = useState('')
  const [sittingReference, setSittingReference] = useState('')
  const [sittingHeadOffset, setSittingHeadOffset] = useState<[number, number]>([200, 0])
  const [draggingHead, setDraggingHead] = useState(false)
  const [sittingHeadScale, setSittingHeadScale] = useState(1)
  const [sittingBodyScale, setSittingBodyScale] = useState(1)
  const [canvasZoom, setCanvasZoom] = useState(1)
  const [, setTick] = useState(0)
  const imgs = useRef(new Map<string, HTMLImageElement>())
  const canvas = useRef<HTMLCanvasElement>(null)
  const packageInput = useRef<HTMLInputElement>(null)

  async function load(version?: number) {
    try {
      const x = await api.cardGet(Number(id), version)
      setD(x)
      setName(x.name)
      document.title = `${x.name} (2.5D) — Cartoon Maker AI`
      if (x.meta) {
        const m = x.meta
        setView((v) => ({
          pose: m.body.poses.includes(v.pose) ? v.pose : m.body.poses.includes('diam') ? 'diam' : m.body.poses[0],
          expression: m.head.expressions.includes(v.expression) ? v.expression : m.head.expressions.includes('netral') ? 'netral' : m.head.expressions[0],
          mouth: null,
          blink: false,
        }))
        if (m.pose_families?.length) {
          const family = m.pose_families.find((item) => item.id === sittingFamily) ?? m.pose_families[0]
          setSittingFamily(family.id)
          setSittingReference(family.default_reference)
          setSittingHeadOffset(m.sitting_head_offsets?.[family.default_reference] ?? [200, 0])
          setSittingHeadScale(m.sitting_head_scales?.[family.default_reference] ?? 1)
          setSittingBodyScale(m.sitting_body_scales?.[family.default_reference] ?? 1)
        }
      }
    } catch (e) { setError((e as Error).message) }
  }
  useEffect(() => { void load() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!id) return
    let cancelled = false
    api.builderSpritePacks(Number(id), 'card').then((packs) => { if (!cancelled) setSpritePacks(packs) }).catch((e) => { if (!cancelled) setError((e as Error).message) })
    return () => { cancelled = true }
  }, [id])

  // load every image of the version once; redraw as they arrive
  useEffect(() => {
    if (!d?.urls) return
    imgs.current = new Map()
    const all = [...Object.values(d.urls.body), ...Object.values(d.urls.head), ...Object.values(d.urls.mouth), ...Object.values(d.urls.sitting ?? {}), ...(d.urls.blink ? [d.urls.blink] : [])]
    for (const u of all) {
      const im = new Image()
      im.onload = () => { imgs.current.set(u, im); setTick((t) => t + 1) }
      im.src = absUrl(u)
    }
  }, [d])

  useEffect(() => {
    const cv = canvas.current
    if (!cv || !d?.meta || !d.urls || !view.pose) return
    const [w, h] = d.meta.body.canvas
    cv.width = w
    cv.height = h
    const ctx = cv.getContext('2d')!
    ctx.clearRect(0, 0, w, h)
    drawCard(ctx, d.meta, (u) => imgs.current.get(u), d.urls, view)
  })

  async function act(fn: () => Promise<unknown>) {
    setBusy(true); setError('')
    try { await fn() } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  const m = d?.meta
  const sittingBodyImage = m && d?.urls?.sitting?.[sittingReference]
    ? imgs.current.get(d.urls.sitting[sittingReference])
    : undefined
  const sittingBaseScale = m && sittingBodyImage
    ? Math.min(
      m.body.canvas[0] / Math.max(1, sittingBodyImage.naturalWidth),
      (m.body.char_height_px ?? m.body.canvas[1] * 0.93) / Math.max(1, sittingBodyImage.naturalHeight),
    )
    : 1
  const sittingPreviewBodyScale = sittingBaseScale * sittingBodyScale
  const pick = (label: string, items: string[], cur: string | null, set: (x: string | null) => void, allowNone?: string) => (
    <div>
      <h4 className="small" style={{ margin: '8px 0 4px' }}>{label}</h4>
      <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
        {allowNone && <button className={cur === null ? 'primary' : ''} onClick={() => set(null)}>{allowNone}</button>}
        {items.map((x) => <button key={x} className={cur === x ? 'primary' : ''} onClick={() => set(x)}>{x}</button>)}
      </div>
    </div>
  )

  return (
    <div className="page">
      <header className="topbar">
        <strong>Cartoon Maker AI</strong>
        <span style={{ width: 16 }} />
        <AppNav />
      </header>
      <main style={{ maxWidth: 1400, margin: '0 auto', padding: 16 }}>
        <p className="small"><Link to="/builder">← Semua karakter</Link></p>
        {error && <div className="error" role="alert">{error}</div>}
        {!d ? <p className="muted">Memuat…</p> : (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 520px) 1fr', gap: 20, alignItems: 'start' }}>
            <div style={{ background: CHECKER, borderRadius: 8, padding: 8, overflow: 'auto' }}>
              <canvas ref={canvas} style={{ width: `${canvasZoom * 100}%`, maxWidth: 'none', height: 'auto', display: 'block', margin: '0 auto' }} aria-label={`Pratinjau ${d.name}`} />
            </div>
            <div>
              <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                <input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} aria-label="Nama karakter" style={{ fontSize: 20, fontWeight: 600 }} />
                {name.trim() && name !== d.name && <button disabled={busy} onClick={() => void act(async () => { await api.cardRename(d.id, name.trim()); await load(d.viewing ?? undefined) })}>Simpan nama</button>}
                <span className="badge">2.5D</span>
              </div>
              {m?.style && <p className="muted small" style={{ margin: '4px 0' }}>{m.style}</p>}
              <p className="muted small" style={{ margin: '4px 0' }}>Sumber: {d.source === 'package-import' ? 'paket karakter ZIP' : <>folder <code>karakter/{d.source}</code></>}. Gambar sudah disalin ke versi ini; menggambar ulang PNG di folder tidak mengubahnya sampai Anda klik <em>Perbarui dari folder</em>.</p>

              {m && (
                <>
                  {pick(`Pose badan (${m.body.poses.length})`, m.body.poses, view.pose, (x) => x && setView((v) => ({ ...v, pose: x })))}
                  {!!m.pose_families?.length && (
                    <section style={{ marginTop: 14, padding: 12, border: '1px solid var(--border)', borderRadius: 8 }}>
                      <h3 style={{ margin: '0 0 4px' }}>Referensi Pose Duduk</h3>
                      <p className="muted small" style={{ margin: '0 0 10px' }}>Katalog pose duduk Uki. Pilih kelompok dan variasi referensi untuk kalibrasi posisi kepala dan ukuran badan.</p>
                      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                        {m.pose_families.map((family) => (
                          <button key={family.id} className={sittingFamily === family.id ? 'primary' : ''} onClick={() => {
                            setSittingFamily(family.id)
                            setSittingReference(family.default_reference)
                            setSittingHeadOffset(m.sitting_head_offsets?.[family.default_reference] ?? [200, 0])
                            setSittingHeadScale(m.sitting_head_scales?.[family.default_reference] ?? 1)
                            setSittingBodyScale(m.sitting_body_scales?.[family.default_reference] ?? 1)
                          }}>{family.label}</button>
                        ))}
                      </div>
                      {m.pose_families.filter((family) => family.id === sittingFamily).map((family) => {
                        const refs = [family.default_reference, ...family.alternatives]
                        return (
                          <div key={family.id} style={{ marginTop: 10 }}>
                            <div className="small"><strong>Variasi referensi</strong></div>
                            <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 5 }}>
                              {refs.map((ref) => <button key={ref} className={sittingReference === ref ? 'primary' : ''} onClick={() => { setSittingReference(ref); setSittingHeadOffset(m.sitting_head_offsets?.[ref] ?? [200, 0]); setSittingHeadScale(m.sitting_head_scales?.[ref] ?? 1); setSittingBodyScale(m.sitting_body_scales?.[ref] ?? 1) }}>{ref}</button>)}
                            </div>
                            {d.sitting_reference_urls?.[sittingReference] ? (
                              <div style={{ marginTop: 10, display: 'inline-flex', flexDirection: 'column', gap: 5, maxWidth: 240 }}>
                                <div className="small"><strong>Preview: {sittingReference}</strong></div>
                                <div style={{ background: CHECKER, border: '1px solid var(--border)', borderRadius: 8, padding: 8, display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 180 }}>
                                  <img
                                    src={absUrl(d.sitting_reference_urls?.[sittingReference] ?? '')}
                                    alt={`Referensi pose duduk ${sittingReference}`}
                                    style={{ display: 'block', maxWidth: '100%', maxHeight: 280, objectFit: 'contain' }}
                                  />
                                </div>
                                <span className="muted small">PNG transparan · referensi statis tanpa kepala</span>
                              </div>
                            ) : (
                              <p className="muted small" style={{ margin: '8px 0 0' }}>Preview belum tersedia pada versi karakter ini. Klik Perbarui dari folder untuk menyalin aset referensi terbaru.</p>
                            )}
                            <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                              <div className="small"><strong>Kalibrasi posisi kepala</strong></div>
                              <p className="muted small" style={{ margin: '4px 0 8px' }}>Atur posisi dan ukuran kepala, lalu sesuaikan skala badan. Semua nilai tersimpan per pose.</p>
                              <div
                                onPointerMove={(event) => {
                                  if (!draggingHead) return
                                  const rect = event.currentTarget.getBoundingClientRect()
                                  setSittingHeadOffset(([x, y]) => [
                                    Math.round(Math.max(-800, Math.min(1200, x + event.movementX * 800 / rect.width))),
                                    Math.round(Math.max(-800, Math.min(1400, y + event.movementY * 1400 / rect.height))),
                                  ])
                                }}
                                onPointerUp={() => setDraggingHead(false)}
                                onPointerCancel={() => setDraggingHead(false)}
                                style={{ position: 'relative', width: 320, aspectRatio: '4 / 7', maxWidth: '100%', overflow: 'hidden', border: '1px solid var(--border)', borderRadius: 8, background: CHECKER, touchAction: 'none', userSelect: 'none' }}
                              >
                                <img src={absUrl(d.sitting_reference_urls?.[sittingReference] ?? '')} alt="" draggable={false}
                                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', objectPosition: 'center bottom', pointerEvents: 'none', transform: `scale(${sittingBodyScale})`, transformOrigin: 'center bottom' }} />
                                {d.urls?.head?.[view.expression] && (
                                  <img src={absUrl(d.urls.head[view.expression])} alt="Kepala yang dapat diposisikan" draggable={false}
                                    onPointerDown={(event) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); setDraggingHead(true) }}
                                    onPointerUp={() => setDraggingHead(false)}
                                    style={{ position: 'absolute', left: `${sittingHeadOffset[0] / 8}%`, top: `${sittingHeadOffset[1] / 14}%`, width: `${m ? (m.head.canvas[0] * sittingPreviewBodyScale * sittingHeadScale / m.body.canvas[0]) * 100 : 50}%`, height: `${m ? (m.head.canvas[1] * sittingPreviewBodyScale * sittingHeadScale / m.body.canvas[1]) * 100 : 400 / 1400 * 100}%`, objectFit: 'contain', cursor: draggingHead ? 'grabbing' : 'grab', touchAction: 'none' }} />
                                )}
                              </div>
                              <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8, alignItems: 'end' }}>
                                <label className="small">X
                                  <input type="number" value={sittingHeadOffset[0]} onChange={(e) => setSittingHeadOffset(([, y]) => [Number(e.target.value), y])} style={{ width: 88 }} />
                                </label>
                                <label className="small">Y
                                  <input type="number" value={sittingHeadOffset[1]} onChange={(e) => setSittingHeadOffset(([x]) => [x, Number(e.target.value)])} style={{ width: 88 }} />
                                </label>
                                <label className="small">Ukuran kepala
                                  <input type="range" min="0.45" max="1.8" step="0.01" value={sittingHeadScale} onChange={(e) => setSittingHeadScale(Number(e.target.value))} />
                                  <span>{Math.round(sittingHeadScale * 100)}%</span>
                                </label>
                                <label className="small">Ukuran badan
                                  <input type="range" min="0.65" max="1.5" step="0.01" value={sittingBodyScale} onChange={(e) => setSittingBodyScale(Number(e.target.value))} />
                                  <span>{Math.round(sittingBodyScale * 100)}%</span>
                                </label>
                                <label className="small">Zoom canvas
                                  <input type="range" min="0.75" max="1.8" step="0.05" value={canvasZoom} onChange={(e) => setCanvasZoom(Number(e.target.value))} />
                                  <span>{Math.round(canvasZoom * 100)}%</span>
                                </label>
                                <button className="primary" disabled={busy || !d.sitting_reference_urls?.[sittingReference]} onClick={() => void act(async () => {
                                  const updated = await api.cardSaveSittingHeadOffset(d.id, sittingReference, sittingHeadOffset[0], sittingHeadOffset[1], sittingHeadScale, sittingBodyScale)
                                  setD(updated)
                                })}>Simpan kalibrasi</button>
                                <button disabled={!m.sitting_head_offsets?.[sittingReference]} onClick={() => setView((v) => ({ ...v, pose: `sitting:${sittingReference}`, mouth: null, blink: false }))}>Gunakan di canvas</button>
                              </div>
                              <p className="muted small" style={{ margin: '6px 0 0' }}>Tersimpan per variasi pose dan membuat versi karakter baru. Setelah tersimpan, klik Gunakan di canvas untuk mengaktifkan pose ini.</p>
                            </div>
                          </div>
                        )
                      })}
                    </section>
                  )}
                  {pick(`Ekspresi kepala (${m.head.expressions.length})`, m.head.expressions, view.expression, (x) => x && setView((v) => ({ ...v, expression: x })))}
                  {m.mouth && pick('Bentuk mulut (lip-sync)', m.mouth.shapes, view.mouth, (x) => setView((v) => ({ ...v, mouth: x })), 'tutup')}
                  {d.urls?.blink && (
                    <label className="row small" style={{ gap: 6, marginTop: 8 }}>
                      <input type="checkbox" checked={view.blink} onChange={(e) => setView((v) => ({ ...v, blink: e.target.checked }))} /> Mata terpejam (kedip)
                      {m.blink?.skip?.includes(view.expression) && <span className="muted">· ekspresi ini tidak dirancang untuk kedip</span>}
                    </label>
                  )}
                </>
              )}

              <div className="row" style={{ gap: 6, marginTop: 16, flexWrap: 'wrap' }}>
                <button className="primary" disabled={busy || d.source === 'package-import'} onClick={() => void act(async () => { const x = await api.cardRefresh(d.id); setD(x) })} title={d.source === 'package-import' ? 'Karakter ini berasal dari paket ZIP, bukan folder sumber.' : 'Buat versi baru dari isi folder karakter saat ini'}>{busy ? 'Memproses…' : 'Perbarui dari folder'}</button>
                <button disabled={busy} onClick={() => void act(async () => { const x = await api.cardDuplicate(d.id); nav(`/builder/card/${x.id}`) })}>Duplikat</button>
                <button disabled={busy} onClick={() => void act(() => api.cardExportPackage(d.id, d.viewing ?? undefined))}>Export Sprite Sheet + ZIP</button>
                <button disabled={busy} onClick={() => packageInput.current?.click()}>Import Paket sebagai Karakter Baru</button>
                <button disabled={busy} onClick={() => { if (confirm(`Hapus karakter "${d.name}" beserta semua versinya?`)) void act(async () => { await api.cardDelete(d.id); nav('/builder') }) }}>Hapus</button>
                <input ref={packageInput} type="file" accept=".zip,application/zip" style={{ display: 'none' }} onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (file) void act(async () => {
                    const created = await api.cardImportPackage(file)
                    nav(`/builder/card/${created.id}`)
                  })
                }} />
              </div>
              <p className="muted small">Export menghasilkan sprite sheet karakter lengkap (kombinasi pose badan + ekspresi kepala, serta sel overlay mulut/kedip; 16 sel per halaman) beserta manifest dan aset modular asli. Edit PNG di folder sprite-sheet/ di Google Flow, pertahankan grid 4×4 dan ukuran 4096×4096, lalu impor ZIP sebagai karakter baru. Sprite sheet hasil edit otomatis dilampirkan sebagai sprite pack; karakter asli tidak ditimpa.</p>
              <p className="muted small">Pakai di film: buka project → tombol <strong>Karakter</strong> → bagian <em>Karakter 2.5D</em> → <strong>Sisipkan 2.5D</strong>. Lalu ganti pose, ekspresi, dan lip-sync dari panel <em>Alat film → Karakter</em>.</p>

              <section style={{ marginTop: 18, padding: 12, border: '1px solid var(--border)', borderRadius: 8 }}>
                <div className="row between" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <div>
                    <h3 style={{ margin: 0 }}>Sprite Sheet Animasi</h3>
                    <p className="muted small" style={{ margin: '4px 0 0' }}>Impor atlas animasi untuk karakter {d.name}.</p>
                  </div>
                  <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                    <button className="primary" disabled={busy} onClick={() => setSpriteImportOpen(true)}>Import Sprite Sheet</button>
                    <button disabled={!spritePacks.length} onClick={() => setSpritePreviewPack(spritePacks[0] ?? null)}>Preview Animasi</button>
                  </div>
                </div>
                {spritePacks.length ? (
                  <ul className="plain" style={{ margin: '10px 0 0' }}>
                    {spritePacks.map((pack) => (
                      <li key={pack.id} className="row between" style={{ gap: 8, padding: '6px 0', borderTop: '1px solid var(--border)' }}>
                        <span><strong>{pack.name}</strong> <span className="muted small">· {pack.frame_count} frame · {pack.facing} · {pack.outfit_name} · {pack.status}</span></span>
                        <button onClick={() => setSpritePreviewPack(pack)}>Preview</button>
                      </li>
                    ))}
                  </ul>
                ) : <p className="muted small" style={{ margin: '10px 0 0' }}>Belum ada sprite sheet yang diimpor.</p>}
              </section>

              <h3 style={{ marginTop: 20 }}>Versi</h3>
              <ul className="plain">
                {d.versions.slice().reverse().map((v) => (
                  <li key={v.number} className="row between">
                    <span><span className="badge">v{v.number}</span> {v.note} <span className="muted small">· {new Date(v.created_at).toLocaleString()}</span></span>
                    {v.number === d.viewing ? <span className="small muted">{v.number === d.current_version ? 'aktif' : 'dilihat'}</span> : <button onClick={() => void load(v.number)}>Lihat</button>}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </main>
      {spriteImportOpen && d && <CharacterSpriteSheetImportDialog characterId={d.id} resource="card" version={d.viewing ?? null} onClose={() => setSpriteImportOpen(false)} onImported={(pack) => {
        setSpritePacks((items) => [pack, ...items.filter((item) => item.id !== pack.id)])
        setSpritePreviewPack(pack)
        setSpriteImportOpen(false)
      }} />}
      {spritePreviewPack && <CharacterSpritePackPreview pack={spritePreviewPack} onClose={() => setSpritePreviewPack(null)} />}
    </div>
  )
}

import { useCallback, useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { absUrl } from '../builder/render'
import {
  mapRule, normHex, packProgress, slugify, PACKS,
  type BuilderStatus, type ColorCluster, type ColorMap, type ImportResult, type PackId, type PromptResult, type ValidationReport,
} from '../builder/cardBuilder'
import { NECK_PIVOT, slotUrl, type CardDetail } from '../builder/card'

const PACK_TITLE: Record<PackId, string> = { dialog: 'Dialog', duduk: 'Duduk', aksi: 'Aksi', jalan: 'Jalan & kiri' }

function Verdict({ v }: { v: ValidationReport | null | undefined }) {
  if (!v) return null
  return (
    <div className="small" style={{ margin: '6px 0' }}>
      <span className="badge">{v.verdict}</span> {v.fails} gagal · {v.warnings} peringatan
      {v.messages.filter((m) => m.level !== 'ok').slice(0, 6).map((m, i) => <div key={i} className={m.level === 'fail' ? 'error' : 'muted'}>• [{m.area}] {m.msg}</div>)}
    </div>
  )
}

async function copy(text: string) {
  try { await navigator.clipboard.writeText(text) } catch { /* clipboard blocked: the text stays selectable in the box */ }
}

/**
 * Where the head sits on one body of a motion pack (sitting, 3/4, side, running) and how far it is tilted around the neck.
 * The picture moves while the sliders move: body image, the head that pose uses (3/4 bodies take the 3/4 head when the card has one).
 */
function HeadFit({ card, onChanged }: { card: CardDetail; onChanged: (c: CardDetail) => void }) {
  const meta = card.meta
  const urls = card.urls
  const slots = Object.keys(meta?.body.head_at ?? {}).filter((id) => urls && slotUrl(urls, 'body', id))
  const [slot, setSlot] = useState(slots[0] ?? '')
  const [dx, setDx] = useState(0)
  const [dy, setDy] = useState(0)
  const [rot, setRot] = useState(0)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const saved = meta?.body.head_at?.[slot]
  const savedRot = meta?.body.head_rot?.[slot] ?? 0
  useEffect(() => { setDx(0); setDy(0); setRot(savedRot); setMsg('') }, [slot, savedRot, saved?.[0], saved?.[1]])   // eslint-disable-line react-hooks/exhaustive-deps
  if (!meta || !urls || !slots.length || !saved) return null

  const [bw, bh] = meta.body.canvas
  const [hw, hh] = meta.head.canvas
  const view = /_(34|sisi)$/.exec(slot)?.[1]
  const headId = (view && urls.extra?.head?.[`netral_${view}`] ? `netral_${view}` : 'netral')
  const headUrl = slotUrl(urls, 'head', headId)
  const x = saved[0] + dx
  const y = saved[1] + dy
  const pct = (v: number, t: number) => `${(v / t) * 100}%`
  const changed = dx !== 0 || dy !== 0 || rot !== savedRot
  /** Drag on the picture: the neck of the head follows the pointer (the head turns around that point, so it stays put when tilted). */
  const place = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const nx = ((e.clientX - r.left) / r.width) * bw
    const ny = ((e.clientY - r.top) / r.height) * bh
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)))
    setDx(clamp(nx - NECK_PIVOT[0], -300, 900) - saved[0])
    setDy(clamp(ny - NECK_PIVOT[1], -300, 1500) - saved[1])
  }
  const slider = (label: string, v: number, set: (n: number) => void, min: number, max: number, step: number, unit: string) => (
    <>
      <label className="small">{label}: {step < 1 ? v.toFixed(1) : v} {unit}</label>
      <input type="range" min={min} max={max} step={step} value={v} onChange={(e) => set(Number(e.target.value))} style={{ width: '100%' }} />
    </>
  )

  return (
    <div>
      <h4 style={{ margin: '16px 0 4px' }}>Pas-kan kepala per pose</h4>
      <p className="muted small">Untuk pose duduk, 3/4, samping, atau lari yang kepalanya belum pas di leher. Geret langsung di gambar (leher kepala mengikuti penunjuk) atau pakai slider, miringkan sampai leher menyatu, lalu <em>Simpan</em>. Kemiringan memutar kepala mengelilingi leher dan ikut dipakai di film.{view ? ` Pose ini memakai kepala ${view === '34' ? '3/4' : 'samping'} bila ada (tab Dialog).` : ''}</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 280px) 1fr', gap: 16, alignItems: 'start' }}>
        <div title="Geret: leher kepala mengikuti penunjuk" style={{ position: 'relative', overflow: 'hidden', background: 'repeating-conic-gradient(#2b2f3a 0 25%, #20232c 0 50%) 0 0 / 14px 14px', borderRadius: 8, aspectRatio: `${bw} / ${bh}`, cursor: 'grab', touchAction: 'none' }}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); place(e) }}
          onPointerMove={(e) => { if (e.buttons) place(e) }}>
          <img src={absUrl(slotUrl(urls, 'body', slot)!)} alt="" draggable={false} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />
          {headUrl && <img src={absUrl(headUrl)} alt="" draggable={false}
            style={{ position: 'absolute', left: pct(x, bw), top: pct(y, bh), width: pct(hw, bw), height: pct(hh, bh), pointerEvents: 'none', transformOrigin: `${pct(NECK_PIVOT[0], hw)} ${pct(NECK_PIVOT[1], hh)}`, transform: `rotate(${rot}deg)` }} />}
        </div>
        <div>
          <select value={slot} onChange={(e) => setSlot(e.target.value)} aria-label="Pose" style={{ width: '100%' }}>
            {slots.map((id) => <option key={id} value={id}>{id}{meta.body.head_rot?.[id] ? ` (miring ${meta.body.head_rot[id]}°)` : ''}</option>)}
          </select>
          {slider('Geser kiri/kanan', dx, setDx, -500, 500, 1, 'px')}
          {slider('Geser atas/bawah', dy, setDy, -500, 500, 1, 'px')}
          {slider('Miringkan (mengelilingi leher)', rot, setRot, -30, 30, 0.5, '°')}
          <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            <button className="primary" disabled={busy || !changed} onClick={() => {
              setBusy(true); setMsg('')
              void api.cbHeadAt(card.id, slot, Math.round(x), Math.round(y), rot)
                .then(() => api.cardRefresh(card.id)).then((c) => { onChanged(c); setMsg('Tersimpan dan versi baru dibuat.') })
                .catch((e: Error) => setMsg(e.message)).finally(() => setBusy(false))
            }}>{busy ? 'Menyimpan…' : 'Simpan posisi kepala'}</button>
            <button disabled={busy || !changed} onClick={() => { setDx(0); setDy(0); setRot(savedRot) }}>Batalkan</button>
          </div>
          {msg && <p className="small muted">{msg}</p>}
        </div>
      </div>
    </div>
  )
}

/** Motion packs (dialog / duduk / aksi) of an existing card character: prompts for Flow, sheet upload, import with detection overlays. */
function PacksTab({ card, onChanged }: { card: CardDetail; onChanged: (c: CardDetail) => void }) {
  const [st, setSt] = useState<BuilderStatus | null>(null)
  const [pack, setPack] = useState<PackId>('duduk')
  const [prompts, setPrompts] = useState<PromptResult | null>(null)
  const [res, setRes] = useState<ImportResult | null>(null)
  const [appearance, setAppearance] = useState('')
  const [fit, setFit] = useState(false)
  const [equal, setEqual] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [mouth, setMouth] = useState<Record<string, [string, string]>>({ '34': ['', ''], sisi: ['', ''] })

  const reload = useCallback(async () => {
    try { const s = await api.cbStatus(card.id); setSt(s); setAppearance((a) => a || s.appearance) } catch (e) { setError((e as Error).message) }
  }, [card.id])
  useEffect(() => { void reload() }, [reload])
  // prompts of the chosen pack show up right away (the tool writes manifest + prompt text into the character folder; uploaded sheets are untouched)
  useEffect(() => {
    let live = true
    api.cbPrompts(card.id, pack).then((r) => { if (live) setPrompts(r) }).catch((e: Error) => { if (live) setError(e.message) })
    return () => { live = false }
  }, [card.id, pack])

  async function act(label: string, fn: () => Promise<void>) {
    setBusy(label); setError(''); setNote('')
    try { await fn() } catch (e) { setError((e as Error).message) } finally { setBusy('') }
  }

  if (!st) return <p className="muted small">{error || 'Memuat status paket…'}</p>
  const p = st.packs[pack]
  const sheetOf = (id: string) => p.sheets.find((s) => s.id === id)

  return (
    <div>
      {error && <div className="error" role="alert">{error}</div>}
      {note && <p className="small" style={{ color: '#7bd88f' }}>{note}</p>}
      <p className="muted small">Alur: tulis ciri tampilan → ambil prompt → buat lembar di Flow → unggah → cek (uji coba) → impor → <strong>Perbarui dari folder</strong>. Slot baru muncul di editor setelah itu.</p>

      <label className="small">Ciri tampilan (dipakai di semua prompt agar rambut/baju konsisten)</label>
      <textarea value={appearance} onChange={(e) => setAppearance(e.target.value)} rows={2} style={{ width: '100%' }} maxLength={1500} />
      <div className="row" style={{ gap: 6, margin: '4px 0 10px' }}>
        <button disabled={!!busy || !appearance.trim() || appearance === st.appearance} onClick={() => void act('app', async () => { await api.cbAppearance(card.id, appearance.trim()); await reload(); setNote('Ciri tampilan disimpan.') })}>Simpan ciri</button>
      </div>

      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {PACKS.map((k) => (
          <button key={k} className={pack === k ? 'primary' : ''} onClick={() => { setPack(k); setPrompts(null); setRes(null) }}>
            {PACK_TITLE[k]} {st.packs[k].enabled && '✓'} <span className="small">({packProgress(st.packs[k])})</span>
          </button>
        ))}
      </div>
      <p className="muted small" style={{ margin: '6px 0' }}>{p.label}</p>

      <details>
        <summary className="small">Slot paket ini ({p.slots.length})</summary>
        <ul className="plain small">{p.slots.map((s) => <li key={s.group + s.id}>{s.present ? '✓' : s.required ? '✗' : '·'} {s.label} {s.required && <span className="muted">(wajib)</span>}</li>)}</ul>
      </details>

      <div className="row" style={{ gap: 6, margin: '8px 0' }}>
        <button className="primary" disabled={!!busy} onClick={() => void act('prompt', async () => { setPrompts(await api.cbPrompts(card.id, pack)); await reload() })}>{busy === 'prompt' ? 'Menyusun…' : 'Susun ulang prompt Flow'}</button>
        {!prompts && !error && <span className="muted small">Menyusun prompt…</span>}
      </div>
      {prompts && prompts.pack === pack && (
        <div>
          {prompts.missing_acuan && <p className="error small">Lembar acuan karakter belum ada; lampirkan gambar acuan saat membuat di Flow.</p>}
          {prompts.sheets.map((sh) => (
            <div key={sh.id} className="card" style={{ margin: '8px 0', padding: 8 }}>
              <div className="row between" style={{ flexWrap: 'wrap', gap: 6 }}>
                <strong className="small">{sh.id} <span className="muted">· {sh.cols}×{sh.rows} sel · lampirkan: {sh.attach.join(', ') || '—'}</span></strong>
                <span className="row" style={{ gap: 6 }}>
                  <button onClick={() => void copy(sh.text)}>Salin prompt</button>
                  <label className="small">
                    <input type="file" accept="image/*" style={{ display: 'none' }} disabled={!!busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void act('up' + sh.id, async () => { await api.cbUpload(card.id, pack, sh.id, f); await reload(); setNote(`${sh.id} terunggah.`) }) }} />
                    <span className="badge" style={{ cursor: 'pointer' }}>{sheetOf(sh.id)?.uploaded ? '✓ ganti lembar' : 'Unggah lembar'}</span>
                  </label>
                </span>
              </div>
              <textarea readOnly value={sh.text} rows={3} style={{ width: '100%', marginTop: 6, fontSize: 11 }} onFocus={(e) => e.currentTarget.select()} />
            </div>
          ))}
        </div>
      )}

      <div className="row" style={{ gap: 12, flexWrap: 'wrap', margin: '8px 0' }}>
        <label className="small" style={{ display: "inline-flex", flexDirection: "row", whiteSpace: "nowrap", gap: 6, alignItems: "center" }}><input type="checkbox" checked={fit} onChange={(e) => setFit(e.target.checked)} /> Kecilkan agar muat (fit)</label>
        <label className="small" style={{ display: "inline-flex", flexDirection: "row", whiteSpace: "nowrap", gap: 6, alignItems: "center" }}><input type="checkbox" checked={equal} onChange={(e) => setEqual(e.target.checked)} /> Bagi sel rata (equal)</label>
      </div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <button disabled={!!busy || !p.sheets.some((s) => s.uploaded)} onClick={() => void act('dry', async () => { setRes(await api.cbImport(card.id, { pack, dry_run: true, fit, equal })) })}>{busy === 'dry' ? 'Memeriksa…' : 'Cek dulu (uji coba)'}</button>
        <button className="primary" disabled={!!busy || !p.sheets.some((s) => s.uploaded)} onClick={() => void act('imp', async () => {
          const r = await api.cbImport(card.id, { pack, overwrite: true, fit, equal }); setRes(r)
          const next = await api.cardRefresh(card.id); onChanged(next); await reload(); setNote('Paket diimpor dan versi baru dibuat.')
        })}>{busy === 'imp' ? 'Mengimpor…' : 'Impor + perbarui versi'}</button>
      </div>
      {res && (
        <div style={{ marginTop: 8 }}>
          <p className="small"><strong>{res.dry_run ? 'Uji coba (belum menulis apa pun)' : 'Hasil impor'}</strong>: {res.imported.filter((i) => !i.skipped).length} slot{res.imported.some((i) => i.skipped) ? `, ${res.imported.filter((i) => i.skipped).length} dilewati` : ''}</p>
          {res.notes.map((n, i) => <div key={i} className="muted small">• {n}</div>)}
          <Verdict v={res.validation} />
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {res.previews.map((pv) => <a key={pv.name} href={absUrl(pv.url)} target="_blank" rel="noreferrer"><img src={absUrl(pv.url)} alt={pv.name} style={{ maxHeight: 220, background: '#20232c', borderRadius: 6 }} /></a>)}
          </div>
        </div>
      )}

      <h4 style={{ margin: '16px 0 4px' }}>Posisi mulut (tampak 3/4 dan samping)</h4>
      <p className="muted small">Titik tengah mulut pada kanvas kepala 400×500. Isi bila mulut tidak pas di kepala hadap 3/4 atau samping. {st.mouth_views.length ? `Terisi: ${st.mouth_views.join(', ')}.` : ''}</p>
      {(['34', 'sisi'] as const).map((v) => (
        <div key={v} className="row small" style={{ gap: 6, margin: '4px 0' }}>
          <span style={{ width: 90 }}>{v === '34' ? '3/4' : 'Samping'}</span>
          x <input style={{ width: 70 }} inputMode="numeric" value={mouth[v][0]} onChange={(e) => setMouth((m) => ({ ...m, [v]: [e.target.value, m[v][1]] }))} />
          y <input style={{ width: 70 }} inputMode="numeric" value={mouth[v][1]} onChange={(e) => setMouth((m) => ({ ...m, [v]: [m[v][0], e.target.value] }))} />
          <button disabled={!!busy || !/^-?\d+$/.test(mouth[v][0]) || !/^-?\d+$/.test(mouth[v][1])} onClick={() => void act('m' + v, async () => { await api.cbMouthAt(card.id, v, Number(mouth[v][0]), Number(mouth[v][1])); await reload(); setNote('Posisi mulut disimpan; klik Perbarui dari folder.') })}>Simpan</button>
        </div>
      ))}
      <HeadFit card={card} onChanged={onChanged} />
      <Verdict v={st.validation} />
    </div>
  )
}

/** Duplicate a character with other colours: pick the colour clusters, map them, preview, save as a new character. */
function RecolorTab({ card }: { card: CardDetail }) {
  const nav = useNavigate()
  const [clusters, setClusters] = useState<ColorCluster[] | null>(null)
  const [maps, setMaps] = useState<ColorMap[]>([])
  const [as, setAs] = useState('')
  const [name, setName] = useState('')
  const [preview, setPreview] = useState<string | null>(null)
  const [report, setReport] = useState<ValidationReport | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  useEffect(() => { api.cbColors(card.id).then(setClusters).catch((e: Error) => setError(e.message)) }, [card.id])

  const rules = maps.map(mapRule)
  const valid = rules.length > 0 && rules.every(Boolean) && /^[a-z0-9][a-z0-9_-]*$/i.test(as)
  async function act(label: string, fn: () => Promise<void>) {
    setBusy(label); setError('')
    try { await fn() } catch (e) { setError((e as Error).message) } finally { setBusy('') }
  }
  const add = (c: ColorCluster) => setMaps((m) => (m.some((x) => normHex(x.from) === c.hex) ? m : [...m, { from: c.hex, to: c.hex, tol: 14, groups: [], not: '' }]))
  const patch = (i: number, p: Partial<ColorMap>) => { setMaps((m) => m.map((x, j) => (j === i ? { ...x, ...p } : x))); setPreview(null) }

  return (
    <div>
      {error && <div className="error" role="alert">{error}</div>}
      <p className="muted small">Buat salinan karakter dengan warna lain (rambut, baju, kulit) tanpa menggambar ulang. Klik warna di bawah, pilih warna tujuan, lihat pratinjau, lalu simpan sebagai karakter baru.</p>
      {!clusters ? <p className="muted small">Menganalisis warna…</p> : (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {clusters.map((c) => (
            <button key={c.hex} onClick={() => add(c)} title={`${c.name} · ${(c.share * 100).toFixed(1)}% · ${Object.keys(c.boxes).join(', ')}`} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 18, height: 18, background: c.hex, borderRadius: 4, border: '1px solid #888' }} /> {c.name} <span className="muted small">{(c.share * 100).toFixed(0)}%</span>
            </button>
          ))}
        </div>
      )}
      {maps.map((m, i) => (
        <div key={i} className="card" style={{ margin: '8px 0', padding: 8 }}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ width: 18, height: 18, background: normHex(m.from) ?? '#000', borderRadius: 4 }} />
            <input style={{ width: 90 }} value={m.from} onChange={(e) => patch(i, { from: e.target.value })} aria-label="Warna asal" />
            →
            <input type="color" style={{ width: 44, padding: 0 }} value={normHex(m.to) ?? '#000000'} onChange={(e) => patch(i, { to: e.target.value })} aria-label="Warna tujuan" />
            <input style={{ width: 90 }} value={m.to} onChange={(e) => patch(i, { to: e.target.value })} aria-label="Warna tujuan (hex)" />
            <label className="small">toleransi <input type="number" min={1} max={60} style={{ width: 56 }} value={m.tol} onChange={(e) => patch(i, { tol: Number(e.target.value) })} /></label>
            <button onClick={() => { setMaps((x) => x.filter((_, j) => j !== i)); setPreview(null) }}>Hapus</button>
          </div>
          <div className="row small" style={{ gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
            {(['body', 'head', 'mouth', 'blink'] as const).map((g) => (
              <label key={g} style={{ display: "inline-flex", flexDirection: "row", whiteSpace: "nowrap", gap: 4, alignItems: "center" }}><input type="checkbox" checked={m.groups.includes(g)} onChange={(e) => patch(i, { groups: e.target.checked ? [...m.groups, g] : m.groups.filter((x) => x !== g) })} /> {g}</label>
            ))}
            <span className="muted">(kosong = semua)</span>
            <label>kecualikan kotak <input style={{ width: 150 }} placeholder="x0,y0,x1,y1" value={m.not} onChange={(e) => patch(i, { not: e.target.value })} /></label>
          </div>
          {clusters?.find((c) => c.hex === normHex(m.from)) && <div className="muted small">Terlihat di: {Object.entries(clusters.find((c) => c.hex === normHex(m.from))!.boxes).map(([k, b]) => `${k} [${b.join(',')}]`).join(' · ')}</div>}
        </div>
      ))}
      <div className="row" style={{ gap: 6, margin: '10px 0', flexWrap: 'wrap', alignItems: 'center' }}>
        <input placeholder="nama folder baru (mis. arum_biru)" value={as} onChange={(e) => { setAs(slugify(e.target.value).replace(/_$/, '')); setPreview(null) }} style={{ width: 220 }} />
        <input placeholder="nama tampil (opsional)" value={name} onChange={(e) => setName(e.target.value)} style={{ width: 200 }} />
        <button disabled={!valid || !!busy} onClick={() => void act('pv', async () => { const r = await api.cbRecolorPreview(card.id, as, rules as string[]); setPreview(r.preview_png_base64); setReport(r.validation) })}>{busy === 'pv' ? 'Membuat…' : 'Pratinjau'}</button>
        <button className="primary" disabled={!valid || !!busy} onClick={() => void act('save', async () => { const r = await api.cbRecolorSave(card.id, as, name.trim(), rules as string[]); nav(`/builder/card/${r.character.id}`) })}>{busy === 'save' ? 'Menyimpan…' : 'Simpan sebagai karakter baru'}</button>
      </div>
      {preview && <img src={`data:image/png;base64,${preview}`} alt="Pratinjau warna" style={{ maxWidth: '100%', background: '#20232c', borderRadius: 6 }} />}
      <Verdict v={report} />
    </div>
  )
}

export function CardBuilderPanel({ card, onChanged }: { card: CardDetail; onChanged: (c: CardDetail) => void }) {
  const [tab, setTab] = useState<'packs' | 'recolor'>('packs')
  const [open, setOpen] = useState(false)
  return (
    <section style={{ marginTop: 20 }}>
      <div className="row between">
        <h3 style={{ margin: 0 }}>Pembangun karakter</h3>
        <button onClick={() => setOpen((o) => !o)}>{open ? 'Tutup' : 'Buka (prompt duduk, dialog, aksi)'}</button>
      </div>
      {open && (
        <div style={{ marginTop: 8 }}>
          <div className="row" style={{ gap: 6, marginBottom: 8 }}>
            <button className={tab === 'packs' ? 'primary' : ''} onClick={() => setTab('packs')}>Paket gerak</button>
            <button className={tab === 'recolor' ? 'primary' : ''} onClick={() => setTab('recolor')}>Duplikat &amp; warna</button>
          </div>
          {tab === 'packs' ? <PacksTab card={card} onChanged={onChanged} /> : <RecolorTab card={card} />}
        </div>
      )}
    </section>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { BuilderStage } from '../builder/BuilderStage'
import { alphaInfo, canvasBlob, absUrl, renderCharacter, type AlphaInfo } from '../builder/render'
import { rotateItems, centerOf } from '../builder/selection'
import { EXPRESSIONS, PALETTE_LABELS, REQUIRED_SLOTS, SLOT_ANCHORS, STARTER_KEYS, VIEWS, drawOrder, emptyConfig, isFullCanvas, moveLayerZ, partBox, placement, type PartXform } from '../builder/spec'
import type { BuilderVersionInfo, CharacterConfig, LibAsset, LibCategory, Palette, SavedExpression } from '../builder/types'
import { AppNav } from '../components/AppNav'
import { SvgExportDialog } from '../components/SvgExportDialog'

// swatches from the sheet's colour panel (master-assets/assets-v1/palette.json)
const SWATCHES: Record<'hair' | 'skin' | 'eye' | 'cloth', string[]> = {
  hair: ['#393635', '#5f4c42', '#876654', '#816f63', '#6f747c', '#756675', '#a9a4a4'],
  skin: ['#fcdbc2', '#fad1b5', '#d9a88b', '#977865'],
  eye: ['#376287', '#5aa0a2', '#734e37', '#a87a5a', '#9ba7b6', '#707b87', '#b6afaf'],
  cloth: ['#64a2db', '#e35e5c', '#208058', '#accf78', '#fbd732', '#5e6ba9', '#4d5991', '#4d525d', '#967563'],
}
const swatchGroup = (slot: string): keyof typeof SWATCHES => (slot.startsWith('hair') ? 'hair' : ['face', 'torso', 'arm_l', 'arm_r', 'body'].includes(slot) ? 'skin' : slot === 'eyes' ? 'eye' : 'cloth')
const lumOf = (hex: string) => { const n = parseInt(hex.slice(1), 16); return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) }
const DEFAULT_SPLIT = 326
const SPLIT_SLOTS = ['hair_front', 'hijab']
const CHECKER = 'repeating-conic-gradient(#2b2f3a 0 25%, #20232c 0 50%) 0 0 / 16px 16px'

/** A tile showing an asset zoomed to the region where its slot lives (parts are drawn on the full 400x800 canvas). */
function SlotTile({ a, slot, size = 76 }: { a: LibAsset; slot: string; size?: number }) {
  const an = SLOT_ANCHORS[slot]
  if (!an || !isFullCanvas(a)) return <img src={absUrl(a.url)} alt={a.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} loading="lazy" />
  const k = size / Math.max(an.maxW * 1.15, 110)
  return <img src={absUrl(a.url)} alt={a.name} loading="lazy" draggable={false} style={{ position: 'absolute', width: 400 * k, height: 800 * k, left: size / 2 - an.cx * k, top: size / 2 - an.cy * k, maxWidth: 'none' }} />
}

export function BuilderPage() {
  const { id } = useParams()
  const nav = useNavigate()
  const isNew = id === 'new'

  const [cats, setCats] = useState<LibCategory[]>([])
  const [svgOpen, setSvgOpen] = useState(false)
  const [lib, setLib] = useState<LibAsset[]>([])
  const [bgs, setBgs] = useState<LibAsset[]>([])
  const [byId, setById] = useState<Record<number, LibAsset>>({})
  const [name, setName] = useState('Karakter baru')
  const [charId, setCharId] = useState<number | null>(isNew ? null : Number(id))
  const [versions, setVersions] = useState<BuilderVersionInfo[]>([])
  const [viewing, setViewing] = useState<number | null>(null)
  const [slot, setSlot] = useState('face')
  /** every selected part (multi-select); `slot` is the primary one the panels edit */
  const [selected, setSelected] = useState<string[]>(['face'])
  const [bg, setBg] = useState<number | ''>('')
  const [infos, setInfos] = useState<Record<number, AlphaInfo>>({})
  const [ready, setReady] = useState(false)
  /** bumps when a character/version is LOADED (not when it is saved): the stage refits only then */
  const [loadTick, setLoadTick] = useState(0)
  const loadedFor = useRef<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')

  // working copy + undo/redo
  const [hist, setHist] = useState<{ past: CharacterConfig[]; cur: CharacterConfig; future: CharacterConfig[] }>({ past: [], cur: emptyConfig(), future: [] })
  const lastKey = useRef<{ k: string; t: number } | null>(null)
  const config = hist.cur

  const commit = useCallback((fn: (c: CharacterConfig) => CharacterConfig, key?: string) => {
    // drags/sliders become ONE undo step. Decided here, not inside the updater: React (StrictMode) may run an updater twice,
    // and a side effect in it made the first change of every gesture vanish from the history.
    const now = Date.now()
    const merge = !!key && lastKey.current?.k === key && now - lastKey.current.t < 700
    lastKey.current = key ? { k: key, t: now } : null
    setHist((h) => ({ past: merge ? h.past : [...h.past.slice(-99), h.cur], cur: fn(h.cur), future: [] }))
    setDirty(true)
  }, [])
  const undo = () => setHist((h) => (h.past.length ? { past: h.past.slice(0, -1), cur: h.past[h.past.length - 1], future: [h.cur, ...h.future] } : h))
  const redo = () => setHist((h) => (h.future.length ? { past: [...h.past, h.cur], cur: h.future[0], future: h.future.slice(1) } : h))

  const zOf = useMemo(() => { const m = Object.fromEntries(cats.map((c) => [c.slug, c.z_order])); return (s: string) => m[s] ?? 0 }, [cats])
  const slots = useMemo(() => cats.filter((c) => c.kind === 'part').sort((a, b) => a.sort - b.sort), [cats])
  const byKey = useMemo(() => Object.fromEntries(lib.filter((a) => a.key).map((a) => [a.key!, a])), [lib])

  // ---- load library + character
  useEffect(() => {
    document.title = 'Character Builder — Cartoon Maker AI'
    if (loadedFor.current === id) return // already showing this character (e.g. right after the first save)
    let dead = false
    ;(async () => {
      try {
        const [c, parts, backgrounds] = await Promise.all([api.libCategories(), api.libAssets({ kind: 'part' }), api.libAssets({ kind: 'background' })])
        if (dead) return
        setCats(c); setLib(parts); setBgs(backgrounds)
        const map: Record<number, LibAsset> = {}
        parts.concat(backgrounds).forEach((a) => (map[a.id] = a))
        if (isNew) {
          const cfg = emptyConfig()
          for (const k of STARTER_KEYS) { const a = parts.find((p) => p.key === k); if (a) cfg.parts[a.category] = { assetId: a.id, dx: 0, dy: 0, scale: 1 } }
          setById(map)
          setHist({ past: [], cur: cfg, future: [] })
        } else {
          const d = await api.builderGet(Number(id))
          if (dead) return
          Object.values(d.assets).forEach((a) => (map[a.id] = a))
          setById(map); setName(d.name); setVersions(d.versions); setViewing(d.viewing)
          if (d.config) setHist({ past: [], cur: d.config, future: [] })
        }
        loadedFor.current = id ?? null
        setLoadTick((n) => n + 1)
        setReady(true)
      } catch (e) { if (!dead) setError((e as Error).message) }
    })()
    return () => { dead = true }
  }, [id, isNew])

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault() }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  // alpha boxes/masks of the parts in use (for the selection box and click-to-select)
  useEffect(() => {
    if (!ready) return
    let dead = false
    for (const p of Object.values(config.parts)) {
      const a = byId[p.assetId]
      if (a && !infos[a.id]) alphaInfo(a).then((i) => { if (!dead) setInfos((m) => (m[a.id] ? m : { ...m, [a.id]: i })) }).catch(() => {})
    }
    return () => { dead = true }
  }, [config.parts, byId, ready, infos])

  // drop selections of parts that no longer exist (removed or replaced slot)
  useEffect(() => {
    if (!ready) return // before the character is loaded `parts` is empty: pruning then would clear the initial selection
    setSelected((s) => (s.every((x) => config.parts[x]) ? s : s.filter((x) => config.parts[x])))
  }, [config.parts, ready])
  // after a character/version is loaded the primary part is selected
  useEffect(() => {
    if (ready && loadTick > 0) setSelected(config.parts[slot] ? [slot] : Object.keys(config.parts).slice(0, 1))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadTick, ready])

  const select = useCallback((slots: string[], primary: string | null) => { setSelected(slots); if (primary) setSlot(primary) }, [])
  const applyXforms = useCallback((updates: Record<string, PartXform>, key: string) => commit((c) => {
    const parts = { ...c.parts }
    for (const [s, t] of Object.entries(updates)) {
      if (!parts[s]) continue
      const { rot, ...rest } = t
      const p = { ...parts[s], ...rest }
      if (rot !== undefined) { if (Math.abs(rot) < 0.01) delete p.rot; else p.rot = rot } // rotation 0 = no rotation stored
      parts[s] = p
    }
    return { ...c, parts }
  }, key), [commit])

  // ---- actions
  const choose = (a: LibAsset | null) => {
    commit((c) => {
      const parts = { ...c.parts }
      // poses whose arms cross or rest ON the clothes (tag di-depan-baju) go in front of the top automatically
      if (a) parts[a.category] = { assetId: a.id, dx: 0, dy: 0, scale: 1, ...(a.tags.includes('di-depan-baju') ? { z: zOf('top') + 0.5 } : {}) }
      else delete parts[slot]
      return { ...c, parts }
    })
    // long hair hangs over the shirt: put the part below the shoulders behind the clothes automatically
    if (a && (a.category === 'hair_front') && isFullCanvas(a)) {
      alphaInfo(a).then((info) => {
        const pl = placement(a.category, a, { dx: 0, dy: 0, scale: 1 })
        if (partBox(pl, info.frac).y1 > 390) {
          commit((c) => (c.parts[a.category]?.assetId === a.id ? { ...c, parts: { ...c.parts, [a.category]: { ...c.parts[a.category], split: DEFAULT_SPLIT } } } : c))
          setNote('Rambut panjang: bagian di bawah bahu otomatis diletakkan di balik baju. Atur atau matikan di panel “Lapisan”.')
        }
      }).catch(() => {})
    }
  }
  const setLayer = (s: string, patch: { z?: number | null; split?: number | null }, key?: string) => commit((c) => {
    if (!c.parts[s]) return c
    const p = { ...c.parts[s] }
    for (const [k, v] of Object.entries(patch) as ['z' | 'split', number | null][]) { if (v === null) delete p[k]; else p[k] = v }
    return { ...c, parts: { ...c.parts, [s]: p } }
  }, key)
  /** Recolour a raster part (see PartRef.tint). null removes a field. */
  const setTint = (s: string, patch: { tint?: string | null; tintAmount?: number | null; brightness?: number | null }, key?: string) => commit((c) => {
    if (!c.parts[s]) return c
    const p = { ...c.parts[s] }
    for (const [k, v] of Object.entries(patch) as ['tint' | 'tintAmount' | 'brightness', string | number | null][]) { if (v === null) delete p[k]; else (p as Record<string, unknown>)[k] = v }
    return { ...c, parts: { ...c.parts, [s]: p } }
  }, key)
  const moveLayer = (s: string, dir: 1 | -1) => { const z = moveLayerZ(config, s, dir, zOf); if (z !== null) setLayer(s, { z }) }
  const setPart = (patch: Partial<{ dx: number; dy: number; scale: number }>, key: string) => commit((c) => (c.parts[slot] ? { ...c, parts: { ...c.parts, [slot]: { ...c.parts[slot], ...patch } } } : c), key)
  const setColor = (k: keyof Palette, v: string) => commit((c) => ({ ...c, palette: { ...c.palette, [k]: v } }), 'pal-' + k)
  const expression = (keys: Record<'eyes' | 'brows' | 'mouth', string>) => commit((c) => {
    const parts = { ...c.parts }
    for (const s of ['eyes', 'brows', 'mouth'] as const) { const a = byKey[keys[s]]; if (a) parts[s] = { assetId: a.id, dx: 0, dy: 0, scale: 1 } }
    return { ...c, parts }
  })

  /** keep the current eyes / brows / mouth (with their position and colour) as a named expression of this character */
  const saveExpression = () => {
    const name = (prompt('Nama ekspresi (mis. Marah, Sedih, Malu):', '') ?? '').trim().slice(0, 30)
    if (!name) return
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'ekspresi'
    const parts: SavedExpression['parts'] = {}
    for (const s of ['eyes', 'brows', 'mouth'] as const) if (config.parts[s]) { const { hash: _h, ...p } = config.parts[s]; parts[s] = p }
    if (Object.keys(parts).length === 0) return setError('Pasang mata, alis, atau mulut dulu.')
    if ((config.expressions ?? []).filter((e) => e.id !== id).length >= 12) return setError('Maksimal 12 ekspresi per karakter.')
    commit((c) => ({ ...c, expressions: [...(c.expressions ?? []).filter((e) => e.id !== id), { id, name, parts }] }))
  }
  const applySaved = (e: SavedExpression) => commit((c) => ({ ...c, parts: { ...c.parts, ...Object.fromEntries(Object.entries(e.parts).map(([k, p]) => [k, { ...p! }])) } }))
  const dropSaved = (id: string) => commit((c) => ({ ...c, expressions: (c.expressions ?? []).filter((e) => e.id !== id) }))

  async function save() {
    setBusy(true); setError(''); setNote('')
    try {
      const cv = await renderCharacter(config, byId, { scale: 0.6, zOf, transparent: true })
      const thumb = await canvasBlob(cv)
      const noteTxt = (prompt('Catatan versi (opsional):', '') ?? '').slice(0, 200)
      const d = await api.builderSave(charId, { name: charId ? undefined : name.trim() || 'Karakter', config, note: noteTxt || undefined }, thumb)
      if (charId && name.trim()) await api.builderRename(charId, name.trim())
      loadedFor.current = String(d.id)
      setCharId(d.id); setVersions(d.versions); setViewing(d.viewing); setDirty(false)
      setNote(`Tersimpan sebagai versi ${d.viewing}.`)
      if (!charId) nav(`/builder/${d.id}`, { replace: true })
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  async function openVersion(n: number) {
    if (dirty && !confirm('Perubahan yang belum disimpan akan hilang. Lanjutkan?')) return
    try {
      const d = await api.builderGet(charId!, n)
      setById((m) => { const x = { ...m }; Object.values(d.assets).forEach((a) => (x[a.id] = a)); return x })
      if (d.config) setHist({ past: [], cur: d.config, future: [] })
      setViewing(d.viewing); setDirty(false); setLoadTick((n) => n + 1)
      setNote(`Membuka versi ${n}. Menyimpan akan membuat versi baru; versi ${n} tidak berubah.`)
    } catch (e) { setError((e as Error).message) }
  }

  async function exportPng(transparent = true) {
    try {
      const cv = await renderCharacter(config, byId, { scale: 2.5, zOf, transparent, background: '#ffffff' })
      download(await canvasBlob(cv), `${name || 'karakter'}-${config.view}.png`)
    } catch (e) { setError((e as Error).message) }
  }

  function exportJson() {
    const doc = {
      format: 'cartoon-maker.character', name, version: viewing, config,
      assets: Object.fromEntries(Object.values(config.parts).map((p) => [p.assetId, { key: byId[p.assetId]?.key ?? null, name: byId[p.assetId]?.name, hash: byId[p.assetId]?.hash }])),
    }
    download(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }), `${name || 'karakter'}.json`)
  }

  if (error && !ready) return <div className="page"><div className="card" style={{ margin: 24 }}><div className="error" role="alert">{error}</div><Link to="/builder">Kembali</Link></div></div>

  const slotAssets = lib.filter((a) => a.category === slot)
  const cur = config.parts[slot]
  const required = (REQUIRED_SLOTS as readonly string[]).includes(slot)

  return (
    <div style={{ display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr)', height: '100vh' }}>
      <header className="topbar" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '8px 16px', borderBottom: '1px solid var(--border)', background: 'var(--panel)' }}>
        <Link to="/builder" style={{ color: 'inherit' }}>← Karakter</Link>
        <AppNav />
        <input value={name} onChange={(e) => { setName(e.target.value); setDirty(true) }} maxLength={120} aria-label="Nama karakter" style={{ width: 200 }} />
        {viewing && <span className="badge">v{viewing}{dirty ? ' • diubah' : ''}</span>}
        <span className="spacer" />
        <button onClick={undo} disabled={!hist.past.length} aria-label="Undo" title="Undo">↶</button>
        <button onClick={redo} disabled={!hist.future.length} aria-label="Redo" title="Redo">↷</button>
        <button onClick={() => void exportPng(true)}>PNG transparan</button>
        <button onClick={() => setSvgOpen(true)} disabled={!ready || Object.keys(config.parts).length === 0} title="Ekspor vektor: SVG berlapis (satu layer per bagian) untuk Inkscape, Illustrator, Figma">SVG (vektor)</button>
        <button onClick={exportJson}>JSON</button>
        <button className="primary" disabled={busy || !ready} onClick={() => void save()}>{busy ? 'Menyimpan…' : 'Simpan versi'}</button>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '300px minmax(0, 1fr) 300px', minHeight: 0 }}>
        {/* slots + assets */}
        <aside data-panel="slots" style={{ display: 'grid', gridTemplateRows: 'auto 1fr', gap: 8, padding: 10, overflow: 'hidden', minHeight: 0, background: 'var(--panel)', borderRight: '1px solid var(--border)' }}>
          <div className="row" style={{ gap: 4 }}>
            {slots.map((s) => (
              <button key={s.slug} onClick={() => setSlot(s.slug)} className={slot === s.slug ? 'primary' : ''} style={{ padding: '3px 8px', fontSize: 12, outline: config.parts[s.slug] ? 'none' : undefined, opacity: config.parts[s.slug] || slot === s.slug ? 1 : 0.65 }} aria-pressed={slot === s.slug}>
                {s.name}
              </button>
            ))}
          </div>
          <div style={{ overflow: 'auto' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {!required && (
                <button onClick={() => choose(null)} style={{ aspectRatio: '1', padding: 0 }} aria-pressed={!cur} title="Tanpa bagian ini">∅ Kosong</button>
              )}
              {slotAssets.map((a) => (
                <button key={a.id} onClick={() => choose(a)} title={a.name} aria-pressed={cur?.assetId === a.id}
                  style={{ position: 'relative', aspectRatio: '1', padding: 0, overflow: 'hidden', background: CHECKER, outline: cur?.assetId === a.id ? '2px solid var(--accent)' : 'none' }}>
                  <SlotTile a={a} slot={slot} />
                </button>
              ))}
            </div>
            {slotAssets.length === 0 && <p className="muted small">Belum ada aset di kategori ini.</p>}
            <p className="small" style={{ marginTop: 12 }}><Link to="/library">+ Tambah aset (unggah / AI)</Link></p>
          </div>
        </aside>

        {/* preview */}
        <main style={{ position: 'relative', minHeight: 0, minWidth: 0, overflow: 'hidden', background: CHECKER }}>
          <BuilderStage config={config} assets={byId} infos={infos} zOf={zOf} ready={ready} selected={selected} primary={slot} splitY={config.parts[slot]?.split}
            backdrop={bg ? byId[bg] : null} resetKey={loadTick} onSelect={select} onChange={applyXforms} onError={setError} />
          {!ready && <div className="muted" style={{ position: 'absolute', left: '50%', top: '50%' }}>Memuat…</div>}
          <div style={{ position: 'absolute', right: 12, top: 12 }}>
            <select value={bg} onChange={(e) => setBg(e.target.value === '' ? '' : Number(e.target.value))} aria-label="Latar pratinjau" style={{ width: 'auto' }}>
              <option value="">Latar: transparan</option>
              {bgs.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          {(error || note) && <div className={error ? 'banner' : 'toast'} role={error ? 'alert' : 'status'} style={{ position: 'absolute', top: 8, bottom: 'auto' }}>{error || note}</div>}
        </main>

        {/* properties */}
        <aside style={{ display: 'grid', gap: 14, alignContent: 'start', padding: 12, overflow: 'auto', minHeight: 0, background: 'var(--panel)', borderLeft: '1px solid var(--border)' }}>
          <section>
            <h3 style={{ margin: '0 0 6px' }}>Tampilan</h3>
            <div className="row">
              {(['half', 'full'] as const).map((v) => (
                <button key={v} className={config.view === v ? 'primary' : ''} onClick={() => commit((c) => ({ ...c, view: v }))} aria-pressed={config.view === v}>{VIEWS[v].label}</button>
              ))}
            </div>
            <p className="muted small">Kedua tampilan memakai aset yang sama; beda hanya pemotongan kanvas.</p>
          </section>

          <section>
            <h3 style={{ margin: '0 0 6px' }}>Ekspresi</h3>
            <div className="row" style={{ gap: 4 }}>
              {EXPRESSIONS.map((e) => <button key={e.id} onClick={() => expression(e.keys)} disabled={!byKey[e.keys.eyes]}>{e.label}</button>)}
            </div>
            <h4 style={{ margin: '10px 0 4px' }} className="small">Ekspresi karakter ini</h4>
            <p className="muted small" style={{ margin: '0 0 6px' }}>Atur mata, alis, dan mulut, lalu simpan sebagai ekspresi. Saat karakter disisipkan ke scene dengan bone, Anda bisa berganti ekspresi di timeline.</p>
            <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
              {(config.expressions ?? []).map((e) => (
                <span key={e.id} className="row" style={{ gap: 0 }}>
                  <button onClick={() => applySaved(e)} title={`Pasang ekspresi ${e.name}`}>{e.name}</button>
                  <button onClick={() => dropSaved(e.id)} aria-label={`Hapus ekspresi ${e.name}`} title="Hapus">×</button>
                </span>
              ))}
              <button className="primary" onClick={saveExpression}>+ Simpan ekspresi saat ini</button>
            </div>
          </section>

          <section>
            <h3 style={{ margin: '0 0 6px' }}>Warna</h3>
            {(Object.keys(PALETTE_LABELS) as (keyof Palette)[]).map((k) => (
              <label key={k} className="row between" style={{ marginBottom: 4 }}>
                <span className="small">{PALETTE_LABELS[k]}</span>
                <input type="color" value={config.palette[k]} onChange={(e) => setColor(k, e.target.value)} style={{ width: 44, height: 26, padding: 0 }} aria-label={`Warna ${PALETTE_LABELS[k]}`} />
              </label>
            ))}
          </section>

          <section>
            <h3 style={{ margin: '0 0 6px' }}>Posisi: {slots.find((s) => s.slug === slot)?.name}</h3>
            {cur ? (
              <>
                {([['dx', 'Geser X', -120, 120, 1], ['dy', 'Geser Y', -120, 120, 1], ['scale', 'Skala', 0.5, 2, 0.01]] as const).map(([k, label, lo, hi, step]) => (
                  <label key={k} className="field">
                    <span>{label}: {cur[k]}</span>
                    <input type="range" min={lo} max={hi} step={step} value={cur[k]} onChange={(e) => setPart({ [k]: +e.target.value }, `part-${slot}-${k}`)} />
                  </label>
                ))}
                <label className="field">
                  <span>Putar: {Math.round(cur.rot ?? 0)}°</span>
                  <input type="range" min={-180} max={180} step={1} value={cur.rot ?? 0} aria-label="Putar bagian" onChange={(e) => {
                    const a = byId[cur.assetId], info = infos[cur.assetId]
                    if (!a || !info) return
                    const pl = placement(slot, a, cur)
                    const it = { slot, pl, frac: info.frac }
                    applyXforms(rotateItems([it], +e.target.value - (cur.rot ?? 0), centerOf(partBox(pl, info.frac))), `rot-${slot}`) // about its own centre
                  }} />
                </label>
                <button onClick={() => commit((c) => { const p = { ...c.parts[slot], dx: 0, dy: 0, scale: 1 }; delete p.rot; return { ...c, parts: { ...c.parts, [slot]: p } } })}>Reset posisi</button>
              </>
            ) : <p className="muted small">Pilih sebuah aset untuk bagian ini.</p>}
          </section>

          {cur && byId[cur.assetId] && (
            <section>
              <h3 style={{ margin: '0 0 6px' }}>Warna bagian: {slots.find((s) => s.slug === slot)?.name}</h3>
              {byId[cur.assetId].tintable ? (
                <p className="muted small" style={{ margin: 0 }}>Bagian ini berupa SVG dengan area warna bertanda: warnanya mengikuti palet <strong>Warna</strong> di atas. (Aksen = kacamata, topi, tas, headphone.)</p>
              ) : (
                <>
                  <p className="muted small" style={{ margin: '0 0 6px' }}>Gambar PNG tidak punya area warna bertanda, jadi diwarnai di sini: warna menggantikan rona aslinya, bayangan dan garis tetap.</p>
                  <div className="row" style={{ gap: 4, marginBottom: 6 }} aria-label="Contoh warna">
                    {SWATCHES[swatchGroup(slot)].map((c) => (
                      <button key={c} aria-label={`Warna ${c}`} title={c} onClick={() => setTint(slot, { tint: c, tintAmount: 1, brightness: Math.round(Math.min(2.5, Math.max(0.6, lumOf(c) / Math.max(20, infos[cur.assetId]?.lum ?? 128))) * 100) / 100 })}
                        style={{ width: 24, height: 24, padding: 0, background: c, outline: cur.tint === c ? '2px solid var(--accent)' : 'none' }} />
                    ))}
                  </div>
                  <label className="row between" style={{ marginBottom: 4 }}>
                    <span className="small">Warna pilihan</span>
                    <input type="color" value={cur.tint ?? '#888888'} onChange={(e) => setTint(slot, { tint: e.target.value, tintAmount: cur.tintAmount ?? 1 }, `tint-${slot}`)} style={{ width: 44, height: 26, padding: 0 }} aria-label="Warna pilihan bagian" />
                  </label>
                  <label className="field"><span>Kekuatan warna: {Math.round((cur.tintAmount ?? 1) * 100)}%</span>
                    <input type="range" min={0} max={1} step={0.05} value={cur.tintAmount ?? 1} disabled={!cur.tint} onChange={(e) => setTint(slot, { tintAmount: +e.target.value }, `tint-amt-${slot}`)} aria-label="Kekuatan warna" /></label>
                  <label className="field"><span>Kecerahan: {Math.round((cur.brightness ?? 1) * 100)}%</span>
                    <input type="range" min={0.4} max={2.5} step={0.05} value={cur.brightness ?? 1} onChange={(e) => setTint(slot, { brightness: +e.target.value }, `bright-${slot}`)} aria-label="Kecerahan" /></label>
                  {(cur.tint !== undefined || cur.brightness !== undefined) && <button onClick={() => setTint(slot, { tint: null, tintAmount: null, brightness: null })}>Kembalikan warna asli</button>}
                </>
              )}
            </section>
          )}

          <section>
            <h3 style={{ margin: '0 0 6px' }}>Lapisan</h3>
            <p className="muted small" style={{ margin: '0 0 6px' }}>Urutan tumpukan (atas = paling depan). Klik nama untuk memilih (Shift/Ctrl+klik = pilih banyak); ▲▼ memajukan/memundurkan satu lapis.</p>
            <ol className="plain" style={{ margin: 0, padding: 0, listStyle: 'none', maxHeight: 210, overflow: 'auto' }} aria-label="Urutan lapisan">
              {[...drawOrder(config, zOf)].reverse().map((s) => (
                <li key={s} className="row between" style={{ padding: '1px 4px', borderRadius: 4, background: selected.includes(s) ? 'var(--panel2)' : 'transparent', outline: s === slot ? '1px solid var(--accent)' : 'none' }}>
                  <button className="link" onClick={(e) => { if (e.shiftKey || e.ctrlKey || e.metaKey) { const next = selected.includes(s) ? selected.filter((x) => x !== s) : [...selected, s]; select(next, next.includes(s) ? s : (next[next.length - 1] ?? null)) } else select([s], s) }} aria-pressed={selected.includes(s)} style={{ textAlign: 'left', fontWeight: selected.includes(s) ? 700 : 400 }}>
                    {cats.find((c) => c.slug === s)?.name ?? s}{config.parts[s]?.z !== undefined ? ' •' : ''}{typeof config.parts[s]?.split === 'number' ? ' ✂' : ''}
                  </button>
                  <span className="row" style={{ gap: 2 }}>
                    <button aria-label={`Majukan ${s}`} onClick={() => moveLayer(s, 1)} style={{ padding: '0 6px' }}>▲</button>
                    <button aria-label={`Mundurkan ${s}`} onClick={() => moveLayer(s, -1)} style={{ padding: '0 6px' }}>▼</button>
                  </span>
                </li>
              ))}
            </ol>
            {cur && config.parts[slot]?.z !== undefined && <button style={{ marginTop: 6 }} onClick={() => setLayer(slot, { z: null })}>Kembalikan urutan bawaan ({cats.find((c) => c.slug === slot)?.name})</button>}
            {cur && SPLIT_SLOTS.includes(slot) && (
              <div style={{ marginTop: 8 }}>
                <label className="inline" title="Bagian di bawah garis potong ditaruh di BALIK baju dan badan; bagian di atasnya tetap di depan. Baju jadi seolah masuk di antara dua lapis.">
                  <input type="checkbox" checked={typeof config.parts[slot]?.split === 'number'} onChange={(e) => setLayer(slot, { split: e.target.checked ? DEFAULT_SPLIT : null })} /> Bagian bawah di balik baju
                </label>
                {typeof config.parts[slot]?.split === 'number' && (
                  <label className="field" style={{ marginTop: 4 }}>
                    <span>Garis potong: y = {config.parts[slot]!.split}</span>
                    <input type="range" min={250} max={520} value={config.parts[slot]!.split} onChange={(e) => setLayer(slot, { split: +e.target.value }, `split-${slot}`)} aria-label="Garis potong" />
                  </label>
                )}
              </div>
            )}
          </section>

          {versions.length > 0 && (
            <section>
              <h3 style={{ margin: '0 0 6px' }}>Versi</h3>
              <ul className="plain" style={{ maxHeight: 180, overflow: 'auto' }}>
                {versions.map((v) => (
                  <li key={v.number} className="row between">
                    <button className="link" onClick={() => void openVersion(v.number)} aria-pressed={viewing === v.number}>v{v.number}{v.note ? ` — ${v.note}` : ''}</button>
                    <span className="muted small">{new Date(v.created_at).toLocaleDateString()}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
      {svgOpen && <SvgExportDialog config={config} assets={byId} zOf={zOf} labels={Object.fromEntries(cats.map((c) => [c.slug, c.name]))} name={name} onClose={() => setSvgOpen(false)} />}
    </div>
  )
}

function download(blob: Blob, filename: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename.replace(/[\\/:*?"<>|]+/g, '_')
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

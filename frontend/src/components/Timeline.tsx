import { useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { ANIM_PROPS, EASES, flatten, removeSwap, totalFrames } from '../anim'
import { camKeyFrames } from '../camera'
import { useEditor } from '../store'
import type { AnimProp, Ease, Layer } from '../types'

const LABEL_W = 150

export function Timeline({ onPresets }: { onPresets: () => void }) {
  const s = useEditor()
  const [ppf, setPpf] = useState(10)
  const [selSwap, setSelSwap] = useState<{ layerId: string; f: number } | null>(null)
  const drag = useRef<{ layerId: string; prop: AnimProp; f: number; startX: number; startF: number } | null>(null)
  const doc = s.doc!
  const total = totalFrames(doc)
  const fps = doc.settings.fps
  const trackW = (total + 1) * ppf

  const frameFromEvent = (e: { clientX: number }, el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    return Math.max(0, Math.min(total, Math.round((e.clientX - r.left) / ppf)))
  }

  function scrub(e: RPointerEvent<HTMLElement>) {
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    s.setPlaying(false)
    s.setFrame(frameFromEvent(e, el))
    el.onpointermove = (ev) => s.setFrame(frameFromEvent(ev, el))
    el.onpointerup = () => {
      el.onpointermove = null
      el.onpointerup = null
    }
  }

  function keyDown(e: RPointerEvent<HTMLElement>, layerId: string, prop: AnimProp, f: number) {
    e.stopPropagation()
    s.setPlaying(false)
    s.select(layerId)
    s.selectKey({ layerId, prop, f })
    s.setFrame(f)
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    drag.current = { layerId, prop, f, startX: e.clientX, startF: f }
  }
  function keyMove(e: RPointerEvent<HTMLElement>) {
    const d = drag.current
    if (!d) return
    const to = Math.max(0, Math.min(total, d.startF + Math.round((e.clientX - d.startX) / ppf)))
    if (to !== d.f) {
      s.moveKey(d.layerId, d.prop, d.f, to)
      d.f = to
      s.setFrame(to)
    }
  }

  const sel = s.selKey
  const selEase: Ease | undefined = sel
    ? doc.layers.find((l) => l.id === sel.layerId)?.keyframes?.[sel.prop]?.find((k) => k.f === sel.f)?.e
    : undefined

  const diamond = (layerId: string, prop: AnimProp, f: number, interactive: boolean) => {
    const on = sel && sel.layerId === layerId && sel.prop === prop && sel.f === f
    return (
      <i
        key={`${prop}${f}`}
        className={`kf ${on ? 'on' : ''}`}
        style={{ left: f * ppf - 5 }}
        title={`Frame ${f}`}
        onPointerDown={interactive ? (e) => keyDown(e, layerId, prop, f) : undefined}
        onPointerMove={interactive ? keyMove : undefined}
        onPointerUp={interactive ? () => (drag.current = null) : undefined}
      />
    )
  }

  const unionFrames = (l: Layer) => [...new Set([...Object.values(l.keyframes ?? {}).flatMap((ks) => ks!.map((k) => k.f)), ...(l.swaps ?? []).map((k) => k.f)])]
  const camFrames = camKeyFrames(doc.camera)
  const subs = doc.subtitles ?? []

  return (
    <div className="tl">
      <div className="tl-bar">
        <button onClick={() => { s.setPlaying(false); s.setFrame(0) }} title="Ke awal">⏮</button>
        <button className="primary" onClick={() => { if (!s.playing && s.frame >= total) s.setFrame(0); s.setPlaying(!s.playing) }} title="Play / Pause (Spasi)">
          {s.playing ? '⏸' : '▶'}
        </button>
        <label className="inline">Frame
          <input type="number" min={0} max={total} value={Math.round(s.frame)} onChange={(e) => { s.setPlaying(false); s.setFrame(e.target.valueAsNumber || 0) }} />
          <span className="muted">/ {total}</span>
        </label>
        <label className="inline">FPS
          <input type="number" min={1} max={60} value={fps} onChange={(e) => { const n = Math.round(e.target.valueAsNumber); if (n >= 1 && n <= 60) s.updateSettings({ fps: n }) }} />
        </label>
        <label className="inline">Durasi
          <input type="number" min={0.5} max={600} step={0.5} value={doc.settings.duration} onChange={(e) => { const n = e.target.valueAsNumber; if (n >= 0.5 && n <= 600) s.updateSettings({ duration: n }) }} />s
        </label>
        <label className="inline"><input type="checkbox" checked={s.autoKey} onChange={(e) => s.setAutoKey(e.target.checked)} /> Auto-key</label>
        <label className="inline"><input type="checkbox" checked={s.onion} onChange={(e) => s.setOnion(e.target.checked)} /> Onion skin</label>
        <button onClick={onPresets} title="Terapkan gerak siap pakai ke layer terpilih">Preset gerak…</button>
        <span className="spacer" />
        {selSwap && (
          <button className="danger" onClick={() => { s.edit((d) => { const l = d.layers.find((x) => x.id === selSwap.layerId); if (l) removeSwap(l, selSwap.f) }); setSelSwap(null) }}>Hapus ganti gambar (f{selSwap.f})</button>
        )}
        {sel && selEase && (
          <>
            <label className="inline">Easing
              <select value={selEase} onChange={(e) => s.setKeyEase(sel, e.target.value as Ease)}>
                {EASES.map((x) => <option key={x.v} value={x.v}>{x.label}</option>)}
              </select>
            </label>
            <button className="danger" onClick={() => s.deleteKey(sel)}>Hapus key</button>
          </>
        )}
        <label className="inline">Zoom <input type="range" min={3} max={30} value={ppf} onChange={(e) => setPpf(+e.target.value)} /></label>
      </div>

      <div className="tl-scroll">
        <div className="tl-inner" style={{ width: LABEL_W + trackW }}>
          <div className="tl-row ruler">
            <div className="tl-label" />
            <div className="tl-track" style={{ width: trackW }} onPointerDown={scrub}>
              {Array.from({ length: Math.floor(total / fps) + 1 }, (_, i) => (
                <span key={i} className="tick" style={{ left: i * fps * ppf }}>{i}s</span>
              ))}
            </div>
          </div>

          {camFrames.length > 0 && (
            <div className="tl-row">
              <div className="tl-label" title="Keyframe kamera (atur di Alat film → Kamera)">🎥 Kamera</div>
              <div className="tl-track" style={{ width: trackW }} onPointerDown={scrub}>
                {camFrames.map((f) => <i key={f} className="kf sum" style={{ left: f * ppf - 5 }} title={`Kamera frame ${f}`} onPointerDown={(e) => { e.stopPropagation(); s.setPlaying(false); s.setFrame(f) }} />)}
              </div>
            </div>
          )}
          {subs.length > 0 && (
            <div className="tl-row">
              <div className="tl-label" title="Subtitle (atur di Alat film → Teks)">💬 Subtitle</div>
              <div className="tl-track" style={{ width: trackW }} onPointerDown={scrub}>
                {subs.map((u) => (
                  <i key={u.id} title={u.text} style={{ position: 'absolute', top: 4, height: 14, left: u.start * fps * ppf, width: Math.max(6, (u.end - u.start) * fps * ppf), background: '#4f8cff88', border: '1px solid #4f8cff', borderRadius: 3, cursor: 'pointer' }}
                    onPointerDown={(e) => { e.stopPropagation(); s.setPlaying(false); s.setFrame(Math.round(u.start * fps)) }} />
                ))}
              </div>
            </div>
          )}

          {flatten(doc).map(({ layer: l, depth }) => {
            const open = l.id === s.selectedId
            return (
              <div key={l.id}>
                <div className={`tl-row ${open ? 'sel' : ''}`}>
                  <div className="tl-label" style={{ paddingLeft: 8 + depth * 12 }} onClick={() => s.select(l.id)}>{l.type === 'bone' ? '🦴 ' : ''}{l.name}</div>
                  <div className="tl-track" style={{ width: trackW }} onPointerDown={scrub}>
                    {unionFrames(l).map((f) => <i key={f} className="kf sum" style={{ left: f * ppf - 5 }} />)}
                  </div>
                </div>
                {open && (l.swaps?.length ?? 0) > 0 && (
                  <div className="tl-row sub">
                    <div className="tl-label sub">Gambar (ekspresi)</div>
                    <div className="tl-track" style={{ width: trackW }} onPointerDown={scrub}>
                      {l.swaps!.map((k) => (
                        <i key={k.f} className={`kf ${selSwap?.layerId === l.id && selSwap.f === k.f ? 'on' : ''}`} style={{ left: k.f * ppf - 5 }} title={`Ganti gambar di frame ${k.f}`}
                          onPointerDown={(e) => { e.stopPropagation(); s.setPlaying(false); s.setFrame(k.f); setSelSwap({ layerId: l.id, f: k.f }) }} />
                      ))}
                    </div>
                  </div>
                )}
                {open &&
                  ANIM_PROPS.map(({ prop, label }) => (
                    <div key={prop} className="tl-row sub">
                      <div className="tl-label sub">{label}</div>
                      <div className="tl-track" style={{ width: trackW }} onPointerDown={scrub}>
                        {l.keyframes?.[prop]?.map((k) => diamond(l.id, prop, k.f, true))}
                      </div>
                    </div>
                  ))}
              </div>
            )
          })}
          {doc.layers.length === 0 && <p className="muted small" style={{ padding: 8 }}>Tambahkan layer untuk mulai menganimasikan.</p>}
          <div className="playhead" style={{ left: LABEL_W + s.frame * ppf }} />
        </div>
      </div>
    </div>
  )
}

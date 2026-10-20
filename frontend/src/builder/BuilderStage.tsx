import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { PartOverlay } from './PartOverlay'
import { absUrl, renderCharacter, type AlphaInfo } from './render'
import { VIEWS, type PartXform } from './spec'
import type { CharacterConfig, LibAsset } from './types'
import { centerOn, clampPan, fitViewport, renderScale, stageOf, zoomAt, ZOOM_MAX, ZOOM_MIN, panBy, type Viewport } from './viewport'

interface Props {
  config: CharacterConfig
  assets: Record<number, LibAsset>
  infos: Record<number, AlphaInfo>
  zOf: (slot: string) => number
  ready: boolean
  selected: string[]
  primary: string
  splitY?: number
  /** scene location shown behind the character inside the export frame (preview only) */
  backdrop?: LibAsset | null
  /** changes when another character/version is loaded: the viewport is fitted again */
  resetKey: string | number
  onSelect: (slots: string[], primary: string | null) => void
  onChange: (updates: Record<string, PartXform>, key: string) => void
  onError: (message: string) => void
}

const CHECKER = 'repeating-conic-gradient(#2b2f3a 0 25%, #20232c 0 50%) 0 0 / 16px 16px'

/**
 * The work area: a stage bigger than the export frame (so parts moved outside it stay visible), shown through a
 * zoomable / pannable viewport that fills the whole centre panel. Wheel = zoom at the cursor, Space+drag / middle button /
 * hand tool = pan. The character itself is rendered by `renderCharacter` at a resolution that follows the zoom.
 */
export function BuilderStage({ config, assets, infos, zOf, ready, selected, primary, splitY, backdrop, resetKey, onSelect, onChange, onError }: Props) {
  const view = VIEWS[config.view]
  const stage = stageOf(view)
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [vp, setVp] = useState<Viewport>({ zoom: 1, ox: 0, oy: 0 })
  const [hand, setHand] = useState(false)
  const [space, setSpace] = useState(false)
  const fitted = useRef<string | null>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const token = useRef(0)
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1

  useLayoutEffect(() => {
    const el = box.current!
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  // fit once the container has a size, and again when another character/version or another view (half/full) is shown
  useEffect(() => {
    const sig = `${resetKey}|${config.view}|${size.w > 0}`
    if (size.w > 0 && fitted.current !== sig) { fitted.current = sig; setVp(fitViewport(size.w, size.h, stage, view)) }
  }, [size, resetKey, config.view, stage, view])

  const fit = useCallback(() => setVp(fitViewport(size.w, size.h, stage, view)), [size, stage, view])
  const actual = useCallback(() => setVp(centerOn(size.w, size.h, stage, view, 1)), [size, stage, view])
  const zoomBy = useCallback((f: number, cx = size.w / 2, cy = size.h / 2) => setVp((v) => clampPan(zoomAt(v, f, cx, cy), size.w, size.h, stage)), [size, stage])
  const pan = useCallback((dx: number, dy: number) => setVp((v) => clampPan(panBy(v, dx, dy), size.w, size.h, stage)), [size, stage])

  // wheel = zoom at the cursor (Shift+wheel is the overlay's: scale the selection)
  const latest = useRef({ zoomBy })
  latest.current = { zoomBy }
  useEffect(() => {
    const el = box.current!
    const h = (e: WheelEvent) => {
      if (e.shiftKey) return
      e.preventDefault()
      const r = el.getBoundingClientRect()
      latest.current.zoomBy(Math.exp(-Math.max(-300, Math.min(300, e.deltaY)) * 0.0015), e.clientX - r.left, e.clientY - r.top)
    }
    el.addEventListener('wheel', h, { passive: false })
    return () => el.removeEventListener('wheel', h)
  }, [])

  // Space held = pan tool (ignored while typing)
  useEffect(() => {
    const typing = (t: EventTarget | null) => t instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)
    const down = (e: KeyboardEvent) => { if (e.code === 'Space' && !typing(e.target)) { e.preventDefault(); setSpace(true) } }
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') setSpace(false) }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [])

  // render the stage; the bitmap resolution follows the zoom (quantised so a wheel burst does not re-render every tick)
  const rs = Math.round(renderScale(vp.zoom, dpr) * 4) / 4
  useEffect(() => {
    if (!ready) return
    const my = ++token.current
    renderCharacter(config, assets, { scale: rs, zOf, transparent: true, rect: stage }).then((cv) => {
      if (my !== token.current || !canvas.current) return
      canvas.current.width = cv.width
      canvas.current.height = cv.height
      canvas.current.getContext('2d')!.drawImage(cv, 0, 0)
    }).catch((e) => onError((e as Error).message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, assets, zOf, ready, rs, config.view])

  const w = stage.w * vp.zoom, h = stage.h * vp.zoom
  const btn = { padding: '2px 8px' } as const
  return (
    <div ref={box} style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: CHECKER }} data-testid="stage">
      <div style={{ position: 'absolute', left: vp.ox, top: vp.oy, width: w, height: h }}>
        {backdrop && (
          <img src={absUrl(backdrop.url)} alt="" draggable={false} style={{ position: 'absolute', left: (view.x - stage.x) * vp.zoom, top: (view.y - stage.y) * vp.zoom, width: view.w * vp.zoom, height: view.h * vp.zoom, objectFit: 'cover' }} />
        )}
        <canvas ref={canvas} aria-label="Pratinjau karakter" data-rect={`${stage.x},${stage.y},${stage.w},${stage.h}`} data-scale={rs} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }} />
        {ready && (
          <PartOverlay config={config} assets={assets} infos={infos} selected={selected} primary={primary} zOf={zOf} view={view} stage={stage} ppu={vp.zoom}
            splitY={splitY} panMode={hand || space} onSelect={onSelect} onChange={onChange} onPan={pan} />
        )}
      </div>

      <div className="row" style={{ position: 'absolute', left: 10, top: 10, gap: 4, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8, padding: 4 }} role="toolbar" aria-label="Zoom kanvas">
        <button style={btn} onClick={() => zoomBy(1 / 1.25)} aria-label="Perkecil tampilan" title="Perkecil (roda mouse ke bawah)" disabled={vp.zoom <= ZOOM_MIN}>−</button>
        <span className="small" style={{ minWidth: 44, textAlign: 'center' }} aria-label="Tingkat zoom">{Math.round(vp.zoom * 100)}%</span>
        <button style={btn} onClick={() => zoomBy(1.25)} aria-label="Perbesar tampilan" title="Perbesar (roda mouse ke atas)" disabled={vp.zoom >= ZOOM_MAX}>+</button>
        <button style={btn} onClick={fit} title="Tampilkan seluruh area ekspor">Pas</button>
        <button style={btn} onClick={actual} title="Ukuran asli (100%)">100%</button>
        <button style={btn} className={hand ? 'primary' : ''} aria-pressed={hand} onClick={() => setHand((v) => !v)} title="Alat geser kanvas (atau tahan Spasi / klik tombol tengah mouse)">✋</button>
      </div>
      <div className="small muted" style={{ position: 'absolute', left: 10, bottom: 10, background: 'color-mix(in srgb, var(--panel) 80%, transparent)', padding: '3px 8px', borderRadius: 6, pointerEvents: 'none' }}>
        Roda = zoom · Spasi+seret = geser kanvas · Shift+klik / seret kotak = pilih banyak · Shift+roda = ubah ukuran pilihan
      </div>
    </div>
  )
}

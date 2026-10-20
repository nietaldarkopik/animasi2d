import { useEffect, useRef, useState } from 'react'
import type { AlphaInfo } from './render'
import { boxesOf, centerOf, marqueeHits, moveItems, normBox, rotateItems, scaleItems, toggle, unionBox, type Item } from './selection'
import { hitsPart, normDeg, orientedCorners, placement, rotv, type Box, type PartXform } from './spec'
import type { CharacterConfig, LibAsset } from './types'
import type { Rect } from './viewport'

interface Props {
  config: CharacterConfig
  assets: Record<number, LibAsset>
  infos: Record<number, AlphaInfo>
  /** every selected slot; `primary` is the one the side panels edit */
  selected: string[]
  primary: string
  zOf: (slot: string) => number
  /** export frame and visible stage, in canvas units */
  view: Rect
  stage: Rect
  /** screen pixels per canvas unit (the current zoom) */
  ppu: number
  splitY?: number
  /** hand tool / Space held: dragging pans the canvas */
  panMode: boolean
  onSelect: (slots: string[], primary: string | null) => void
  /** key groups consecutive changes of one gesture into a single undo step */
  onChange: (updates: Record<string, PartXform>, key: string) => void
  onPan: (dx: number, dy: number) => void
}

type Drag =
  | { kind: 'pan'; x: number; y: number }
  | { kind: 'move'; start: { x: number; y: number }; items: Item[] }
  | { kind: 'resize'; center: { x: number; y: number }; startDist: number; items: Item[] }
  | { kind: 'rotate'; center: { x: number; y: number }; startAngle: number; items: Item[] }
  | { kind: 'marquee'; start: { x: number; y: number }; base: string[]; moved: boolean }

const HANDLE = 11 // px on screen
const ROT_OFFSET = 30 // px between the frame and the rotate handle
const angleOf = (c: { x: number; y: number }, p: { x: number; y: number }) => (Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI
const snap = (deg: number, step = 15) => Math.round(deg / step) * step

/**
 * Direct manipulation on top of the stage.
 *  - click a part to select it; Shift/Ctrl+click toggles it in the selection; drag on empty space for a rubber band
 *  - drag a selected part to move the WHOLE selection; drag a corner handle to resize the whole selection about its centre
 *  - the round handle above the frame rotates the selection (Shift = 15° steps); Alt+wheel and [ ] rotate it too
 *  - Shift+mouse wheel scales the selection, arrow keys nudge it (Shift = 5 units), + / - scale it, Ctrl+A selects all
 *  - middle button, Space+drag or the hand tool pan the canvas (the plain wheel zooms: handled by the stage)
 * Everything is expressed in character-canvas units through the SVG viewBox.
 */
export function PartOverlay({ config, assets, infos, selected, primary, zOf, view, stage, ppu, splitY, panMode, onSelect, onChange, onPan }: Props) {
  const svg = useRef<SVGSVGElement>(null)
  const drag = useRef<Drag | null>(null)
  const [cursor, setCursor] = useState('default')
  const [marquee, setMarquee] = useState<Box | null>(null)
  const [rotLabel, setRotLabel] = useState<string | null>(null)

  /** Item with a known visible box (alpha info loaded), by slot. */
  const itemOf = (slot: string): Item | null => {
    const part = config.parts[slot]
    const a = part && assets[part.assetId]
    const info = part && infos[part.assetId]
    return a && info ? { slot, pl: placement(slot, a, part), frac: info.frac } : null
  }
  const allItems = Object.keys(config.parts).map(itemOf).filter(Boolean) as Item[]
  const selItems = selected.map(itemOf).filter(Boolean) as Item[]
  const boxes = boxesOf(allItems)
  const group = unionBox(selItems.map((i) => boxes[i.slot]))
  // one part: a frame that turns with it; several: the axis-aligned frame around all of them
  const single = selItems.length === 1 ? selItems[0] : null
  const frame = single ? orientedCorners(single.pl, single.frac) : group ? [{ x: group.x0, y: group.y0 }, { x: group.x1, y: group.y0 }, { x: group.x1, y: group.y1 }, { x: group.x0, y: group.y1 }] : null
  const frameRot = single ? single.pl.rot : 0
  const rotHandle = frame ? (() => {
    const mid = { x: (frame[0].x + frame[1].x) / 2, y: (frame[0].y + frame[1].y) / 2 }
    const up = rotv(0, -1, frameRot)
    return { mid, p: { x: mid.x + (up.x * ROT_OFFSET) / ppu, y: mid.y + (up.y * ROT_OFFSET) / ppu } }
  })() : null

  const toUnits = (e: { clientX: number; clientY: number }) => {
    const r = svg.current!.getBoundingClientRect()
    return { x: stage.x + ((e.clientX - r.left) / r.width) * stage.w, y: stage.y + ((e.clientY - r.top) / r.height) * stage.h }
  }
  const topmostHit = (p: { x: number; y: number }): string | null => {
    const order = [...allItems].sort((a, b) => (config.parts[b.slot].z ?? zOf(b.slot)) - (config.parts[a.slot].z ?? zOf(a.slot)))
    for (const i of order) {
      const info = infos[config.parts[i.slot].assetId]
      if (info && hitsPart(i.pl, info.mask, p)) return i.slot
    }
    return null
  }
  const inside = (b: Box | null, p: { x: number; y: number }) => !!b && p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1

  function down(e: React.PointerEvent) {
    svg.current!.setPointerCapture(e.pointerId)
    svg.current!.parentElement?.focus()
    if (e.button === 1 || panMode) { e.preventDefault(); drag.current = { kind: 'pan', x: e.clientX, y: e.clientY }; setCursor('grabbing'); return }
    if (e.button !== 0) return
    const p = toUnits(e)
    const handle = (e.target as SVGElement).getAttribute?.('data-handle')
    if (handle && group && selItems.length) {
      const center = centerOf(group)
      if (handle === 'rot') drag.current = { kind: 'rotate', center, startAngle: angleOf(center, p), items: selItems }
      else drag.current = { kind: 'resize', center, startDist: Math.max(4, Math.hypot(p.x - center.x, p.y - center.y)), items: selItems }
      return
    }
    const mod = e.shiftKey || e.ctrlKey || e.metaKey
    const hit = topmostHit(p)
    if (hit) {
      if (mod) {
        const next = toggle(selected, hit)
        onSelect(next, next.includes(hit) ? hit : (next[next.length - 1] ?? null))
        const items = next.map(itemOf).filter(Boolean) as Item[]
        if (next.includes(hit)) drag.current = { kind: 'move', start: p, items }
      } else if (selected.includes(hit)) {
        drag.current = { kind: 'move', start: p, items: selItems } // dragging any selected part moves the whole selection
        if (hit !== primary) onSelect(selected, hit)
      } else {
        onSelect([hit], hit)
        const it = itemOf(hit)
        if (it) drag.current = { kind: 'move', start: p, items: [it] }
      }
      return
    }
    if (!mod && inside(group, p) && selItems.length) { drag.current = { kind: 'move', start: p, items: selItems }; return }
    drag.current = { kind: 'marquee', start: p, base: mod ? selected : [], moved: false }
    setMarquee(normBox(p.x, p.y, p.x, p.y))
  }

  function move(e: React.PointerEvent) {
    const d = drag.current
    if (!d) {
      const h = (e.target as SVGElement).getAttribute?.('data-handle')
      setCursor(panMode ? 'grab' : h === 'rot' ? 'crosshair' : h ? (h === 'nw' || h === 'se' ? 'nwse-resize' : 'nesw-resize') : topmostHit(toUnits(e)) ? 'move' : 'default')
      return
    }
    if (d.kind === 'pan') { onPan(e.clientX - d.x, e.clientY - d.y); d.x = e.clientX; d.y = e.clientY; return }
    const p = toUnits(e)
    if (d.kind === 'move') onChange(moveItems(d.items, p.x - d.start.x, p.y - d.start.y), 'drag-move')
    else if (d.kind === 'resize') onChange(scaleItems(d.items, Math.hypot(p.x - d.center.x, p.y - d.center.y) / d.startDist, d.center), 'drag-resize')
    else if (d.kind === 'rotate') {
      let delta = normDeg(angleOf(d.center, p) - d.startAngle)
      if (e.shiftKey) delta = d.items.length === 1 ? snap(d.items[0].pl.rot + delta) - d.items[0].pl.rot : snap(delta)
      setRotLabel(`${Math.round(d.items.length === 1 ? normDeg(d.items[0].pl.rot + delta) : delta)}°`)
      onChange(rotateItems(d.items, delta, d.center), 'drag-rotate')
    }
    else {
      d.moved = d.moved || Math.hypot(p.x - d.start.x, p.y - d.start.y) * ppu > 4
      setMarquee(normBox(d.start.x, d.start.y, p.x, p.y))
    }
  }

  function up(e: React.PointerEvent) {
    const d = drag.current
    drag.current = null
    setCursor(panMode ? 'grab' : 'default')
    setRotLabel(null)
    if (d?.kind !== 'marquee') return
    const p = toUnits(e)
    setMarquee(null)
    if (!d.moved) { if (!d.base.length) onSelect([], null); return } // a plain click on empty space clears the selection
    const hits = marqueeHits(allItems, normBox(d.start.x, d.start.y, p.x, p.y))
    const next = [...d.base, ...hits.filter((s) => !d.base.includes(s))]
    onSelect(next, next[next.length - 1] ?? null)
  }

  // Shift+wheel scales the selection; the plain wheel is left to the stage (zoom)
  const latest = useRef({ selItems, group, onChange })
  latest.current = { selItems, group, onChange }
  useEffect(() => {
    const el = svg.current
    if (!el) return
    const h = (e: WheelEvent) => {
      if (!e.shiftKey && !e.altKey) return
      const { selItems: its, group: g, onChange: change } = latest.current
      if (!its.length || !g) return
      e.preventDefault()
      e.stopPropagation()
      const dy = Math.max(-300, Math.min(300, e.deltaY || e.deltaX)) // some browsers turn Shift+wheel into horizontal scrolling
      if (e.altKey) change(rotateItems(its, -dy * 0.03, centerOf(g)), 'wheel-rotate') // Alt+wheel rotates (about 3° per notch)
      else change(scaleItems(its, Math.exp(-dy * 0.001), centerOf(g)), 'wheel-scale')
    }
    el.addEventListener('wheel', h, { passive: false })
    return () => el.removeEventListener('wheel', h)
  }, [])

  function key(e: React.KeyboardEvent) {
    const step = e.shiftKey ? 5 : 1
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault()
      const all = Object.keys(config.parts)
      onSelect(all, all.includes(primary) ? primary : (all[all.length - 1] ?? null))
    } else if (e.key === 'Escape') onSelect([], null)
    else if (arrows[e.key] && selItems.length) {
      e.preventDefault()
      onChange(moveItems(selItems, arrows[e.key][0], arrows[e.key][1]), 'nudge')
    } else if ((e.key === '[' || e.key === ']') && selItems.length && group) {
      e.preventDefault()
      onChange(rotateItems(selItems, (e.key === ']' ? 1 : -1) * (e.shiftKey ? 15 : 1), centerOf(group)), 'key-rotate')
    } else if ((e.key === '+' || e.key === '=' || e.key === '-') && selItems.length && group) {
      e.preventDefault()
      onChange(scaleItems(selItems, e.key === '-' ? 1 / 1.03 : 1.03, centerOf(group)), 'key-scale')
    }
  }

  const hs = HANDLE / ppu
  const sw = (n: number) => n / ppu
  const names = ['nw', 'ne', 'se', 'sw']
  const corners = frame ? frame.map((p, i) => [names[i], p.x, p.y] as const) : []
  return (
    <div tabIndex={0} onKeyDown={key} aria-label="Area pengeditan posisi bagian (geser, ubah ukuran, pilih banyak)" style={{ position: 'absolute', inset: 0, outline: 'none' }}>
      <svg ref={svg} viewBox={`${stage.x} ${stage.y} ${stage.w} ${stage.h}`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        onContextMenu={(e) => e.preventDefault()} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: panMode ? 'grab' : cursor, touchAction: 'none' }}>
        {/* the export frame: everything outside it is dimmed (visible, but not part of the PNG / rig) */}
        <g pointerEvents="none">
          <path fillRule="evenodd" fill="rgba(8,10,16,0.45)" d={`M${stage.x} ${stage.y}h${stage.w}v${stage.h}h${-stage.w}Z M${view.x} ${view.y}v${view.h}h${view.w}v${-view.h}Z`} />
          <rect x={view.x} y={view.y} width={view.w} height={view.h} fill="none" stroke="#9aa3b8" strokeWidth={sw(1.2)} strokeDasharray={`${sw(8)} ${sw(5)}`} />
          <text x={view.x + sw(6)} y={view.y - sw(6)} fontSize={sw(11)} fill="#9aa3b8">area ekspor</text>
        </g>
        {typeof splitY === 'number' && (
          <g pointerEvents="none">
            <line x1={stage.x} x2={stage.x + stage.w} y1={splitY} y2={splitY} stroke="#ff9f43" strokeWidth={sw(1.5)} strokeDasharray={`${sw(3)} ${sw(5)}`} />
            <text x={view.x + sw(6)} y={splitY - sw(5)} fontSize={sw(11)} fill="#ff9f43">garis potong: bagian bawah di balik baju</text>
          </g>
        )}
        {selItems.length > 1 && selItems.map((i) => (
          <rect key={i.slot} pointerEvents="none" x={boxes[i.slot].x0} y={boxes[i.slot].y0} width={boxes[i.slot].x1 - boxes[i.slot].x0} height={boxes[i.slot].y1 - boxes[i.slot].y0} fill="none" stroke="#4f8cff" strokeOpacity={0.55} strokeWidth={sw(1)} />
        ))}
        {frame && (
          <polygon pointerEvents="none" points={frame.map((p) => `${p.x},${p.y}`).join(' ')} fill="rgba(79,140,255,0.06)" stroke="#4f8cff" strokeWidth={sw(1.5)} strokeDasharray={`${sw(6)} ${sw(4)}`} />
        )}
        {rotHandle && (
          <g>
            <line pointerEvents="none" x1={rotHandle.mid.x} y1={rotHandle.mid.y} x2={rotHandle.p.x} y2={rotHandle.p.y} stroke="#4f8cff" strokeWidth={sw(1.5)} />
            <circle data-handle="rot" cx={rotHandle.p.x} cy={rotHandle.p.y} r={sw(7)} fill="#fff" stroke="#4f8cff" strokeWidth={sw(1.5)} />
            {rotLabel && <text pointerEvents="none" x={rotHandle.p.x + sw(12)} y={rotHandle.p.y + sw(4)} fontSize={sw(12)} fill="#fff" stroke="#14161b" strokeWidth={sw(3)} paintOrder="stroke">{rotLabel}</text>}
          </g>
        )}
        {corners.map(([h, x, y]) => (
          <rect key={h} data-handle={h} x={x - hs / 2} y={y - hs / 2} width={hs} height={hs} rx={sw(2)} fill="#fff" stroke="#4f8cff" strokeWidth={sw(1.5)} />
        ))}
        {marquee && <rect pointerEvents="none" x={marquee.x0} y={marquee.y0} width={marquee.x1 - marquee.x0} height={marquee.y1 - marquee.y0} fill="rgba(79,140,255,0.12)" stroke="#4f8cff" strokeWidth={sw(1)} strokeDasharray={`${sw(4)} ${sw(3)}`} />}
      </svg>
    </div>
  )
}

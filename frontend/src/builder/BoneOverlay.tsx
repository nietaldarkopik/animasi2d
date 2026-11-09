import { useRef, useState } from 'react'
import { ARM_HALF_WIDTH, band, JOINT_LABEL, JOINTS, LINKS, type CharRig, type JointKey, type Joints } from './charRig'
import type { Rect } from './viewport'

interface Props {
  /** the rig being edited (the stored one, or the guess when the character has none yet) */
  rig: CharRig
  /** true while `rig` is only a guess (drawn dashed until the user moves a joint) */
  guessed: boolean
  stage: Rect
  /** screen pixels per canvas unit */
  ppu: number
  onChange: (rig: CharRig, key: string) => void
}

/** Joint editor on top of the Builder stage: drag a joint to move it (canvas units, through the SVG viewBox). */
export function BoneOverlay({ rig, guessed, stage, ppu, onChange }: Props) {
  const svg = useRef<SVGSVGElement>(null)
  const drag = useRef<{ key: JointKey; gesture: string } | null>(null)
  const [hover, setHover] = useState<JointKey | null>(null)
  const J = rig.joints
  const sw = (px: number) => px / ppu
  const toUnits = (e: { clientX: number; clientY: number }) => {
    const r = svg.current!.getBoundingClientRect()
    return { x: stage.x + ((e.clientX - r.left) / r.width) * stage.w, y: stage.y + ((e.clientY - r.top) / r.height) * stage.h }
  }
  const move = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const p = toUnits(e)
    const joints: Joints = { ...J, [d.key]: { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 } }
    onChange({ ...rig, joints }, d.gesture)
  }
  const r = rig.armWidth ?? ARM_HALF_WIDTH
  const strip = (s: 'l' | 'r') => {
    const S = J[`shoulder_${s}`], E = J[`elbow_${s}`], W = J[`wrist_${s}`]
    const l = Math.hypot(E.x - S.x, E.y - S.y) || 1
    return band({ x: S.x - ((E.x - S.x) / l) * r * 0.5, y: S.y - ((E.y - S.y) / l) * r * 0.5 }, W, r, r * 3)
  }
  const color = guessed ? '#ffd166' : '#4cc9f0'
  return (
    <svg ref={svg} viewBox={`${stage.x} ${stage.y} ${stage.w} ${stage.h}`} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }}
      onPointerMove={move} onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }} aria-label="Bone karakter">
      {(['l', 'r'] as const).map((s) => (
        <polygon key={s} points={strip(s).map((p) => `${p.x},${p.y}`).join(' ')} fill={color} fillOpacity={0.12} stroke={color} strokeOpacity={0.5} strokeWidth={sw(1)} strokeDasharray={`${sw(4)} ${sw(4)}`} />
      ))}
      {LINKS.map(([a, b]) => (
        <line key={`${a}-${b}`} x1={J[a].x} y1={J[a].y} x2={J[b].x} y2={J[b].y} stroke={color} strokeWidth={sw(3)} strokeLinecap="round" strokeDasharray={guessed ? `${sw(6)} ${sw(4)}` : undefined} />
      ))}
      {JOINTS.map((k) => (
        <g key={k}>
          <circle cx={J[k].x} cy={J[k].y} r={sw(hover === k ? 9 : 7)} fill="#111" stroke={color} strokeWidth={sw(2.5)} style={{ cursor: 'grab' }}
            onPointerDown={(e) => { e.stopPropagation(); (e.target as Element).setPointerCapture?.(e.pointerId); drag.current = { key: k, gesture: `joint:${k}:${Date.now()}` } }}
            onPointerEnter={() => setHover(k)} onPointerLeave={() => setHover((h) => (h === k ? null : h))}>
            <title>{JOINT_LABEL[k]}</title>
          </circle>
          {hover === k && <text x={J[k].x + sw(12)} y={J[k].y - sw(10)} fontSize={sw(12)} fill="#fff" stroke="#000" strokeWidth={sw(3)} paintOrder="stroke">{JOINT_LABEL[k]}</text>}
        </g>
      ))}
    </svg>
  )
}

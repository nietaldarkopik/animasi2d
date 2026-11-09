/**
 * Where characters stand. Each library location has a floor line (scene px of a 1280x720 picture, where the wall meets the floor);
 * a character's feet go a little way into the floor, not on the line itself, and the figure is sized for the room.
 */

/** floor line (y of the wall/floor edge in a 720 px high location) by lower-case location name */
const FLOORS: [string, number][] = [
  ['halaman sekolah', 520], ['ruang kelas', 500], ['lab komputer', 520], ['kantin', 500], ['perpustakaan', 520], ['lapangan', 430],
  ['ruang tamu', 520], ['kamar tidur', 530], ['dapur', 520], ['taman', 520], ['jalan', 440],
]

/** Floor line of a named location scaled to a scene of height `H`; unknown (uploaded) locations get a floor at 70% of the height. */
export function floorFor(locationName: string | undefined, H: number): number {
  const n = (locationName ?? '').toLowerCase()
  const hit = FLOORS.find(([k]) => n.includes(k))
  return Math.round(((hit ? hit[1] : 504) / 720) * H)
}

/** Feet go this far into the floor band (0 = on the wall line, 1 = at the bottom edge). */
export const FOOT_DEPTH = 0.35

export interface Standing {
  /** y of the feet on the scene */
  footY: number
  /** multiplier for the default character scale (rigLayers' `scale`) so the figure is `heightFrac` of the scene height */
  scale: number
}

/**
 * Feet position and size for a character in a room. `defaultK` = scene px per canvas unit at scale 1 (fitScale(H));
 * `figureUnits` = height of the figure in canvas units (feet to top of the head).
 */
export function standingOn(H: number, floorY: number, heightFrac: number, defaultK: number, figureUnits: number): Standing {
  const footY = Math.round(floorY + FOOT_DEPTH * (H - floorY))
  const k = (heightFrac * H) / Math.max(1, figureUnits)
  return { footY, scale: Math.round((k / defaultK) * 1000) / 1000 }
}

export interface BalloonSpot { x: number; y: number; tailX: number; tailY: number }

/**
 * A speech balloon above the speaker's head: beside it (towards the middle of the scene so it stays on screen), clear of the top
 * edge, with the tail pointing down at the head. Everything in scene px; tail is relative to the balloon centre.
 */
export function balloonAbove(W: number, charX: number, headTop: number, bw: number, bh: number): BalloonSpot {
  const margin = 16
  const towardsMiddle = charX < W / 2 ? 1 : -1
  const x = Math.min(W - bw / 2 - margin, Math.max(bw / 2 + margin, charX + towardsMiddle * bw * 0.3))
  const y = Math.max(bh / 2 + margin, headTop - bh / 2 - 28)
  const targetY = Math.max(y + bh / 2 + 18, headTop + 6) // the tail always points down, ending just above the hair
  return { x: Math.round(x), y: Math.round(y), tailX: Math.round(charX - x), tailY: Math.round(targetY - y) }
}

/**
 * Height of the figure (fraction of the scene height) that still leaves room above the head for the tallest balloon of the scene:
 * never above `base`, never below 30%. `footY` = scene y of the feet.
 */
export function figureFracWithHeadroom(H: number, footY: number, balloonH: number, base: number): number {
  const need = balloonH + 44 // the balloon, a 28 px gap above the head and a 16 px margin at the top edge
  return Math.round(Math.max(0.3, Math.min(base, (footY - need) / H)) * 1000) / 1000
}

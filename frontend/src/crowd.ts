/**
 * A crowd behind the speakers (students at an assembly, a class...): the members of a scene's `cast` who do not speak stand in one or two
 * rows further back. Further back = smaller and with the feet higher on the screen; the front row keeps clear of the speakers.
 */
export interface CrowdSpot {
  xFrac: number
  /** 0 = the row right behind the speakers, 1 = the row behind that */
  row: 0 | 1
  /** size relative to a speaker */
  scale: number
  /** how much higher the feet are than a speaker's, as a fraction of the scene height */
  lift: number
}

export const ROWS = [{ scale: 0.8, lift: 0.06, max: 7 }, { scale: 0.66, lift: 0.11, max: 9 }] as const
const EDGE = 0.06
/** how far (fraction of the width) a front-row member stays from a speaker */
export const CLEAR = 0.11

/** Evenly spread points over [EDGE, 1 - EDGE], keeping away from `taken` when there is room. */
function spread(n: number, taken: number[]): number[] {
  if (n <= 0) return []
  for (let m = n; m <= n + taken.length * 3 + 6; m++) {
    const all = Array.from({ length: m }, (_, i) => (m === 1 ? 0.5 : EDGE + ((1 - 2 * EDGE) * i) / (m - 1)))
    const free = all.filter((x) => taken.every((t) => Math.abs(x - t) >= CLEAR))
    if (free.length >= n) return Array.from({ length: n }, (_, i) => free[Math.round((i * (free.length - 1)) / Math.max(1, n - 1))])
  }
  return Array.from({ length: n }, (_, i) => (n === 1 ? 0.5 : EDGE + ((1 - 2 * EDGE) * i) / (n - 1)))
}

/** Where `count` crowd members stand, given the x of the speakers (fractions of the width). At most ROWS[0].max + ROWS[1].max. */
export function crowdSpots(count: number, speakers: number[]): CrowdSpot[] {
  const n = Math.min(count, ROWS[0].max + ROWS[1].max)
  const front = n <= ROWS[0].max ? n : Math.ceil(n / 2) <= ROWS[0].max ? Math.ceil(n / 2) : ROWS[0].max
  const back = n - front
  const f = spread(front, speakers)
  // the back row sits in the gaps of the front row, so faces are not hidden behind heads
  const sorted = [...f].sort((x, y) => x - y)
  const gaps = [...sorted.slice(1).map((x, i) => (x + sorted[i]) / 2), ...(sorted.length ? [Math.max(EDGE, sorted[0] / 2), Math.min(1 - EDGE, (sorted[sorted.length - 1] + 1) / 2)] : [])].filter((g) => sorted.every((x) => Math.abs(x - g) > 0.03)).sort((x, y) => x - y)
  const b = back <= gaps.length ? Array.from({ length: back }, (_, i) => gaps[Math.round((i * (gaps.length - 1)) / Math.max(1, back - 1))]) : Array.from({ length: back }, (_, i) => EDGE / 2 + ((1 - EDGE) * (i + 0.5)) / back) // (more than the gaps: a grid offset by half a step)
  return [
    ...f.map((xFrac): CrowdSpot => ({ xFrac, row: 0, scale: ROWS[0].scale, lift: ROWS[0].lift })),
    ...b.map((xFrac): CrowdSpot => ({ xFrac, row: 1, scale: ROWS[1].scale, lift: ROWS[1].lift })),
  ]
}

/** The non-speaking members of a scene's cast, in order, without duplicates (names compared case-insensitively). */
export function silentCast(cast: string[] | undefined, speakers: string[]): string[] {
  const seen = new Set(speakers.map((s) => s.trim().toLowerCase()))
  const out: string[] = []
  for (const c of cast ?? []) {
    const k = c.trim().toLowerCase()
    if (!k || seen.has(k) || /^narr?ator$/.test(k)) continue
    seen.add(k)
    out.push(c.trim())
  }
  return out
}

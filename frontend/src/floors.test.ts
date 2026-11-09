import { describe, expect, it } from 'vitest'
import { balloonAbove, figureFracWithHeadroom, floorFor, FOOT_DEPTH, standingOn } from './floors'

describe('floors and standing', () => {
  it('knows the floor line of the library locations and scales it with the scene height', () => {
    expect(floorFor('Ruang kelas', 720)).toBe(500)
    expect(floorFor('Lapangan upacara', 720)).toBe(430)
    expect(floorFor('Kantin sekolah', 720)).toBe(500)
    expect(floorFor('Ruang kelas', 360)).toBe(250)
    expect(floorFor('Taman', 1080)).toBe(780)
  })

  it('an unknown or missing location gets a floor at 70% of the height', () => {
    expect(floorFor('Gunung rahasia', 720)).toBe(504)
    expect(floorFor(undefined, 1000)).toBe(700)
  })

  it('puts the feet a little into the floor band, never above the wall line or below the picture', () => {
    for (const [name, H] of [['Ruang kelas', 720], ['Lapangan upacara', 720], ['Taman', 540], ['Gunung', 1080]] as const) {
      const f = floorFor(name, H)
      const s = standingOn(H, f, 0.52, 0.84, 770)
      expect(s.footY).toBeGreaterThan(f)
      expect(s.footY).toBeLessThan(H)
      expect(s.footY).toBe(Math.round(f + FOOT_DEPTH * (H - f)))
    }
  })

  it('sizes the figure to the requested fraction of the scene height', () => {
    const H = 720, defaultK = 0.841
    const s = standingOn(H, 500, 0.52, defaultK, 760)
    // scale 1 = defaultK px per unit; the figure is 760 units tall -> height on screen = scale * defaultK * 760
    expect(s.scale * defaultK * 760).toBeCloseTo(0.52 * H, 0)
    expect(standingOn(H, 500, 0.8, defaultK, 760).scale).toBeGreaterThan(s.scale)
  })
})

describe('speech balloon above a head', () => {
  const W = 1280

  it('sits above the head, beside it towards the middle, with the tail pointing down at the head', () => {
    const left = balloonAbove(W, 410, 200, 400, 110)
    expect(left.y + 55).toBeLessThan(200) // the balloon bottom is above the head top
    expect(left.x).toBeGreaterThan(410) // left speaker: balloon leans towards the middle
    expect(left.tailY).toBeGreaterThan(55) // tail leaves the bottom edge
    expect(left.x + left.tailX).toBe(410) // and ends over the head
    const right = balloonAbove(W, 870, 200, 400, 110)
    expect(right.x).toBeLessThan(870)
    expect(right.x + right.tailX).toBe(870)
  })

  it('stays on screen: clamped to the sides and to the top edge, tail still pointing down', () => {
    const edge = balloonAbove(W, 40, 60, 420, 110) // tiny headroom, speaker at the far left
    expect(edge.x - 210).toBeGreaterThanOrEqual(16)
    expect(edge.y - 55).toBeGreaterThanOrEqual(16)
    expect(edge.tailY).toBeGreaterThan(55)
    const far = balloonAbove(W, 1260, 300, 420, 110)
    expect(far.x + 210).toBeLessThanOrEqual(W - 16)
  })
})

describe('headroom for the balloon', () => {
  it('shrinks a tall figure just enough that the tallest balloon fits above its head, never below 30% or above the base size', () => {
    // street scene: feet at 538 of 720; a 3-line balloon is 110 high
    const f = figureFracWithHeadroom(720, 538, 110, 0.58)
    expect(f).toBeLessThan(0.58)
    const headTop = 538 - f * 720
    expect(headTop).toBeGreaterThanOrEqual(110 + 44 - 1) // balloon + gaps fit above the head
    expect(figureFracWithHeadroom(720, 577, 70, 0.52)).toBe(0.52) // plenty of room: base size stays
    expect(figureFracWithHeadroom(720, 200, 300, 0.58)).toBe(0.3) // hopeless: the floor of 30%
  })
})

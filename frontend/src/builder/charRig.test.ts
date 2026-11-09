import { describe, expect, it } from 'vitest'
import { bonesFromJoints, DEFAULT_JOINTS, guessJoints, insideConvex, planPartPieces, type PartPiece, type PieceLayer, type Poly } from './charRig'
import type { Pt } from './rig'

const Z: Record<string, number> = { hair_back: 1, body: 2, arm_l: 3, arm_r: 3, torso: 4, bottom: 5, top: 6, shoes: 7, face: 10, hair_front: 12 }
const zOf = (s: string) => Z[s.replace('shoes_r', 'shoes')] ?? 0
const plan = (slots: string[], extra: Partial<Parameters<typeof planPartPieces>[0]> = {}) =>
  planPartPieces({ slots, joints: DEFAULT_JOINTS, skirt: false, zOf, labelOf: (s) => s, ...extra })
const piece = (ps: PartPiece[], key: string) => ps.find((p) => p.key === key)!
/** is the point drawn from this layer? (inside every `within` entry, outside every `minus` polygon) */
const keeps = (l: PieceLayer, p: Pt) => (l.within ?? []).every((u: Poly[]) => u.some((poly) => insideConvex(poly, p))) && !(l.minus ?? []).some((poly) => insideConvex(poly, p))

describe('cutting each part at the character joints', () => {
  it('an arm part is cut on its own into upper arm, forearm and hand: nothing of the clothes in them', () => {
    const ps = plan(['body', 'arm_l', 'arm_r', 'top', 'face'])
    for (const [k, bone] of [['arm_l_up', 'arm_l'], ['arm_l_low', 'forearm_l'], ['hand_l', 'hand_l']]) {
      expect(piece(ps, k).bone).toBe(bone)
      expect(piece(ps, k).layers.map((l) => l.slot)).toEqual(['arm_l'])
    }
    const [up, low, hand] = ['arm_l_up', 'arm_l_low', 'hand_l'].map((k) => piece(ps, k).layers[0])
    const upperArm = { x: 106, y: 400 }, forearm = { x: 106, y: 500 }, palm = { x: 106, y: 570 }
    expect([keeps(up, upperArm), keeps(low, upperArm), keeps(hand, upperArm)]).toEqual([true, false, false])
    expect([keeps(up, forearm), keeps(low, forearm), keeps(hand, forearm)]).toEqual([false, true, false])
    expect([keeps(up, palm), keeps(low, palm), keeps(hand, palm)]).toEqual([false, false, true])
  })

  it('a bent arm is cut across the arm at the elbow, not along a horizontal line', () => {
    // forearm pointing sideways: a point on it at the height of the elbow belongs to the forearm
    const joints = { ...DEFAULT_JOINTS, elbow_l: { x: 106, y: 452 }, wrist_l: { x: 10, y: 452 } }
    const ps = plan(['arm_l'], { joints })
    expect(keeps(piece(ps, 'arm_l_low').layers[0], { x: 60, y: 452 })).toBe(true)
    expect(keeps(piece(ps, 'arm_l_up').layers[0], { x: 60, y: 452 })).toBe(false)
  })

  it('with arm parts the clothes stay whole, except the sleeve of a top stacked over the arm', () => {
    const ps = plan(['body', 'arm_l', 'arm_r', 'torso', 'top'])
    const torso = piece(ps, 'torso')
    const top = torso.layers.find((l) => l.slot === 'top')!, body = torso.layers.find((l) => l.slot === 'body')!
    expect(top.minus).toHaveLength(2) // both sleeves leave the torso image
    expect(body.minus).toBeUndefined()
    expect(keeps(top, { x: 100, y: 400 })).toBe(false)
    expect(keeps(top, { x: 115, y: 400 })).toBe(true) // the inner half of the sleeve stays in the torso too (no hole when the arm is raised)
    expect(keeps(top, { x: 200, y: 400 })).toBe(true)
    expect(piece(ps, 'sleeve_l_up').layers[0].slot).toBe('top')
    expect(piece(ps, 'sleeve_l_up').order).toBeGreaterThan(piece(ps, 'arm_l_up').order)
    // a top stacked BEHIND the arm keeps its sleeves
    const back = planPartPieces({ slots: ['arm_l', 'top'], joints: DEFAULT_JOINTS, skirt: false, zOf: (s) => (s === 'top' ? 1 : s === 'arm_l' ? 9 : 0), labelOf: (s) => s })
    expect(back.some((p) => p.key.startsWith('sleeve_'))).toBe(false)
  })

  it('a side without an arm part takes the arm out of the clothes along the arm, and the torso gives it up', () => {
    const ps = plan(['body', 'top'])
    const up = piece(ps, 'arm_r_up')
    expect(up.layers.map((l) => l.slot).sort()).toEqual(['body', 'top'])
    expect(keeps(up.layers.find((l) => l.slot === 'top')!, { x: 294, y: 400 })).toBe(true)
    expect(keeps(up.layers.find((l) => l.slot === 'top')!, { x: 200, y: 400 })).toBe(false)
    const torsoTop = piece(ps, 'torso').layers.find((l) => l.slot === 'top')!
    expect(keeps(torsoTop, { x: 300, y: 400 })).toBe(false)
    expect(keeps(torsoTop, { x: 200, y: 400 })).toBe(true)
  })

  it('cuts the legs left/right at the hips and at the knees; each shoe part is its own piece', () => {
    const ps = plan(['body', 'bottom', 'shoes', 'shoes_r'])
    const thigh = piece(ps, 'leg_l_up'), shin = piece(ps, 'leg_l_low')
    expect(thigh.layers.map((l) => l.slot)).toEqual(['body', 'bottom'])
    const b = (pc: PartPiece) => pc.layers.find((l) => l.slot === 'bottom')!
    expect(keeps(b(thigh), { x: 172, y: 600 })).toBe(true)
    expect(keeps(b(thigh), { x: 228, y: 600 })).toBe(false)
    expect(keeps(b(shin), { x: 172, y: 720 })).toBe(true)
    expect(keeps(b(thigh), { x: 172, y: 720 })).toBe(false)
    expect(piece(ps, 'shoe_l')).toMatchObject({ bone: 'shin_l', layers: [{ slot: 'shoes' }] })
    expect(piece(ps, 'shoe_r')).toMatchObject({ bone: 'shin_r', layers: [{ slot: 'shoes_r' }] })
    // the waistband of trousers belongs to the torso
    expect(keeps(piece(ps, 'torso').layers.find((l) => l.slot === 'bottom')!, { x: 200, y: 540 })).toBe(true)
  })

  it('a pair of shoes in one image is cut between the feet; a skirt hangs whole on the hips', () => {
    const ps = plan(['body', 'bottom', 'shoes'], { skirt: true })
    expect(piece(ps, 'leg_l_low').layers.map((l) => l.slot)).toEqual(['body', 'shoes'])
    expect(piece(ps, 'skirt')).toMatchObject({ bone: 'root', layers: [{ slot: 'bottom' }] })
    expect(ps.some((p) => p.key === 'leg_l_up' && p.layers.some((l) => l.slot === 'bottom'))).toBe(false)
  })

  it('under a skirt the bare body in the torso stops just below the hem of the top, never below the hips', () => {
    const torsoBody = (hemY?: number) => piece(plan(['body', 'top', 'bottom'], { skirt: true, hemY }), 'torso').layers.find((l) => l.slot === 'body')!
    expect(keeps(torsoBody(480), { x: 200, y: 484 })).toBe(true)
    expect(keeps(torsoBody(480), { x: 200, y: 500 })).toBe(false) // (a kit body has flat thighs there)
    expect(keeps(torsoBody(700), { x: 200, y: 550 })).toBe(true)
    expect(keeps(torsoBody(700), { x: 200, y: 560 })).toBe(false)
  })
})

describe('bones and joints', () => {
  it('builds the bones on the joints: the default joints give the default skeleton', () => {
    const bones = bonesFromJoints(DEFAULT_JOINTS)
    const arm = bones.find((b) => b.key === 'arm_l')!
    expect(arm.joint).toEqual({ x: 106, y: 340 })
    expect(arm.angle).toBe(90)
    expect(arm.length).toBe(112)
    expect(bones.find((b) => b.key === 'forearm_l')!.parent).toBe('arm_l')
    expect(bones.find((b) => b.key === 'torso')!.angle).toBe(-90)
  })

  it('a moved joint moves the bone and turns it toward the next joint', () => {
    const b = bonesFromJoints({ ...DEFAULT_JOINTS, elbow_l: { x: 50, y: 340 } }).find((x) => x.key === 'arm_l')!
    expect(b.angle).toBe(180)
    expect(b.length).toBe(56)
  })

  it('guesses the joints from where the parts are', () => {
    const g = guessJoints({ arm_l: { x0: 60, y0: 300, x1: 100, y1: 600 }, face: { x0: 150, y0: 100, x1: 250, y1: 300 }, bottom: { x0: 120, y0: 500, x1: 280, y1: 760 } })
    expect(g.shoulder_l.x).toBe(80)
    expect(g.elbow_l.y).toBeCloseTo(432)
    expect(g.wrist_l.y).toBeCloseTo(540)
    expect(g.neck.y).toBeCloseTo(292)
    expect(g.hip.y).toBe(512)
    expect(g.shoulder_r).toEqual(DEFAULT_JOINTS.shoulder_r) // no right arm part: default
  })
})

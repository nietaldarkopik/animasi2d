import { describe, expect, it } from 'vitest'
import { assetAt, evalLayer, evalProp } from '../anim'
import type { Layer, SceneDocument } from '../types'
import { CARD_ROLES, cardLayers, meanHeadDx, tiltShift, type CardMeta, type PreparedCard } from './card'
import { applyCardLook, applyCardMotion, applyCardTurn, bodySlotFor, cardCapabilities, cardParts, clearCardLook, headExpressionAt, headKeyFor, stepKey } from './cardMotion'
import { applyRigMotion, findRigs } from './rigMotion'

const META: CardMeta = {
  name: 'tes',
  body: { canvas: [800, 1400], feet_y: 1375, center_x: 400, char_height_px: 1300, poses: ['diam', 'tunjuk', 'angkat'], head_dx: { diam: 0, tunjuk: 1, angkat: 0 },
    head_at: { duduk_sila: [204, -3], duduk_tegak: [204, 40], diam_34: [200, 2], diam_sisi: [190, 2], lari_sisi: [150, 30], lari_sisi_2: [160, 36] } },
  head: { canvas: [400, 500], paste_on_body: [200, 0], expressions: ['netral', 'senang'] },
  mouth: { canvas: [120, 80], paste_on_head_topleft: [139, 218], shapes: ['a', 'o'] },
  blink: { canvas: [400, 500], paste_on_head_topleft: [0, 0] },
  spec: { version: 2, packs: ['dasar', 'dialog', 'duduk', 'aksi'], mirror_ok: true },
}
const A_BASE = { body: { diam: 1, tunjuk: 2, angkat: 3 }, head: { netral: 10, senang: 11 }, mouth: { a: 20, o: 21 }, blink: 30 }
const A_EXTRA = {
  body: { diam_34: 40, diam_sisi: 41, duduk_sila: 42, duduk_tegak: 43, lari_sisi: 44, lari_sisi_2: 45 },
  head: { netral_34: 50, netral_sisi: 51, senang_34: 52, lirik_kanan: 53, lirik_kiri: 54 },
  mouth: {},
}
const prepared = (extra: boolean, meta: CardMeta = META): PreparedCard => ({ name: 'Tes', version: 1, meta, assets: { ...A_BASE, ...(extra ? { extra: A_EXTRA } : {}) } })

let n = 0
const newId = () => `L${++n}`
const scene = { width: 1280, height: 720, duration: 10, fps: 24 }
const build = (extra = true, meta?: CardMeta) => {
  const layers = cardLayers(prepared(extra, meta), scene, newId, { xFrac: 0.5, footY: 700, blink: false })
  const doc: SceneDocument = { schema: 1, settings: { ...scene, background: '#000' }, layers }
  const rig = findRigs(layers)[0]
  return { doc, rig, parts: cardParts(doc, rig)! }
}
const role = (layers: Layer[], r: string) => layers.find((l) => l.rig?.role === r)!

describe('cardLayers with spec v2 slots', () => {
  it('adds the extra images to the swap tables and stores the head positions on the root bone', () => {
    const { doc } = build()
    const body = role(doc.layers, `piece:${CARD_ROLES.body}`)
    const head = role(doc.layers, `piece:${CARD_ROLES.head}`)
    expect(Object.keys(body.expr!)).toEqual(expect.arrayContaining(['diam', 'angkat', 'duduk_sila', 'lari_sisi', 'default']))
    expect(Object.keys(head.expr!)).toEqual(expect.arrayContaining(['netral', 'netral_34', 'lirik_kanan']))
    const card = role(doc.layers, 'bone:root').rig!.card!
    // head image centre relative to the body image centre, body pixels: paste (x, y) + half head - half body
    expect(card.head0).toEqual([Math.round((200 + meanHeadDx(META) + 200 - 400) * 1000) / 1000, 0 + 250 - 700])   // the base poses share one (mean) head position
    expect(card.head.duduk_sila).toEqual([204 + 200 - 400, -3 + 250 - 700])
    expect(Object.keys(card.head).sort()).toEqual(Object.keys(META.body.head_at!).sort())
    expect(card.mirror).toBe(true)
  })

  it('without extra slots nothing changes except the head0 record', () => {
    const { doc } = build(false)
    expect(Object.keys(role(doc.layers, `piece:${CARD_ROLES.body}`).expr!).sort()).toEqual(['angkat', 'default', 'diam', 'tunjuk'])
    expect(role(doc.layers, 'bone:root').rig!.card!.head).toEqual({})
  })

  it('mirror_ok = false is recorded', () => {
    const { doc } = build(true, { ...META, spec: { version: 2, packs: ['dasar'], mirror_ok: false } })
    expect(role(doc.layers, 'bone:root').rig!.card!.mirror).toBe(false)
  })
})

describe('images drawn facing left (pack "jalan")', () => {
  const META_L: CardMeta = { ...META, body: { ...META.body, head_at: { ...META.body.head_at, jalan_sisi: [150, 30], jalan_sisi_kiri: [250, 30], jalan_sisi_2: [152, 31], jalan_sisi_2_kiri: [248, 31], diam_34_kiri: [210, 2] } } }
  const EXTRA_L = {
    body: { ...A_EXTRA.body, jalan_sisi: 60, jalan_sisi_kiri: 61, jalan_sisi_2: 62, jalan_sisi_2_kiri: 63, diam_34_kiri: 64 },
    head: { ...A_EXTRA.head, netral_34_kiri: 70, netral_sisi_kiri: 71 },
    mouth: {},
  }
  const buildL = (extra: { body: Record<string, number>; head: Record<string, number>; mouth: Record<string, number> }, meta = META_L) => {
    const layers = cardLayers({ name: 'Tes', version: 1, meta, assets: { ...A_BASE, extra } }, scene, newId, { xFrac: 0.5, footY: 700, blink: false })
    const doc: SceneDocument = { schema: 1, settings: { ...scene, background: '#000' }, layers }
    const rig = findRigs(layers)[0]
    return { doc, rig, parts: cardParts(doc, rig)! }
  }

  it('walking left uses the left-facing walk images and does not mirror the figure', () => {
    const { doc, rig, parts } = buildL(EXTRA_L)
    expect(applyRigMotion(doc, rig, 'walk', 0, { duration: 2, distance: 300, dir: -1 })).toBe(true)
    expect(assetAt(parts.body, 0)).toBe(61)                          // jalan_sisi_kiri
    expect(evalProp(parts.root, 'scaleX', 1)).toBe(1)               // not mirrored
    const used = new Set(Array.from({ length: 49 }, (_, f) => assetAt(parts.body, f)))
    expect(used.has(63)).toBe(true)                                  // the second phase, also drawn facing left
    expect(used.has(60) || used.has(62)).toBe(false)                // never the right-facing ones
    expect(assetAt(parts.head, 0)).toBe(71)                          // netral_sisi_kiri
    expect(evalProp(parts.head, 'x', 0)).toBe(Math.round((250 + 200 - 400) * 1000) / 1000)   // head_at of the left image
    expect(evalProp(parts.head, 'scaleX', 0)).toBe(1)
  })

  it('walking right uses the right-facing images; walking left without left images mirrors as before', () => {
    const r = buildL(EXTRA_L)
    applyRigMotion(r.doc, r.rig, 'walk', 0, { duration: 2, distance: 300, dir: 1 })
    expect(assetAt(r.parts.body, 0)).toBe(60)
    expect(evalProp(r.parts.root, 'scaleX', 1)).toBe(1)
    const noLeft = buildL({ ...EXTRA_L, body: { ...A_EXTRA.body, jalan_sisi: 60 }, head: A_EXTRA.head })
    applyRigMotion(noLeft.doc, noLeft.rig, 'walk', 0, { duration: 2, distance: 300, dir: -1 })
    expect(assetAt(noLeft.parts.body, 0)).toBe(60)
    expect(evalProp(noLeft.parts.root, 'scaleX', 1)).toBe(-1)         // mirrored copy of the right-facing walk
  })

  it('a look facing left takes the left body and head; a head without a left picture is mirrored alone', () => {
    const { doc, rig, parts } = buildL(EXTRA_L)
    applyCardLook(doc, rig, { pose: 'diam', view: '34', facing: -1 }, 5)
    expect(assetAt(parts.body, 5)).toBe(64)
    expect(assetAt(parts.head, 5)).toBe(70)
    expect(evalProp(parts.root, 'scaleX', 5)).toBe(1)
    expect(evalProp(parts.head, 'scaleX', 5)).toBe(1)
    applyCardLook(doc, rig, { pose: 'diam', view: 'sisi', facing: -1 }, 20)    // no diam_sisi_kiri image: mirrored as before
    expect(evalProp(parts.root, 'scaleX', 20)).toBe(-1)
  })

  it('turning the head left uses left-drawn heads, else mirrors', () => {
    const { doc, rig, parts } = buildL(EXTRA_L)
    const end = applyCardTurn(doc, rig, -1, 0, { hold: 1, back: true })!
    expect(assetAt(parts.head, 0)).toBe(70)
    expect(evalProp(parts.head, 'scaleX', 0)).toBe(1)
    expect(evalProp(parts.head, 'scaleX', end)).toBe(1)
    const plain = build(true)
    applyCardTurn(plain.doc, plain.rig, -1, 0, { hold: 1, back: false })
    expect(evalProp(plain.parts.head, 'scaleX', 0)).toBe(-1)           // legacy: mirrored right-facing head
  })

  it('left images do not show up as base poses', () => {
    expect(cardCapabilities(buildL(EXTRA_L).parts).basePoses.sort()).toEqual(['angkat', 'diam', 'tunjuk'])
    expect(cardCapabilities(buildL(EXTRA_L).parts).leftImages).toBe(true)
    expect(cardCapabilities(build(true).parts).leftImages).toBe(false)
  })
})

describe('head tilt per pose', () => {
  const TILTED: CardMeta = { ...META, body: { ...META.body, head_rot: { duduk_sila: 10 } } }

  it('tilts around the neck: the layer centre moves so the neck stays put', () => {
    const { doc } = build(true, TILTED)
    const card = role(doc.layers, 'bone:root').rig!.card!
    expect(card.rot).toEqual({ duduk_sila: 10 })
    const [sx, sy] = tiltShift(10, 500)
    expect(card.head.duduk_sila).toEqual([Math.round((204 + 200 - 400 + sx) * 1000) / 1000, Math.round((-3 + 250 - 700 + sy) * 1000) / 1000])
    // neck point (200, 379) of the head canvas, after rotating the layer about its centre by 10°, must equal the unrotated neck point
    const c = [200, 250], n = [200, 379], r = (10 * Math.PI) / 180
    const rotated = [c[0] + sx + Math.cos(r) * (n[0] - c[0]) - Math.sin(r) * (n[1] - c[1]), c[1] + sy + Math.sin(r) * (n[0] - c[0]) + Math.cos(r) * (n[1] - c[1])]
    expect(rotated[0]).toBeCloseTo(n[0], 6)
    expect(rotated[1]).toBeCloseTo(n[1], 6)
    expect(tiltShift(0, 500)).toEqual([0, 0])
  })

  it('keys the tilt with the pose and clears it for other poses', () => {
    const { doc, rig, parts } = build(true, TILTED)
    applyCardLook(doc, rig, { pose: 'duduk_sila' }, 10)
    expect(evalProp(parts.head, 'rotation', 10)).toBe(10)
    applyCardLook(doc, rig, { pose: 'duduk_tegak' }, 30)
    expect(evalProp(parts.head, 'rotation', 30)).toBe(0)
    clearCardLook(doc, rig, 30)
    expect(evalProp(parts.head, 'rotation', 30)).toBe(10)
  })

  it('a card without tilted slots gets no rotation keys at all', () => {
    const { doc, rig, parts } = build(true)
    applyCardLook(doc, rig, { pose: 'duduk_sila' }, 10)
    expect(parts.head.keyframes?.rotation).toBeUndefined()
  })
})

describe('stepKey', () => {
  it('pins the earlier state so frames before the first key do not change', () => {
    const { parts } = build()
    stepKey(parts.head, 'x', 30, 99)
    expect(evalProp(parts.head, 'x', 0)).toBe(parts.head.x)
    expect(evalProp(parts.head, 'x', 29)).toBe(parts.head.x)
    expect(evalProp(parts.head, 'x', 30)).toBe(99)
    expect(evalProp(parts.head, 'x', 200)).toBe(99)
    stepKey(parts.head, 'x', 60, 5)
    expect(evalProp(parts.head, 'x', 45)).toBe(99)                       // holds until the next key
    expect(evalProp(parts.head, 'x', 60)).toBe(5)
  })
})

describe('applyCardLook', () => {
  it('sits: swaps the body, moves the head to the slot position and leaves the frames before alone', () => {
    const { doc, rig, parts } = build()
    const before = evalLayer(parts.head, 10)
    const r = applyCardLook(doc, rig, { pose: 'duduk_sila' }, 30)!
    expect(r.applied).toContain('badan duduk_sila')
    const p2 = cardParts(doc, rig)!
    expect(assetAt(p2.body, 29)).toBe(1)
    expect(assetAt(p2.body, 30)).toBe(42)
    const hx = evalProp(p2.head, 'x', 30), hy = evalProp(p2.head, 'y', 30)
    expect([hx - (400 / 2 - 800 / 2), hy - (500 / 2 - 1400 / 2)]).toEqual([204, -3])     // = head_at: top-left of the head on the body
    expect([evalProp(p2.head, 'x', 29), evalProp(p2.head, 'y', 29)]).toEqual([before.x, before.y])
  })

  it('stands up again: the base pose gets the base head position back', () => {
    const { doc, rig } = build()
    applyCardLook(doc, rig, { pose: 'duduk_tegak' }, 20)
    applyCardLook(doc, rig, { pose: 'diam' }, 50)
    const p = cardParts(doc, rig)!
    expect(assetAt(p.body, 55)).toBe(1)
    expect([evalProp(p.head, 'x', 55), evalProp(p.head, 'y', 55)]).toEqual(p.data!.head0)
    expect(evalProp(p.head, 'y', 25)).not.toBe(p.data!.head0[1])
  })

  it('lifts the figure for a chair, and standing resets it', () => {
    const { doc, rig, parts } = build()
    const y0 = parts.body.y
    applyCardLook(doc, rig, { pose: 'duduk_tegak', lift: 40 }, 10)
    applyCardLook(doc, rig, { pose: 'diam' }, 40)
    const p = cardParts(doc, rig)!
    expect(evalProp(p.body, 'y', 20)).toBe(y0 - 40)
    expect(evalProp(p.body, 'y', 5)).toBe(y0)
    expect(evalProp(p.body, 'y', 45)).toBe(y0)
  })

  it('3/4 and side views use the view images, hide the front mouth and eyelids, and mirror for facing left', () => {
    const { doc, rig } = build()
    const r = applyCardLook(doc, rig, { pose: 'diam', view: 'sisi', facing: -1 }, 12)!
    const p = cardParts(doc, rig)!
    expect(r.applied).toEqual(expect.arrayContaining(['badan diam_sisi', 'kepala netral_sisi', 'menghadap kiri']))
    expect(assetAt(p.body, 12)).toBe(41)
    expect(assetAt(p.head, 12)).toBe(51)
    expect(evalProp(p.root, 'scaleX', 11)).toBe(1)
    expect(evalProp(p.root, 'scaleX', 12)).toBe(-1)
    expect(evalProp(p.mouth!, 'scaleX', 12)).toBeLessThan(0.01)
    expect(evalProp(p.blink!, 'scaleX', 12)).toBeLessThan(0.01)
    applyCardLook(doc, rig, { pose: 'diam', view: 'depan', facing: 1 }, 40)
    expect(evalProp(p.root, 'scaleX', 40)).toBe(1)
    expect(evalProp(p.mouth!, 'scaleX', 40)).toBe(1)
    expect(assetAt(p.head, 40)).toBe(10)
  })

  it('keeps the current expression in the other view when the image exists', () => {
    const { doc, rig } = build()
    applyCardLook(doc, rig, {}, 0)
    const p = cardParts(doc, rig)!
    p.head.swaps = [{ f: 5, assetId: 11 }]                               // "senang"
    expect(headExpressionAt(p, 6)).toBe('senang')
    applyCardLook(doc, rig, { pose: 'diam', view: '34' }, 8)
    expect(assetAt(p.head, 8)).toBe(52)                                   // senang_34
    applyCardLook(doc, rig, { pose: 'diam', view: 'sisi' }, 16)
    expect(assetAt(p.head, 16)).toBe(51)                                  // no senang_sisi -> netral_sisi
  })

  it('falls back to the standing view of the pose and says so', () => {
    const { doc, rig } = build()
    const r = applyCardLook(doc, rig, { pose: 'tunjuk', view: '34' }, 3)!
    expect(r.notes.join(' ')).toContain('"diam_34"')
    expect(assetAt(cardParts(doc, rig)!.body, 3)).toBe(40)
    expect(applyCardLook(doc, rig, { pose: 'duduk_sila', view: 'sisi' }, 3)!.applied).toContain('badan diam_sisi')
  })

  it('glances sideways with the eyes only and returns', () => {
    const { doc, rig } = build()
    applyCardLook(doc, rig, { gaze: 'kanan' }, 10)
    applyCardLook(doc, rig, { gaze: 'kiri' }, 20)
    applyCardLook(doc, rig, { gaze: null }, 30)
    const p = cardParts(doc, rig)!
    expect([assetAt(p.head, 10), assetAt(p.head, 20), assetAt(p.head, 30)]).toEqual([53, 54, 10])
    expect(assetAt(p.body, 15)).toBe(1)                                   // the body is untouched
    expect(p.root.keyframes?.scaleX).toBeUndefined()
  })

  it('never mirrors an asymmetric design', () => {
    const { doc, rig } = build(true, { ...META, spec: { version: 2, packs: ['dasar'], mirror_ok: false } })
    const r = applyCardLook(doc, rig, { pose: 'diam', view: 'sisi', facing: -1 }, 5)!
    expect(r.notes.join(' ')).toContain('asimetris')
    expect(cardParts(doc, rig)!.root.keyframes?.scaleX).toBeUndefined()
  })

  it('answers null for a character that is not a card, and reports a missing glance image', () => {
    const { doc, rig } = build(false)
    expect(applyCardLook(doc, rig, { gaze: 'kanan' }, 3)!.notes.join(' ')).toContain('melirik')
    expect(applyCardLook(doc, { ...rig, pieces: {} }, { pose: 'diam' }, 3)).toBeNull()
  })

  it('clearCardLook removes what a look set at that frame and nothing else', () => {
    const { doc, rig } = build()
    applyCardLook(doc, rig, { pose: 'duduk_sila' }, 10)
    applyCardLook(doc, rig, { pose: 'diam', view: 'sisi', facing: -1 }, 30)
    clearCardLook(doc, rig, 30)
    const p = cardParts(doc, rig)!
    expect(assetAt(p.body, 40)).toBe(42)                                  // back to the sitting look of frame 10
    expect(evalProp(p.root, 'scaleX', 40)).toBe(1)
    expect(evalProp(p.mouth!, 'scaleX', 40)).toBe(1)
    expect(p.body.swaps!.map((k) => k.f)).toEqual([10])
    expect([evalProp(p.head, 'x', 40), evalProp(p.head, 'y', 40)]).toEqual(p.data!.head.duduk_sila)
  })

  it('exposes what the card can do', () => {
    const c = cardCapabilities(build().parts)
    expect(c).toMatchObject({ views: ['34', 'sisi'], bodyViews: ['34', 'sisi'], gaze: true, run: true, run2: true, jump: false, mirror: true })
    expect(c.sit.sort()).toEqual(['duduk_sila', 'duduk_tegak'])
    expect(c.basePoses).toEqual(['diam', 'tunjuk', 'angkat'])
    const none = cardCapabilities(build(false).parts)
    expect(none).toMatchObject({ views: [], gaze: false, run: false, sit: [] })
  })

  it('resolves body and head slots', () => {
    const { parts } = build()
    expect(bodySlotFor(parts, 'diam', 'depan')).toEqual({ slot: 'diam', exact: true })
    expect(bodySlotFor(parts, 'diam', '34')).toEqual({ slot: 'diam_34', exact: true })
    expect(bodySlotFor(parts, 'tidak_ada', 'depan')).toBeNull()
    expect(headKeyFor(parts, 'marah', '34')).toBe('netral_34')
    expect(headKeyFor(parts, 'netral', '34', 'kanan')).toBe('lirik_kanan')
    expect(headKeyFor(parts, 'netral', 'depan')).toBe('netral')
  })
})

describe('applyCardTurn', () => {
  it('turns the head to 3/4 then side, holds, and comes back; left mirrors the head layer', () => {
    const { doc, rig } = build()
    const end = applyCardTurn(doc, rig, -1, 10, { hold: 1, back: true })!
    const p = cardParts(doc, rig)!
    expect(assetAt(p.head, 9)).toBe(10)
    expect(assetAt(p.head, 10)).toBe(50)                                  // netral_34
    expect(assetAt(p.head, 16)).toBe(51)                                  // netral_sisi
    expect(evalProp(p.head, 'scaleX', 14)).toBe(-1)
    expect(evalProp(p.head, 'scaleX', 9)).toBe(1)
    expect(assetAt(p.head, end)).toBe(10)                                 // back to the front head
    expect(evalProp(p.head, 'scaleX', end)).toBe(1)
    expect(evalProp(p.mouth!, 'scaleX', 14)).toBeLessThan(0.01)
    expect(evalProp(p.mouth!, 'scaleX', end)).toBe(1)
    expect(assetAt(p.body, 14)).toBe(1)                                   // the body does not turn
    expect(p.root.keyframes?.scaleX).toBeUndefined()
  })

  it('can stay turned', () => {
    const { doc, rig } = build()
    applyCardTurn(doc, rig, 1, 10, { hold: 0.5, back: false })
    const p = cardParts(doc, rig)!
    expect(assetAt(p.head, 200)).toBe(51)
  })

  it('does nothing for a card without side heads, or when mirroring is not allowed', () => {
    expect(applyCardTurn(build(false).doc, build(false).rig, 1, 5, { hold: 1, back: true })).toBeNull()
    const m = build(true, { ...META, spec: { version: 2, packs: ['dasar'], mirror_ok: false } })
    expect(applyCardTurn(m.doc, m.rig, -1, 5, { hold: 1, back: true })).toBeNull()
  })
})

describe('applyCardMotion', () => {
  it('walks left in side view: mirrored while it walks, travelling, then back to how it was', () => {
    const { doc, rig, parts } = build()
    const x0 = parts.root.x
    expect(applyRigMotion(doc, rig, 'walk', 10, { duration: 2, distance: 300, dir: -1 })).toBe(true)
    const p = cardParts(doc, rig)!
    const end = 10 + 48
    expect(evalProp(p.root, 'scaleX', 9)).toBe(1)
    expect(evalProp(p.root, 'scaleX', 20)).toBe(-1)
    expect(evalProp(p.root, 'scaleX', end)).toBe(1)
    expect(assetAt(p.body, 20)).toBe(41)                                  // diam_sisi
    expect(assetAt(p.head, 20)).toBe(51)                                  // netral_sisi
    expect(assetAt(p.body, end)).toBe(1)
    expect(assetAt(p.head, end)).toBe(10)
    expect(evalProp(p.root, 'x', end)).toBeCloseTo(x0 - 300, 3)
    expect([evalProp(p.head, 'x', 20), evalProp(p.head, 'y', 20)]).toEqual(p.data!.head.diam_sisi)
    expect(evalProp(p.head, 'x', end)).toBe(p.data!.head0[0])
  })

  it('without side images the figure still walks (root bob), unmirrored', () => {
    const { doc, rig } = build(false)
    expect(applyRigMotion(doc, rig, 'walk', 0, { duration: 2, distance: 200, dir: 1 })).toBe(true)
    const p = cardParts(doc, rig)!
    expect(p.root.keyframes?.x?.length).toBeGreaterThan(1)
    expect(p.root.keyframes?.scaleX).toBeUndefined()
    expect(p.body.swaps).toBeUndefined()
  })

  it('runs with two alternating stride images and leans the way it runs', () => {
    const right = build(), left = build()
    applyCardMotion(right.doc, right.rig, 'run', 0, { duration: 2, distance: 600, dir: 1 })
    applyCardMotion(left.doc, left.rig, 'run', 0, { duration: 2, distance: 600, dir: -1 })
    const pr = cardParts(right.doc, right.rig)!, pl = cardParts(left.doc, left.rig)!
    const seen = new Set((pr.body.swaps ?? []).map((s) => s.assetId))
    expect(seen.has(44) && seen.has(45)).toBe(true)                       // lari_sisi and lari_sisi_2
    expect(evalProp(pr.root, 'rotation', 10)).toBeGreaterThan(0)
    expect(evalProp(pl.root, 'rotation', 10)).toBeLessThan(0)
    expect(evalProp(pl.root, 'scaleX', 10)).toBe(-1)
    expect(evalProp(pl.root, 'x', 48)).toBeLessThan(pl.root.x)
  })

  it('jumps with both hands up (the "angkat" pose) and lands back', () => {
    const { doc, rig } = build()
    applyRigMotion(doc, rig, 'jump', 0, { duration: 1, distance: 0, dir: 1 })
    const p = cardParts(doc, rig)!
    expect(assetAt(p.body, 12)).toBe(3)
    expect(assetAt(p.body, 24)).toBe(1)
  })

  it('nods with the head and breathes with the whole figure', () => {
    const { doc, rig } = build()
    expect(applyRigMotion(doc, rig, 'nod', 0, { duration: 2, distance: 0, dir: 1 })).toBe(true)
    expect(applyRigMotion(doc, rig, 'breathe', 0, { duration: 3, distance: 0, dir: 1 })).toBe(true)
    const p = cardParts(doc, rig)!
    expect(p.head.keyframes?.rotation?.length).toBeGreaterThan(2)
    expect(p.root.keyframes?.y?.length).toBeGreaterThan(2)
  })

  it('leaves movements it does not know to the bone motions', () => {
    const { doc, rig } = build()
    expect(applyCardMotion(doc, rig, 'wave', 0, { duration: 2, distance: 0, dir: 1 })).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { worldMatrix } from '../anim'
import type { SceneDocument } from '../types'
import { applyCardLipSync, blinkKeys, CARD_ROLES, cardLayers, meanHeadDx, type CardMeta, type PreparedCard } from './card'
import { findRigs, rigExpressions } from './rigMotion'

// the numbers of karakter/uki/character.json
const META: CardMeta = {
  name: 'uki',
  body: { canvas: [800, 1400], feet_y: 1375, center_x: 400, char_height_px: 1300, poses: ['diam', 'lambai'], head_dx: { diam: -36, lambai: -34 } },
  head: { canvas: [400, 400], paste_on_body: [200, 0], expressions: ['netral', 'senang', 'kaget'] },
  mouth: { canvas: [120, 80], paste_on_head_topleft: [138, 204], shapes: ['a', 'i', 'u', 'e', 'o'] },
  blink: { canvas: [400, 400], paste_on_head_topleft: [0, 0] },
}
const P: PreparedCard = {
  name: 'Uki', version: 1, meta: META,
  assets: { body: { diam: 1, lambai: 2 }, head: { netral: 10, senang: 11, kaget: 12 }, mouth: { a: 20, i: 21, u: 22, e: 23, o: 24 }, blink: 30 },
}
let n = 0
const newId = () => `L${++n}`
const scene = { width: 1280, height: 720, duration: 10, fps: 24 }
const docOf = (layers: SceneDocument['layers']): SceneDocument => ({ schema: 1, settings: { ...scene, background: '#000' }, layers })

describe('cardLayers', () => {
  const layers = cardLayers(P, scene, newId, { xFrac: 0.5, footY: 700 })
  const doc = docOf(layers)
  const role = (r: string) => layers.find((l) => l.rig?.role === r)!
  const k = (720 * 0.78) / 1300

  it('is one rig with a root bone, body, head, mouth and eyelid', () => {
    expect(layers.map((l) => l.rig?.role)).toEqual(['bone:root', `piece:${CARD_ROLES.body}`, `piece:${CARD_ROLES.head}`, `piece:${CARD_ROLES.mouth}`, `piece:${CARD_ROLES.blink}`])
    const rigs = findRigs(layers)
    expect(rigs).toHaveLength(1)
    expect(rigExpressions(rigs[0])).toEqual(['default', 'netral', 'senang', 'kaget']) // the editor's expression buttons see the heads
  })

  it('puts the feet on footY and the head where character.json pastes it', () => {
    const bodyM = worldMatrix(doc, role(`piece:${CARD_ROLES.body}`), 0)
    // body pixel (center_x, feet_y) -> scene; the body image's origin is its centre
    const feet = { x: bodyM.a * (400 - 400) + bodyM.c * (1375 - 700) + bodyM.tx, y: bodyM.b * (400 - 400) + bodyM.d * (1375 - 700) + bodyM.ty }
    expect(feet.x).toBeCloseTo(640, 3)
    expect(feet.y).toBeCloseTo(700, 3)
    const headM = worldMatrix(doc, role(`piece:${CARD_ROLES.head}`), 0)
    // head centre = body top-left + paste + mean dx + half the head canvas
    const hx = 200 + meanHeadDx(META) + 200
    const hy = 0 + 200
    expect(headM.tx).toBeCloseTo(bodyM.tx + (hx - 400) * k, 3)
    expect(headM.ty).toBeCloseTo(bodyM.ty + (hy - 700) * k, 3)
    expect(headM.a).toBeCloseTo(k, 6) // drawn at the body's scale
    const mouthM = worldMatrix(doc, role(`piece:${CARD_ROLES.mouth}`), 0)
    expect(mouthM.tx).toBeCloseTo(headM.tx + (138 + 60 - 200) * k, 3)
    expect(mouthM.ty).toBeCloseTo(headM.ty + (204 + 40 - 200) * k, 3)
  })

  it('starts with the neutral head and the mouth / eyelid hidden, blinking now and then', () => {
    expect(role(`piece:${CARD_ROLES.head}`).assetId).toBe(10)
    expect(role(`piece:${CARD_ROLES.body}`).assetId).toBe(1)
    expect(role(`piece:${CARD_ROLES.mouth}`).opacity).toBe(0)
    const lid = role(`piece:${CARD_ROLES.blink}`)
    expect(lid.opacity).toBe(0)
    expect(lid.keyframes?.opacity?.filter((x) => x.v === 1).length).toBeGreaterThanOrEqual(2)
  })
})

describe('blinkKeys', () => {
  it('opens again a few frames after closing, and stays inside the scene', () => {
    const keys = blinkKeys(10, 24)
    for (let i = 1; i < keys.length; i += 2) {
      expect(keys[i].v).toBe(1)
      expect(keys[i + 1].v).toBe(0)
      expect(keys[i + 1].f - keys[i].f).toBe(3)
    }
    expect(keys[keys.length - 1].f).toBeLessThan(240)
  })
})

describe('applyCardLipSync', () => {
  it('shows a mouth shape while speaking, hides it in pauses and after the speech', () => {
    const mouth = cardLayers(P, scene, newId).find((l) => l.rig?.role === `piece:${CARD_ROLES.mouth}`)!
    const n = applyCardLipSync(mouth, [0, 1, 1, 0.4, 0, 0, 0.75], 10)
    expect(n).toBeGreaterThan(0)
    const op = mouth.keyframes!.opacity!
    expect(op).toEqual([{ f: 10, v: 0, e: 'step' }, { f: 11, v: 1, e: 'step' }, { f: 14, v: 0, e: 'step' }, { f: 16, v: 1, e: 'step' }, { f: 17, v: 0, e: 'step' }])
    expect(mouth.swaps![0]).toEqual({ f: 11, assetId: 20 }) // wide = "a"
    expect(mouth.swaps!.every((s) => [20, 21, 22, 23, 24].includes(s.assetId))).toBe(true)
  })

  it('keeps keys outside the spoken range', () => {
    const mouth = cardLayers(P, scene, newId).find((l) => l.rig?.role === `piece:${CARD_ROLES.mouth}`)!
    mouth.keyframes = { opacity: [{ f: 100, v: 1, e: 'step' }] }
    applyCardLipSync(mouth, [1, 0], 0)
    expect(mouth.keyframes.opacity!.some((x) => x.f === 100)).toBe(true)
  })
})

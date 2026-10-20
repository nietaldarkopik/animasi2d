import { describe, expect, it } from 'vitest'
import { isSkirt, planGroups } from './rigRender'

const z: Record<string, number> = { hair_back: 1, body: 2, shoes: 3, bottom: 4, top: 5, bag: 6, face: 7, hair_front: 8, hijab: 9, eyes: 10, brows: 11, mouth: 12, glasses: 13, hat: 14, headphone: 15, accessory: 16 }
const zOf = (s: string) => z[s] ?? 0
const label = (s: string) => s
const all = Object.keys(z)

describe('planGroups', () => {
  const keys = (g: ReturnType<typeof planGroups>) => g.map((x) => x.key)

  it('head parts are separate pieces on the head bone, ordered by stacking; back hair hangs behind the torso', () => {
    const g = planGroups(all, false, zOf, label)
    const head = g.filter((x) => x.bone === 'head')
    expect(head.map((x) => x.key)).toEqual(['face', 'hair_front', 'hijab', 'eyes', 'brows', 'mouth', 'glasses', 'hat', 'headphone'])
    expect(head.map((x) => x.order)).toEqual([...head.map((x) => x.order)].sort((a, b) => a - b))
    const back = g.find((x) => x.key === 'hair_back')!
    expect([back.bone, back.order]).toEqual(['torso', 0])
    expect(g.find((x) => x.key === 'torso')!.order).toBeGreaterThan(back.order)
  })

  it('trousers are cut into both legs; a skirt stays one piece on the root and is excluded from the legs', () => {
    const pants = planGroups(all, false, zOf, label)
    expect(keys(pants)).toEqual(expect.arrayContaining(['leg_l_up', 'leg_l_low', 'leg_r_up', 'leg_r_low']))
    expect(keys(pants)).not.toContain('skirt')
    expect(pants.find((x) => x.key === 'leg_l_up')!.slots).toContain('bottom')

    const skirt = planGroups(all, true, zOf, label)
    expect(keys(skirt)).toContain('skirt')
    expect(skirt.find((x) => x.key === 'skirt')!.bone).toBe('root')
    expect(skirt.find((x) => x.key === 'leg_l_up')!.slots).not.toContain('bottom')
  })

  it('arms are cut at the shoulder/elbow into upper and lower pieces on their own bones, left and right', () => {
    const g = planGroups(all, false, zOf, label)
    expect(g.filter((x) => x.key.startsWith('arm_')).map((x) => [x.key, x.bone])).toEqual([
      ['arm_l_up', 'arm_l'], ['arm_l_low', 'forearm_l'], ['arm_r_up', 'arm_r'], ['arm_r_low', 'forearm_r'],
    ])
    const l = g.find((x) => x.key === 'arm_l_up')!.keep![0], r = g.find((x) => x.key === 'arm_r_up')!.keep![0]
    expect(l[2]).toBeLessThan(r[0]) // the two arm regions never overlap
  })

  it('the torso excludes the arm bands but keeps the centre; body skin is only kept above the hips', () => {
    const t = planGroups(all, false, zOf, label).find((x) => x.key === 'torso')!
    expect(t.slots).toEqual(['body', 'top', 'bag', 'accessory'])
    const covers = (x: number, y: number) => t.keep!.some(([a, b, c, d]) => x >= a && x < c && y >= b && y < d)
    expect(covers(200, 450)).toBe(true)    // chest
    expect(covers(80, 400)).toBe(false)    // left arm band
    expect(covers(320, 400)).toBe(false)   // right arm band
    expect(covers(80, 200)).toBe(true)     // above the shoulders (head/hair area) is not an arm
    expect(t.slotKeep!.body[0][3]).toBe(556)
  })

  it('missing slots simply produce fewer pieces (no top, no shoes, no hijab)', () => {
    const g = planGroups(['body', 'face', 'eyes'], false, zOf, label)
    expect(g.find((x) => x.key === 'torso')!.slots).toEqual(['body'])
    expect(g.find((x) => x.key === 'leg_l_low')!.slots).toEqual(['body'])
    expect(keys(g)).not.toContain('hijab')
    expect(keys(g)).not.toContain('hair_back')
  })

  it('a split part also gets a copy behind the torso, so the clothes sit between the two hair layers', () => {
    const g = planGroups(all, false, zOf, label, ['hair_front'])
    const back = g.find((x) => x.key === 'hair_front_back')!
    expect([back.bone, back.order, back.slots]).toEqual(['torso', 0, ['hair_front:back']])
    expect(back.order).toBeLessThan(g.find((x) => x.key === 'torso')!.order) // behind the torso image
    expect(g.find((x) => x.key === 'hair_front')!.bone).toBe('head')          // the front copy stays on the head
    expect(planGroups(all, false, zOf, label).some((x) => x.key.endsWith('_back') && x.key !== 'hair_back')).toBe(false)
  })

  it('the anime torso is cut with the body; posed arms become rigid pieces on the upper-arm bones, behind or in front of the sleeve', () => {
    const slots = [...all, 'torso', 'arm_l', 'arm_r']
    const z2: Record<string, number> = { ...z, torso: 5, arm_l: 6, arm_r: 6, top: 7 }
    const zz = (s: string) => z2[s] ?? 0
    const g = planGroups(slots, false, zz, label)
    expect(g.find((x) => x.key === 'torso')!.slots).toEqual(['body', 'torso', 'top', 'bag', 'accessory'].sort((a, b) => zz(a) - zz(b)))
    const l = g.find((x) => x.key === 'arm_l_pose')!, r = g.find((x) => x.key === 'arm_r_pose')!
    expect([l.bone, r.bone, l.order]).toEqual(['arm_l', 'arm_r', -1])         // under the sleeve (order 0 piece)
    expect(g.find((x) => x.key === 'arm_l_up')!.order).toBeGreaterThan(l.order)
    const front = planGroups(slots, false, (s) => (s === 'arm_l' ? 9 : zz(s)), label) // stacked above the top
    expect(front.find((x) => x.key === 'arm_l_pose')!.order).toBe(20)
    expect(planGroups(all, false, zz, label).some((x) => x.key.endsWith('_pose'))).toBe(false)
  })

  it('isSkirt recognises Indonesian and English names', () => {
    expect(isSkirt({ name: 'Rok plisa biru 1', key: null })).toBe(true)
    expect(isSkirt({ name: 'Rok panjang', key: 'bottom_skirt' })).toBe(true)
    expect(isSkirt({ name: 'Celana jeans', key: null })).toBe(false)
    expect(isSkirt({ name: 'Wortel', key: 'bottom_trousers' })).toBe(false)
    expect(isSkirt(undefined)).toBe(false)
  })
})

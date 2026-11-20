import { describe, expect, it } from 'vitest'
import { applyCalib, calibChanged, calibPayload, clickToCanvas, livePreview, mapRule, missingRequired, normHex, slugify, type Calibration, type DraftSheet } from './cardBuilder'

const calib: Calibration = { chin_y: 284, mouth: [199, 258], eyes: [[163, 215], [232, 215]] }

describe('mapRule', () => {
  it('builds the tool syntax', () => {
    expect(mapRule({ from: '#5E516D', to: '3f5f9f', tol: 14, groups: ['head'], not: '125 185 275 250' })).toBe('#5e516d>#3f5f9f;tol=14;not=125,185,275,250;groups=head')
  })
  it('skips empty options and rejects bad colours', () => {
    expect(mapRule({ from: '#112233', to: '#445566', tol: 0, groups: [], not: '' })).toBe('#112233>#445566')
    expect(mapRule({ from: '#12', to: '#445566', tol: 10, groups: [], not: '' })).toBeNull()
    expect(mapRule({ from: '#112233', to: '#445566', tol: 10, groups: [], not: '1,2,3' })).toBe('#112233>#445566;tol=10')
  })
  it('normHex', () => { expect(normHex(' ABCDEF ')).toBe('#abcdef'); expect(normHex('abc')).toBeNull() })
})

describe('calibration', () => {
  it('maps clicks to canvas pixels, clamped', () => {
    const rect = { left: 10, top: 20, width: 200, height: 250 }
    expect(clickToCanvas(110, 145, rect, [400, 500])).toEqual([200, 250])
    expect(clickToCanvas(0, 999, rect, [400, 500])).toEqual([0, 500])
  })
  it('applies targets and keeps the eyes ordered', () => {
    expect(applyCalib(calib, 'chin', [1, 290]).chin_y).toBe(290)
    expect(applyCalib(calib, 'mouth', [200, 260]).mouth).toEqual([200, 260])
    expect(applyCalib(calib, 'eyeL', [300, 210]).eyes).toEqual([[232, 215], [300, 210]])
  })
  it('payload is whole numbers', () => {
    const p = calibPayload({ ...calib, mouth: [199.6, 258.2], mouth_scale: 1.2 })
    expect(p.mouth).toEqual([200, 258])
    expect(p.mouth_scale).toBe(1.2)
    expect('lid_scale' in p).toBe(false)
    expect([p.head_dx, p.head_dy, p.head_rot]).toEqual([0, 0, 0])
    expect(calibPayload({ ...calib, head_dx: 3.4, head_dy: -2, head_rot: -6.26 })).toMatchObject({ head_dx: 3, head_dy: -2, head_rot: -6.3 })
  })
})

describe('live preview', () => {
  const saved: Calibration = { ...calib, mouth_scale: 1, lid_scale: 1, head_dx: 4, head_dy: -2, head_rot: 1 }
  it('is neutral when nothing changed', () => {
    const p = livePreview(saved, saved)
    expect(p.head).toMatchObject({ dx: 0, dy: 0, rot: 0, pivot: [204, 377] })
    expect(p.mouth.scale).toBe(1)
    expect(p.lids.map((l) => l.scale)).toEqual([1, 1])
    expect(calibChanged(saved, saved)).toBe(false)
    expect(calibChanged({ ...calib }, { ...calib, mouth_scale: 1, lid_scale: 1, head_dx: 0, head_dy: 0, head_rot: 0 })).toBe(false)
  })
  it('turns slider values into deltas against the applied calibration', () => {
    const c = { ...saved, head_dx: 10, head_rot: -3, mouth_scale: 1.5, lid_scale: 0.8 }
    const p = livePreview(c, saved)
    expect(p.head).toMatchObject({ dx: 6, dy: 0, rot: -4 })
    expect(p.mouth.scale).toBe(1.5)
    expect(p.lids[0].scale).toBeCloseTo(0.8)
    expect(calibChanged(c, saved)).toBe(true)
  })
  it('moves the lids with the eye marks and scales with their spacing', () => {
    const c: Calibration = { ...saved, eyes: [[153, 215], [242, 215]] }
    const p = livePreview(c, saved)
    expect(p.lids[0]).toMatchObject({ from: [163, 215], to: [153, 215] })
    expect(p.lids[1].scale).toBeCloseTo(89 / 69)
    expect(p.mid).toBe(197.5)
  })
  it('treats missing scales as 1', () => {
    expect(livePreview({ ...calib, mouth_scale: 2 }, calib).mouth.scale).toBe(2)
  })
})

describe('misc', () => {
  it('slugify', () => { expect(slugify('Sri Wulandari!')).toBe('sri_wulandari'); expect(slugify('Ábe  Çan')).toBe('abe_can') })
  it('missingRequired', () => {
    const s = [{ id: 'a', required: true, uploaded: false }, { id: 'b', required: true, uploaded: true }, { id: 'c', required: false, uploaded: false }] as DraftSheet[]
    expect(missingRequired(s)).toEqual(['a'])
  })
})

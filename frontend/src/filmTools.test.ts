import { describe, expect, it } from 'vitest'
import { evalCamera } from './anim'
import { camFocus, camKeyFrames, camPan, camShake, camZoom } from './camera'
import { addEffect, balloonSize, boardFromScript, makeBalloon, makeShadow, makeTitle, parseScript, pickBackground, propPlacement, sceneSecondsFor, setTimeOfDay, spreadX, subtitlesFromDialog, subtitleSeconds, timeOfDay } from './filmTools'
import { effectAt, migrate, mergeView, sceneView } from './movie'
import type { ProjectDoc, SceneCamera } from './types'

let n = 0
const id = () => `i${++n}`

describe('camera moves', () => {
  it('zoom, pan and focus write keys the evaluator interpolates', () => {
    const cam: SceneCamera = {}
    camZoom(cam, 0, 48, 1, 2, 'linear')
    expect(evalCamera(cam, 24, 1280, 720).zoom).toBeCloseTo(1.5, 6)
    camPan(cam, 0, 48, { x: 300, y: 360 }, { x: 900, y: 360 }, 'linear')
    expect(evalCamera(cam, 24, 1280, 720).x).toBeCloseTo(600, 6)

    const c2: SceneCamera = {}
    camFocus(c2, 10, 24, 200, 150, 2, 1280, 720)
    expect(evalCamera(c2, 10, 1280, 720)).toMatchObject({ x: 640, y: 360, zoom: 1 }) // starts where it was
    const end = evalCamera(c2, 34, 1280, 720)
    expect([end.x, end.y, end.zoom]).toEqual([200, 150, 2])
    expect(camKeyFrames(c2)).toEqual([10, 34])
  })

  it('focus starts from a moving camera, not from the default', () => {
    const cam: SceneCamera = {}
    camZoom(cam, 0, 20, 1, 3, 'linear')
    camFocus(cam, 10, 10, 100, 100, 1, 1280, 720)
    expect(evalCamera(cam, 10, 1280, 720).zoom).toBeCloseTo(2, 6)
  })

  it('shake is deterministic, bounded by the amplitude, fades out and comes to rest', () => {
    const a: SceneCamera = {}, b: SceneCamera = {}
    camShake(a, 0, 24, 20, { x: 640, y: 360 })
    camShake(b, 0, 24, 20, { x: 640, y: 360 })
    expect(a).toEqual(b)
    for (const k of [...a.x!, ...a.y!]) expect(Math.abs(k.v - (a.x!.includes(k) ? 640 : 360))).toBeLessThanOrEqual(20)
    const last = a.x!.at(-1)!
    expect(last.v).toBe(640)
    const early = Math.max(...a.x!.slice(0, 4).map((k) => Math.abs(k.v - 640)))
    const late = Math.max(...a.x!.slice(-4).map((k) => Math.abs(k.v - 640)))
    expect(late).toBeLessThan(early + 1e-9)
    expect(a.x!.length).toBeGreaterThan(8)
  })
})

describe('effects and time of day', () => {
  it('a time preset replaces the previous tint and keeps other effects; noon removes the tint', () => {
    let fx = addEffect(undefined, 'rain', 0.5, id)
    fx = setTimeOfDay(fx, 'malam', id)
    expect(fx.map((e) => e.kind).sort()).toEqual(['rain', 'tint'])
    expect(timeOfDay(fx)).toBe('Malam')
    fx = setTimeOfDay(fx, 'sore', id)
    expect(fx.filter((e) => e.kind === 'tint')).toHaveLength(1)
    expect(timeOfDay(fx)).toBe('Sore')
    fx = setTimeOfDay(fx, 'siang', id)
    expect(fx.map((e) => e.kind)).toEqual(['rain'])
    expect(timeOfDay(fx)).toBe('Siang (normal)')
  })

  it('adding an effect of the same kind replaces it', () => {
    let fx = addEffect(undefined, 'snow', 0.2, id)
    fx = addEffect(fx, 'snow', 0.9, id)
    expect(fx).toHaveLength(1)
    expect(fx[0].intensity).toBe(0.9)
  })
})

describe('balloons, titles, shadows', () => {
  it('a balloon grows with its text and its tail points at the target', () => {
    expect(balloonSize('Hai', 32).width).toBe(180)
    expect(balloonSize('x'.repeat(60), 32).width).toBeGreaterThan(balloonSize('x'.repeat(10), 32).width)
    expect(balloonSize('x'.repeat(200), 32).height).toBeGreaterThan(balloonSize('x', 32).height)
    const l = makeBalloon('b', 'Halo semua!', 'speech', { x: 500, y: 200 }, { x: 420, y: 400 })
    expect(l.type).toBe('balloon')
    expect([l.tailX, l.tailY]).toEqual([-80, 200])
    expect(makeBalloon('b', 'x', 'thought', { x: 0, y: 0 }, null).tailY).toBeGreaterThan(0)
  })

  it('a title fades in and out across its length', () => {
    const t = makeTitle('t', 'Film Kami', 1280, 720, 24, 4)
    const o = t.keyframes!.opacity!
    expect(o[0]).toMatchObject({ f: 0, v: 0 })
    expect(o.at(-1)).toMatchObject({ f: 96, v: 0 })
    expect(o.some((k) => k.v === 1)).toBe(true)
    expect(t.x).toBe(640)
  })

  it('a shadow is a flat translucent ellipse', () => {
    const s = makeShadow('s', { x: 100, y: 600 }, 200)
    expect([s.shape, s.width, s.height, s.opacity]).toEqual(['ellipse', 200, 44, 0.28])
  })
})

describe('subtitles', () => {
  it('lasts longer for longer lines, with a floor', () => {
    expect(subtitleSeconds('Hai')).toBe(1.2)
    expect(subtitleSeconds('x'.repeat(100))).toBeGreaterThan(subtitleSeconds('x'.repeat(20)))
  })

  it('lays dialogue out one after another and stops at the end of the scene', () => {
    const lines = [{ who: 'Uki', text: 'Selamat pagi, semuanya!' }, { who: 'Sekar', text: 'Pagi!' }, { who: 'Uki', text: 'x'.repeat(300) }]
    const s = subtitlesFromDialog(lines, 1, 6, id)
    expect(s.map((x) => x.text.split(':')[0])).toEqual(['Uki', 'Sekar', 'Uki'])
    expect(s[1].start).toBeGreaterThan(s[0].end)
    expect(s.at(-1)!.end).toBeLessThanOrEqual(6)
    const short = subtitlesFromDialog(lines, 5, 6, id)
    expect(short.length).toBeLessThan(3) // later lines do not fit
    expect(subtitlesFromDialog(lines, 1, 6, id, false)[0].text).toBe('Selamat pagi, semuanya!')
  })
})

describe('storyboard script', () => {
  const script = `# Pagi di sekolah | lokasi: Halaman sekolah
(Uki tiba di sekolah dan melambai)
Uki: Selamat pagi, Sekar!
Sekar: Pagi, Uki. Sudah mengerjakan tugas?

# Di kelas | lokasi: Ruang kelas
Uki: Belum...
Bu guru masuk ke kelas.
`
  const scenes = parseScript(script)

  it('splits into scenes with location, summary, dialogue and characters', () => {
    expect(scenes).toHaveLength(2)
    expect(scenes[0]).toMatchObject({ name: 'Pagi di sekolah', location: 'Halaman sekolah', summary: 'Uki tiba di sekolah dan melambai', characters: ['Uki', 'Sekar'] })
    expect(scenes[0].dialog).toEqual([{ who: 'Uki', text: 'Selamat pagi, Sekar!' }, { who: 'Sekar', text: 'Pagi, Uki. Sudah mengerjakan tugas?' }])
    expect(scenes[1].dialog).toHaveLength(1)
    expect(scenes[1].summary).toBe('Bu guru masuk ke kelas.') // a plain line is narration
  })

  it('tolerates scripts without headings, blank lines and odd input', () => {
    expect(parseScript('')).toEqual([])
    const s = parseScript('Uki: Halo\n\n\nSekar: Hai')
    expect(s).toHaveLength(1)
    expect(s[0].name).toBe('Scene 1')
    expect(s[0].dialog).toHaveLength(2)
    expect(parseScript('# A\n# B')).toHaveLength(2)
    expect(parseScript('# ' + 'x'.repeat(200))[0].name).toHaveLength(80)
  })

  it('a colon inside the sentence does not make a speaker of the whole line', () => {
    const s = parseScript('Uki: Kita punya tiga tugas: A, B, C')
    expect(s[0].dialog).toEqual([{ who: 'Uki', text: 'Kita punya tiga tugas: A, B, C' }])
  })

  it('scene length follows the dialogue and stays within limits', () => {
    expect(sceneSecondsFor({ dialog: [] })).toBe(3)
    expect(sceneSecondsFor(scenes[0])).toBeGreaterThan(sceneSecondsFor(scenes[1]))
    expect(sceneSecondsFor({ dialog: Array.from({ length: 400 }, () => ({ who: 'a', text: 'x'.repeat(400) })) })).toBe(600)
  })

  it('picks the background that matches the location words', () => {
    const bgs = [{ name: 'Halaman sekolah', tags: ['sekolah', 'luar'] }, { name: 'Ruang kelas', tags: ['sekolah', 'kelas'] }, { name: 'Taman', tags: ['taman'] }]
    expect(pickBackground('Ruang kelas', bgs)!.name).toBe('Ruang kelas')
    expect(pickBackground('di taman kota', bgs)!.name).toBe('Taman')
    expect(pickBackground('Gunung', bgs)).toBeNull()
    expect(pickBackground('', bgs)).toBeNull()
  })

  it('turns a script scene into board notes with ids', () => {
    const b = boardFromScript(scenes[0], id)
    expect(b.location).toBe('Halaman sekolah')
    expect(b.dialog!.map((d) => d.who)).toEqual(['Uki', 'Sekar'])
    expect(new Set(b.dialog!.map((d) => d.id)).size).toBe(2)
    expect(boardFromScript({ name: 'x', location: '', summary: '', dialog: [], characters: [] }, id)).toEqual({})
  })

  it('spreads characters across the width', () => {
    expect(spreadX(1)).toEqual([0.5])
    const x = spreadX(3)
    expect(x[0]).toBeCloseTo(0.2, 6)
    expect(x[2]).toBeCloseTo(0.8, 6)
    expect(x[1]).toBeCloseTo(0.5, 6)
  })
})

describe('document plumbing', () => {
  const proj = (): ProjectDoc => migrate({
    schema: 2, settings: { width: 1280, height: 720, fps: 24 }, audio: [],
    scenes: [{ id: 's1', name: 'S1', duration: 4, background: '#ffffff', transition: null, layers: [], camera: { zoom: [{ f: 0, v: 1, e: 'linear' }] }, effects: [{ id: 'e', kind: 'rain', intensity: 0.5 }], subtitles: [{ id: 'u', start: 0, end: 1, text: 'Hai' }], board: { location: 'Kelas' } }],
  })

  it('camera, effects and subtitles travel with the scene view and back; empty ones are dropped', () => {
    const p = proj()
    const v = sceneView(p, 's1')
    expect(v.camera?.zoom).toHaveLength(1)
    expect(v.effects).toHaveLength(1)
    expect(v.subtitles![0].text).toBe('Hai')
    const back = mergeView(p, 's1', { ...v, effects: [], subtitles: [], camera: {} })
    expect(back.scenes[0].effects).toBeUndefined()
    expect(back.scenes[0].subtitles).toBeUndefined()
    expect(back.scenes[0].camera).toBeUndefined()
    expect(back.scenes[0].board).toEqual({ location: 'Kelas' }) // storyboard notes are untouched by view edits
    const kept = mergeView(p, 's1', v)
    expect(kept.scenes[0].effects).toEqual(p.scenes[0].effects)
  })

  it('placing a prop uses the camera centre and a size relative to the scene', () => {
    const p = proj()
    const v = sceneView(p, 's1')
    const a = propPlacement(v, 0, 400, 400)
    expect(a.x).toBe(640)
    expect(a.scale).toBeCloseTo(0.45, 6)
    v.camera = { x: [{ f: 0, v: 200, e: 'linear' }] }
    expect(propPlacement(v, 0, 400, 400).x).toBe(200)
  })

  it('wipe and zoom transitions cover and uncover the scene', () => {
    const p = proj()
    p.scenes.push({ ...p.scenes[0], id: 's2', transition: null })
    p.scenes[0].transition = { type: 'wipe', duration: 1 }
    expect(effectAt(p, 0, 4, 1280)).toMatchObject({ kind: 'wipe', progress: 1, side: -1 }) // leaving: fully covered at the cut
    expect(effectAt(p, 1, 0, 1280)).toMatchObject({ kind: 'wipe', side: 1 })
    expect(effectAt(p, 0, 1, 1280)).toBeNull()
    p.scenes[0].transition = { type: 'zoom', duration: 1 }
    const z = effectAt(p, 0, 3.9, 1280)
    expect(z).toMatchObject({ kind: 'zoom' })
    expect((z as { scale: number }).scale).toBeGreaterThan(1)
  })
})

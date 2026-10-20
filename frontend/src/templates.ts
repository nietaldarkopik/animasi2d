import { sceneUid } from './movie'
import type { Keyframe, Layer, ProjectDoc } from './types'

const L = (id: string, o: Partial<Layer>): Layer => ({
  id, type: 'shape', name: id, x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, visible: true, locked: false, parentId: null, ...o,
})
const kf = (...k: [number, number][]): Keyframe[] => k.map(([f, v]) => ({ f, v, e: 'easeInOut' as const }))

/**
 * A ready-made rigged character waving at the viewer (3 s loop): body → head/arms/legs hierarchy, a bone chain
 * (shoulder → elbow) for the waving arm, and keyframes on the bones. Everything is ordinary, editable content.
 */
export function sampleCharacter(): ProjectDoc {
  const skin = '#ffd6aa'
  const layers: Layer[] = [
    L('badan', { name: 'Badan', x: 640, y: 420, width: 120, height: 170, fill: '#4f8cff' }),
    L('kaki-kiri', { name: 'Kaki kiri', parentId: 'badan', x: -28, y: 140, width: 36, height: 110, fill: '#3a3f6b' }),
    L('kaki-kanan', { name: 'Kaki kanan', parentId: 'badan', x: 28, y: 140, width: 36, height: 110, fill: '#3a3f6b' }),
    L('lengan-kiri', { name: 'Lengan kiri', parentId: 'badan', x: -86, y: 10, width: 26, height: 110, fill: skin }),
    L('kepala', { name: 'Kepala', parentId: 'badan', x: 0, y: -135, width: 96, height: 96, fill: skin }),
    L('mata-kiri', { name: 'Mata kiri', parentId: 'kepala', x: -20, y: -8, width: 12, height: 12, fill: '#111111' }),
    L('mata-kanan', { name: 'Mata kanan', parentId: 'kepala', x: 20, y: -8, width: 12, height: 12, fill: '#111111' }),
    L('mulut', { name: 'Mulut', parentId: 'kepala', x: 0, y: 24, width: 36, height: 8, fill: '#b3363a' }),
    // waving arm: bones carry the motion, shapes ride on them
    L('bahu', { name: 'Bahu kanan', type: 'bone', parentId: 'badan', x: 64, y: -72, rotation: 90, length: 70, pivotX: 0, pivotY: 0,
      keyframes: { rotation: kf([0, 90], [12, -70], [60, -70], [72, 90]) } }),
    L('lengan-atas', { name: 'Lengan atas', parentId: 'bahu', x: 35, y: 0, width: 70, height: 24, fill: skin }),
    L('siku', { name: 'Siku kanan', type: 'bone', parentId: 'bahu', x: 70, y: 0, length: 60, pivotX: 0, pivotY: 0,
      keyframes: { rotation: kf([0, 0], [12, -30], [24, 30], [36, -30], [48, 30], [60, -20], [72, 0]) } }),
    L('lengan-bawah', { name: 'Lengan bawah', parentId: 'siku', x: 30, y: 0, width: 60, height: 22, fill: skin }),
    L('sapaan', { name: 'Sapaan', type: 'text', x: 640, y: 110, text: 'Halo!', fontSize: 64, fill: '#1b2a49', opacity: 1,
      keyframes: { opacity: kf([0, 0], [14, 1], [60, 1], [72, 0]) } }),
  ]
  return {
    schema: 2,
    settings: { width: 1280, height: 720, fps: 24 },
    scenes: [{ id: sceneUid(), name: 'Melambai', duration: 3, background: '#eef3ff', transition: null, layers }],
    audio: [],
  }
}
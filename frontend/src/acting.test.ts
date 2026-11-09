import { describe, expect, it } from 'vitest'
import { emotionOf, followKeys, isRunScene, planActing, poseFor, parseAction, travelDistance } from './acting'

describe('emotion of a line', () => {
  const cases: [string, ReturnType<typeof emotionOf>][] = [
    ['Hah?! Hari ini ujian saringan masuk SMK Informatika! Aku harus cepat!', 'kaget'],
    ['Ayo cepat, ayo cepat! Kalau terlambat, aku bisa tidak boleh ikut ujian!', 'teriak'],
    ['Alhamdulillah! Mulai besok aku tidak akan kesiangan lagi dan akan belajar lebih giat!', 'senang'],
    ['Uki, hasil saringan sudah keluar! Kamu lulus!', 'senang'],
    ['Selesai! Sebagian soal belum sempat kuperiksa. Semoga hasilnya cukup.', 'senang'],
    ['Waktunya sempit sekali. Kerjakan dulu soal yang paling mudah.', 'serius'],
    ['Iya, maaf. Aku kesiangan. Apa aku masih boleh ikut ujian?', 'serius'],
    ['Haha, kukira ada hantu teknologi.', 'tertawa'],
    ['Nilainya pas-pasan, tapi kamu tetap diterima di SMK Informatika.', 'netral'],
    ['Kak Uki, kenapa baru bangun?', 'netral'],
  ]
  for (const [text, want] of cases) it(`"${text.slice(0, 40)}…" -> ${want}`, () => expect(emotionOf(text)).toBe(want))

  it('is case-insensitive and matches whole words only', () => {
    expect(emotionOf('ASTAGA!')).toBe('kaget')
    expect(emotionOf('Aku melihat selesainya jalan')).toBe('netral') // "selesainya" is not "selesai"
  })
})

describe('pose for a line', () => {
  it('points when something is seen ahead, cheers on good news, thinks when worried about time', () => {
    expect(poseFor('Tenang. Gerbang sekolahnya sudah kelihatan di depan!', 'netral')).toBe('tunjuk')
    expect(poseFor('Kamu lulus!', 'senang')).toBe('angkat')
    expect(poseFor('Terima kasih!', 'senang')).toBeNull()
    expect(poseFor('Waktunya sempit sekali.', 'serius')).toBe('berpikir')
    expect(poseFor('Maaf, aku kesiangan.', 'serius')).toBe('miring')
    expect(poseFor('Hah?!', 'kaget')).toBe('kaget')
    expect(poseFor('Halo semuanya.', 'netral')).toBeNull()
  })
})

describe('running scenes and the plan', () => {
  it('recognises a scene where the character runs', () => {
    expect(isRunScene('Berlari ke Sekolah', [])).toBe(true)
    expect(isRunScene('Di jalan', ['Ayo cepat, ayo cepat!'])).toBe(true)
    expect(isRunScene('Mengerjakan Ujian', ['Waktunya sempit sekali.'])).toBe(false)
  })

  it('turns lines (seconds) into steps (frames) with their emotion and pose', () => {
    const plan = planActing([{ text: 'Hah?!', start: 0.5, end: 1.5 }, { text: 'Halo.', start: 2, end: 3 }], 24)
    expect(plan).toEqual([
      { start: 12, end: 36, emotion: 'kaget', pose: 'kaget' },
      { start: 48, end: 72, emotion: 'netral', pose: null },
    ])
  })

  it('followKeys shifts values and keeps frames and easing', () => {
    expect(followKeys([{ f: 0, v: 100, e: 'linear' }, { f: 50, v: 400.123, e: 'easeIn' }], 30)).toEqual([{ f: 0, v: 130, e: 'linear' }, { f: 50, v: 430.12, e: 'easeIn' }])
  })
})

describe('actions written in a script', () => {
  it('a walk stops beside whoever stands in the way, and on the screen', () => {
    expect(travelDistance(320, 1, 400, 1000, [680])).toBeCloseTo(220)
    expect(travelDistance(320, 1, 100, 1000, [680])).toBe(100)
    expect(travelDistance(320, -1, 400, 1000, [680])).toBeCloseTo(240) // nobody on that side: the edge of the screen
    expect(travelDistance(600, 1, 400, 1000, [680])).toBe(0) // already next to them
  })
  const names = ['Uki', 'Pak Suga', 'Sekar']
  it('finds who and what, and the direction of a walk', () => {
    expect(parseAction('Uki melambai', names)).toEqual({ who: ['Uki'], all: false, effects: [{ kind: 'motion', id: 'wave' }] })
    expect(parseAction('Pak Suga dan Sekar berlari ke kiri', names)).toMatchObject({ who: ['Pak Suga', 'Sekar'], effects: [{ kind: 'motion', id: 'run', dir: -1 }] })
    expect(parseAction('Uki tertawa sambil melompat', names).effects.map((e) => e.id).sort()).toEqual(['jump', 'tertawa'])
    expect(parseAction('semua bersorak', names)).toMatchObject({ who: [], all: true, effects: [{ kind: 'pose', id: 'angkat' }] })
  })
  it('a name inside another word does not count, and unknown actions do nothing', () => {
    expect(parseAction('Ukiran itu melambai', names).who).toEqual([])
    expect(parseAction('Uki terbang', names).effects).toEqual([])
    expect(parseAction('Uki di jalan raya', names).effects).toEqual([])
  })
})

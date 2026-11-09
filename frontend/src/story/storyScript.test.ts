import { describe, expect, it } from 'vitest'
import { addCrowdPerson, checkScript, formatScript, parseScript } from './storyScript'

describe('script text', () => {
  it('reads scenes with location and time, and dialogue lines', () => {
    const s = parseScript('# Gerbang | Halaman sekolah | Pagi\nUki: Wah, besar!\nNarator: Pagi itu cerah.\n\n# Kelas\nSekar: Mulai ya.')
    expect(s.scenes).toEqual([
      { name: 'Gerbang', location: 'Halaman sekolah', time: 'pagi', dialog: [{ who: 'Uki', text: 'Wah, besar!' }, { who: 'Narator', text: 'Pagi itu cerah.' }] },
      { name: 'Kelas', location: '', time: 'siang', dialog: [{ who: 'Sekar', text: 'Mulai ya.' }] },
    ])
  })

  it('keeps colons inside the sentence, ignores lines that are not dialogue, and starts a scene when none was declared', () => {
    const s = parseScript('Uki: Jam 7: berangkat!\ncatatan tanpa pembicara\n# Kosong\n')
    expect(s.scenes).toHaveLength(1)
    expect(s.scenes[0].dialog).toEqual([{ who: 'Uki', text: 'Jam 7: berangkat!' }])
    expect(s.scenes[0].name).toBe('Scene 1')
  })

  it('round-trips through text', () => {
    const script = { scenes: [{ name: 'A', location: 'Taman', time: 'sore', dialog: [{ who: 'Uki', text: 'Hai' }] }, { name: 'B', location: 'Dapur', time: 'malam', dialog: [{ who: 'Sekar', text: 'Halo' }] }] }
    expect(parseScript(formatScript(script))).toEqual(script)
    expect(formatScript(null)).toBe('')
  })

  it('reads actions, sound effects and the people in the background, in order', () => {
    const s = parseScript('# Pagi | Taman | sore | latar: Kris, Arum, Kris\n[bel]\n(Uki melambai)\nUki: Halo\n(semua melompat)\n[SFX: tada]')
    expect(s.scenes).toEqual([{ name: 'Pagi', location: 'Taman', time: 'sore', cast: ['Kris', 'Arum'], dialog: [{ who: 'Uki', text: 'Halo', before: [{ sfx: 'bel' }, { action: 'Uki melambai' }] }], after: [{ action: 'semua melompat' }, { sfx: 'tada' }] }])
  })

  it('a scene may have no words at all, and an action does not leak into the next scene', () => {
    const s = parseScript('# Diam\n(Uki berjalan)\n# Bicara\nUki: Hai')
    expect(s.scenes[0]).toMatchObject({ name: 'Diam', dialog: [], after: [{ action: 'Uki berjalan' }] })
    expect(s.scenes[1].dialog).toEqual([{ who: 'Uki', text: 'Hai' }])
  })

  it('actions, effects and the background survive a round trip', () => {
    const script = { scenes: [{ name: 'A', location: 'Taman', time: 'sore', cast: ['Kris', 'Pak Suga'], dialog: [{ who: 'Uki', text: 'Hai', before: [{ action: 'Uki tertawa' }] }], after: [{ sfx: 'bel' }] }] }
    expect(parseScript(formatScript(script))).toEqual(script)
  })

  const ctx = { speakers: ['Uki', 'Narator'], people: ['Uki', 'Kris'], locations: ['Taman'] }
  it('says what would not reach the film', () => {
    const w = checkScript('# A | Gunung | subuh | latar: Hantu\nBudi: Halo\ncatatan saja\n(Uki terbang)\n(melambai)\n[gong]\n# Kosong', ctx)
    expect(w.map((x) => x.split(':')[0])).toEqual(['Baris 1', 'Baris 1', 'Baris 1', 'Baris 2', 'Baris 3', 'Baris 4', 'Baris 5', 'Baris 6', 'Baris 7'])
    expect(w.join(' ')).toContain('"Budi" belum ada')
    expect(w.join(' ')).toContain('"Hantu" belum ada')
    expect(w.join(' ')).toContain('"gong" belum ada')
  })

  it('a good script has nothing to report', () => {
    expect(checkScript('# A | taman | pagi | latar: kris\n[ketuk pintu]\n(Kris melambai)\nuki: Halo\nNarator: Pagi cerah.\n(semua melompat)', ctx)).toEqual([])
  })

  it('adds a person to the scene under the cursor, once', () => {
    const t = '# A | Taman\nUki: Hai\n# B | latar: Kris\nUki: Halo'
    expect(addCrowdPerson(t, 3, 'Arum').split('\n')[0]).toBe('# A | Taman | latar: Arum')
    expect(addCrowdPerson(t, t.length, 'Arum').split('\n')[2]).toBe('# B | latar: Kris, Arum')
    expect(addCrowdPerson(t, t.length, 'kris')).toBe(t)
    expect(addCrowdPerson('Uki: Hai', 0, 'Arum')).toBe('# Scene 1 | latar: Arum\nUki: Hai')
  })
})

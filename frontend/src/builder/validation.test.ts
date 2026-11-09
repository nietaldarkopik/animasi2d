import { describe, expect, it } from 'vitest'
import { pickNote, summarize } from './validation'
import type { AssetValidation } from './types'

const v = (errors: string[], warnings: [string, string][] = []): AssetValidation => ({ ok: errors.length === 0, errors: errors.map((m) => ({ code: 'region', message: m })), warnings: warnings.map(([code, message]) => ({ code, message })) })

describe('validation summary', () => {
  it('has nothing to say about a part without a report or with a clean one', () => {
    expect(summarize(null)).toEqual({ level: 'ok', messages: [] })
    expect(summarize(v([]))).toEqual({ level: 'ok', messages: [] })
    expect(pickNote({ name: 'A', validation: v([]) })).toBe('')
  })

  it('ignores warnings that only inform (a vector part cannot be measured, a view with no example)', () => {
    expect(summarize(v([], [['vector', 'SVG'], ['unmeasured', 'belum ada contoh']])).level).toBe('ok')
  })

  it('errors win over warnings and all messages are kept in order', () => {
    const s = summarize(v(['keluar area'], [['size', 'terlalu kecil'], ['vector', 'SVG']]))
    expect(s).toEqual({ level: 'error', messages: ['keluar area', 'terlalu kecil'] })
    expect(summarize(v([], [['duplicate', 'sama dengan #3']])).level).toBe('warn')
  })

  it('words the note by severity', () => {
    expect(pickNote({ name: 'Wajah X', validation: v(['keluar area']) })).toBe('“Wajah X” belum lolos validasi template: keluar area')
    expect(pickNote({ name: 'Wajah Y', validation: v([], [['size', 'kecil']]) })).toContain('lolos dengan catatan')
  })
})

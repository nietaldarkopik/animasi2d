import type { AssetValidation, LibAsset } from './types'

/** Warnings that are only informational (a vector part cannot be measured) are not worth showing as a problem. */
const QUIET = new Set(['vector', 'unmeasured'])

export interface ValidationSummary { level: 'ok' | 'warn' | 'error'; messages: string[] }

export function summarize(v: AssetValidation | null | undefined): ValidationSummary {
  if (!v) return { level: 'ok', messages: [] }
  const warnings = v.warnings.filter((w) => !QUIET.has(w.code))
  return { level: v.errors.length ? 'error' : warnings.length ? 'warn' : 'ok', messages: [...v.errors, ...warnings].map((i) => i.message) }
}

/** The note shown when a part with findings is picked, or '' when there is nothing to say. */
export function pickNote(a: Pick<LibAsset, 'name' | 'validation'>): string {
  const s = summarize(a.validation)
  return s.level === 'ok' ? '' : `“${a.name}” ${s.level === 'error' ? 'belum lolos' : 'lolos dengan catatan pada'} validasi template: ${s.messages.join(' ')}`
}

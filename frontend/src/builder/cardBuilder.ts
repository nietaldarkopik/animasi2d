/** Types and pure helpers of the Card Builder web UI (backend: CardBuilderController → tools/card_builder). */

export type PackId = 'dialog' | 'duduk' | 'aksi' | 'jalan'
export const PACKS: PackId[] = ['dialog', 'duduk', 'aksi', 'jalan']

export interface BuilderSlot { group: string; id: string; label: string; required: boolean; present: boolean; file: string }
export interface BuilderSheetState { id: string; file: string; uploaded: boolean; size: number }
export interface BuilderPack {
  label: string; enabled: boolean; slots: BuilderSlot[]; sheets: BuilderSheetState[]
  required_total: number; required_present: number; optional_total: number; optional_present: number; has_prompts: boolean
}
export interface ValidationMessage { level: string; area: string; msg: string }
export interface ValidationReport { verdict: 'pass' | 'warn' | 'fail' | string; fails: number; warnings: number; messages: ValidationMessage[] }
export interface BuilderStatus {
  slug: string; name: string; appearance: string; packs_enabled: string[]; mirror_ok: boolean
  packs: Record<PackId, BuilderPack>; mouth_views: string[]; extra_synced: boolean; validation: ValidationReport
}
export interface PromptSheet { id: string; file: string; cols: number; rows: number; attach: string[]; group: string; text: string }
export interface PromptResult { pack: PackId; sheets: PromptSheet[]; skipped: string[]; missing_acuan: boolean; fixes: unknown }
export interface PreviewImage { name: string; url: string }
export interface ImportResult {
  notes: string[]; imported: { slot: string; file: string; skipped: boolean; scale: number | null; head_at: [number, number] | null }[]
  previews: PreviewImage[]; dry_run: boolean; validation: ValidationReport | null
}

export interface ColorCluster { name: string; hex: string; share: number; kind: string; sat: number; boxes: Record<string, [number, number, number, number]> }
export interface ColorMap { from: string; to: string; tol: number; groups: string[]; not: string }

export interface Calibration { chin_y: number; mouth: [number, number]; eyes: [[number, number], [number, number]]; mouth_scale?: number; lid_scale?: number; head_dx?: number; head_dy?: number; head_rot?: number }
export interface DraftSheet { id: string; file: string; cols: number; rows: number; attach: string[]; text: string; required: boolean; cells?: number; uploaded: boolean }
export interface DraftState {
  slug: string; name: string; appearance: string; style: string; sheets_full: DraftSheet[]; imported: boolean
  calibration: Calibration; has_blink: boolean; previews: PreviewImage[]; exists_final: boolean; validation: ValidationReport | null
  assets: { head?: string; body?: string; mouth?: string; blink?: string }
  standard: { head_canvas: [number, number]; defaults: Calibration }
}
export interface DraftImportResult { notes: string[]; has_blink: boolean; calib: Calibration; state: DraftState }

const HEX = /^#?[0-9a-fA-F]{6}$/
export const normHex = (h: string): string | null => (HEX.test(h.trim()) ? '#' + h.trim().replace('#', '').toLowerCase() : null)

/** One `--map` rule as the tool parses it: `#src>#dst;tol=14;not=x0,y0,x1,y1;groups=head`. null when the colours are not valid hex. */
export function mapRule(m: ColorMap): string | null {
  const a = normHex(m.from)
  const b = normHex(m.to)
  if (!a || !b) return null
  const opts: string[] = []
  if (m.tol > 0) opts.push(`tol=${Math.round(m.tol)}`)
  const not = m.not.split(/[\s,]+/).filter(Boolean).map(Number)
  if (not.length === 4 && not.every(Number.isFinite)) opts.push(`not=${not.map(Math.round).join(',')}`)
  if (m.groups.length) opts.push(`groups=${m.groups.join(',')}`)
  return [`${a}>${b}`, ...opts].join(';')
}

/** Chinese-box style: pixel position of a click on an image shown at `shown` px wide, for a canvas `canvasW` px wide. */
export function clickToCanvas(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }, canvas: [number, number]): [number, number] {
  const x = ((clientX - rect.left) / rect.width) * canvas[0]
  const y = ((clientY - rect.top) / rect.height) * canvas[1]
  return [Math.max(0, Math.min(canvas[0], Math.round(x))), Math.max(0, Math.min(canvas[1], Math.round(y)))]
}

export type CalibTarget = 'chin' | 'mouth' | 'eyeL' | 'eyeR'
/** Applies a click to the calibration. Eyes stay ordered left → right. */
export function applyCalib(c: Calibration, target: CalibTarget, p: [number, number]): Calibration {
  if (target === 'chin') return { ...c, chin_y: p[1] }
  if (target === 'mouth') return { ...c, mouth: p }
  const eyes: [[number, number], [number, number]] = target === 'eyeL' ? [p, c.eyes[1]] : [c.eyes[0], p]
  return { ...c, eyes: eyes[0][0] <= eyes[1][0] ? eyes : [eyes[1], eyes[0]] }
}

/** Where the importer pivots the head: neck stub at (head_cx, head_top + head_h) of the 400×500 head canvas (tools/card_builder/newchar.py CANON). */
export const HEAD_PIVOT: [number, number] = [200, 379]
/** The mouth image is 120×80 and centred on the mouth point. */
export const MOUTH_CANVAS: [number, number] = [120, 80]

export interface LivePreview {
  /** Head image: extra shift/rotation relative to the applied head, about `pivot` (head-canvas px). */
  head: { dx: number; dy: number; rot: number; pivot: [number, number] }
  /** Applied mouth image redrawn at the new mouth point, scaled by `scale` about its centre. */
  mouth: { center: [number, number]; scale: number }
  /** Applied lids image (both lids on one canvas): per eye, move `from` → `to` and scale about `from`; `mid` splits the two lids. */
  lids: { from: [number, number]; to: [number, number]; scale: number }[]
  mid: number
}

const ratio = (now: number | undefined, was: number | undefined): number => {
  const a = now || 1
  const b = was || 1
  return a / b
}

/**
 * Instant approximation of what Terapkan will produce: `saved` is the calibration the images on screen were built with,
 * `c` the draft being dragged. Rescaling the built images is slightly soft; the real result still comes from the importer.
 */
export function livePreview(c: Calibration, saved: Calibration): LivePreview {
  const spacingNow = Math.abs(c.eyes[1][0] - c.eyes[0][0])
  const spacingWas = Math.abs(saved.eyes[1][0] - saved.eyes[0][0])
  const lidRatio = ratio(c.lid_scale, saved.lid_scale) * (spacingWas > 0 && spacingNow > 0 ? spacingNow / spacingWas : 1)
  return {
    head: {
      dx: (c.head_dx ?? 0) - (saved.head_dx ?? 0), dy: (c.head_dy ?? 0) - (saved.head_dy ?? 0), rot: (c.head_rot ?? 0) - (saved.head_rot ?? 0),
      pivot: [HEAD_PIVOT[0] + (saved.head_dx ?? 0), HEAD_PIVOT[1] + (saved.head_dy ?? 0)],
    },
    mouth: { center: c.mouth, scale: ratio(c.mouth_scale, saved.mouth_scale) },
    lids: [0, 1].map((i) => ({ from: saved.eyes[i], to: c.eyes[i], scale: lidRatio })),
    mid: (saved.eyes[0][0] + saved.eyes[1][0]) / 2,
  }
}

/** True when the draft differs from what was last applied (the images on screen are then only a preview). */
export function calibChanged(c: Calibration, saved: Calibration): boolean {
  const norm = (x: Calibration) => JSON.stringify(calibPayload({ ...x, mouth_scale: x.mouth_scale ?? 1, lid_scale: x.lid_scale ?? 1 }))
  return norm(c) !== norm(saved)
}

/** What the importer accepts: whole numbers, scales 0.3–3. */
export function calibPayload(c: Calibration): Record<string, unknown> {
  const r = Math.round
  return {
    chin_y: r(c.chin_y), mouth: [r(c.mouth[0]), r(c.mouth[1])], eyes: [[r(c.eyes[0][0]), r(c.eyes[0][1])], [r(c.eyes[1][0]), r(c.eyes[1][1])]],
    ...(c.mouth_scale ? { mouth_scale: c.mouth_scale } : {}), ...(c.lid_scale ? { lid_scale: c.lid_scale } : {}),
    head_dx: r(c.head_dx ?? 0), head_dy: r(c.head_dy ?? 0), head_rot: Math.round((c.head_rot ?? 0) * 10) / 10,
  }
}

export const slugify = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)

/** The sheets still needed before the first import. */
export const missingRequired = (sheets: DraftSheet[]): string[] => sheets.filter((s) => s.required && !s.uploaded).map((s) => s.id)

export const packProgress = (p: BuilderPack): string => `${p.required_present}/${p.required_total} wajib${p.optional_total ? ` · ${p.optional_present}/${p.optional_total} opsional` : ''}`

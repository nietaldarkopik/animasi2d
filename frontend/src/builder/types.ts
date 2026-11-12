import type { CharRig } from './charRig'
export interface Palette {
  skin: string; hair: string; top: string; bottom: string; hijab: string; tie: string; eye: string; shoe: string; accent: string
}

export interface PartRef {
  assetId: number
  /** content hash of the asset when saved (server-filled); pins what this version looked like */
  hash?: string
  dx: number
  dy: number
  scale: number
  /** stacking override (default: the category order); higher = more in front */
  z?: number
  /** stacking override per direction the character faces (front/right/left/back); wins over `z`, which only applies to the front */
  zv?: Partial<Record<Facing, number>>
  /**
   * Split line (canvas y). When set the part is drawn twice: the whole part BEHIND the body/clothes, and the part above the
   * line IN FRONT, so clothes slot in between (long hair falls behind the shirt).
   */
  split?: number
  /** rotation in degrees (clockwise on screen) about the centre of the part's visible artwork; default 0 */
  rot?: number
  /**
   * Recolouring of a raster part (PNG parts have no recolourable regions): the part's hue/saturation is replaced by `tint`
   * (keeping its shading) with strength `tintAmount` (0..1, default 1); `brightness` scales the lightness (default 1).
   */
  tint?: string
  tintAmount?: number
  brightness?: number
}

/** A named look of the face: eyes / brows / mouth variants. A rig made from the character can swap between them per frame. */
export interface SavedExpression { id: string; name: string; parts: Partial<Record<'eyes' | 'brows' | 'mouth', PartRef>> }

export interface CharacterConfig {
  schema_version: 1
  view: 'half' | 'full'
  /** which way the character faces; the part picker only offers parts drawn for that direction (default: front) */
  facing?: Facing
  /** design template of the character; its parts must be made for the same one (default anime-v1) */
  template?: string
  /** the head was fitted to a body kit: every head part is scaled by `s` about (nx, ny) (bottom of the face) and moved so that point lands on (jx, jy) */
  headFit?: HeadFit
  palette: Palette
  parts: Record<string, PartRef>
  expressions?: SavedExpression[]
  /** the skeleton of the character, per facing: joints placed in the Builder (see charRig.ts); "Sisipkan + bone" cuts every part at them */
  rig?: Partial<Record<Facing, CharRig>>
}

export interface LibCategory { id: number; slug: string; name: string; kind: 'part' | 'background' | 'reference' | 'prop'; z_order: number; sort: number }

/** The directions a part can be drawn for. A part without one faces the front. */
export interface HeadFit { s: number; nx: number; ny: number; jx: number; jy: number }

export type Facing = 'front' | 'right' | 'left' | 'back'

/** One finding of the design-template check of a part (see AssetValidator): code is stable, message is for people. */
export interface ValidationIssue { code: string; message: string }
export interface AssetValidation { ok: boolean; errors: ValidationIssue[]; warnings: ValidationIssue[]; /** broke a rule: waits for the author's decision */ held?: boolean; checked_at?: string }

/** One design family of the template: its name and the families it can be combined with without a warning. */
export interface DesignFamilyInfo { label: string; compatible: string[] }
export interface DesignTemplateInfo { id: string; label: string; views: string[]; tolerance: { warn: number; error: number } | null; families: Record<string, DesignFamilyInfo> }

export interface LibAsset {
  id: number
  asset_uuid: string
  version_number: number
  parent_asset_id: number | null
  is_current: boolean
  change_note: string | null
  key: string | null
  category: string
  name: string
  tags: string[]
  source: 'system' | 'upload' | 'ai'
  status: 'approved' | 'pending' | 'rejected'
  mime: string
  width: number
  height: number
  tintable: boolean
  /** the direction this part faces (old assets: front) */
  view?: Facing
  /** the same part drawn for every facing shares one set key (null: no twins) */
  set?: string | null
  /** named attachment points measured from the art (canvas units): head.top_anchor, face.left_eye_anchor... */
  anchors?: Record<string, { x: number; y: number }> | null
  /** how far to move the part so its anchors land on the template's (null: already in place or not aligned) */
  align?: { dx: number; dy: number } | null
  /** design family (male, female, kit-l1, kit-p2, kit-p3, legacy, general): which parts it was drawn with and fits */
  family?: string | null
  /** design template (character family / art-style preset) the part was made for; default anime-v1 */
  template?: string
  /** result of the design-template check (parts only) */
  validation?: AssetValidation | null
  /** one shoe drawn for the viewer-left foot: {px, py} is its pivot (canvas units); the other foot is the same shoe mirrored about x=200 */
  mirror?: { px: number; py: number } | null
  hash: string
  mine: boolean
  meta: { prompt: string | null; model: string | null } | null
  url: string
}

export interface BuilderSummary { id: number; name: string; current_version: number; updated_at: string; thumbnail: string | null }
export interface BuilderVersionInfo { number: number; note: string | null; created_at: string; thumbnail: string | null }
export interface BuilderDetail extends BuilderSummary {
  versions: BuilderVersionInfo[]
  config: CharacterConfig | null
  viewing: number | null
  assets: Record<number, LibAsset>
}

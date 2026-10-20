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
  palette: Palette
  parts: Record<string, PartRef>
  expressions?: SavedExpression[]
}

export interface LibCategory { id: number; slug: string; name: string; kind: 'part' | 'background' | 'reference' | 'prop'; z_order: number; sort: number }

export interface LibAsset {
  id: number
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

export type LayerType = 'image' | 'text' | 'shape' | 'bone' | 'balloon'

export type AnimProp = 'x' | 'y' | 'scaleX' | 'scaleY' | 'rotation' | 'opacity'
export type Ease = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'step'
/** f = frame number, v = value, e = easing of the segment starting at this key */
export interface Keyframe {
  f: number
  v: number
  e: Ease
}

/** Image swap key: from frame `f` on the layer shows `assetId` (expressions, mouth shapes). Held until the next key. */
export interface Swap { f: number; assetId: number }

export interface Layer {
  keyframes?: Partial<Record<AnimProp, Keyframe[]>>
  /** per-frame image swaps (a step track); before the first key the layer's own assetId shows */
  swaps?: Swap[]
  /** expression id -> asset id for this layer (eyes / brows / mouth of a rig made with expressions) */
  expr?: Record<string, number>
  /** which rig character (instance id) and which part (bone:<key> / piece:<key>) this layer is */
  rig?: { id: string; role: string }
  /** shape layers: rectangle (default) or ellipse */
  shape?: 'rect' | 'ellipse'
  /** balloon layers: kind, fill colour, and where the tail points to relative to the balloon centre */
  bubble?: 'speech' | 'thought' | 'shout'
  bubbleFill?: string
  tailX?: number
  tailY?: number
  /** parent layer id; x/y/rotation/scale are then local to the parent's frame (forward kinematics) */
  parentId?: string | null
  /** pivot / joint, in the layer's own content space (origin = content center; bones: origin = joint) */
  pivotX?: number
  pivotY?: number
  /** bone length */
  length?: number
  /** 2-bone IK: this bone is the end effector of the chain [parent, this]; its tip chases `target` */
  ik?: { target: string; bend: 1 | -1 } | null
  id: string
  type: LayerType
  name: string
  /** center position in scene pixels */
  x: number
  y: number
  scaleX: number
  scaleY: number
  /** degrees */
  rotation: number
  opacity: number
  visible: boolean
  locked: boolean
  assetId?: number | null
  text?: string
  fontSize?: number
  fill?: string
  width?: number
  height?: number
}

export interface Settings {
  width: number
  height: number
  fps: number
  duration: number
  background: string
}

export interface SceneDocument {
  schema: number
  settings: Settings
  /** index 0 is the bottom-most layer */
  layers: Layer[]
  camera?: SceneCamera
  effects?: SceneEffect[]
  subtitles?: Subtitle[]
}

export type TransitionType = 'none' | 'fade' | 'fadeWhite' | 'slideLeft' | 'slideRight' | 'wipe' | 'zoom'
export interface Transition { type: TransitionType; duration: number }

/** Camera tracks (keyframes in frames): x/y = the scene point in the middle of the view, zoom (1 = whole scene), rot = degrees. */
export type CameraProp = 'x' | 'y' | 'zoom' | 'rot'
export type SceneCamera = Partial<Record<CameraProp, Keyframe[]>>

export type EffectKind = 'rain' | 'snow' | 'tint' | 'vignette'
/** Scene-wide visual effect. `color`/`blend` apply to tint; `intensity` is 0..1 (amount of drops, strength of the tint...). */
export interface SceneEffect { id: string; kind: EffectKind; intensity: number; color?: string; blend?: 'multiply' | 'normal'; label?: string }

/** Caption shown over the picture from `start` to `end` seconds (scene time). */
export interface Subtitle { id: string; start: number; end: number; text: string }

/** Storyboard notes of a scene: where it takes place, what happens, who says what. */
export interface SceneBoard {
  location?: string
  summary?: string
  dialog?: { id: string; who: string; text: string }[]
}

/** One scene of the film. */
export interface Scene {
  camera?: SceneCamera
  effects?: SceneEffect[]
  subtitles?: Subtitle[]
  board?: SceneBoard
  id: string
  name: string
  duration: number
  background: string
  /** transition from THIS scene into the next one */
  transition: Transition | null
  layers: Layer[]
}

export interface AudioClip {
  id: string
  assetId: number
  name: string
  /** seconds on the film timeline */
  start: number
  volume: number
  kind?: 'music' | 'sfx' | 'voice'
  /** seconds of fade at the start / end of the clip */
  fadeIn?: number
  fadeOut?: number
}

/** Whole project document (schema 2). SceneDocument below is the view of the ACTIVE scene the editor works on. */
export interface ProjectDoc {
  schema: 2
  settings: { width: number; height: number; fps: number }
  scenes: Scene[]
  audio: AudioClip[]
  auto_generated?: boolean
  characters?: string[]
}

export interface Project {
  id: number
  name: string
  revision: number
  document: ProjectDoc
  updated_at: string
}

export interface ProjectSummary {
  id: number
  name: string
  revision: number
  updated_at: string
}

export interface Asset {
  id: number
  name: string
  mime: string
  size: number
  /** pixels (images only; the server sends null for audio, which is filtered out by mime) */
  width: number
  height: number
  /** seconds, audio only */
  duration?: number | null
  url: string
  /** original = untouched upload; enhanced = a version made by the enhancement studio / image tools; character = cut-out part */
  kind?: 'original' | 'enhanced' | 'character'
  parent_id?: number | null
  mode?: EnhanceModeId | null
}

export type EnhanceModeId = 'preserve' | 'clean_sketch' | 'clean_line_art' | 'colorize' | 'ai_redraw' | 'upscale_ai'
export interface EnhanceModeInfo {
  id: EnhanceModeId
  label: string
  engine: 'local' | 'ai' | 'local-ai'
  available: boolean
  default: boolean
  summary: string
  unavailable_reason?: string | null
}
export interface EnhanceOptions {
  /** 4 paper corners in source pixels: top-left, top-right, bottom-right, bottom-left */
  perspective?: [number, number][]
  deskew?: boolean
  rotate?: number
  strength?: number
  upscale?: number
  remove_bg?: boolean
  tolerance?: number
  crop?: { x: number; y: number; w: number; h: number }
}

export interface VersionInfo {
  id: number
  number: number
  label: string | null
  created_at: string
}

export interface ExportInfo {
  id: number
  format: 'webm' | 'mp4' | 'png_sequence' | 'gif' | 'sprite_sheet'
  width: number
  height: number
  fps: number
  status: 'uploaded' | 'queued' | 'processing' | 'done' | 'failed'
  error: string | null
  created_at: string
}

export type ImageOp =
  | { op: 'crop'; x: number; y: number; w: number; h: number }
  | { op: 'resize'; width: number }
  | { op: 'remove_bg'; tolerance: number }
  | { op: 'sketch'; strength: number }
  | { op: 'trim' }
  | { op: 'enhance' }

/** result geometry relative to the input image (see worker/imagetool.py) */
export interface Geometry {
  pixel_scale: number
  origin: [number, number]
  input_size: [number, number]
}

export interface AiStatus {
  configured: boolean
  model: string
  features: Record<'prompt_to_motion' | 'segment_parts' | 'image_to_video' | 'lip_sync' | 'video_to_motion', boolean>
}

export interface AiJobInfo {
  id: number
  type: string
  status: 'queued' | 'processing' | 'done' | 'failed'
  error: string | null
  prompt: string | null
  result: (import('./anim').MotionPlan & Partial<SegmentPlan>) | null
}

export interface SegmentPlan {
  asset: { id: number; width: number; height: number }
  parts: { name: string; parent: string | null; box: { x: number; y: number; w: number; h: number }; joint: { x: number; y: number } | null }[]
  notes: string
  warnings: string[]
  model?: string
}

export const isAudioAsset = (a: Pick<Asset, 'mime'>) => a.mime.startsWith('audio/')
export const isImageAsset = (a: Pick<Asset, 'mime'>) => a.mime.startsWith('image/')

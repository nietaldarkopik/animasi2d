export interface SpriteAtlasFrame {
  id: string
  x: number
  y: number
  width: number
  height: number
}

export interface SpriteAtlasAnimation {
  fps: number
  loop?: boolean
  frames: SpriteAtlasFrame[]
}

export interface SpriteAtlasManifest {
  format: 'animasi2d.character-sprite-atlas'
  format_version: 1
  frame: { width: number; height: number; pivot?: { x: number; y: number } }
  atlas: { width: number; height: number; columns: number; rows: number }
  animations: Record<string, SpriteAtlasAnimation>
}

export interface ResolvedSpriteAnimation {
  id: string
  fps: number
  loop: boolean
  pivot: { x: number; y: number }
  frameWidth: number
  frameHeight: number
  frames: SpriteAtlasFrame[]
}

export function parseSpriteAtlasManifest(value: unknown): SpriteAtlasManifest {
  if (!value || typeof value !== 'object') throw new Error('Manifest sprite atlas tidak valid.')
  const manifest = value as Partial<SpriteAtlasManifest>
  if (manifest.format !== 'animasi2d.character-sprite-atlas' || manifest.format_version !== 1) {
    throw new Error('Format manifest sprite atlas tidak didukung.')
  }
  if (!manifest.frame || manifest.frame.width !== 1024 || manifest.frame.height !== 1024) {
    throw new Error('Ukuran frame manifest harus 1024 × 1024.')
  }
  if (!manifest.atlas || !Number.isInteger(manifest.atlas.width) || !Number.isInteger(manifest.atlas.height)) {
    throw new Error('Dimensi atlas tidak valid.')
  }
  if (!manifest.animations || typeof manifest.animations !== 'object' || !Object.keys(manifest.animations).length) {
    throw new Error('Manifest tidak memiliki animasi.')
  }
  for (const [name, animation] of Object.entries(manifest.animations)) {
    if (!animation || !Array.isArray(animation.frames) || !animation.frames.length) {
      throw new Error(`Animasi "${name}" tidak memiliki frame.`)
    }
    if (!Number.isFinite(animation.fps) || animation.fps < 1 || animation.fps > 60) {
      throw new Error(`FPS animasi "${name}" tidak valid.`)
    }
    for (const frame of animation.frames) {
      if (!frame || !frame.id || frame.width !== 1024 || frame.height !== 1024
        || !Number.isInteger(frame.x) || !Number.isInteger(frame.y)
        || frame.x < 0 || frame.y < 0
        || frame.x + frame.width > manifest.atlas.width
        || frame.y + frame.height > manifest.atlas.height) {
        throw new Error(`Frame pada animasi "${name}" berada di luar atlas atau tidak valid.`)
      }
    }
  }
  return manifest as SpriteAtlasManifest
}

export function resolveSpriteAnimation(manifestValue: unknown, animationId?: string): ResolvedSpriteAnimation {
  const manifest = parseSpriteAtlasManifest(manifestValue)
  const id = animationId && manifest.animations[animationId] ? animationId : Object.keys(manifest.animations)[0]
  const animation = manifest.animations[id]
  return {
    id,
    fps: animation.fps,
    loop: animation.loop !== false,
    pivot: manifest.frame.pivot ?? { x: 512, y: 1024 },
    frameWidth: manifest.frame.width,
    frameHeight: manifest.frame.height,
    frames: animation.frames,
  }
}

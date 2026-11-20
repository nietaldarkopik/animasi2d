import { describe, expect, it } from 'vitest'
import { parseSpriteAtlasManifest, resolveSpriteAnimation } from './spritePackRuntime'

const manifest = {
  format: 'animasi2d.character-sprite-atlas',
  format_version: 1,
  frame: { width: 1024, height: 1024, pivot: { x: 512, y: 1024 } },
  atlas: { width: 2048, height: 1024, columns: 2, rows: 1 },
  animations: {
    idle: { fps: 8, loop: true, frames: [
      { id: 'idle_0001', x: 0, y: 0, width: 1024, height: 1024 },
      { id: 'idle_0002', x: 1024, y: 0, width: 1024, height: 1024 },
    ] },
    talk: { fps: 12, loop: false, frames: [
      { id: 'talk_0001', x: 0, y: 0, width: 1024, height: 1024 },
    ] },
  },
}

describe('spritePackRuntime', () => {
  it('resolves the requested animation and its timing/pivot', () => {
    const result = resolveSpriteAnimation(manifest, 'talk')
    expect(result.id).toBe('talk')
    expect(result.fps).toBe(12)
    expect(result.loop).toBe(false)
    expect(result.pivot).toEqual({ x: 512, y: 1024 })
    expect(result.frames).toHaveLength(1)
  })

  it('falls back to the first animation when no id is supplied', () => {
    expect(resolveSpriteAnimation(manifest).id).toBe('idle')
  })

  it('rejects frames outside the atlas', () => {
    const invalid = structuredClone(manifest)
    invalid.animations.idle.frames[0].x = 2048
    expect(() => parseSpriteAtlasManifest(invalid)).toThrow(/di luar atlas/)
  })

  it('rejects unsupported manifest versions', () => {
    expect(() => parseSpriteAtlasManifest({ ...manifest, format_version: 2 })).toThrow(/tidak didukung/)
  })
})

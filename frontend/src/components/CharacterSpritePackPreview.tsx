import { useEffect, useRef, useState } from 'react'
import { AnimatedSprite, Application, Assets, Rectangle, Texture } from 'pixi.js'
import type { CharacterSpritePackInfo } from '../api'
import { resolveSpriteAnimation } from '../builder/spritePackRuntime'

interface Props {
  pack: CharacterSpritePackInfo
  onClose: () => void
}

export function CharacterSpritePackPreview({ pack, onClose }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const sprite = useRef<AnimatedSprite | null>(null)
  const [animationId, setAnimationId] = useState(Object.keys((pack.manifest as any).animations ?? {})[0] ?? '')
  const [playing, setPlaying] = useState(true)
  const [error, setError] = useState('')
  const animationNames = Object.keys((pack.manifest as any).animations ?? {})

  useEffect(() => {
    let cancelled = false
    let app: Application | null = null
    let current: AnimatedSprite | null = null
    let appDestroyed = false
    const run = async () => {
      try {
        const resolved = resolveSpriteAnimation(pack.manifest, animationId)
        app = new Application()
        await app.init({ width: 480, height: 480, backgroundAlpha: 0, antialias: true, preference: 'webgl', resolution: window.devicePixelRatio || 1 })
        if (cancelled || !host.current) { app.destroy(true); appDestroyed = true; return }
        host.current.replaceChildren(app.canvas)
        const atlas = await Assets.load<Texture>(pack.file_url)
        if (cancelled) { if (!appDestroyed) { app.destroy(true); appDestroyed = true } return }
        const frames = resolved.frames.map((frame) => new Texture({
          source: atlas.source,
          frame: new Rectangle(frame.x, frame.y, frame.width, frame.height),
        }))
        current = new AnimatedSprite({ textures: frames, autoUpdate: true })
        current.anchor.set(resolved.pivot.x / resolved.frameWidth, resolved.pivot.y / resolved.frameHeight)
        current.position.set(240, 420)
        current.scale.set(0.36)
        current.animationSpeed = resolved.fps / 60
        current.loop = resolved.loop
        current.play()
        sprite.current = current
        app.stage.addChild(current)
      } catch (e) {
        if (!cancelled) setError((e as Error).message || 'Sprite sheet gagal dimuat.')
      }
    }
    void run()
    return () => {
      cancelled = true
      sprite.current = null
      current?.stop()
      if (app && !appDestroyed) { app.destroy(true, { children: true }); appDestroyed = true }
      host.current?.replaceChildren()
    }
  }, [pack.id, pack.file_url, pack.manifest, animationId])

  useEffect(() => {
    if (!sprite.current) return
    if (playing) sprite.current.play()
    else sprite.current.stop()
  }, [playing, animationId])

  return (
    <div role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }} style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,.76)', display: 'grid', placeItems: 'center', padding: 20 }}>
      <section role="dialog" aria-modal="true" aria-labelledby="sprite-preview-title" style={{ width: 'min(620px, 96vw)', background: 'var(--panel)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 12, padding: 18, display: 'grid', gap: 12 }}>
        <header className="row between">
          <div>
            <h2 id="sprite-preview-title" style={{ margin: 0 }}>PixiJS Sprite Preview</h2>
            <p className="muted small" style={{ margin: '4px 0 0' }}>{pack.name} · {pack.frame_count} frame · {pack.facing} · {pack.status}</p>
          </div>
          <button onClick={onClose} aria-label="Tutup">×</button>
        </header>
        <div ref={host} style={{ width: '100%', aspectRatio: '1', maxHeight: 480, display: 'grid', placeItems: 'center', background: 'repeating-conic-gradient(#2b2f3a 0 25%, #20232c 0 50%) 0 0 / 20px 20px', overflow: 'hidden' }} />
        {error && <p role="alert" style={{ color: 'var(--danger)', margin: 0 }}>{error}</p>}
        <div className="row between">
          <label className="row small" style={{ gap: 8 }}>Animasi
            <select value={animationId} onChange={(e) => { setPlaying(true); setAnimationId(e.target.value) }}>
              {animationNames.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <button onClick={() => setPlaying((v) => !v)} disabled={!!error}>{playing ? 'Pause' : 'Play'}</button>
        </div>
        <p className="muted small" style={{ margin: 0 }}>Playback menggunakan AnimatedSprite PixiJS 8. Pivot dan FPS dibaca dari manifest atlas.</p>
      </section>
    </div>
  )
}

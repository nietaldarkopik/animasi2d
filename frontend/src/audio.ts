import type { Asset, AudioClip } from './types'

/**
 * Preview mixer: one <audio> element per clip, started/stopped/seeked to follow the film clock.
 * (The export mixes audio on the server with FFmpeg; this is only for listening while editing.)
 */
/** 0..1 gain from the clip's fade-in / fade-out at `t` seconds into the clip. */
export function fadeGain(c: Pick<AudioClip, 'fadeIn' | 'fadeOut'>, duration: number, t: number): number {
  let g = 1
  if (c.fadeIn && c.fadeIn > 0) g = Math.min(g, t / c.fadeIn)
  if (c.fadeOut && c.fadeOut > 0) g = Math.min(g, (duration - t) / c.fadeOut)
  return Math.max(0, Math.min(1, g))
}

export class AudioMixer {
  private els = new Map<string, HTMLAudioElement>()

  update(clips: AudioClip[], assets: Record<number, Asset>, t: number, playing: boolean) {
    for (const c of clips) {
      const a = assets[c.assetId]
      if (!a?.duration) continue
      let el = this.els.get(c.id)
      const want = t - c.start
      if (playing && want >= 0 && want < a.duration) {
        if (!el) {
          el = new Audio(a.url)
          el.preload = 'auto'
          this.els.set(c.id, el)
        }
        el.volume = Math.max(0, Math.min(1, c.volume * fadeGain(c, a.duration, want)))
        if (el.paused) {
          el.currentTime = want
          void el.play().catch(() => {}) // blocked autoplay / not decoded yet: next tick retries
        } else if (Math.abs(el.currentTime - want) > 0.3) {
          el.currentTime = want // drifted (seek, tab throttling)
        }
      } else if (el && !el.paused) {
        el.pause()
      }
    }
    for (const [id, el] of this.els) {
      if (!clips.some((c) => c.id === id)) {
        el.pause()
        this.els.delete(id)
      }
    }
  }

  stopAll() {
    this.els.forEach((el) => el.pause())
  }

  dispose() {
    this.stopAll()
    this.els.clear()
  }
}
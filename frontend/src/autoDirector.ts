import { api } from './api'
import { figureExtent, prepareFlat, prepareRig, rigLayers, type FlatFigure, type PreparedRig } from './builder/insertRig'
import { RIG_PX } from './builder/rigRender'
import { uid } from './store'
import { fitScale } from './builder/rig'
import { crowdSpots, silentCast } from './crowd'
import { balloonSize } from './filmTools'
import { balloonAbove, figureFracWithHeadroom, floorFor, standingOn } from './floors'
import { applyPreset, evalLayer } from './anim'
import { EASE_IN, EASE_OUT, followKeys, isRunScene, parseAction, planActing, travelDistance, type ActionEffect } from './acting'
import { pickSfx, SFX, sfxBlob } from './audioTools'
import { absUrl } from './builder/render'
import { applyExpression, applyPose, applyRigMotion, findRigs, POSES, rigExpressions } from './builder/rigMotion'
import { applyLipSync, envelope, mouthKeys, openings } from './lipsync'
import { sceneStart } from './movie'
import type { BuilderSummary } from './builder/types'
import { applyCardLipSync, applyCardPose, CARD_ROLES, cardExpression, cardLayers, type CardSummary, type PreparedCard } from './builder/card'
import { prepareCard, prepareCardFlat } from './builder/insertCard'

/** A character on stage: a Character Builder rig, or a 2.5D card character (body per pose, head per expression). */
type Cast = { kind: 'rig'; name: string; pr: PreparedRig } | { kind: 'card'; name: string; pc: PreparedCard }
/** the head expressions of a card rig, under the card's own names */
const cardExprs = (rig: ReturnType<typeof findRigs>[number]) => Object.keys(rig.pieces[CARD_ROLES.head]?.expr ?? {}).filter((k) => k !== 'default')
import type { Asset, AudioClip, Keyframe, Layer, ProjectDoc, Scene, SceneDocument } from './types'

/** the document allows this many audio clips: one effect too many would make the whole film unsaveable */
const MAX_AUDIO_CLIPS = 200
/** the most characters acted out with a full rig in one scene (a rig has ~40 layers, a scene at most 500) */
const MAX_RIGS = 4
const HOLD_SECONDS = 2
const MOTION_SECONDS = { walk: 2.5, run: 1.6, wave: 2.2, nod: 1.6, jump: 1 } as const

/** Acts out one effect of a script action at `at` seconds; `follow` receives the x keys when the character travels (its balloon goes along). */
function applyAction(doc: SceneDocument, rig: ReturnType<typeof findRigs>[number], e: ActionEffect, at: number, W: number, others: number[], follow: (x: Keyframe[]) => void): void {
  const { fps, duration } = doc.settings
  const f = Math.round(at * fps)
  const room = Math.max(0.5, duration - at)
  const backAt = Math.round(Math.min(at + HOLD_SECONDS, duration) * fps)
  const cardBody = rig.pieces[CARD_ROLES.body] && doc.layers.find((l) => l.id === rig.pieces[CARD_ROLES.body].id)
  if (e.kind === 'expression') {
    const id = cardBody ? cardExpression(e.id, cardExprs(rig)) : e.id
    if (!id || !rigExpressions(rig).includes(id)) return
    applyExpression(doc, rig, id, f)
    applyExpression(doc, rig, 'default', backAt)
  } else if (e.kind === 'pose' && cardBody) {
    if (applyCardPose(cardBody, e.id, f) && backAt > f + 4) applyCardPose(cardBody, 'berdiri', backAt)
  } else if (e.kind === 'pose') {
    const pose = POSES.find((p) => p.id === e.id)
    const stand = POSES.find((p) => p.id === 'berdiri')
    if (!pose || !stand) return
    if (f - EASE_IN > 0) applyPose(doc, rig, stand, f - EASE_IN)
    applyPose(doc, rig, pose, f + 2)
    if (backAt > f + 4) applyPose(doc, rig, stand, backAt)
  } else {
    const root = doc.layers.find((l) => l.id === rig.bones.root?.id)
    const x = root ? evalLayer(root, f).x : W / 2
    const dir = e.dir ?? (x < W / 2 ? 1 : -1) // towards the middle unless the script says where
    const wanted = e.id === 'run' ? W * 0.4 : e.id === 'walk' ? W * 0.25 : 0
    const distance = travelDistance(x, dir, wanted, W, others)
    applyRigMotion(doc, rig, e.id, f, { duration: Math.min(MOTION_SECONDS[e.id], room), distance, dir })
    if (wanted && root?.keyframes?.x) follow(root.keyframes.x)
  }
}

/**
 * Auto-Director for Animated Cartoons:
 * Places Character Builder rigs in the scene and applies automatic talking/acting gestures.
 */
export async function directCartoonProject(
  projectId: number,
  doc: ProjectDoc,
  onProgress?: (msg: string) => void
): Promise<ProjectDoc> {
  const builders = await api.builderList().catch(() => [] as BuilderSummary[])
  const cards = await api.cardList().catch(() => [] as CardSummary[])
  if (!builders.length && !cards.length) {
    onProgress?.('Tidak ada karakter di Character Builder.')
    return doc
  }
  type Member = { kind: 'rig'; c: BuilderSummary } | { kind: 'card'; c: CardSummary }
  const roster: Member[] = [...builders.map((c) => ({ kind: 'rig' as const, c })), ...cards.map((c) => ({ kind: 'card' as const, c }))]
  /** the character a name stands for: the id the film pinned (builder and card ids share one table), else by name */
  const memberOf = (name: string): Member | undefined => {
    const key = name.toLowerCase()
    const id = ((doc as any).character_ids ?? {})[key]
    return roster.find((m) => m.c.id === id) ?? roster.find((m) => m.c.name.toLowerCase() === key)
  }

  const W = doc.settings.width
  const H = doc.settings.height
  const fps = doc.settings.fps
  const preparedCache = new Map<string, Cast | null>()
  const flatCache = new Map<string, FlatFigure | null>()
  const projectAssets = new Map<number, Asset>((await api.assets(projectId).catch(() => [] as Asset[])).map((a) => [a.id, a]))
  const decoded = new Map<number, { mono: Float32Array; rate: number; seconds: number } | null>()
  /** a voice clip as mono samples (for the lip-sync); null when it cannot be read */
  const decodeVoice = async (assetId: number) => {
    if (!decoded.has(assetId)) {
      try {
        const a = projectAssets.get(assetId)
        if (!a) throw new Error('no asset')
        const buf = await fetch(absUrl(a.url)).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer() })
        const audio = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(buf)
        const mono = new Float32Array(audio.length)
        for (let c = 0; c < audio.numberOfChannels; c++) { const ch = audio.getChannelData(c); for (let i = 0; i < mono.length; i++) mono[i] += ch[i] / audio.numberOfChannels }
        decoded.set(assetId, { mono, rate: audio.sampleRate, seconds: audio.duration })
      } catch {
        decoded.set(assetId, null)
      }
    }
    return decoded.get(assetId) ?? null
  }

  const updatedScenes: Scene[] = []
  const effectClips: AudioClip[] = []
  const effectAssets = new Map<string, number | null>() // sound effect -> uploaded asset (once per project)
  const knownNames = [...((doc as any).characters ?? []), ...Object.keys((doc as any).character_ids ?? {})] as string[]

  for (let sIdx = 0; sIdx < doc.scenes.length; sIdx++) {
    const sc = doc.scenes[sIdx]
    onProgress?.(`Menata adegan ${sIdx + 1}/${doc.scenes.length}: ${sc.name}…`)

    // Check which characters speak in this scene
    const speakers = Array.from(
      new Set((sc.board?.dialog ?? []).map((d) => d.who.trim()).filter((w) => w && !/^narr?ator$/i.test(w))) // the narrator has a voice and a caption, not a body
    )
    // what the script says happens without words; whoever is named in an action needs a full rig, even without a line to speak
    const beats = sc.board?.beats ?? []
    const names = [...speakers, ...(sc.board?.cast ?? []), ...knownNames, ...roster.map((m) => m.c.name)]
    const actions = beats.filter((b) => b.action).map((b) => ({ at: b.at, ...parseAction(b.action!, names) })).filter((a) => a.effects.length)
    const speaking = speakers.map((n) => n.toLowerCase())
    const actors = actions.flatMap((a) => a.who.map((n) => n.trim())).filter((n, i, all) => !speaking.includes(n.toLowerCase()) && !/^narr?ator$/i.test(n) && all.findIndex((x) => x.toLowerCase() === n.toLowerCase()) === i)
    const onStage = [...speakers, ...actors].slice(0, Math.max(MAX_RIGS, speakers.length))
    const targetChars: string[] = onStage.length > 0 ? onStage : (doc as any).characters ?? ['Sekar', 'Uki']

    /** the rig of a character by name (prepared once per project); `strict` = no stand-in when no character has that name */
    const rigOf = async (name: string, strict = false): Promise<Cast | null> => {
      const key = name.toLowerCase()
      if (!preparedCache.has(key)) {
        const m = memberOf(name) ?? (strict ? undefined : roster[0])
        if (!m) return null
        onProgress?.(`Mempersiapkan karakter ${m.kind === 'card' ? '2.5D' : 'rig'}: ${m.c.name}…`)
        const cast: Cast | null = m.kind === 'card'
          ? await prepareCard(projectId, m.c, onProgress).then((pc) => ({ kind: 'card' as const, name: pc.name, pc })).catch(() => null)
          : await prepareRig(projectId, m.c, onProgress).then((pr) => ({ kind: 'rig' as const, name: pr.name, pr })).catch(() => null)
        preparedCache.set(key, cast)
      }
      return preparedCache.get(key) ?? null
    }
    const rigsInScene: Cast[] = []
    const rigByName = new Map<string, Cast>()
    for (const name of targetChars) {
      const found = await rigOf(name, actors.includes(name)) // (only a speaker may have a stand-in: someone named in an action must really be that character)
      if (found) { rigsInScene.push(found); rigByName.set(name.toLowerCase(), found) }
    }
    // the crowd: who else is in the scene without speaking (students, teachers...). Each one is ONE image (it only stands and breathes: a
    // rig of ~40 bones and pieces per person would make a scene of a whole class far too heavy). A name without a character is left out.
    const crowd: FlatFigure[] = []
    for (const name of silentCast(sc.board?.cast, targetChars)) {
      const key = name.toLowerCase()
      if (!flatCache.has(key)) {
        const m = memberOf(name)
        onProgress?.(`Menyiapkan pemeran latar: ${m?.c.name ?? name}…`)
        flatCache.set(key, m ? await (m.kind === 'card' ? prepareCardFlat(projectId, m.c) : prepareFlat(projectId, m.c)).catch(() => null) : null)
      }
      const f = flatCache.get(key)
      if (f && !crowd.includes(f)) crowd.push(f)
    }

    // Positions: Left (0.32) and Right (0.68)
    const dialogLines = (sc.board?.dialog ?? []).map((d) => d.text)
    const running = rigsInScene.length === 1 && isRunScene(sc.name, dialogLines) // one character crossing the screen
    const xFracs = running ? [0.15] : rigsInScene.length === 1 ? [0.5] : [0.32, 0.68, 0.5, 0.82]
    const sStart = sceneStart(doc, sIdx)
    const charLayers: Layer[] = []
    // Where the feet go: on the floor of THIS location, with the figure sized for the room
    const floorY = floorFor(sc.layers.find((l) => l.name.startsWith('Latar'))?.name.replace(/^Latar:\s*/, ''), H)
    const spots = new Map<string, { x: number; headTop: number; follow?: Keyframe[] }>() // speaker -> where the head is (for the balloons); follow = x keys when it moves

    const speakerScale: { height: number; footY: number }[] = [] // how tall the speakers are on screen and where they stand: the crowd is sized from them
    for (const [idx, cast] of rigsInScene.entries()) {
      const pr = cast // (its name)
      const xFrac = xFracs[idx] ?? 0.5
      // figure height in its own units: rig canvas units, or card pixels (hair top to feet)
      const units = cast.kind === 'rig' ? figureExtent(cast.pr).bottom - figureExtent(cast.pr).top : (cast.pc.meta.body.char_height_px ?? cast.pc.meta.body.canvas[1])
      const baseFrac = rigsInScene.length === 1 ? 0.58 : 0.52
      const footY0 = standingOn(H, floorY, baseFrac, fitScale(H), units).footY
      const tallestBalloon = Math.max(0, ...sc.layers.filter((l) => l.type === 'balloon').map((b) => balloonSize(b.text ?? '', b.fontSize ?? 28).height))
      // leave room above the head for the biggest balloon of this scene (a tall figure in a room with a low ceiling would hide behind it)
      const stand = standingOn(H, floorY, figureFracWithHeadroom(H, footY0, tallestBalloon, baseFrac), fitScale(H), units)
      const figPx = fitScale(H) * stand.scale * units
      const layers = cast.kind === 'rig'
        ? rigLayers(cast.pr, { width: W, height: H }, { xFrac, scale: stand.scale, footY: stand.footY })
        : cardLayers(cast.pc, { width: W, height: H, duration: sc.duration, fps }, uid, { xFrac, footY: stand.footY, height: figPx / H })
      speakerScale.push({ height: figPx, footY: stand.footY })
      spots.set(pr.name.toLowerCase(), { x: xFrac * W, headTop: stand.footY - figPx })

      // ---- acting: breathing or running, a face and pose per line, the mouth following the real voice
      const tmp: SceneDocument = { schema: 1, settings: { width: W, height: H, fps, duration: sc.duration, background: '#ffffff' }, layers }
      const rig = findRigs(layers)[0]
      const myLines = (sc.subtitles ?? [])
        .filter((sub) => sub.text.toLowerCase().startsWith(`${pr.name.toLowerCase()}:`))
        .map((sub) => ({ text: sub.text.slice(sub.text.indexOf(':') + 1).trim(), start: sub.start, end: sub.end }))
      if (rig) {
        try {
          const root = layers.find((l) => l.id === rig.bones.root?.id)
          if (running) {
            applyRigMotion(tmp, rig, 'run', 0, { duration: sc.duration, distance: W * 0.55, dir: 1 })
            if (root?.keyframes?.x) spots.get(pr.name.toLowerCase())!.follow = root.keyframes.x
          } else {
            // a card has no torso bone: it breathes from the feet (its root)
            const torso = layers.find((l) => l.id === (cast.kind === 'card' ? rig.bones.root?.id : rig.bones.torso?.id))
            if (torso) applyPreset(torso, 'breathe', { duration: sc.duration, amount: cast.kind === 'card' ? 0.8 : 1.4, cycles: Math.max(1, Math.round(sc.duration / 2.4)), phase: 0 }, 0, fps, evalLayer(torso, 0))
          }

          const exprs = rigExpressions(rig)
          const cardBody = cast.kind === 'card' ? layers.find((l) => l.id === rig.pieces[CARD_ROLES.body]?.id) : undefined
          const stand = POSES.find((p) => p.id === 'berdiri')!
          const plan = planActing(myLines, fps)
          plan.forEach((step, i) => {
            const next = plan[i + 1]
            const emotion = cardBody ? cardExpression(step.emotion, cardExprs(rig)) ?? 'netral' : step.emotion
            if (step.emotion !== 'netral' && emotion !== 'netral' && exprs.includes(emotion)) {
              applyExpression(tmp, rig, emotion, step.start)
              const back = Math.min(step.end + 4, next ? next.start - 1 : Infinity)
              if (back > step.start) applyExpression(tmp, rig, 'default', back) // relax the face (unless the next line starts right away)
            }
            if (cardBody && step.pose && !running) {
              if (applyCardPose(cardBody, step.pose, step.start + 2)) {
                const back = Math.min(step.end + EASE_OUT, next ? next.start - 1 : Infinity)
                if (back > step.start + 4) applyCardPose(cardBody, 'berdiri', back)
              }
              return
            }
            const pose = POSES.find((p) => p.id === step.pose)
            if (pose && !running && !cardBody) {
              if (step.start - EASE_IN > 0) applyPose(tmp, rig, stand, step.start - EASE_IN)
              applyPose(tmp, rig, pose, step.start + 2)
              const back = Math.min(step.end + EASE_OUT, next ? next.start - EASE_IN - 1 : Infinity)
              if (back > step.start + 4) applyPose(tmp, rig, stand, back)
            }
          })

          // what the script says this character does (after the acting above: an action replaces the keys in its range)
          for (const a of actions) {
            if (!a.all && !a.who.some((n) => rigByName.get(n.trim().toLowerCase()) === cast)) continue
            for (const e of a.effects) applyAction(tmp, rig, e, a.at, W, rigsInScene.map((_, i) => (xFracs[i] ?? 0.5) * W).filter((_, i) => i !== idx), (x) => { spots.get(pr.name.toLowerCase())!.follow = x })
          }

          // the mouth follows the loudness of the real voice of each of this character's lines
          const mouth = layers.find((l) => l.id === (rig.pieces.mouth ?? rig.pieces[CARD_ROLES.mouth])?.id)
          const cardMouth = !!mouth && mouth.rig?.role === `piece:${CARD_ROLES.mouth}`
          if (mouth) {
            for (const clip of doc.audio.filter((c) => c.name.toLowerCase().startsWith(`${pr.name.toLowerCase()}: `))) {
              const t0 = clip.start - sStart
              if (t0 < -0.01 || t0 >= sc.duration || !clip.assetId) continue
              const v = await decodeVoice(clip.assetId)
              if (!v) continue
              const open = openings(envelope(v.mono, v.rate, fps, 0, Math.min(v.seconds, sc.duration - t0)))
              if (cardMouth) { applyCardLipSync(mouth, open, Math.round(t0 * fps)); continue }
              const keys = mouthKeys(open, Math.round(t0 * fps), mouth.scaleY)
              applyLipSync(mouth, keys)
            }
          }
        } catch (e) {
          console.warn('Auto-director: acting skipped for', pr.name, e) // the character still stands in the scene
        }
      }

      charLayers.push(...layers)
    }

    // the crowd stands further back (smaller, feet higher), the back row first; it breathes, each one at its own pace
    const crowdLayers: Layer[] = []
    const spotsBack = crowdSpots(crowd.length, rigsInScene.map((_, i) => xFracs[i] ?? 0.5))
    for (const [i, f] of crowd.entries()) {
      const at = spotsBack[i]
      if (!at) break
      // the size and floor line of the speakers (they are made smaller when a scene has big balloons: the crowd must not outgrow them)
      const own = standingOn(H, floorY, 0.52, fitScale(H), f.box.y1 - f.box.y0)
      // (figures are sized by their HEIGHT on screen, whatever the size of their drawing: the same rule as for the speakers)
      const figH = f.box.y1 - f.box.y0
      const ref = speakerScale.length
        ? { height: speakerScale.reduce((t, x) => t + x.height, 0) / speakerScale.length, footY: speakerScale.reduce((t, x) => t + x.footY, 0) / speakerScale.length }
        : { height: fitScale(H) * own.scale * figH, footY: own.footY }
      const k = (ref.height * at.scale) / figH // scene pixels per canvas unit
      const footY = ref.footY - at.lift * H
      const layer: Layer = {
        id: uid(), type: 'image', name: `Orang latar: ${f.name}`, assetId: f.assetId,
        x: Math.round(at.xFrac * W + k * ((f.box.x0 + f.box.x1) / 2 - 200)), y: Math.round(footY - (k * (f.box.y1 - f.box.y0)) / 2),
        scaleX: k / RIG_PX, scaleY: k / RIG_PX, rotation: 0, pivotX: 0, pivotY: 0, opacity: 1, visible: true, locked: false, parentId: null,
      }
      applyPreset(layer, 'breathe', { duration: sc.duration, amount: 0.8, cycles: Math.max(1, Math.round(sc.duration / (2.2 + (i % 4) * 0.35))), phase: (i * 67) % 360 }, 0, fps, evalLayer(layer, 0))
      if (at.row === 1) crowdLayers.unshift(layer); else crowdLayers.push(layer)
    }
    if (crowd.length) charLayers.unshift(...crowdLayers) // behind the speakers


    // the sound effects of the script
    for (const b of beats) {
      const id = b.sfx ? pickSfx(b.sfx) : null
      if (!id || doc.audio.length + effectClips.length >= MAX_AUDIO_CLIPS) continue
      const label = SFX.find((x) => x.id === id)!.label
      if (!effectAssets.has(id)) {
        onProgress?.(`Menyiapkan efek suara: ${label}…`)
        const up = await api.uploadAudio(projectId, new File([sfxBlob(id)], `efek-${id}.wav`, { type: 'audio/wav' })).catch((e) => { console.warn('Auto-director: efek suara gagal', id, e); return null })
        effectAssets.set(id, up?.id ?? null)
      }
      const assetId = effectAssets.get(id)
      if (assetId) effectClips.push({ id: uid(), assetId, name: `Efek: ${label}`.slice(0, 120), start: Math.round((sStart + b.at) * 100) / 100, volume: 0.8, kind: 'sfx' })
    }

    // Combine: Background layer -> Character layers -> Speech Balloons / Foreground
    const bgLayer = sc.layers.find((l) => l.name.startsWith('Latar'))
    const balloons = sc.layers.filter((l) => l.type === 'balloon')
    const otherLayers = sc.layers.filter((l) => !l.name.startsWith('Latar') && l.type !== 'balloon')

    // balloons go above the head of whoever speaks (size fitted to the text), tail pointing at the head
    for (const b of balloons) {
      const spot = spots.get((b.name.replace(/^Balon:\s*/, '') || '').trim().toLowerCase()) ?? [...spots.values()][0]
      if (!spot) continue
      const { width, height } = balloonSize(b.text ?? '', b.fontSize ?? 28)
      const at = balloonAbove(W, spot.x, spot.headTop, width, height)
      Object.assign(b, { width, height, x: at.x, y: at.y, tailX: at.tailX, tailY: at.tailY })
      if (spot.follow) b.keyframes = { ...b.keyframes, x: followKeys(spot.follow, at.x - spot.x) } // the balloon runs along with the speaker
    }

    const newLayers: Layer[] = [
      ...(bgLayer ? [bgLayer] : []),
      ...charLayers,
      ...otherLayers,
      ...balloons,
    ]

    updatedScenes.push({
      ...sc,
      layers: newLayers,
    })
  }

  const updatedDoc: ProjectDoc = {
    ...doc,
    scenes: updatedScenes,
    audio: [...doc.audio, ...effectClips],
    auto_generated: false, // marked as directed
  }

  return updatedDoc
}

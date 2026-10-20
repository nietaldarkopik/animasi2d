import { api } from './api'
import { prepareRig, rigLayers, type PreparedRig } from './builder/insertRig'
import type { BuilderSummary } from './builder/types'
import type { Keyframe, Layer, ProjectDoc, Scene } from './types'

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
  if (!builders.length) {
    onProgress?.('Tidak ada karakter di Character Builder.')
    return doc
  }

  const W = doc.settings.width
  const H = doc.settings.height
  const fps = doc.settings.fps
  const preparedCache = new Map<string, PreparedRig | null>()

  const updatedScenes: Scene[] = []

  for (let sIdx = 0; sIdx < doc.scenes.length; sIdx++) {
    const sc = doc.scenes[sIdx]
    onProgress?.(`Menata adegan ${sIdx + 1}/${doc.scenes.length}: ${sc.name}…`)

    // Check which characters speak in this scene
    const speakers = Array.from(
      new Set((sc.board?.dialog ?? []).map((d) => d.who.trim()).filter(Boolean))
    )
    const targetChars = speakers.length > 0 ? speakers : (doc as any).characters ?? ['Sekar', 'Uki']

    const rigsInScene: PreparedRig[] = []
    for (const name of targetChars) {
      const key = name.toLowerCase()
      if (!preparedCache.has(key)) {
        const b = builders.find((x) => x.name.toLowerCase() === key) ?? builders[0]
        onProgress?.(`Mempersiapkan karakter 3D/2D rig: ${b.name}…`)
        const pr = await prepareRig(projectId, b, onProgress).catch(() => null)
        preparedCache.set(key, pr)
      }
      const found = preparedCache.get(key)
      if (found) rigsInScene.push(found)
    }

    // Positions: Left (0.32) and Right (0.68)
    const xFracs = rigsInScene.length === 1 ? [0.5] : [0.32, 0.68, 0.5, 0.82]
    const charLayers: Layer[] = []

    rigsInScene.forEach((pr, idx) => {
      const isLeft = idx === 0
      const xFrac = xFracs[idx] ?? 0.5
      const layers = rigLayers(pr, { width: W, height: H }, { xFrac, scale: 0.95 })

      // Animate character talking when their dialogue is active
      const rootBone = layers.find((l) => l.type === 'bone' && !l.parentId)
      const headBone = layers.find((l) => l.name.toLowerCase().includes('kepala') || l.name.toLowerCase().includes('head'))
      const armBone = layers.find((l) => l.name.toLowerCase().includes('lengan') && l.name.toLowerCase().includes('kanan'))

      // Dialogue intervals for this character
      const myDialogs = (sc.subtitles ?? []).filter((sub) =>
        sub.text.toLowerCase().startsWith(pr.name.toLowerCase())
      )

      if (rootBone && myDialogs.length > 0) {
        const rotKeys: Keyframe[] = [{ f: 0, v: rootBone.rotation ?? 0, e: 'linear' }]
        const yKeys: Keyframe[] = [{ f: 0, v: rootBone.y, e: 'linear' }]

        for (const dlg of myDialogs) {
          const sf = Math.round(dlg.start * fps)
          const ef = Math.round(dlg.end * fps)
          const mid = Math.round((sf + ef) / 2)

          // Subtle bounce and tilt while talking
          rotKeys.push(
            { f: sf, v: (rootBone.rotation ?? 0) + (isLeft ? 2 : -2), e: 'easeOut' },
            { f: mid, v: (rootBone.rotation ?? 0) - (isLeft ? 2 : -2), e: 'easeInOut' },
            { f: ef, v: rootBone.rotation ?? 0, e: 'easeIn' }
          )
          yKeys.push(
            { f: sf, v: rootBone.y - 6, e: 'easeOut' },
            { f: mid, v: rootBone.y, e: 'easeInOut' },
            { f: ef, v: rootBone.y, e: 'easeIn' }
          )
        }

        rootBone.keyframes = {
          ...rootBone.keyframes,
          rotation: rotKeys,
          y: yKeys,
        }
      }

      // Head nodding while speaking
      if (headBone && myDialogs.length > 0) {
        const headRotKeys: Keyframe[] = [{ f: 0, v: headBone.rotation ?? 0, e: 'linear' }]
        for (const dlg of myDialogs) {
          const sf = Math.round(dlg.start * fps)
          const ef = Math.round(dlg.end * fps)
          const mid = Math.round((sf + ef) / 2)
          headRotKeys.push(
            { f: sf, v: (headBone.rotation ?? 0) + 3, e: 'easeOut' },
            { f: mid, v: (headBone.rotation ?? 0) - 2, e: 'easeInOut' },
            { f: ef, v: headBone.rotation ?? 0, e: 'easeIn' }
          )
        }
        headBone.keyframes = {
          ...headBone.keyframes,
          rotation: headRotKeys,
        }
      }

      // Hand gesture during speech
      if (armBone && myDialogs.length > 0) {
        const firstDlg = myDialogs[0]
        const sf = Math.round(firstDlg.start * fps)
        const ef = Math.round(firstDlg.end * fps)
        armBone.keyframes = {
          ...armBone.keyframes,
          rotation: [
            { f: 0, v: armBone.rotation ?? 0, e: 'linear' },
            { f: sf + 4, v: (armBone.rotation ?? 0) + (isLeft ? -35 : 35), e: 'easeOut' },
            { f: ef - 6, v: (armBone.rotation ?? 0) + (isLeft ? -25 : 25), e: 'easeInOut' },
            { f: ef, v: armBone.rotation ?? 0, e: 'easeIn' },
          ],
        }
      }

      charLayers.push(...layers)
    })

    // Combine: Background layer -> Character layers -> Speech Balloons / Foreground
    const bgLayer = sc.layers.find((l) => l.name.startsWith('Latar'))
    const balloons = sc.layers.filter((l) => l.type === 'balloon')
    const otherLayers = sc.layers.filter((l) => !l.name.startsWith('Latar') && l.type !== 'balloon')

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
    auto_generated: false, // marked as directed
  }

  return updatedDoc
}

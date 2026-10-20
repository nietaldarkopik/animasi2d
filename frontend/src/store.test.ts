import { beforeEach, describe, expect, it, vi } from 'vitest'

// the store talks to the server only through api.saveProject; replace it with a slow fake that enforces revisions like the server
const calls: { base: number; doc: unknown }[] = []
let serverRevision = 1
vi.mock('./api', () => {
  class ApiError extends Error { status: number; constructor(m: string, s: number) { super(m); this.status = s } }
  return {
    ApiError,
    api: {
      saveProject: async (_id: number, p: { base_revision: number; document: unknown }) => {
        calls.push({ base: p.base_revision, doc: p.document })
        await new Promise((r) => setTimeout(r, 30))
        if (p.base_revision !== serverRevision) throw new ApiError('conflict', 409)
        serverRevision++
        return { id: 1, name: 'p', revision: serverRevision, document: p.document, updated_at: '' }
      },
    },
  }
})

const { useEditor } = await import('./store')

const doc = () => ({ schema: 2 as const, settings: { width: 100, height: 100, fps: 24 }, scenes: [{ id: 's', name: 'S', duration: 2, background: '#ffffff', transition: null, layers: [] }], audio: [] })

beforeEach(() => {
  calls.length = 0
  serverRevision = 1
  useEditor.getState().reset()
  const project = doc()
  useEditor.setState({
    projectId: 1, name: 'p', project, activeSceneId: 's', revision: 1, dirty: true, saveState: 'idle',
    doc: { schema: 1, settings: { ...project.settings, duration: 2, background: '#ffffff' }, layers: [] },
  })
})

describe('saving', () => {
  it('two saves requested while one is running are sent one after the other with fresh revisions (no false conflict)', async () => {
    const s = useEditor.getState()
    const first = s.save()
    useEditor.getState().edit((d) => { d.settings.duration += 1 }) // a real edit while the first save is in flight
    const second = useEditor.getState().save() // e.g. the manual "Simpan versi" while autosave is in flight
    useEditor.getState().edit((d) => { d.settings.duration += 1 })
    const third = useEditor.getState().save() // and a third one (Export clicks save too)
    expect(await Promise.all([first, second, third])).toEqual([true, true, true])
    expect(useEditor.getState().saveState).toBe('saved')
    // the later two are coalesced into ONE save of the newest document (nothing to send for the third), with the fresh revision
    expect(calls.map((c) => c.base)).toEqual([1, 2])
    expect((calls[1].doc as { scenes: { duration: number }[] }).scenes[0].duration).toBe(4)
    expect(useEditor.getState().revision).toBe(3)
    expect(useEditor.getState().dirty).toBe(false)
  })

  it('a real conflict (someone else saved) is still reported', async () => {
    serverRevision = 7
    expect(await useEditor.getState().save()).toBe(false)
    expect(useEditor.getState().saveState).toBe('conflict')
  })

  it('a save with nothing to save is a no-op unless a snapshot is requested', async () => {
    useEditor.setState({ dirty: false })
    expect(await useEditor.getState().save()).toBe(true)
    expect(calls).toHaveLength(0)
    expect(await useEditor.getState().save({ snapshot: true, label: 'x' })).toBe(true)
    expect(calls).toHaveLength(1)
  })
})

describe('scene-level helpers', () => {
  it('addScenes replaces a still-blank single scene and appends otherwise, opening the first new scene', () => {
    const mk = (id: string) => ({ id, name: id, duration: 3, background: '#ffffff', transition: null, layers: [] })
    useEditor.getState().addScenes([mk('a'), mk('b')])
    expect(useEditor.getState().currentProject()!.scenes.map((x) => x.id)).toEqual(['a', 'b'])
    expect(useEditor.getState().activeSceneId).toBe('a')
    useEditor.getState().addScenes([mk('c')])
    expect(useEditor.getState().currentProject()!.scenes.map((x) => x.id)).toEqual(['a', 'b', 'c'])
    expect(useEditor.getState().activeSceneId).toBe('c')
  })

  it('addLayersToScene reaches the open scene (undoable) and other scenes, and can replace the background layer', () => {
    const mk = (id: string) => ({ id, name: id, duration: 3, background: '#ffffff', transition: null, layers: [] })
    useEditor.getState().addScenes([mk('a'), mk('b')])
    const L = (id: string, name: string) => ({ id, type: 'shape' as const, name, x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, visible: true, locked: false })
    useEditor.getState().addLayersToScene('b', [L('bg1', 'Latar: Satu')], { first: true })
    expect(useEditor.getState().currentProject()!.scenes[1].layers.map((l) => l.id)).toEqual(['bg1'])
    useEditor.getState().addLayersToScene('b', [L('x', 'Tokoh')])
    useEditor.getState().addLayersToScene('b', [L('bg2', 'Latar: Dua')], { first: true, replacePrefix: 'Latar: ' })
    expect(useEditor.getState().currentProject()!.scenes[1].layers.map((l) => l.id)).toEqual(['bg2', 'x'])
    // the open scene goes through the undo history
    useEditor.getState().addLayersToScene('a', [L('p', 'Properti')])
    expect(useEditor.getState().doc!.layers.map((l) => l.id)).toEqual(['p'])
    useEditor.getState().undo()
    expect(useEditor.getState().doc!.layers).toHaveLength(0)
  })

  it('addAudio places a clip at a given time with its kind, else after the previous clip', () => {
    const a = (id: number, d: number) => ({ id, name: `a${id}`, mime: 'audio/wav', size: 1, width: 0, height: 0, duration: d, url: '' })
    useEditor.setState({ assets: { 1: a(1, 2), 2: a(2, 1) } })
    useEditor.getState().addAudio(a(1, 2))
    useEditor.getState().addAudio(a(2, 1), { start: 5.123, kind: 'sfx' })
    useEditor.getState().addAudio(a(1, 2))
    const clips = useEditor.getState().currentProject()!.audio
    expect(clips.map((c) => c.start)).toEqual([0, 5.12, 6.12]) // the third follows the end of the clip that ends last (5.12 + 1)
    expect(clips[1].kind).toBe('sfx')
    expect(clips[0].kind).toBeUndefined()
  })

  it('camera / effects / subtitles of the open scene survive merging back into the project', () => {
    useEditor.getState().edit((d) => { d.effects = [{ id: 'e', kind: 'rain', intensity: 0.4 }]; d.subtitles = [{ id: 'u', start: 0, end: 1, text: 'Hai' }] })
    const p = useEditor.getState().currentProject()!
    expect(p.scenes[0].effects).toHaveLength(1)
    expect(p.scenes[0].subtitles![0].text).toBe('Hai')
    useEditor.getState().setSceneExtras('s', { effects: [] })
    expect(useEditor.getState().currentProject()!.scenes[0].effects).toBeUndefined()
  })
})

describe('multi-selection', () => {
  const L = (id: string, o: object = {}) => ({ id, type: 'shape' as const, name: id, x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, visible: true, locked: false, ...o })
  beforeEach(() => { useEditor.getState().edit((d) => { d.layers = [L('a'), L('b'), L('c', { parentId: 'a' })] }); useEditor.getState().select(null) })

  it('select / toggle / selectMany keep the primary layer = the last one picked', () => {
    const s = useEditor.getState()
    s.select('a')
    expect(useEditor.getState()).toMatchObject({ selectedId: 'a', selection: ['a'] })
    useEditor.getState().toggleSelect('b')
    expect(useEditor.getState()).toMatchObject({ selectedId: 'b', selection: ['a', 'b'] })
    useEditor.getState().toggleSelect('b')
    expect(useEditor.getState()).toMatchObject({ selectedId: 'a', selection: ['a'] })
    useEditor.getState().selectMany(['b', 'zzz'], true) // unknown ids are ignored; additive keeps a
    expect(useEditor.getState().selection).toEqual(['a', 'b'])
    useEditor.getState().selectMany(['c'])
    expect(useEditor.getState()).toMatchObject({ selectedId: 'c', selection: ['c'] })
    useEditor.getState().select(null)
    expect(useEditor.getState()).toMatchObject({ selectedId: null, selection: [] })
  })

  it('setPropsMany changes several layers in ONE undo step', () => {
    useEditor.getState().setPropsMany({ a: { x: 5 }, b: { x: 7, y: 9 } })
    expect(useEditor.getState().doc!.layers.map((l) => [l.x, l.y])).toEqual([[5, 0], [7, 9], [0, 0]])
    useEditor.getState().undo()
    expect(useEditor.getState().doc!.layers.map((l) => l.x)).toEqual([0, 0, 0])
  })

  it('setPropsMany keys animated properties at the playhead like setProps does', () => {
    useEditor.getState().edit((d) => { d.layers[0].keyframes = { x: [{ f: 0, v: 0, e: 'linear' }] } })
    useEditor.getState().setFrame(12)
    useEditor.getState().setPropsMany({ a: { x: 40 }, b: { x: 40 } })
    const [a, b] = useEditor.getState().doc!.layers
    expect(a.keyframes!.x).toEqual([{ f: 0, v: 0, e: 'linear' }, { f: 12, v: 40, e: 'linear' }])
    expect(b.x).toBe(40) // not animated: plain value
  })

  it('removeLayers deletes the selection with its children and prunes the selection', () => {
    useEditor.getState().selectMany(['a', 'b'])
    useEditor.getState().removeLayers(['a', 'b'])
    expect(useEditor.getState().doc!.layers).toEqual([]) // c was a's child
    expect(useEditor.getState().selection).toEqual([])
    useEditor.getState().undo()
    expect(useEditor.getState().doc!.layers.map((l) => l.id)).toEqual(['a', 'b', 'c'])
  })

  it('undo drops layers that no longer exist from the selection', () => {
    useEditor.getState().addLayer(L('n'))
    expect(useEditor.getState().selection).toEqual(['n'])
    useEditor.getState().undo()
    expect(useEditor.getState().selection).toEqual([])
    expect(useEditor.getState().selectedId).toBeNull()
  })
})

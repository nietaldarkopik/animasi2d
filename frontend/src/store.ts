import { create } from 'zustand'
import { api, ApiError } from './api'
import { descendantIds, evalProp, hasCamera, isAnimProp, keyAt, removeKey, setKey, totalFrames } from './anim'
import { cloneScene, mergeView, migrate, sceneUid, sceneView } from './movie'
import type { AnimProp, Asset, AudioClip, Ease, Layer, Project, ProjectDoc, Scene, SceneDocument, Settings } from './types'

const HISTORY_LIMIT = 100
const AUTOSAVE_MS = 2000

const clone = <T,>(v: T): T => structuredClone(v)
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)

interface EditorState {
  projectId: number | null
  name: string
  /** the whole film. NOTE: the active scene's layers live in `doc` until merged — use `currentProject()` for the full, current document */
  project: ProjectDoc | null
  activeSceneId: string | null
  /** play the whole film (all scenes, transitions, audio) instead of looping the active scene */
  movie: boolean
  setMovie: (v: boolean) => void
  /** show the scene through its camera while editing (always on for film playback and export) */
  camPreview: boolean
  setCamPreview: (v: boolean) => void
  currentProject: () => ProjectDoc | null
  selectScene: (id: string) => void
  addScene: () => void
  duplicateScene: (id: string) => void
  deleteScene: (id: string) => void
  moveScene: (id: string, dir: -1 | 1) => void
  updateScene: (id: string, patch: Partial<Pick<Scene, 'name' | 'transition' | 'board' | 'duration' | 'background'>>) => void
  /** add layers to any scene of the film (the open one goes through the undo history) */
  addLayersToScene: (sceneId: string, layers: Layer[], opts?: { first?: boolean; replacePrefix?: string }) => void
  /** append scenes to the film (a still-blank single scene is replaced); opens the first new one */
  addScenes: (scenes: Scene[]) => void
  setSceneExtras: (sceneId: string, extras: Partial<Pick<Scene, 'camera' | 'effects' | 'subtitles'>>) => void
  addAudio: (asset: Asset, opts?: { start?: number; kind?: AudioClip['kind'] }) => void
  updateAudio: (id: string, patch: Partial<AudioClip>) => void
  removeAudio: (id: string) => void
  /** the editable view of the active scene */
  doc: SceneDocument | null
  revision: number
  assets: Record<number, Asset>
  /** the primary selected layer (properties panel, timeline); always the last element of `selection` */
  selectedId: string | null
  /** every selected layer (several can be moved / resized together) */
  selection: string[]
  past: SceneDocument[]
  future: SceneDocument[]
  coalesceKey: string | null
  coalesceAt: number
  dirty: boolean
  saveState: 'idle' | 'saving' | 'saved' | 'error' | 'conflict'
  saveError: string | null
  frame: number
  playing: boolean
  autoKey: boolean
  onion: boolean
  /** asset currently open in the image editor dialog */
  editAssetId: number | null
  /** asset open in the Enhancement Studio */
  enhanceAssetId: number | null
  openEnhance: (id: number | null) => void
  /** image layer being split into parts by the AI dialog */
  segmentLayerId: string | null
  /** image layer open in the retouch dialog */
  retouchLayerId: string | null
  openRetouch: (id: string | null) => void
  openSegment: (id: string | null) => void
  openImageEditor: (id: number | null) => void
  showBones: boolean
  setShowBones: (v: boolean) => void
  /** Re-parent keeping the on-screen position; local comes from the canvas. Returns an error message or null. */
  reparent: (id: string, parentId: string | null, local: Partial<Layer>) => string | null
  selKey: { layerId: string; prop: AnimProp; f: number } | null

  setFrame: (f: number) => void
  setPlaying: (p: boolean) => void
  setAutoKey: (v: boolean) => void
  setOnion: (v: boolean) => void
  selectKey: (k: EditorState['selKey']) => void
  /** Keyframe-aware property change at the playhead (auto-key, or props that are already animated). */
  setProps: (id: string, patch: Partial<Layer>, key?: string) => void
  toggleKey: (id: string, prop: AnimProp) => void
  moveKey: (id: string, prop: AnimProp, from: number, to: number) => void
  deleteKey: (k: NonNullable<EditorState['selKey']>) => void
  setKeyEase: (k: NonNullable<EditorState['selKey']>, e: Ease) => void

  load: (id: number) => Promise<void>
  reset: () => void
  select: (id: string | null) => void
  /** replace the selection, or (additive) add to it */
  selectMany: (ids: string[], additive?: boolean) => void
  /** Shift/Ctrl+click: add the layer to the selection or take it out */
  toggleSelect: (id: string) => void
  /** several layers' properties in ONE undo step (keyframe-aware like setProps) */
  setPropsMany: (patches: Record<string, Partial<Layer>>, key?: string) => void
  removeLayers: (ids: string[]) => void
  /** Apply a change to the document, recording undo history. `key` coalesces rapid edits of the same field. */
  edit: (fn: (d: SceneDocument) => void, key?: string) => void
  updateLayer: (id: string, patch: Partial<Layer>, key?: string) => void
  updateSettings: (patch: Partial<Settings>) => void
  addLayer: (layer: Layer) => void
  removeLayer: (id: string) => void
  moveLayer: (id: string, dir: 1 | -1) => void
  addAsset: (a: Asset) => void
  undo: () => void
  redo: () => void
  rename: (name: string) => void
  save: (opts?: { snapshot?: boolean; label?: string }) => Promise<boolean>
  adopt: (p: Project) => void
}

let timer: ReturnType<typeof setTimeout> | undefined
let inflight: Promise<boolean> | null = null
/** undo/redo stacks of the scenes that are not currently open */
const histories = new Map<string, { past: SceneDocument[]; future: SceneDocument[] }>()

export const useEditor = create<EditorState>((set, get) => {
  const touch = () => {
    set({ dirty: true, saveState: 'idle' })
    clearTimeout(timer)
    timer = setTimeout(() => void get().save(), AUTOSAVE_MS)
  }

  /** project-level change (scene list/order): rebuild the active view and drop undo history (it no longer matches) */
  const activate = (p: ProjectDoc, sceneId: string) => {
    histories.clear()
    set({ project: p, activeSceneId: sceneId, doc: sceneView(p, sceneId), past: [], future: [], selectedId: null, selection: [], selKey: null, frame: 0, coalesceKey: null })
    touch()
  }

  return {
    projectId: null,
    name: '',
    project: null,
    activeSceneId: null,
    movie: false,
    setMovie: (movie) => set({ movie, playing: movie ? true : get().playing }),
    camPreview: false,
    setCamPreview: (camPreview) => set({ camPreview }),

    currentProject() {
      const { project, activeSceneId, doc } = get()
      return project && doc && activeSceneId ? mergeView(project, activeSceneId, doc) : project
    },

    selectScene(id) {
      const { project, activeSceneId, doc, past, future } = get()
      if (!project || !doc || !activeSceneId || id === activeSceneId || !project.scenes.some((s) => s.id === id)) return
      histories.set(activeSceneId, { past, future })
      const merged = mergeView(project, activeSceneId, doc)
      const h = histories.get(id)
      set({ project: merged, activeSceneId: id, doc: sceneView(merged, id), past: h?.past ?? [], future: h?.future ?? [], selectedId: null, selection: [], selKey: null, frame: 0, coalesceKey: null })
    },

    addScene() {
      const p = get().currentProject()
      if (!p) return
      const cur = p.scenes.find((s) => s.id === get().activeSceneId)!
      const sc: Scene = { id: sceneUid(), name: `Scene ${p.scenes.length + 1}`, duration: cur.duration, background: cur.background, transition: null, layers: [] }
      const i = p.scenes.indexOf(cur)
      activate({ ...p, scenes: [...p.scenes.slice(0, i + 1), sc, ...p.scenes.slice(i + 1)] }, sc.id)
    },

    duplicateScene(id) {
      const p = get().currentProject()
      const src = p?.scenes.find((s) => s.id === id)
      if (!p || !src) return
      const copy = cloneScene(src, sceneUid(), `${src.name} (salinan)`.slice(0, 80), uid)
      const i = p.scenes.indexOf(src)
      activate({ ...p, scenes: [...p.scenes.slice(0, i + 1), copy, ...p.scenes.slice(i + 1)] }, copy.id)
    },

    deleteScene(id) {
      const p = get().currentProject()
      if (!p || p.scenes.length <= 1) return
      const i = p.scenes.findIndex((s) => s.id === id)
      if (i < 0) return
      const scenes = p.scenes.filter((s) => s.id !== id)
      const active = get().activeSceneId
      activate({ ...p, scenes }, active === id ? scenes[Math.min(i, scenes.length - 1)].id : active!)
    },

    moveScene(id, dir) {
      const p = get().currentProject()
      if (!p) return
      const i = p.scenes.findIndex((s) => s.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= p.scenes.length) return
      const scenes = [...p.scenes]
      ;[scenes[i], scenes[j]] = [scenes[j], scenes[i]]
      activate({ ...p, scenes }, get().activeSceneId!)
    },

    updateScene(id, patch) {
      const p = get().currentProject()
      if (!p) return
      set({ project: { ...p, scenes: p.scenes.map((s) => (s.id === id ? { ...s, ...patch } : s)) } })
      touch()
    },

    addLayersToScene(sceneId, layers, opts) {
      const drop = (ls: Layer[]) => (opts?.replacePrefix ? ls.filter((l) => !l.name.startsWith(opts.replacePrefix!)) : ls)
      if (sceneId === get().activeSceneId) {
        get().edit((d) => { d.layers = opts?.first ? [...layers, ...drop(d.layers)] : [...drop(d.layers), ...layers] })
        return
      }
      const p = get().currentProject()
      if (!p) return
      set({ project: { ...p, scenes: p.scenes.map((s) => (s.id === sceneId ? { ...s, layers: opts?.first ? [...layers, ...drop(s.layers)] : [...drop(s.layers), ...layers] } : s)) } })
      touch()
    },

    addScenes(scenes) {
      const p = get().currentProject()
      if (!p || scenes.length === 0) return
      const only = p.scenes[0]
      const blank = p.scenes.length === 1 && only.layers.length === 0 && !only.board && !only.subtitles?.length && !only.effects?.length && !hasCamera(only.camera)
      activate({ ...p, scenes: blank ? scenes : [...p.scenes, ...scenes] }, scenes[0].id)
    },

    setSceneExtras(sceneId, extras) {
      if (sceneId === get().activeSceneId) {
        get().edit((d) => {
          if ('camera' in extras) d.camera = extras.camera
          if ('effects' in extras) d.effects = extras.effects
          if ('subtitles' in extras) d.subtitles = extras.subtitles
        })
        return
      }
      const p = get().currentProject()
      if (!p) return
      set({ project: { ...p, scenes: p.scenes.map((s) => (s.id === sceneId ? { ...s, ...extras } : s)) } })
      touch()
    },

    addAudio(asset, opts) {
      const p = get().currentProject()
      if (!p) return
      // place the new clip right after the previous one (or at 0), unless a start time is given
      const end = Math.max(0, ...p.audio.map((c) => c.start + (get().assets[c.assetId]?.duration ?? 0)))
      const start = Math.round((opts?.start ?? end) * 100) / 100
      set({ project: { ...p, audio: [...p.audio, { id: uid(), assetId: asset.id, name: asset.name.slice(0, 120), start, volume: 1, ...(opts?.kind ? { kind: opts.kind } : {}) }] } })
      touch()
    },

    updateAudio(id, patch) {
      const p = get().currentProject()
      if (!p) return
      set({ project: { ...p, audio: p.audio.map((c) => (c.id === id ? { ...c, ...patch } : c)) } })
      touch()
    },

    removeAudio(id) {
      const p = get().currentProject()
      if (!p) return
      set({ project: { ...p, audio: p.audio.filter((c) => c.id !== id) } })
      touch()
    },

    doc: null,
    revision: 0,
    assets: {},
    selectedId: null,
    selection: [],
    past: [],
    future: [],
    coalesceKey: null,
    coalesceAt: 0,
    dirty: false,
    saveState: 'idle',
    saveError: null,
    frame: 0,
    playing: false,
    autoKey: false,
    onion: false,
    editAssetId: null,
    enhanceAssetId: null,
    openEnhance: (enhanceAssetId) => set({ enhanceAssetId }),
    segmentLayerId: null,
    retouchLayerId: null,
    openRetouch: (retouchLayerId) => set({ retouchLayerId }),
    openSegment: (segmentLayerId) => set({ segmentLayerId }),
    openImageEditor: (editAssetId) => set({ editAssetId }),
    showBones: true,
    setShowBones: (showBones) => set({ showBones }),
    reparent(id, parentId, local) {
      const d = get().doc
      const l = d?.layers.find((x) => x.id === id)
      if (!d || !l) return 'Layer tidak ditemukan.'
      if (parentId && (parentId === id || descendantIds(d, id).has(parentId))) return 'Parent tidak boleh layer itu sendiri atau turunannya.'
      if (['x', 'y', 'rotation', 'scaleX', 'scaleY'].some((p) => l.keyframes?.[p as AnimProp]?.length)) return 'Hapus keyframe posisi/rotasi/skala layer ini dulu sebelum mengganti parent.'
      get().edit((dd) => {
        const t = dd.layers.find((x) => x.id === id)!
        t.parentId = parentId
        Object.assign(t, local)
      })
      return null
    },
    selKey: null,

    setFrame: (f) => set({ frame: Math.max(0, Math.min(f, get().doc ? totalFrames(get().doc!) : 0)) }),
    setPlaying: (playing) => set({ playing }),
    setAutoKey: (autoKey) => set({ autoKey }),
    setOnion: (onion) => set({ onion }),
    selectKey: (selKey) => set({ selKey }),

    setProps(id, patch, key) {
      const { frame, autoKey } = get()
      const f = Math.round(frame)
      get().edit((d) => {
        const l = d.layers.find((x) => x.id === id)
        if (!l) return
        for (const [k, v] of Object.entries(patch) as [keyof Layer, any][]) {
          if (isAnimProp(k) && (autoKey || l.keyframes?.[k]?.length)) setKey(l, k, f, v as number)
          else (l as any)[k] = v
        }
      }, key)
    },

    toggleKey(id, prop) {
      const f = Math.round(get().frame)
      get().edit((d) => {
        const l = d.layers.find((x) => x.id === id)
        if (!l) return
        if (keyAt(l, prop, f)) removeKey(l, prop, f)
        else setKey(l, prop, f, evalProp(l, prop, f))
      })
    },

    moveKey(id, prop, from, to) {
      if (from === to) return
      get().edit((d) => {
        const l = d.layers.find((x) => x.id === id)
        const k = l && keyAt(l, prop, from)
        if (!l || !k || keyAt(l, prop, to)) return
        removeKey(l, prop, from)
        setKey(l, prop, to, k.v, k.e)
      }, 'movekey:' + id + prop)
      const s = get().selKey
      if (s && s.layerId === id && s.prop === prop && s.f === from) set({ selKey: { ...s, f: to } })
    },

    deleteKey(k) {
      get().edit((d) => {
        const l = d.layers.find((x) => x.id === k.layerId)
        if (l) removeKey(l, k.prop, k.f)
      })
      set({ selKey: null })
    },

    setKeyEase(k, e) {
      get().edit((d) => {
        const l = d.layers.find((x) => x.id === k.layerId)
        const kf = l && keyAt(l, k.prop, k.f)
        if (kf) kf.e = e
      })
    },

    reset() {
      clearTimeout(timer)
      histories.clear()
      set({ projectId: null, project: null, activeSceneId: null, movie: false, doc: null, assets: {}, selectedId: null, selection: [], frame: 0, playing: false, selKey: null, past: [], future: [], dirty: false, saveState: 'idle', saveError: null })
    },

    async load(id) {
      get().reset()
      const [p, assets] = await Promise.all([api.project(id), api.assets(id)])
      const project = migrate(p.document)
      set({
        projectId: p.id,
        name: p.name,
        project,
        activeSceneId: project.scenes[0].id,
        doc: sceneView(project, project.scenes[0].id),
        revision: p.revision,
        assets: Object.fromEntries(assets.map((a) => [a.id, a])),
      })
    },

    adopt(p) {
      const project = migrate(p.document)
      histories.clear()
      set({ name: p.name, project, activeSceneId: project.scenes[0].id, doc: sceneView(project, project.scenes[0].id), revision: p.revision, selectedId: null, selection: [], selKey: null, frame: 0, past: [], future: [], dirty: false, saveState: 'saved' })
    },

    select: (id) => set({ selectedId: id, selection: id ? [id] : [] }),

    selectMany(ids, additive) {
      const known = new Set(get().doc?.layers.map((l) => l.id))
      const next = [...new Set([...(additive ? get().selection : []), ...ids.filter((i) => known.has(i))])]
      set({ selection: next, selectedId: next.at(-1) ?? null })
    },

    toggleSelect(id) {
      const cur = get().selection
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
      set({ selection: next, selectedId: next.at(-1) ?? null })
    },

    setPropsMany(patches, key) {
      const { frame, autoKey } = get()
      const f = Math.round(frame)
      get().edit((d) => {
        for (const [id, patch] of Object.entries(patches)) {
          const l = d.layers.find((x) => x.id === id)
          if (!l) continue
          for (const [k, v] of Object.entries(patch) as [keyof Layer, any][]) {
            if (isAnimProp(k) && (autoKey || l.keyframes?.[k]?.length)) setKey(l, k, f, v as number)
            else (l as any)[k] = v
          }
        }
      }, key)
    },

    removeLayers(ids) {
      const d = get().doc
      if (!d || ids.length === 0) return
      const gone = new Set<string>()
      for (const id of ids) { gone.add(id); descendantIds(d, id).forEach((x) => gone.add(x)) }
      get().edit((dd) => {
        dd.layers = dd.layers.filter((l) => !gone.has(l.id))
        const alive = new Set(dd.layers.map((l) => l.id))
        for (const l of dd.layers) if (l.ik && !alive.has(l.ik.target)) l.ik = null
      })
      const next = get().selection.filter((x) => !gone.has(x))
      set({ selection: next, selectedId: next.at(-1) ?? null })
    },

    edit(fn, key) {
      const { doc, past, coalesceKey, coalesceAt } = get()
      if (!doc) return
      const next = clone(doc)
      fn(next)
      const now = Date.now()
      const merge = key && key === coalesceKey && now - coalesceAt < 800
      set({
        doc: next,
        past: merge ? past : [...past, doc].slice(-HISTORY_LIMIT),
        future: [],
        coalesceKey: key ?? null,
        coalesceAt: now,
      })
      touch()
    },

    updateLayer(id, patch, key) {
      get().edit((d) => {
        const l = d.layers.find((x) => x.id === id)
        if (l) Object.assign(l, patch)
      }, key)
    },

    updateSettings(patch) {
      get().edit((d) => Object.assign(d.settings, patch), 'settings:' + Object.keys(patch).join(','))
    },

    addLayer(layer) {
      get().edit((d) => void d.layers.push(layer))
      set({ selectedId: layer.id, selection: [layer.id] })
    },

    removeLayer(id) {
      // deleting a joint deletes everything attached to it
      const gone = new Set([id, ...descendantIds(get().doc!, id)])
      get().edit((d) => {
        d.layers = d.layers.filter((l) => !gone.has(l.id))
        const alive = new Set(d.layers.map((l) => l.id))
        for (const l of d.layers) if (l.ik && !alive.has(l.ik.target)) l.ik = null // target deleted: IK off
      })
      { const next = get().selection.filter((x) => !gone.has(x)); if (next.length !== get().selection.length) set({ selection: next, selectedId: next.at(-1) ?? null }) }
    },

    moveLayer(id, dir) {
      get().edit((d) => {
        const i = d.layers.findIndex((l) => l.id === id)
        if (i < 0) return
        // swap with the nearest sibling (same parent) in that direction
        const pid = d.layers[i].parentId ?? null
        let j = i + dir
        while (j >= 0 && j < d.layers.length && (d.layers[j].parentId ?? null) !== pid) j += dir
        if (j < 0 || j >= d.layers.length) return
        ;[d.layers[i], d.layers[j]] = [d.layers[j], d.layers[i]]
      })
    },

    addAsset: (a) => set((s) => ({ assets: { ...s.assets, [a.id]: a } })),

    undo() {
      const { past, doc, future } = get()
      if (!past.length || !doc) return
      set({ doc: past[past.length - 1], past: past.slice(0, -1), future: [doc, ...future], coalesceKey: null })
      { const known = new Set(get().doc!.layers.map((l) => l.id)); const next = get().selection.filter((x) => known.has(x)); if (next.length !== get().selection.length) set({ selection: next, selectedId: next.at(-1) ?? null }) }
      touch()
    },

    redo() {
      const { past, doc, future } = get()
      if (!future.length || !doc) return
      set({ doc: future[0], past: [...past, doc], future: future.slice(1), coalesceKey: null })
      touch()
    },

    rename(name) {
      set({ name })
      touch()
    },

    async save(opts) {
      // serialise saves: wait for any in-flight one, then save the latest state
      while (inflight) await inflight.catch(() => false) // loop: several callers can wait on the same save, and only one may start the next
      const { projectId, doc, name, revision, dirty, project } = get()
      if (!projectId || !doc || (!dirty && !opts?.snapshot)) return true
      clearTimeout(timer)

      set({ saveState: 'saving', saveError: null })
      const sentDoc = doc
      const sentProject = project
      const payload = get().currentProject()!
      inflight = (async () => {
        try {
          const p = await api.saveProject(projectId, {
            name,
            document: payload,
            base_revision: revision,
            snapshot: opts?.snapshot,
            label: opts?.label,
          })
          // keep edits made while the request was in flight
          const stillDirty = get().doc !== sentDoc || get().project !== sentProject
          set({ revision: p.revision, dirty: stillDirty, saveState: 'saved' })
          if (stillDirty) touch()
          return true
        } catch (e) {
          const conflict = e instanceof ApiError && e.status === 409
          set({ saveState: conflict ? 'conflict' : 'error', saveError: (e as Error).message })
          return false
        } finally {
          inflight = null
        }
      })()
      return inflight
    },
  }
})

// the browser test scripts read and drive the editor state through this handle (development builds only)
if (import.meta.env.DEV && typeof window !== 'undefined') (window as unknown as { __editor: typeof useEditor }).__editor = useEditor

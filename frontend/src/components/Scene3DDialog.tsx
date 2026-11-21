import { useEffect, useRef, useState, type PointerEvent } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { api } from '../api'
import { uid, useEditor } from '../store'
import type { Scene3DConfig, Scene3DObject } from '../types'

const freshConfig = (): Scene3DConfig => ({
  background: '#b8c9d8',
  floor: true,
  walls: true,
  ambient: 1.4,
  directional: 2.2,
  camera: [7, 6, 9],
  objects: [],
})

function makeObject(shape: Scene3DObject['shape'], index: number): Scene3DObject {
  return {
    id: uid(),
    name: shape === 'box' ? `Kubus ${index}` : shape === 'sphere' ? `Bola ${index}` : 'Silinder',
    shape,
    position: [index * 1.1 - 1, 0.65, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    color: shape === 'sphere' ? '#e9a23b' : shape === 'cylinder' ? '#4d9b83' : '#4f8cff',
  }
}

export function Scene3DDialog({ projectId, sceneId, initial, onClose }: {
  projectId: number
  sceneId: string
  initial?: Scene3DConfig
  onClose: () => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const modelLoadGeneration = useRef(0)
  const modelInput = useRef<HTMLInputElement>(null)
  const environmentInput = useRef<HTMLInputElement>(null)
  const renderer = useRef<THREE.WebGLRenderer | null>(null)
  const world = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const [config, setConfig] = useState<Scene3DConfig>(() => structuredClone(initial ?? freshConfig()))
  const [camera, setCamera] = useState<[number, number, number]>(() => [...(initial?.camera ?? freshConfig().camera)])
  const [selected, setSelected] = useState<string | null>(config.objects[0]?.id ?? null)
  const [busy, setBusy] = useState(false)
  const [modelsLoading, setModelsLoading] = useState(false)
  const [error, setError] = useState('')
  const active = config.objects.find((o) => o.id === selected) ?? null
  const aspect = useEditor((s) => s.doc ? s.doc.settings.width / s.doc.settings.height : 9 / 16)

  useEffect(() => {
    if (!host.current) return
    const scene = new THREE.Scene()
    const cam = new THREE.PerspectiveCamera(42, aspect, 0.1, 1000)
    cam.position.set(...camera)
    cam.lookAt(0, 0.8, 0)
    const gl = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true })
    gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75))
    gl.outputColorSpace = THREE.SRGBColorSpace
    gl.shadowMap.enabled = true
    gl.shadowMap.type = THREE.PCFSoftShadowMap
    host.current.appendChild(gl.domElement)
    renderer.current = gl
    world.current = scene
    cameraRef.current = cam
    const resize = () => {
      if (!host.current) return
      const w = Math.max(1, host.current.clientWidth)
      const h = Math.max(1, host.current.clientHeight)
      gl.setSize(w, h, false)
      cam.aspect = w / h
      cam.updateProjectionMatrix()
      gl.render(scene, cam)
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host.current)
    resize()
    return () => {
      observer.disconnect()
      gl.dispose()
      gl.domElement.remove()
      renderer.current = null
      world.current = null
      cameraRef.current = null
    }
  }, [aspect])

  useEffect(() => {
    let alive = true
    api.assets(projectId).then((assets) => {
      if (!alive) return
      const byId = new Map(assets.map((asset) => [asset.id, asset]))
      setConfig((current) => ({
        ...current,
        objects: current.objects.map((item) => {
          if (item.shape !== 'model' || !item.assetId) return item
          const asset = byId.get(item.assetId)
          return asset ? { ...item, modelUrl: asset.url } : item
        }),
      }))
    }).catch(() => {
      // Keep saved URLs as a fallback; they may still be valid.
    })
    return () => { alive = false }
  }, [projectId])

  useEffect(() => {
    const scene = world.current
    const gl = renderer.current
    const cam = cameraRef.current
    if (!scene || !gl || !cam) return
    scene.traverse((node) => {
      const mesh = node as THREE.Mesh
      if (mesh.geometry) mesh.geometry.dispose()
      if (mesh.material) {
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        materials.forEach((material) => material.dispose())
      }
    })
    scene.clear()
    scene.background = new THREE.Color(config.background)
    scene.add(new THREE.HemisphereLight(0xffffff, 0x657080, config.ambient))
    const key = new THREE.DirectionalLight(0xffffff, config.directional)
    key.position.set(-4, 9, 6)
    key.castShadow = true
    key.shadow.mapSize.set(1024, 1024)
    scene.add(key)

    if (config.floor) {
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(24, 24), new THREE.MeshStandardMaterial({ color: '#c9c5bb', roughness: 0.92 }))
      floor.rotation.x = -Math.PI / 2
      floor.position.y = -0.03
      floor.receiveShadow = true
      scene.add(floor)
      const grid = new THREE.GridHelper(24, 24, 0x777777, 0xaaaaaa)
      grid.position.y = -0.015
      scene.add(grid)
    }
    if (config.walls) {
      const wallMaterial = new THREE.MeshStandardMaterial({ color: '#e2e5e8', roughness: 0.95, side: THREE.DoubleSide })
      const back = new THREE.Mesh(new THREE.PlaneGeometry(24, 10), wallMaterial)
      back.position.set(0, 5, -8)
      back.receiveShadow = true
      scene.add(back)
      const side = new THREE.Mesh(new THREE.PlaneGeometry(16, 10), wallMaterial)
      side.position.set(-12, 5, 0)
      side.rotation.y = Math.PI / 2
      side.receiveShadow = true
      scene.add(side)
    }

    const generation = ++modelLoadGeneration.current
    const modelItems = config.objects.filter((item) => item.shape === 'model')
    setModelsLoading(modelItems.length > 0)
    let pendingModels = modelItems.length
    const modelReady = () => {
      pendingModels -= 1
      if (generation === modelLoadGeneration.current && pendingModels <= 0) setModelsLoading(false)
      if (generation === modelLoadGeneration.current) gl.render(scene, cam)
    }

    for (const item of config.objects) {
      if (item.shape === 'model') {
        if (!item.modelUrl) { modelReady(); continue }
        new GLTFLoader().load(item.modelUrl, (gltf) => {
          if (generation !== modelLoadGeneration.current) return
          const model = gltf.scene
          const bounds = new THREE.Box3().setFromObject(model)
          const size = bounds.getSize(new THREE.Vector3())
          const center = bounds.getCenter(new THREE.Vector3())
          const largest = Math.max(size.x, size.y, size.z, 0.001)
          const fitScale = 1.8 / largest
          model.scale.setScalar(fitScale)
          model.position.copy(center).multiplyScalar(-fitScale)
          model.traverse((node) => {
            const mesh = node as THREE.Mesh
            if (mesh.isMesh) { mesh.castShadow = true; mesh.receiveShadow = true }
          })
          const wrapper = new THREE.Group()
          wrapper.add(model)
          wrapper.position.set(...item.position)
          wrapper.rotation.set(...item.rotation.map((v) => THREE.MathUtils.degToRad(v)) as [number, number, number])
          wrapper.scale.set(...item.scale)
          scene.add(wrapper)
          modelReady()
        }, undefined, () => { if (generation === modelLoadGeneration.current) setError(`Gagal memuat model 3D: ${item.name}`); modelReady() })
        continue
      }
      const geometry = item.shape === 'sphere'
        ? new THREE.SphereGeometry(0.65, 32, 24)
        : item.shape === 'cylinder'
          ? new THREE.CylinderGeometry(0.55, 0.55, 1.3, 32)
          : new THREE.BoxGeometry(1.3, 1.3, 1.3)
      const material = new THREE.MeshStandardMaterial({ color: item.color, roughness: 0.62, metalness: 0.02 })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.position.set(...item.position)
      mesh.rotation.set(...item.rotation.map((v) => THREE.MathUtils.degToRad(v)) as [number, number, number])
      mesh.scale.set(...item.scale)
      mesh.castShadow = true
      mesh.receiveShadow = true
      scene.add(mesh)
    }

    cam.position.set(...camera)
    cam.lookAt(0, 0.8, 0)
    gl.render(scene, cam)
    return () => { modelLoadGeneration.current += 1 }
  }, [config, camera])

  async function importEnvironment(file?: File) {
    if (!file) return
    try {
      const parsed = JSON.parse(await file.text())
      const source = parsed.config ?? parsed
      let objects: Scene3DObject[]
      if (Array.isArray(source.items) && source.placeName) {
        objects = source.items.filter((item: { kind?: string }) => item.kind !== 'character').map((item: Record<string, unknown>) => ({
          id: String(item.id ?? uid()),
          name: String(item.name ?? 'Objek environment'),
          shape: item.shape === 'sphere' || item.shape === 'cylinder' ? item.shape : 'box',
          position: [Number(item.x ?? 0), Number(item.y ?? 0), Number(item.z ?? 0)] as [number, number, number],
          rotation: [0, 0, 0] as [number, number, number],
          scale: [Number(item.width ?? 1), Number(item.height ?? 1), Number(item.depth ?? 1)] as [number, number, number],
          color: String(item.color ?? '#a6b4c2'),
        }))
      } else if (Array.isArray(source.objects)) {
        objects = source.objects.map((item: Scene3DObject) => ({
          ...item,
          id: String(item.id ?? uid()),
          shape: item.shape === 'sphere' || item.shape === 'cylinder' || item.shape === 'model' ? item.shape : 'box',
          position: item.position ?? [0, 0.5, 0],
          rotation: item.rotation ?? [0, 0, 0],
          scale: item.scale ?? [1, 1, 1],
          color: item.color ?? '#a6b4c2',
        }))
      } else throw new Error('File tidak berisi daftar objek environment yang dikenali.')
      // Models from the shared Environment Library must become project-owned assets
      // before the scene is saved, so project duplication and validation remain reliable.
      for (const object of objects) {
        if (object.shape !== 'model' || object.assetId || !object.modelUrl) continue
        const response = await fetch(object.modelUrl)
        if (!response.ok) throw new Error(`Tidak dapat mengambil model environment: ${object.name}`)
        const blob = await response.blob()
        const file = new File([blob], `${object.name || 'environment'}.glb`, { type: 'model/gltf-binary' })
        const asset = await api.upload3DModel(projectId, file)
        useEditor.getState().addAsset(asset)
        object.assetId = asset.id
        object.modelUrl = asset.url
      }
      const nextCamera = Array.isArray(source.camera) && source.camera.length === 3
        ? source.camera.map(Number) as [number, number, number]
        : [7, 6, 9] as [number, number, number]
      const next: Scene3DConfig = {
        ...freshConfig(),
        background: typeof source.background === 'string' ? source.background : '#202a35',
        floor: Boolean(source.floor),
        walls: Boolean(source.walls),
        ambient: Number.isFinite(Number(source.ambient)) ? Number(source.ambient) : 1.4,
        directional: Number.isFinite(Number(source.directional)) ? Number(source.directional) : 2.2,
        camera: nextCamera,
        objects,
      }
      setConfig(next)
      setCamera(nextCamera)
      setSelected(objects[0]?.id ?? null)
      setError('')
    } catch (e) {
      setError((e as Error).message || 'Gagal membaca environment JSON.')
    } finally {
      if (environmentInput.current) environmentInput.current.value = ''
    }
  }

  async function importModel(file?: File) {
    if (!file) return
    const extension = file.name.toLowerCase().split('.').pop()
    if (extension !== 'glb' && extension !== 'gltf') {
      setError('Pilih file .glb atau .gltf.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const asset = await api.upload3DModel(projectId, file)
      useEditor.getState().addAsset(asset)
      const item: Scene3DObject = {
        id: uid(),
        name: file.name.replace(/\.(glb|gltf)$/i, ''),
        shape: 'model',
        assetId: asset.id,
        modelUrl: asset.url,
        position: [0, 0.9, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        color: '#ffffff',
      }
      setConfig((current) => ({ ...current, objects: [...current.objects, item] }))
      setSelected(item.id)
    } catch (e) {
      setError((e as Error).message || 'Gagal mengunggah model 3D.')
    } finally {
      setBusy(false)
      if (modelInput.current) modelInput.current.value = ''
    }
  }

  function patchObject(patch: Partial<Scene3DObject>) {
    if (!active) return
    setConfig((c) => ({ ...c, objects: c.objects.map((o) => o.id === active.id ? { ...o, ...patch } : o) }))
  }

  function patchVector(key: 'position' | 'rotation' | 'scale', axis: 0 | 1 | 2, value: number) {
    if (!active || !Number.isFinite(value)) return
    const vector = [...active[key]] as [number, number, number]
    vector[axis] = value
    patchObject({ [key]: vector })
  }

  function add(shape: Scene3DObject['shape']) {
    const item = makeObject(shape, config.objects.length + 1)
    setConfig((c) => ({ ...c, objects: [...c.objects, item] }))
    setSelected(item.id)
  }

  function addPreset(kind: 'chair' | 'desk') {
    const base = config.objects.length * 0.08
    const parts: Omit<Scene3DObject, 'id'>[] = kind === 'chair'
      ? [
          { name: 'Kursi - dudukan', shape: 'box', position: [base, 0.66, 0], rotation: [0, 0, 0], scale: [1.05, 0.14, 0.95], color: '#b77945' },
          { name: 'Kursi - sandaran', shape: 'box', position: [base, 1.22, -0.4], rotation: [0, 0, 0], scale: [1.05, 1.05, 0.13], color: '#9b6038' },
          { name: 'Kursi - kaki kiri depan', shape: 'box', position: [base - 0.42, 0.32, 0.36], rotation: [0, 0, 0], scale: [0.12, 0.64, 0.12], color: '#765039' },
          { name: 'Kursi - kaki kanan depan', shape: 'box', position: [base + 0.42, 0.32, 0.36], rotation: [0, 0, 0], scale: [0.12, 0.64, 0.12], color: '#765039' },
          { name: 'Kursi - kaki kiri belakang', shape: 'box', position: [base - 0.42, 0.32, -0.36], rotation: [0, 0, 0], scale: [0.12, 0.64, 0.12], color: '#765039' },
          { name: 'Kursi - kaki kanan belakang', shape: 'box', position: [base + 0.42, 0.32, -0.36], rotation: [0, 0, 0], scale: [0.12, 0.64, 0.12], color: '#765039' },
        ]
      : [
          { name: 'Meja - permukaan', shape: 'box', position: [base, 0.94, 0], rotation: [0, 0, 0], scale: [2.2, 0.14, 1.25], color: '#bd8956' },
          { name: 'Meja - kaki kiri depan', shape: 'box', position: [base - 0.88, 0.46, 0.45], rotation: [0, 0, 0], scale: [0.13, 0.92, 0.13], color: '#80583a' },
          { name: 'Meja - kaki kanan depan', shape: 'box', position: [base + 0.88, 0.46, 0.45], rotation: [0, 0, 0], scale: [0.13, 0.92, 0.13], color: '#80583a' },
          { name: 'Meja - kaki kiri belakang', shape: 'box', position: [base - 0.88, 0.46, -0.45], rotation: [0, 0, 0], scale: [0.13, 0.92, 0.13], color: '#80583a' },
          { name: 'Meja - kaki kanan belakang', shape: 'box', position: [base + 0.88, 0.46, -0.45], rotation: [0, 0, 0], scale: [0.13, 0.92, 0.13], color: '#80583a' },
        ]
    const created = parts.map((part) => ({ ...part, id: uid() } as Scene3DObject))
    setConfig((c) => ({ ...c, objects: [...c.objects, ...created] }))
    setSelected(created[0]?.id ?? null)
  }

  function orbit(e: PointerEvent<HTMLDivElement>) {
    if (e.buttons !== 1) return
    const target = e.currentTarget
    const rect = target.getBoundingClientRect()
    const dx = e.movementX / Math.max(1, rect.width)
    const dy = e.movementY / Math.max(1, rect.height)
    setCamera((old) => {
      const radius = Math.max(3, Math.hypot(...old))
      const theta = Math.atan2(old[0], old[2]) - dx * 3
      const phi = THREE.MathUtils.clamp(Math.acos(old[1] / radius) + dy * 3, 0.25, 1.48)
      return [radius * Math.sin(phi) * Math.sin(theta), radius * Math.cos(phi), radius * Math.sin(phi) * Math.cos(theta)]
    })
  }

  async function save() {
    setBusy(true); setError('')
    try {
      const finalConfig = { ...config, camera }
      useEditor.getState().updateScene(sceneId, { threeScene: finalConfig })
      const gl = renderer.current
      const scene = world.current
      const previewCamera = cameraRef.current
      const doc = useEditor.getState().doc
      if (!gl || !scene || !previewCamera || !doc) throw new Error('Preview 3D belum siap.')
      // Render at the exact project dimensions, not the dialog preview dimensions.
      const exportRenderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
      try {
        exportRenderer.setPixelRatio(1)
        exportRenderer.setSize(doc.settings.width, doc.settings.height, false)
        exportRenderer.outputColorSpace = THREE.SRGBColorSpace
        exportRenderer.shadowMap.enabled = true
        exportRenderer.shadowMap.type = THREE.PCFSoftShadowMap
        const exportCamera = previewCamera.clone()
        exportCamera.aspect = doc.settings.width / doc.settings.height
        exportCamera.updateProjectionMatrix()
        exportRenderer.render(scene, exportCamera)
        const blob = await new Promise<Blob>((resolve, reject) => exportRenderer.domElement.toBlob((b) => b ? resolve(b) : reject(new Error('Gagal membuat render PNG.')), 'image/png'))
        const asset = await api.uploadAsset(projectId, blob, `scene-3d-${sceneId}.png`)
        useEditor.getState().addAsset(asset)
        const fit = Math.min(doc.settings.width / asset.width, doc.settings.height / asset.height)
      useEditor.getState().addLayersToScene(sceneId, [{
        id: uid(), type: 'image', name: 'Latar 3D', assetId: asset.id,
        x: doc.settings.width / 2, y: doc.settings.height / 2,
        scaleX: fit, scaleY: fit, rotation: 0, opacity: 1, visible: true, locked: true,
        }], { first: true, replacePrefix: ['Latar 3D', 'Latar: '] })
        onClose()
      } finally {
        exportRenderer.dispose()
      }
    } catch (e) {
      setError((e as Error).message || 'Gagal menyimpan scene 3D.')
    } finally { setBusy(false) }
  }

  return (
    <div className="modal" onClick={() => !busy && onClose()}>
      <div className="card dialog" role="dialog" aria-modal="true" aria-labelledby="scene3d-title" onClick={(e) => e.stopPropagation()} style={{ width: 'min(1180px, 98vw)', height: 'min(820px, 94vh)', maxHeight: '94vh', display: 'flex', flexDirection: 'column', gap: 10, overflow: 'hidden' }}>
        <div className="row between">
          <div><h2 id="scene3d-title">3D Scene Studio</h2><p className="muted small">Bangun lingkungan 3D, atur kamera, lalu masukkan hasil render sebagai latar scene 2D.</p></div>
          <button onClick={onClose} disabled={busy}>Tutup</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 280px', gap: 12, minHeight: 0, flex: 1 }}>
          <div ref={host} onPointerMove={orbit} onWheel={(e) => { e.preventDefault(); setCamera((c) => c.map((v) => v * (e.deltaY > 0 ? 1.08 : 0.92)) as [number, number, number]) }} style={{ minHeight: 260, background: '#20242c', borderRadius: 8, overflow: 'hidden', cursor: 'grab', touchAction: 'none' }} />
          <aside style={{ overflow: 'auto', display: 'grid', alignContent: 'start', gap: 10 }}>
            <section>
              <h3>Lingkungan</h3>
              <input ref={environmentInput} type="file" accept="application/json,.json" hidden onChange={(e) => void importEnvironment(e.target.files?.[0])} />
              <button onClick={() => environmentInput.current?.click()} disabled={busy}>Impor environment dari Scene Lab (.JSON)</button>
              <label className="field"><span>Warna langit / latar</span><input type="color" value={config.background} onChange={(e) => setConfig((c) => ({ ...c, background: e.target.value }))} /></label>
              <label className="inline"><input type="checkbox" checked={config.floor} onChange={(e) => setConfig((c) => ({ ...c, floor: e.target.checked }))} /> Lantai</label>
              <label className="inline"><input type="checkbox" checked={config.walls} onChange={(e) => setConfig((c) => ({ ...c, walls: e.target.checked }))} /> Dinding</label>
              <label className="field"><span>Ambient light: {config.ambient.toFixed(1)}</span><input type="range" min="0" max="3" step="0.1" value={config.ambient} onChange={(e) => setConfig((c) => ({ ...c, ambient: Number(e.target.value) }))} /></label>
              <label className="field"><span>Directional light: {config.directional.toFixed(1)}</span><input type="range" min="0" max="5" step="0.1" value={config.directional} onChange={(e) => setConfig((c) => ({ ...c, directional: Number(e.target.value) }))} /></label>
            </section>
            <section>
              <h3>Tambah objek 3D</h3>
              <div className="row" style={{ flexWrap: 'wrap' }}><button onClick={() => add('box')}>+ Kubus</button><button onClick={() => add('sphere')}>+ Bola</button><button onClick={() => add('cylinder')}>+ Silinder</button></div>
              <div className="row" style={{ flexWrap: 'wrap', marginTop: 6 }}><button onClick={() => addPreset('chair')}>+ Kursi sekolah</button><button onClick={() => addPreset('desk')}>+ Meja sekolah</button></div>
              <input ref={modelInput} type="file" accept=".glb,.gltf,model/gltf-binary,model/gltf+json" hidden onChange={(e) => void importModel(e.target.files?.[0])} />
              <button onClick={() => modelInput.current?.click()} disabled={busy}>+ Impor model 3D (.GLB / .GLTF)</button>
              {modelsLoading && <p className="muted small">Memuat model 3D…</p>}
              <div style={{ display: 'grid', gap: 4, marginTop: 8 }}>
                {config.objects.map((o) => <button key={o.id} className={o.id === selected ? 'primary' : ''} onClick={() => setSelected(o.id)} style={{ textAlign: 'left' }}>{o.name}</button>)}
                {config.objects.length === 0 && <p className="muted small">Belum ada objek. Tambahkan bentuk dasar di atas.</p>}
              </div>
            </section>
            {active && <section>
              <div className="row between"><h3>{active.name}</h3><button className="danger" onClick={() => { setConfig((c) => ({ ...c, objects: c.objects.filter((o) => o.id !== active.id) })); setSelected(null) }}>Hapus</button></div>
              <label className="field"><span>Nama</span><input value={active.name} onChange={(e) => patchObject({ name: e.target.value })} /></label>
              {active.shape !== 'model' && <label className="field"><span>Warna</span><input type="color" value={active.color} onChange={(e) => patchObject({ color: e.target.value })} /></label>}
              {(['position', 'rotation', 'scale'] as const).map((key) => <div key={key}><h3>{key === 'position' ? 'Posisi XYZ' : key === 'rotation' ? 'Rotasi XYZ (derajat)' : 'Skala XYZ'}</h3><div className="grid2">{(['X', 'Y', 'Z'] as const).map((axis, i) => <label className="field" key={axis}><span>{axis}</span><input type="number" step={key === 'rotation' ? 5 : 0.1} value={active[key][i]} onChange={(e) => patchVector(key, i as 0 | 1 | 2, Number(e.target.value))} /></label>)}</div></div>)}
            </section>}
            <section><h3>Kamera</h3><p className="muted small">Seret area preview untuk memutar kamera, scroll untuk zoom.</p><div className="grid2">{(['X', 'Y', 'Z'] as const).map((axis, i) => <label className="field" key={axis}><span>{axis}</span><input type="number" step="0.5" value={camera[i]} onChange={(e) => setCamera((c) => c.map((v, j) => j === i ? Number(e.target.value) : v) as [number, number, number])} /></label>)}</div></section>
            {error && <p className="error small" role="alert">{error}</p>}
            <button className="primary" disabled={busy || modelsLoading} onClick={() => void save()}>{busy ? 'Merender…' : 'Simpan & gunakan sebagai latar'}</button>
          </aside>
        </div>
      </div>
    </div>
  )
}

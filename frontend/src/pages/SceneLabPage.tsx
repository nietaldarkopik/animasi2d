import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { AppNav } from '../components/AppNav'

type Kind = 'place' | 'prop' | 'character'
type Shape = 'box' | 'sphere' | 'cylinder' | 'plane'
interface SceneItem {
  id: string
  name: string
  kind: Kind
  shape: Shape
  x: number; y: number; z: number
  width: number; height: number; depth: number
  color: string
  imageData?: string
}
interface SceneDraft { placeName: string; items: SceneItem[] }

const KEY = 'cm_three_scene_lab_v1'
const uid = () => Math.random().toString(36).slice(2, 10)
const starter = (): SceneDraft => ({
  placeName: 'Kamar mandi',
  items: [
    { id: 'floor', name: 'Lantai', kind: 'place', shape: 'box', x: 0, y: -0.12, z: 0, width: 8, height: .2, depth: 7, color: '#777f89' },
    { id: 'back-wall', name: 'Dinding belakang', kind: 'place', shape: 'box', x: 0, y: 1.7, z: -3.45, width: 8, height: 3.4, depth: .12, color: '#c8d1d8' },
    { id: 'left-wall', name: 'Dinding kiri', kind: 'place', shape: 'box', x: -3.95, y: 1.7, z: 0, width: .12, height: 3.4, depth: 7, color: '#b8c4ce' },
    { id: 'door', name: 'Pintu', kind: 'prop', shape: 'box', x: 2.5, y: 1.05, z: -3.36, width: 1.25, height: 2.1, depth: .08, color: '#80583d' },
    { id: 'sink', name: 'Wastafel', kind: 'prop', shape: 'box', x: -2.2, y: .75, z: -2.5, width: 1.1, height: .22, depth: .55, color: '#e8edf0' },
    { id: 'mirror', name: 'Cermin', kind: 'prop', shape: 'box', x: -2.2, y: 1.8, z: -3.35, width: .9, height: 1, depth: .06, color: '#8fc4d7' },
  ],
})

function readDraft(): SceneDraft {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return starter()
    const parsed = JSON.parse(raw) as SceneDraft
    return parsed.placeName && Array.isArray(parsed.items) ? parsed : starter()
  } catch { return starter() }
}
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

export function SceneLabPage() {
  const [draft, setDraft] = useState<SceneDraft>(readDraft)
  const [selectedId, setSelectedId] = useState<string | null>('sink')
  const [prompt, setPrompt] = useState('')
  const [message, setMessage] = useState('Scene tersimpan otomatis di browser ini.')
  const [busy, setBusy] = useState(false)
  const host = useRef<HTMLDivElement>(null)
  const runtime = useRef<{ renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls; meshes: Map<string, THREE.Object3D>; raf: number } | null>(null)
  const selected = draft.items.find(x => x.id === selectedId) ?? null

  useEffect(() => { localStorage.setItem(KEY, JSON.stringify(draft)) }, [draft])

  useEffect(() => {
    const el = host.current
    if (!el) return
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#202a35')
    scene.fog = new THREE.Fog('#202a35', 14, 35)
    const camera = new THREE.PerspectiveCamera(42, 1, .1, 100)
    camera.position.set(8, 6.5, 10)
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.15
    el.appendChild(renderer.domElement)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(0, 1, 0)
    controls.enableDamping = true
    scene.add(new THREE.HemisphereLight(0xe8f2ff, 0x657080, 2))
    const key = new THREE.DirectionalLight(0xffe0bd, 3)
    key.position.set(-4, 8, 5); key.castShadow = true
    key.shadow.mapSize.set(1024, 1024)
    scene.add(key)
    const fill = new THREE.DirectionalLight(0xb4d9ff, 1.2)
    fill.position.set(5, 4, -4); scene.add(fill)
    const grid = new THREE.GridHelper(16, 32, 0x718096, 0x3c4858)
    grid.position.y = -.015; scene.add(grid)
    const meshes = new Map<string, THREE.Object3D>()
    const resize = () => {
      const w = Math.max(1, el.clientWidth), h = Math.max(1, el.clientHeight)
      camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h)
    }
    const ro = new ResizeObserver(resize); ro.observe(el); resize()
    const tick = () => { controls.update(); renderer.render(scene, camera); runtime.current!.raf = requestAnimationFrame(tick) }
    runtime.current = { renderer, scene, camera, controls, meshes, raf: 0 }
    tick()
    return () => {
      cancelAnimationFrame(runtime.current?.raf ?? 0)
      ro.disconnect(); controls.dispose()
      for (const object of meshes.values()) {
        object.traverse(node => {
          const mesh = node as THREE.Mesh
          if (mesh.geometry) mesh.geometry.dispose()
          const material = mesh.material
          if (Array.isArray(material)) material.forEach(m => m.dispose())
          else if (material) material.dispose()
        })
      }
      renderer.dispose(); renderer.domElement.remove(); runtime.current = null
    }
  }, [])

  useEffect(() => {
    const rt = runtime.current
    if (!rt) return
    const alive = new Set(draft.items.map(x => x.id))
    for (const [id, object] of rt.meshes) if (!alive.has(id)) {
      rt.scene.remove(object); object.traverse(node => {
        const mesh = node as THREE.Mesh
        mesh.geometry?.dispose()
        if (Array.isArray(mesh.material)) mesh.material.forEach(m => m.dispose())
        else if (mesh.material) mesh.material.dispose()
      })
      rt.meshes.delete(id)
    }
    for (const item of draft.items) {
      let object = rt.meshes.get(item.id)
      if (!object) {
        let geometry: THREE.BufferGeometry
        if (item.shape === 'sphere') geometry = new THREE.SphereGeometry(.5, 24, 16)
        else if (item.shape === 'cylinder') geometry = new THREE.CylinderGeometry(.5, .5, 1, 24)
        else if (item.shape === 'plane') geometry = new THREE.PlaneGeometry(1, 1)
        else geometry = new THREE.BoxGeometry(1, 1, 1)
        let material: THREE.Material
        if (item.imageData) {
          const texture = new THREE.TextureLoader().load(item.imageData)
          texture.colorSpace = THREE.SRGBColorSpace
          material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide })
        } else material = new THREE.MeshStandardMaterial({ color: item.color, roughness: .78, metalness: .02 })
        const mesh = new THREE.Mesh(geometry, material)
        mesh.castShadow = item.kind !== 'place'; mesh.receiveShadow = true
        object = mesh
        rt.scene.add(object); rt.meshes.set(item.id, object)
      }
      object.position.set(item.x, item.y, item.z)
      object.scale.set(item.width, item.height, item.depth)
      object.rotation.set(0, 0, 0)
      object.traverse(node => {
        const mesh = node as THREE.Mesh
        if (mesh.material && !Array.isArray(mesh.material) && 'color' in mesh.material && !item.imageData) {
          (mesh.material as THREE.MeshStandardMaterial).color.set(item.id === selectedId ? '#ffffff' : item.color)
          ;(mesh.material as THREE.MeshStandardMaterial).emissive?.set(item.id === selectedId ? '#26384d' : '#000000')
        }
      })
    }
  }, [draft, selectedId])

  const patchItem = (id: string, patch: Partial<SceneItem>) => setDraft(d => ({ ...d, items: d.items.map(x => x.id === id ? { ...x, ...patch } : x) }))
  const addItem = (kind: Kind, shape: Shape = 'box', name?: string, imageData?: string) => {
    const id = uid()
    const item: SceneItem = { id, name: name ?? (kind === 'character' ? 'Karakter baru' : kind === 'place' ? 'Objek tempat' : 'Properti baru'), kind, shape: kind === 'character' ? 'plane' : shape, x: kind === 'character' ? 0 : 0, y: kind === 'character' ? 1 : .5, z: kind === 'character' ? 1 : 0, width: kind === 'character' ? 1.2 : 1, height: kind === 'character' ? 2 : 1, depth: kind === 'character' ? .04 : 1, color: kind === 'character' ? '#ffffff' : '#a6b4c2', ...(imageData ? { imageData } : {}) }
    setDraft(d => ({ ...d, items: [...d.items, item] })); setSelectedId(id)
  }
  const applyPrompt = () => {
    const raw = prompt.trim()
    if (!raw) return
    const p = raw.toLocaleLowerCase('id')
    const next = structuredClone(draft)
    let changed = false
    const target = next.items.find(x => p.includes(x.name.toLocaleLowerCase('id')))
    const color = raw.match(/#(?:[0-9a-f]{3}){1,2}\b/i)?.[0]
    if (/^(ganti nama tempat|ubah nama tempat|nama tempat)/i.test(raw)) {
      next.placeName = raw.replace(/^(ganti nama tempat|ubah nama tempat|nama tempat)\s*(menjadi|:)?\s*/i, '').trim() || next.placeName; changed = true
    } else if (/\b(tambah|buat|letakkan)\b/i.test(p)) {
      const kind: Kind = /arum|seni|uki|riska|karakter/.test(p) ? 'character' : /ruangan|dinding|lantai|tempat/.test(p) ? 'place' : 'prop'
      const name = raw.replace(/^(tolong\s*)?(tambahkan|tambah|buat|letakkan)\s*/i, '').trim().replace(/\s+(di|ke)\s+.*$/i, '') || (kind === 'character' ? 'Karakter baru' : 'Properti baru')
      const id = uid()
      next.items.push({ id, name, kind, shape: kind === 'character' ? 'plane' : 'box', x: 0, y: kind === 'character' ? 1 : .5, z: 0, width: kind === 'character' ? 1.2 : 1, height: kind === 'character' ? 2 : 1, depth: .12, color: color ?? '#a6b4c2' })
      setSelectedId(id); changed = true
    } else if (target && /\b(hapus|hilangkan)\b/.test(p)) {
      next.items = next.items.filter(x => x.id !== target.id); setSelectedId(null); changed = true
    } else if (target && /\b(ubah warna|warnai|ganti warna)\b/.test(p) && color) {
      target.color = color; changed = true; setSelectedId(target.id)
    } else if (target && /\b(geser|pindah|letakkan)\b/.test(p)) {
      const step = /jauh|belakang/.test(p) ? 1.5 : .5
      if (/kiri/.test(p)) target.x -= step
      if (/kanan/.test(p)) target.x += step
      if (/depan/.test(p)) target.z += step
      if (/belakang/.test(p)) target.z -= step
      if (/atas/.test(p)) target.y += step
      if (/bawah/.test(p)) target.y = Math.max(.1, target.y - step)
      changed = true; setSelectedId(target.id)
    } else if (/\b(nama|ganti nama|ubah nama)\b/.test(p) && target) {
      const name = raw.split(/menjadi|jadi|:/i).pop()?.trim()
      if (name) { target.name = name; changed = true; setSelectedId(target.id) }
    }
    if (changed) {
      setDraft(next); setMessage('Instruksi diterapkan ke draft. Periksa hasilnya sebelum melanjutkan.')
    } else setMessage('Instruksi belum dikenali. Coba pola: tambah wastafel; geser wastafel ke kiri; ubah warna pintu #8b5a2b; hapus cermin.')
    setPrompt('')
  }
  const uploadCharacter = (file?: File) => {
    if (!file) return
    if (!file.type.startsWith('image/')) { setMessage('File karakter harus berupa gambar.'); return }
    const reader = new FileReader()
    reader.onload = () => addItem('character', 'plane', file.name.replace(/\.[^.]+$/, ''), String(reader.result))
    reader.readAsDataURL(file)
  }
  const exportDraft = () => {
    const blob = new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob); const a = document.createElement('a')
    a.href = url; a.download = 'scene-3d.json'; a.click(); URL.revokeObjectURL(url)
  }
  const importDraft = async (file?: File) => {
    if (!file) return
    try {
      const parsed = JSON.parse(await file.text()) as SceneDraft
      if (!parsed.placeName || !Array.isArray(parsed.items)) throw new Error('Format scene tidak valid')
      setDraft(parsed); setSelectedId(parsed.items[0]?.id ?? null); setMessage('Scene berhasil dimuat.')
    } catch (e) { setMessage((e as Error).message) }
  }
  const selectedLabel = useMemo(() => selected ? selected.name : 'Belum ada objek dipilih', [selected])

  return <div className="page" style={{ height: '100vh', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
    <header className="topbar" style={{ gap: 14, flexWrap: 'wrap' }}>
      <strong>Scene Lab 3D</strong><AppNav /><span className="spacer" />
      <span className="muted small">Prototype • PixiJS tetap menjadi editor karakter utama</span>
    </header>
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 310px', flex: 1, minHeight: 0 }}>
      <main style={{ display: 'flex', flexDirection: 'column', minWidth: 0, background: '#171c24' }}>
        <div className="row" style={{ padding: 10, borderBottom: '1px solid var(--border)' }}>
          <strong>{draft.placeName}</strong><span className="muted small">{draft.items.length} objek</span><span className="spacer" />
          <button onClick={() => { runtime.current?.camera.position.set(8, 6.5, 10); runtime.current?.controls.target.set(0, 1, 0) }}>Reset kamera</button>
          <button onClick={exportDraft}>Export JSON</button>
          <label style={{ width: 'auto' }}><span className="muted small">Import JSON</span><input type="file" accept="application/json" onChange={e => void importDraft(e.target.files?.[0])} /></label>
        </div>
        <div ref={host} style={{ flex: 1, minHeight: 260, position: 'relative' }} />
        <div style={{ padding: 12, borderTop: '1px solid var(--border)', display: 'grid', gap: 8 }}>
          <div className="row"><strong>Instruksi scene</strong><span className="muted small">Prompt cepat</span></div>
          <div className="row" style={{ alignItems: 'stretch' }}>
            <input value={prompt} onChange={e => setPrompt(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') applyPrompt() }} placeholder="Contoh: geser wastafel ke kiri" />
            <button className="primary" onClick={applyPrompt}>Terapkan</button>
          </div>
          <div className="muted small">{message}</div>
        </div>
      </main>
      <aside style={{ background: 'var(--panel)', borderLeft: '1px solid var(--border)', padding: 12, overflow: 'auto', display: 'grid', alignContent: 'start', gap: 12 }}>
        <section style={{ display: 'grid', gap: 8 }}>
          <h3>Tempat & objek</h3>
          <label>Nama tempat<input value={draft.placeName} onChange={e => setDraft(d => ({ ...d, placeName: e.target.value }))} /></label>
          <div className="row">
            <button onClick={() => addItem('place')}>+ Area</button>
            <button onClick={() => addItem('prop')}>+ Properti</button>
            <label style={{ width: 'auto' }}><span className="muted small">+ Karakter 2D</span><input type="file" accept="image/*" onChange={e => uploadCharacter(e.target.files?.[0])} /></label>
          </div>
          <div style={{ display: 'grid', gap: 4 }}>
            {draft.items.map(item => <button key={item.id} onClick={() => setSelectedId(item.id)} style={{ textAlign: 'left', borderColor: item.id === selectedId ? 'var(--accent)' : 'var(--border)', background: item.id === selectedId ? '#263449' : 'var(--panel2)' }}>{item.kind === 'character' ? '◉ ' : item.kind === 'place' ? '▧ ' : '□ '}{item.name}</button>)}
          </div>
        </section>
        <section style={{ display: 'grid', gap: 8 }}>
          <h3>Properti objek</h3>
          <div className="muted small">{selectedLabel}</div>
          {selected ? <>
            <label>Nama<input value={selected.name} onChange={e => patchItem(selected.id, { name: e.target.value })} /></label>
            <label>Jenis<select value={selected.kind} onChange={e => patchItem(selected.id, { kind: e.target.value as Kind })}><option value="place">Bagian tempat</option><option value="prop">Properti</option><option value="character">Karakter</option></select></label>
            <label>Bentuk<select value={selected.shape} onChange={e => patchItem(selected.id, { shape: e.target.value as Shape })}><option value="box">Kotak</option><option value="sphere">Bola</option><option value="cylinder">Silinder</option><option value="plane">Bidang / karakter</option></select></label>
            <label>Warna<input type="color" value={selected.color} onChange={e => patchItem(selected.id, { color: e.target.value })} /></label>
            <div className="grid2">
              {(['x','y','z'] as const).map(axis => <label key={axis}>{axis.toUpperCase()}<input type="number" step=".1" value={selected[axis]} onChange={e => patchItem(selected.id, { [axis]: Number(e.target.value) })} /></label>)}
              {(['width','height','depth'] as const).map(axis => <label key={axis}>{axis === 'width' ? 'Lebar' : axis === 'height' ? 'Tinggi' : 'Kedalaman'}<input type="number" min=".02" step=".1" value={selected[axis]} onChange={e => patchItem(selected.id, { [axis]: clamp(Number(e.target.value), .02, 30) })} /></label>)}
            </div>
            <button className="danger" onClick={() => { setDraft(d => ({ ...d, items: d.items.filter(x => x.id !== selected.id) })); setSelectedId(null) }}>Hapus objek</button>
          </> : <p className="muted small">Pilih objek untuk mengubah properti.</p>}
        </section>
        <p className="muted small">Draft disimpan otomatis di browser. Export JSON dapat dipakai untuk memindahkan draft ke komputer lain.</p>
      </aside>
    </div>
  </div>
}

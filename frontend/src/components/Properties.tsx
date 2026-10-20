import { canvasRef } from '../canvas'
import { descendantIds, flatten, ikDriven, keyAt, worldPoint } from '../anim'
import { TRANSITIONS } from '../movie'
import { uid, useEditor } from '../store'
import type { TransitionType } from '../types'
import type { AnimProp, Layer } from '../types'

function Num({ label, value, onChange, step = 1, min, max, kf, disabled }: { label: string; value: number; onChange: (n: number) => void; step?: number; min?: number; max?: number; disabled?: boolean; kf?: { on: boolean; has: boolean; toggle: () => void } }) {
  return (
    <label className="field">
      <span>{label}{kf && <button type="button" className={`kfbtn ${kf.on ? 'on' : kf.has ? 'has' : ''}`} title="Tambah/hapus keyframe di frame ini" onClick={(e) => { e.preventDefault(); kf.toggle() }}>◆</button>}</span>
      <input
        type="number"
        value={Number.isFinite(value) ? Math.round(value * 1000) / 1000 : 0}
        step={step}
        disabled={disabled}
        min={min}
        max={max}
        onChange={(e) => {
          const n = e.target.valueAsNumber
          if (Number.isFinite(n)) onChange(min !== undefined ? Math.max(min, max !== undefined ? Math.min(max, n) : n) : n)
        }}
      />
    </label>
  )
}

export function Properties({ layer }: { layer: Layer | null }) {
  const { doc, updateLayer, setProps, toggleKey, frame, updateSettings, removeLayer, reparent, addLayer } = useEditor()
  const kfOf = (p: AnimProp) => layer ? ({ on: !!keyAt(layer, p, Math.round(frame)), has: !!layer.keyframes?.[p]?.length, toggle: () => toggleKey(layer.id, p) }) : undefined
  if (!doc) return null
  const st = doc.settings
  const driven = !!layer && ikDriven(doc).has(layer.id)
  const enableIK = () => {
    if (!layer?.parentId) return
    const tip = worldPoint(doc, layer.id, frame, layer.length ?? 100, 0)
    const tid = uid()
    useEditor.getState().edit((d) => {
      d.layers.push({ id: tid, type: 'bone', name: 'Target IK', x: tip.x, y: tip.y, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, visible: true, locked: false, parentId: null, length: 30, pivotX: 0, pivotY: 0 })
      d.layers.find((l) => l.id === layer.id)!.ik = { target: tid, bend: 1 }
    })
  }
  const parentLayer = layer?.parentId ? doc.layers.find((l) => l.id === layer.parentId) : undefined
  const ikTargets = layer && parentLayer ? doc.layers.filter((o) => o.id !== layer.id && o.id !== parentLayer.id && !descendantIds(doc, parentLayer.id).has(o.id)) : []
  const addChildBone = (pid: string) => {
    const p = doc.layers.find((l) => l.id === pid)!
    addLayer({ id: uid(), type: 'bone', name: 'Bone', x: p.length ?? 100, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, visible: true, locked: false, parentId: pid, length: 100, pivotX: 0, pivotY: 0 })
  }

  return (
    <>
      {layer ? (
        <section>
          <h3>Properti layer</h3>
          <label className="field">
            <span>Nama</span>
            <input value={layer.name} maxLength={120} onChange={(e) => updateLayer(layer.id, { name: e.target.value || 'Layer' }, 'name:' + layer.id)} />
          </label>
          <div className="grid2">
            <Num label="X" value={layer.x} kf={kfOf('x')} onChange={(x) => setProps(layer.id, { x }, 'x:' + layer.id)} />
            <Num label="Y" value={layer.y} kf={kfOf('y')} onChange={(y) => setProps(layer.id, { y }, 'y:' + layer.id)} />
            <Num label="Skala X" value={layer.scaleX} kf={kfOf('scaleX')} step={0.05} min={0.01} onChange={(scaleX) => setProps(layer.id, { scaleX }, 'sx:' + layer.id)} />
            <Num label="Skala Y" value={layer.scaleY} kf={kfOf('scaleY')} step={0.05} min={0.01} onChange={(scaleY) => setProps(layer.id, { scaleY }, 'sy:' + layer.id)} />
            <Num label="Rotasi °" disabled={driven} value={layer.rotation} kf={kfOf('rotation')} onChange={(rotation) => setProps(layer.id, { rotation }, 'r:' + layer.id)} />
            <Num label="Opacity" value={layer.opacity} kf={kfOf('opacity')} step={0.05} min={0} max={1} onChange={(opacity) => setProps(layer.id, { opacity }, 'o:' + layer.id)} />
          </div>
          <h3>Rig</h3>
          <label className="field">
            <span>Parent (FK)</span>
            <select
              value={layer.parentId ?? ''}
              onChange={(e) => {
                const pid = e.target.value || null
                const local = canvasRef.current?.localFor(layer.id, pid)
                if (!local) return
                const err = reparent(layer.id, pid, local)
                if (err) alert(err)
              }}
            >
              <option value="">— tanpa parent —</option>
              {flatten(doc).filter(({ layer: o }) => o.id !== layer.id && !descendantIds(doc, layer.id).has(o.id)).map(({ layer: o, depth }) => (
                <option key={o.id} value={o.id}>{'\u00a0\u00a0'.repeat(depth)}{o.type === 'bone' ? '🦴 ' : ''}{o.name}</option>
              ))}
            </select>
          </label>
          <div className="grid2">
            <Num label="Pivot X" value={layer.pivotX ?? 0} onChange={(pivotX) => updateLayer(layer.id, { pivotX }, 'px:' + layer.id)} />
            <Num label="Pivot Y" value={layer.pivotY ?? 0} onChange={(pivotY) => updateLayer(layer.id, { pivotY }, 'py:' + layer.id)} />
          </div>
          <p className="muted small">Seret titik oranye di kanvas untuk memindah pivot tanpa menggeser gambar. Atur pivot sebelum membuat keyframe.</p>
          {layer.type === 'bone' && (
            <>
              <Num label="Panjang bone" value={layer.length ?? 100} min={1} max={5000} onChange={(length) => updateLayer(layer.id, { length }, 'len:' + layer.id)} />
              <button onClick={() => addChildBone(layer.id)}>+ Bone anak di ujung</button>
              {parentLayer && !layer.ik && <button onClick={enableIK} title="Ujung bone ini mengejar target; bone induk ikut menekuk (2-bone IK)">Aktifkan IK 2-bone</button>}
              {layer.ik && (
                <div className="ikbox">
                  <strong className="small">IK 2-bone: {parentLayer?.name} → {layer.name}</strong>
                  <label className="field"><span>Target</span>
                    <select value={layer.ik.target} onChange={(e) => updateLayer(layer.id, { ik: { ...layer.ik!, target: e.target.value } })}>
                      {ikTargets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  </label>
                  <label className="field"><span>Arah tekukan</span>
                    <select value={layer.ik.bend} onChange={(e) => updateLayer(layer.id, { ik: { ...layer.ik!, bend: Number(e.target.value) as 1 | -1 } })}>
                      <option value={1}>Searah jarum jam</option><option value={-1}>Berlawanan</option>
                    </select>
                  </label>
                  <button onClick={() => updateLayer(layer.id, { ik: null })}>Matikan IK</button>
                  <p className="muted small">Gerakkan/keyframe layer target untuk menggerakkan rantai. Rotasi kedua bone dikendalikan IK. Gunakan skala seragam.</p>
                </div>
              )}
            </>
          )}
          {layer.type === 'image' && layer.assetId && (
            <>
              <button onClick={() => useEditor.getState().openImageEditor(layer.assetId!)}>Edit gambar…</button>
              <button onClick={() => useEditor.getState().openEnhance(layer.assetId!)}>Perbaiki (Enhancement)…</button>
              <button onClick={() => useEditor.getState().openRetouch(layer.id)} title="Hapus/lukis piksel dan perluas kanvas untuk memperbaiki bagian terpotong atau tersembunyi">🖌 Retouch…</button>
              <button onClick={() => useEditor.getState().openSegment(layer.id)} title="AI mengusulkan bagian tubuh, induk, dan sendi untuk rig">✨ AI pisahkan bagian…</button>
            </>
          )}
          {layer.type === 'text' && (
            <>
              <label className="field">
                <span>Teks</span>
                <textarea rows={3} value={layer.text ?? ''} onChange={(e) => updateLayer(layer.id, { text: e.target.value }, 'text:' + layer.id)} />
              </label>
              <div className="grid2">
                <Num label="Ukuran" value={layer.fontSize ?? 48} min={4} max={500} onChange={(fontSize) => updateLayer(layer.id, { fontSize }, 'fs:' + layer.id)} />
                <label className="field"><span>Warna</span><input type="color" value={layer.fill ?? '#111111'} onChange={(e) => updateLayer(layer.id, { fill: e.target.value }, 'fill:' + layer.id)} /></label>
              </div>
            </>
          )}
          {layer.type === 'shape' && (
            <div className="grid2">
              <Num label="Lebar" value={layer.width ?? 200} min={1} max={5000} onChange={(width) => updateLayer(layer.id, { width }, 'w:' + layer.id)} />
              <Num label="Tinggi" value={layer.height ?? 200} min={1} max={5000} onChange={(height) => updateLayer(layer.id, { height }, 'h:' + layer.id)} />
              <label className="field"><span>Warna</span><input type="color" value={layer.fill ?? '#4f8cff'} onChange={(e) => updateLayer(layer.id, { fill: e.target.value }, 'fill:' + layer.id)} /></label>
            </div>
          )}
          <button className="danger" onClick={() => removeLayer(layer.id)}>Hapus layer</button>
        </section>
      ) : (
        <section>
          <h3>Scene</h3>
          <SceneMeta />
          <div className="grid2">
            <Num label="Lebar" value={st.width} min={64} max={3840} onChange={(width) => updateSettings({ width })} />
            <Num label="Tinggi" value={st.height} min={64} max={2160} onChange={(height) => updateSettings({ height })} />
            <Num label="FPS" value={st.fps} min={1} max={60} onChange={(fps) => updateSettings({ fps: Math.round(fps) })} />
            <Num label="Durasi (s)" value={st.duration} step={0.5} min={0.5} max={600} onChange={(duration) => updateSettings({ duration })} />
            <label className="field"><span>Background</span><input type="color" value={st.background} onChange={(e) => updateSettings({ background: e.target.value })} /></label>
          </div>
          <p className="muted small">Pilih layer di kanvas atau daftar untuk mengedit propertinya.</p>
        </section>
      )}
    </>
  )
}

/** Name and outgoing transition of the active scene (they live on the project, not in the editable scene view). */
function SceneMeta() {
  const project = useEditor((s) => s.project)
  const activeId = useEditor((s) => s.activeSceneId)
  const updateScene = useEditor((s) => s.updateScene)
  if (!project || !activeId) return null
  const i = project.scenes.findIndex((x) => x.id === activeId)
  const sc = project.scenes[i]
  const last = i === project.scenes.length - 1
  const tr = sc.transition ?? { type: 'none' as TransitionType, duration: 1 }
  return (
    <>
      <label className="field"><span>Nama scene</span>
        <input value={sc.name} maxLength={80} onChange={(e) => updateScene(sc.id, { name: e.target.value || 'Scene' })} />
      </label>
      <label className="field"><span>Transisi ke scene berikutnya</span>
        <select disabled={last} value={last ? 'none' : tr.type} onChange={(e) => updateScene(sc.id, { transition: e.target.value === 'none' ? null : { type: e.target.value as TransitionType, duration: tr.duration } })}>
          {TRANSITIONS.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
        </select>
      </label>
      {!last && tr.type !== 'none' && (
        <label className="field"><span>Durasi transisi: {tr.duration}s</span>
          <input type="range" min={0.2} max={3} step={0.1} value={tr.duration} onChange={(e) => updateScene(sc.id, { transition: { type: tr.type, duration: +e.target.value } })} />
        </label>
      )}
      {last && <p className="muted small">Scene terakhir tidak punya transisi keluar.</p>}
      {!last && tr.type !== 'none' && <p className="muted small">Transisi bergaya "dip": scene ini keluar di separuh pertama dan scene berikutnya masuk di separuh kedua (bukan crossfade tumpang-tindih). Terlihat di "Putar film" dan export.</p>}
    </>
  )
}

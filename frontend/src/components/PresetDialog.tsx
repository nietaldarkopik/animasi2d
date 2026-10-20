import { useState } from 'react'
import { PRESETS, applyPreset, evalAll, totalFrames } from '../anim'
import { useEditor } from '../store'
import type { PresetParams } from '../anim'

export function PresetDialog({ onClose }: { onClose: () => void }) {
  const s = useEditor()
  const doc = s.doc!
  const layer = doc.layers.find((l) => l.id === s.selectedId)
  const [id, setId] = useState(PRESETS[0].id)
  const preset = PRESETS.find((p) => p.id === id)!
  const [params, setParams] = useState<PresetParams>(preset.defaults)
  const start = Math.round(s.frame)
  const frames = Math.round(params.duration * doc.settings.fps)
  const over = start + frames > totalFrames(doc)

  const pick = (nid: string) => {
    setId(nid)
    setParams(PRESETS.find((p) => p.id === nid)!.defaults)
  }
  const set = (k: keyof PresetParams) => (e: React.ChangeEvent<HTMLInputElement>) => setParams({ ...params, [k]: e.target.valueAsNumber })
  const valid = Object.values(params).every(Number.isFinite) && params.duration >= 0.1 && params.duration <= 120 && params.cycles >= 1 && params.cycles <= 100

  function apply() {
    if (!layer || !valid) return
    s.edit((d) => {
      const target = d.layers.find((l) => l.id === layer.id)!
      const at = evalAll(d, start).get(layer.id)!
      applyPreset(target, id, params, start, d.settings.fps, at)
      // grow the scene if the motion runs past the end
      const need = (start + Math.round(params.duration * d.settings.fps)) / d.settings.fps
      if (need > d.settings.duration) d.settings.duration = Math.ceil(need * 2) / 2
    })
    onClose()
  }

  return (
    <div className="modal" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="card dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Preset gerak</h2>
        {!layer ? (
          <p className="muted">Pilih layer (atau bone) yang akan digerakkan terlebih dulu.</p>
        ) : (
          <>
            <p className="small">Diterapkan ke <strong>{layer.name}</strong>, mulai frame <strong>{start}</strong>. Hasilnya adalah keyframe biasa yang bisa diedit di timeline.</p>
            <label className="field">
              <span>Preset</span>
              <select value={id} onChange={(e) => pick(e.target.value)}>
                {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </label>
            <p className="muted small">{preset.hint}</p>
            <div className="grid2">
              <label className="field"><span>Durasi (detik)</span><input type="number" step="0.5" value={params.duration} onChange={set('duration')} /></label>
              {preset.amountLabel !== '?' && <label className="field"><span>{preset.amountLabel}</span><input type="number" value={params.amount} onChange={set('amount')} /></label>}
              <label className="field"><span>Siklus / langkah</span><input type="number" min={1} value={params.cycles} onChange={set('cycles')} /></label>
              {preset.id === 'swing' && <label className="field"><span>Fase (?)</span><input type="number" step={45} value={params.phase} onChange={set('phase')} /></label>}
            </div>
            {over && <p className="small" style={{ color: 'var(--warn)' }}>Gerakan melewati akhir scene; durasi scene akan diperpanjang.</p>}
            <p className="muted small">Menimpa keyframe {preset.props.join(', ')} di rentang frame {start}?{start + frames}.</p>
          </>
        )}
        <div className="row end">
          <button onClick={onClose}>Batal</button>
          <button className="primary" disabled={!layer || !valid} onClick={apply}>Terapkan</button>
        </div>
      </div>
    </div>
  )
}

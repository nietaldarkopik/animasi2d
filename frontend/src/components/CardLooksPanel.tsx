import { useState } from 'react'
import { applyCardLook, applyCardTurn, cardCapabilities, cardParts, clearCardLook, type CardLook, type Gaze, type View } from '../builder/cardMotion'
import type { RigRef } from '../builder/rigMotion'
import { useEditor } from '../store'

const SIT_LABEL: Record<string, string> = { duduk_tegak: 'Tegak', duduk_condong: 'Condong', duduk_sila: 'Sila', duduk_tangan_lutut: 'Tangan di lutut' }
const VIEW_LABEL: Record<Exclude<View, 'depan'>, string> = { '34': '¾', sisi: 'Samping' }
const NOTE = { margin: '4px 0 0' } as const

/** Looks of a 2.5D card character: pose, facing, head turn, glance, sitting. Everything is baked at the playhead frame. */
export function CardLooksPanel({ rig, frame }: { rig: RigRef; frame: number }) {
  const s = useEditor()
  const doc = s.doc!
  const [lift, setLift] = useState(0)
  const [hold, setHold] = useState(1)
  const [back, setBack] = useState(true)
  const [msg, setMsg] = useState('')
  const parts = cardParts(doc, rig)
  if (!parts) return null
  const cap = cardCapabilities(parts)
  const allBody = Object.keys(parts.body.expr ?? {}).filter((k) => k !== 'default')
  const known = new Set([...cap.basePoses, ...cap.sit, 'diam_34', 'diam_sisi', 'diam_belakang'])
  const others = allBody.filter((k) => !known.has(k) && !/_(34|sisi|belakang)$/.test(k))
  const hasExtras = cap.views.length > 0 || cap.gaze || cap.sit.length > 0 || cap.run

  const look = (l: CardLook) => {
    let notes = ''
    s.edit((d) => { notes = applyCardLook(d, rig, l, frame)?.notes.join('; ') ?? '' })
    setMsg(notes)
  }
  const turn = (dir: 1 | -1) => {
    let end: number | null = null
    s.edit((d) => { end = applyCardTurn(d, rig, dir, frame, { hold, back }) })
    setMsg(end === null ? 'Karakter ini belum punya kepala tampak ¾/samping, atau desainnya asimetris (tidak bisa dicerminkan).' : `Menengok dipasang sampai frame ${end}.`)
  }
  const btn = (key: string, label: string, onClick: () => void, title: string, disabled = false) => (
    <button key={key} onClick={onClick} disabled={disabled} title={title}>{label}</button>
  )

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div>
        <h4 className="small" style={{ margin: '0 0 4px' }}>Pose badan (mulai frame {frame})</h4>
        <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
          {[...cap.basePoses, ...others].map((p) => btn(p, p, () => look({ pose: p }), `Ganti gambar badan ke "${p}" dan pasang kepala di tempatnya`))}
        </div>
      </div>

      {cap.views.length > 0 && (
        <div>
          <h4 className="small" style={{ margin: '0 0 4px' }}>Hadap</h4>
          <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
            {btn('depan', 'Depan', () => look({ pose: 'diam', view: 'depan', facing: 1 }), 'Berdiri menghadap kamera')}
            {cap.views.map((v) => btn(`${v}r`, `${VIEW_LABEL[v]} kanan →`, () => look({ pose: 'diam', view: v, facing: 1 }), 'Menghadap ke kanan layar'))}
            {cap.views.map((v) => btn(`${v}l`, `← ${VIEW_LABEL[v]} kiri`, () => look({ pose: 'diam', view: v, facing: -1 }), 'Menghadap ke kiri layar (gambar dicerminkan)', !cap.mirror))}
          </div>
          {!cap.mirror && <p className="muted small" style={NOTE}>Desain karakter ini asimetris: tidak bisa dicerminkan ke kiri.</p>}
        </div>
      )}

      {cap.headViews.length > 0 && (
        <div>
          <h4 className="small" style={{ margin: '0 0 4px' }}>Tengok (kepala saja)</h4>
          <div className="row" style={{ gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
            {btn('tl', '← Kiri', () => turn(-1), 'Kepala menengok ke kiri layar', !cap.mirror)}
            {btn('tr', 'Kanan →', () => turn(1), 'Kepala menengok ke kanan layar')}
            <label className="field" style={{ margin: 0 }}><span>Tahan (detik)</span><input type="number" min={0.2} max={10} step={0.2} value={hold} onChange={(e) => Number.isFinite(e.target.valueAsNumber) && setHold(Math.max(0.2, Math.min(10, e.target.valueAsNumber)))} /></label>
            <label className="small"><input type="checkbox" checked={back} onChange={(e) => setBack(e.target.checked)} /> kembali ke depan</label>
          </div>
        </div>
      )}

      {cap.gaze && (
        <div>
          <h4 className="small" style={{ margin: '0 0 4px' }}>Lirik (mata saja)</h4>
          <div className="row" style={{ gap: 4 }}>
            {(['kiri', 'kanan'] as Gaze[]).map((g) => btn(g, g === 'kiri' ? '← Kiri' : 'Kanan →', () => look({ gaze: g }), `Mata melirik ke ${g} layar`))}
            {btn('tengah', 'Tengah', () => look({ gaze: null }), 'Mata kembali ke depan')}
          </div>
        </div>
      )}

      {cap.sit.length > 0 && (
        <div>
          <h4 className="small" style={{ margin: '0 0 4px' }}>Duduk</h4>
          <div className="row" style={{ gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
            {cap.sit.map((p) => btn(p, SIT_LABEL[p] ?? p, () => look({ pose: p, lift }), `Duduk (${SIT_LABEL[p] ?? p}) mulai frame ${frame}`))}
            {btn('berdiri', 'Berdiri', () => look({ pose: 'diam', lift: 0 }), 'Berdiri lagi dan turunkan kembali')}
            <label className="field" style={{ margin: 0 }}><span>Naikkan (px)</span><input type="number" min={0} max={600} step={5} value={lift} onChange={(e) => Number.isFinite(e.target.valueAsNumber) && setLift(Math.max(0, Math.min(600, e.target.valueAsNumber)))} /></label>
          </div>
          <p className="muted small" style={NOTE}>Gambar duduk tidak menggambar kursi: sisipkan properti kursi dan naikkan karakter agar duduk di atasnya.</p>
        </div>
      )}

      <div>
        <button onClick={() => { s.edit((d) => clearCardLook(d, rig, frame)); setMsg('') }} title="Menghapus pergantian gambar dan kunci posisi yang dipasang tombol di atas pada frame ini">Hapus pengaturan di frame ini</button>
        {!hasExtras && <p className="muted small" style={NOTE}>Karakter ini hanya punya pose depan. Tambahkan paket dialog/duduk/aksi dengan <em>card_builder</em> (docs/CARD_SPEC_V2.md), lalu sisipkan karakter lagi.</p>}
        {cap.views.length > 0 && <p className="muted small" style={NOTE}>Pada tampak ¾/samping, mulut dan kelopak depan disembunyikan (belum ada lip-sync untuk arah itu).</p>}
        {msg && <p className="small" role="status" style={NOTE}>{msg}</p>}
      </div>
    </div>
  )
}

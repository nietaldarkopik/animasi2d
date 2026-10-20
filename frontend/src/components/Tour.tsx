import { useEffect, useLayoutEffect, useState } from 'react'

export const TOUR_KEY = 'cm_tour_done'
export const tourDone = () => { try { return localStorage.getItem(TOUR_KEY) === '1' } catch { return true } }
const markDone = () => { try { localStorage.setItem(TOUR_KEY, '1') } catch { /* private mode */ } }

const STEPS = [
  { sel: '.toolbar', title: 'Toolbar', body: 'Import gambar, tambah teks/kotak/bone, undo/redo, ✨ AI Gerak, simpan versi, dan Export. Project tersimpan otomatis.' },
  { sel: '.left', title: 'Aset, audio, dan layer', body: 'Gambar yang Anda import muncul di sini (klik untuk menambahkan, ✎ untuk edit). Daftar layer menampilkan hierarki rig; bagian bawahnya audio.' },
  { sel: '.stage', title: 'Kanvas', body: 'Klik objek untuk memilih, seret untuk memindah, tarik kotak kanan-bawah untuk skala, bulatan atas untuk memutar. Titik oranye adalah pivot/sendi.' },
  { sel: '.right', title: 'Properti & rig', body: 'Atur posisi, skala, rotasi, opacity. Di bagian Rig: pilih parent (FK), pivot, dan IK 2-bone. Tanpa pilihan: pengaturan scene & transisi.' },
  { sel: '.scenebar', title: 'Scene & film', body: 'Satu film bisa berisi banyak scene dengan transisi dan audio. "Putar film" memutar semuanya dari awal.' },
  { sel: '.tl', title: 'Timeline', body: 'Aktifkan Auto-key lalu ubah properti di frame berbeda untuk membuat keyframe. Ada easing, onion skin, dan "Preset gerak…" siap pakai.' },
  { sel: '.toolbar', title: 'Coba AI', body: '✨ AI Gerak menerjemahkan perintah teks menjadi keyframe pada rig Anda. Pada gambar karakter, "AI pisahkan bagian…" mengusulkan bagian tubuh. Hasilnya selalu bisa dikoreksi dan di-undo.' },
]

export function Tour({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const step = STEPS[i]

  const finish = () => { markDone(); onClose() }

  useLayoutEffect(() => {
    const measure = () => {
      const el = document.querySelector<HTMLElement>(step.sel)
      el?.scrollIntoView({ block: 'nearest' })
      setRect(el ? el.getBoundingClientRect() : null)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [step.sel, i])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish()
      else if (e.key === 'ArrowRight') setI((n) => Math.min(STEPS.length - 1, n + 1))
      else if (e.key === 'ArrowLeft') setI((n) => Math.max(0, n - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const W = Math.min(340, window.innerWidth - 24)
  const below = rect ? rect.bottom + 12 + 190 < window.innerHeight : true
  const top = rect ? (below ? Math.min(rect.bottom + 12, window.innerHeight - 200) : Math.max(12, rect.top - 190)) : 80
  const left = rect ? Math.max(12, Math.min(rect.left + 12, window.innerWidth - W - 12)) : 12

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label={`Tur: ${step.title}`}>
      {rect && <div className="tour-hole" style={{ left: rect.left - 4, top: rect.top - 4, width: rect.width + 8, height: rect.height + 8 }} />}
      <div className="tour-card card" style={{ left, top, width: W }}>
        <small className="muted">Langkah {i + 1} dari {STEPS.length}</small>
        <h3 style={{ margin: '2px 0 6px', textTransform: 'none', letterSpacing: 0, fontSize: 15, color: 'var(--text)' }}>{step.title}</h3>
        <p className="small" style={{ margin: '0 0 10px' }}>{step.body}</p>
        <div className="row between">
          <button className="link" onClick={finish}>Lewati</button>
          <span className="row">
            <button disabled={i === 0} onClick={() => setI(i - 1)}>Kembali</button>
            {i < STEPS.length - 1 ? <button className="primary" autoFocus onClick={() => setI(i + 1)}>Berikutnya</button> : <button className="primary" autoFocus onClick={finish}>Selesai</button>}
          </span>
        </div>
      </div>
    </div>
  )
}
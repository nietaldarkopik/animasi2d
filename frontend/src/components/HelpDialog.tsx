const KEYS: [string, string][] = [
  ['Ctrl+Z / Ctrl+Y', 'Undo / redo (per scene)'],
  ['Ctrl+S', 'Simpan versi'],
  ['Spasi', 'Play / pause'],
  ['Delete', 'Hapus layer (atau keyframe terpilih)'],
  ['Panah / Shift+Panah', 'Geser layer 1 / 10 piksel'],
  ['Esc', 'Tutup dialog'],
  ['← → (saat tur)', 'Langkah sebelumnya / berikutnya'],
]

export function HelpDialog({ onClose, onTour }: { onClose: () => void; onTour: () => void }) {
  return (
    <div className="modal" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Bantuan" className="card dialog wide" onClick={(e) => e.stopPropagation()}>
        <h2>Bantuan</h2>
        <div className="row"><button className="primary" onClick={onTour}>Mulai tur singkat</button></div>
        <div className="imgedit">
          <div style={{ flex: '1 1 320px' }}>
            <h3>Pintasan keyboard</h3>
            <table className="small"><tbody>{KEYS.map(([k, d]) => <tr key={k}><td><kbd>{k}</kbd></td><td className="muted">&nbsp;{d}</td></tr>)}</tbody></table>
            <h3 style={{ marginTop: 14 }}>Alur kerja yang disarankan</h3>
            <ol className="small">
              <li>Import gambar karakter (foto sketsa pun bisa: <em>Edit gambar → Sketsa kertas → garis transparan</em>).</li>
              <li>Pisahkan bagian tubuh: <em>✨ AI pisahkan bagian…</em>, koreksi kotaknya, lalu <em>🖌 Retouch</em> bila ada piksel tetangga yang ikut.</li>
              <li>Buat keyframe (Auto-key), pakai <em>Preset gerak</em>, atau <em>✨ AI Gerak</em>.</li>
              <li>Susun scene, transisi, dan audio, lalu <em>Putar film</em> dan <em>Export</em>.</li>
            </ol>
          </div>
          <div style={{ flex: '1 1 280px' }}>
            <h3>Belum tersedia (jujur)</h3>
            <ul className="small">
              <li><strong>Image-to-Video</strong>, <strong>Lip Sync</strong> ke audio, dan <strong>Video-to-Motion</strong> — tidak ada model untuk itu di gateway AI saat ini.</li>
              <li>Transisi bergaya <em>dip</em> (keluar lalu masuk), bukan crossfade tumpang-tindih.</li>
              <li>Audio di preview hanya terdengar pada "Putar film"; pada export dicampur server.</li>
              <li>Hasil AI bersifat usulan; selalu tinjau dan koreksi.</li>
            </ul>
            <h3>Tips</h3>
            <ul className="small">
              <li>Project tersimpan otomatis; "Simpan versi" membuat titik kembali di <em>Riwayat</em>.</li>
              <li>Bone hanya terlihat di editor dan tidak ikut export.</li>
              <li>Atur pivot sebelum membuat keyframe.</li>
            </ul>
          </div>
        </div>
        <div className="row end"><button onClick={onClose}>Tutup</button></div>
      </div>
    </div>
  )
}
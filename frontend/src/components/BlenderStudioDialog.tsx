import { useEffect, useState } from 'react'
import { api } from '../api'

interface CharacterInfo {
  id: string
  name: string
  style: string
  poses: string[]
  expressions: string[]
  has_blink: boolean
  has_mouth: boolean
}

interface ScriptInfo {
  file: string
  title: string
  theme: string
  scenes_count: number
  content: any
}

interface OutputItem {
  filename: string
  type: 'image' | 'video' | 'blend' | 'file'
  size: number
  created_at: string
  url: string
}

interface ClipwizeStatusInfo {
  status: 'connected' | 'token_ready' | 'not_configured' | 'error'
  api_base?: string
  user?: string
  message?: string
}

export function BlenderStudioDialog({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'generate' | 'characters' | 'gallery'>('generate')
  const [mcpStatus, setMcpStatus] = useState<{ mcp_online: boolean; cli_available: boolean; blender_version: string } | null>(null)
  const [clipwizeStatus, setClipwizeStatus] = useState<ClipwizeStatusInfo | null>(null)
  const [characters, setCharacters] = useState<CharacterInfo[]>([])
  const [scripts, setScripts] = useState<ScriptInfo[]>([])
  const [outputs, setOutputs] = useState<OutputItem[]>([])

  // Form state
  const [mode, setMode] = useState<'prompt' | 'script'>('prompt')
  const [prompt, setPrompt] = useState('Arum: Hah?! Benarkah nilaiku lulus? | Uki: Benar, selamat ya! (Uki tersenyum dan melambai)')
  const [selectedScript, setSelectedScript] = useState('')
  const [renderVideo, setRenderVideo] = useState(false)

  // Execution state
  const [busy, setBusy] = useState(false)
  const [progressMsg, setProgressMsg] = useState('')
  const [error, setError] = useState('')
  const [lastResult, setLastResult] = useState<{
    status: string
    outputs: { blend?: string; preview?: string; video?: string }
    stdout?: string
    stderr?: string
  } | null>(null)

  const loadAll = async () => {
    try {
      const [st, ch, sc, out] = await Promise.all([
        api.blenderStatus(),
        api.blenderCharacters(),
        api.blenderScripts(),
        api.blenderOutputs(),
      ])
      setMcpStatus(st)
      setCharacters(ch.characters)
      setScripts(sc.scripts)
      if (sc.scripts.length > 0 && !selectedScript) {
        setSelectedScript(sc.scripts[0].file)
      }
      setOutputs(out.outputs)
    } catch (e: any) {
      setError(e.message || 'Gagal memuat status Blender.')
    }
    // Load ClipWize TTS status separately (non-critical)
    try {
      const cwStatus = await api.clipwizeStatus()
      setClipwizeStatus(cwStatus as ClipwizeStatusInfo)
    } catch {
      setClipwizeStatus({ status: 'error', message: 'Tidak dapat memeriksa status ClipWize TTS' })
    }
  }

  useEffect(() => {
    loadAll()
  }, [])

  const handleAnimate = async () => {
    setError('')
    setBusy(true)
    setProgressMsg('Mengirim instruksi ke Blender & menyiapkan karakter 2.5D...')
    setLastResult(null)

    try {
      const res = await api.blenderAnimate({
        mode,
        prompt: mode === 'prompt' ? prompt : undefined,
        script_file: mode === 'script' ? selectedScript : undefined,
        render_video: renderVideo,
      })

      setLastResult(res)
      // Refresh output list
      const out = await api.blenderOutputs()
      setOutputs(out.outputs)
    } catch (e: any) {
      setError(e.message || 'Gagal mengeksekusi animasi di Blender.')
    } finally {
      setBusy(false)
      setProgressMsg('')
    }
  }

  const promptPresets = [
    {
      title: 'Dialog 2 Karakter (Uki & Arum)',
      text: 'Arum: Hah?! Benarkah nilaiku lulus? | Uki: Benar, selamat ya! (Uki tersenyum dan melambai)',
    },
    {
      title: 'Uki Kaget & Menunjuk',
      text: 'Uki: Hah?! Ada apa di depan sana? (Uki kaget lalu menunjuk)',
    },
    {
      title: 'Arum Berpikir Matematika',
      text: 'Arum: Tunggu sebentar, polanya sudah mulai kelihatan. (Arum berpikir dan tersenyum)',
    },
    {
      title: 'Seni Ceria Melambai',
      text: 'Seni: Halo semuanya! Ayo kita mulai eksperimen hari ini! (Seni melambai dan berkacak pinggang)',
    },
  ]

  return (
    <div className="modal-backdrop" onClick={onClose} style={{ zIndex: 1100 }}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '95%',
          maxWidth: 960,
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          padding: 0,
          overflow: 'hidden',
          background: 'var(--bg, #1e1e2e)',
          borderRadius: 12,
          boxShadow: '0 20px 40px rgba(0,0,0,0.4)',
        }}
      >
        {/* Top Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--border, #333)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--panel, #252538)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 24 }}>🎬</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16 }}>Studio Karakter 2.5D Blender & MCP</div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>
                Gerakkan karakter anime Uki, Arum, Seni, Riska berbasis naskah/prompt via Blender 5.2
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* Status indicator */}
            {mcpStatus && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 10px',
                  borderRadius: 20,
                  fontSize: 12,
                  fontWeight: 600,
                  background: mcpStatus.mcp_online ? 'rgba(34, 197, 94, 0.15)' : 'rgba(234, 179, 8, 0.15)',
                  color: mcpStatus.mcp_online ? '#22c55e' : '#eab308',
                  border: `1px solid ${mcpStatus.mcp_online ? 'rgba(34, 197, 94, 0.4)' : 'rgba(234, 179, 8, 0.4)'}`,
                }}
                title={mcpStatus.mcp_online ? 'Blender MCP Socket aktif di port 9876' : 'Blender MCP belum aktif, otomatis menggunakan Blender CLI Background'}
              >
                <span style={{ fontSize: 10 }}>●</span>
                {mcpStatus.mcp_online ? 'Blender MCP Online (:9876)' : 'Blender Headless CLI Ready'}
              </div>
            )}
            {/* ClipWize TTS status badge */}
            {clipwizeStatus && (() => {
              const isOk = clipwizeStatus.status === 'connected' || clipwizeStatus.status === 'token_ready'
              const isWarn = clipwizeStatus.status === 'not_configured'
              const color = isOk ? '#22c55e' : isWarn ? '#eab308' : '#ef4444'
              const bg = isOk ? 'rgba(34,197,94,0.12)' : isWarn ? 'rgba(234,179,8,0.12)' : 'rgba(239,68,68,0.12)'
              const border = isOk ? 'rgba(34,197,94,0.4)' : isWarn ? 'rgba(234,179,8,0.4)' : 'rgba(239,68,68,0.4)'
              const label = isOk
                ? `🎙 TTS ClipWize${clipwizeStatus.user ? ' (' + clipwizeStatus.user + ')' : ''}`
                : isWarn
                  ? '🎙 TTS edge-tts (fallback)'
                  : '🎙 TTS error'
              const tip = clipwizeStatus.api_base
                ? `ClipWize API: ${clipwizeStatus.api_base} | Status: ${clipwizeStatus.status}`
                : clipwizeStatus.message || clipwizeStatus.status
              return (
                <div
                  style={{ display:'flex', alignItems:'center', gap:6, padding:'4px 10px', borderRadius:20, fontSize:12, fontWeight:600, background:bg, color, border:`1px solid ${border}` }}
                  title={tip}
                >
                  <span style={{ fontSize:10 }}>●</span>
                  {label}
                </div>
              )
            })()}
            <button
              onClick={onClose}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'inherit',
                fontSize: 18,
                cursor: 'pointer',
                padding: '4px 8px',
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div
          style={{
            display: 'flex',
            gap: 8,
            padding: '10px 20px',
            borderBottom: '1px solid var(--border, #333)',
            background: 'var(--panel2, #1b1b2a)',
          }}
        >
          <button
            onClick={() => setTab('generate')}
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              border: 'none',
              cursor: 'pointer',
              fontWeight: 600,
              background: tab === 'generate' ? 'var(--accent, #6366f1)' : 'transparent',
              color: tab === 'generate' ? '#fff' : 'inherit',
            }}
          >
            ✨ Gerakkan & Render Animasi
          </button>
          <button
            onClick={() => setTab('characters')}
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              border: 'none',
              cursor: 'pointer',
              fontWeight: 600,
              background: tab === 'characters' ? 'var(--accent, #6366f1)' : 'transparent',
              color: tab === 'characters' ? '#fff' : 'inherit',
            }}
          >
            👥 Karakter 2.5D ({characters.length})
          </button>
          <button
            onClick={() => setTab('gallery')}
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              border: 'none',
              cursor: 'pointer',
              fontWeight: 600,
              background: tab === 'gallery' ? 'var(--accent, #6366f1)' : 'transparent',
              color: tab === 'gallery' ? '#fff' : 'inherit',
            }}
          >
            📁 Galeri Hasil Output ({outputs.length})
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          {error && (
            <div
              style={{
                padding: '10px 14px',
                borderRadius: 8,
                background: 'rgba(239, 68, 68, 0.15)',
                color: '#ef4444',
                marginBottom: 16,
                fontSize: 13,
              }}
            >
              {error}
            </div>
          )}

          {/* TAB 1: GENERATE ANIMASI */}
          {tab === 'generate' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              {/* Mode switch */}
              <div style={{ display: 'flex', gap: 16 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontWeight: 600 }}>
                  <input
                    type="radio"
                    name="mode"
                    value="prompt"
                    checked={mode === 'prompt'}
                    onChange={() => setMode('prompt')}
                  />
                  Teks Prompt / Dialog
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontWeight: 600 }}>
                  <input
                    type="radio"
                    name="mode"
                    value="script"
                    checked={mode === 'script'}
                    onChange={() => setMode('script')}
                  />
                  File Naskah Cerita (JSON)
                </label>
              </div>

              {/* Mode Prompt */}
              {mode === 'prompt' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <label style={{ fontSize: 13, fontWeight: 600 }}>
                    Tuliskan dialog atau aksi adegan (karakter akan otomatis menyesuaikan emosi wajah, gerakan pose tubuh, dan lip-sync mulut):
                  </label>
                  <textarea
                    rows={3}
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Contoh: Arum: Hah?! | Uki: Tenang! (Uki tersenyum dan melambai)"
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      borderRadius: 8,
                      border: '1px solid var(--border, #444)',
                      background: 'var(--panel2, #181825)',
                      color: 'inherit',
                      fontSize: 14,
                      resize: 'vertical',
                    }}
                  />

                  {/* Preset prompt pills */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                    <span style={{ fontSize: 12, opacity: 0.7 }}>Contoh cepat:</span>
                    {promptPresets.map((p, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setPrompt(p.text)}
                        style={{
                          fontSize: 11,
                          padding: '4px 8px',
                          borderRadius: 6,
                          border: '1px solid var(--border, #444)',
                          background: 'rgba(255,255,255,0.05)',
                          color: 'inherit',
                          cursor: 'pointer',
                        }}
                      >
                        {p.title}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Mode Script JSON */}
              {mode === 'script' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <label style={{ fontSize: 13, fontWeight: 600 }}>Pilih Naskah dari Folder naskah/:</label>
                  <select
                    value={selectedScript}
                    onChange={(e) => setSelectedScript(e.target.value)}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 8,
                      border: '1px solid var(--border, #444)',
                      background: 'var(--panel2, #181825)',
                      color: 'inherit',
                      fontSize: 14,
                    }}
                  >
                    {scripts.map((s) => (
                      <option key={s.file} value={s.file}>
                        {s.title} ({s.file} - {s.scenes_count} Adegan, Tema: {s.theme})
                      </option>
                    ))}
                  </select>

                  {/* Script preview */}
                  {scripts.find((s) => s.file === selectedScript) && (
                    <div
                      style={{
                        padding: 12,
                        borderRadius: 8,
                        background: 'rgba(0,0,0,0.2)',
                        border: '1px solid var(--border, #333)',
                        fontSize: 12,
                        maxHeight: 120,
                        overflowY: 'auto',
                      }}
                    >
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>
                        Pratinjau Adegan 1: {scripts.find((s) => s.file === selectedScript)?.content?.scenes?.[0]?.name}
                      </div>
                      <div style={{ opacity: 0.8 }}>
                        {scripts
                          .find((s) => s.file === selectedScript)
                          ?.content?.scenes?.[0]?.dialog?.slice(0, 3)
                          ?.map((d: any, idx: number) => (
                            <div key={idx}>
                              <strong>{d.who}:</strong> {d.text}
                            </div>
                          ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Render options */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 20,
                  padding: '12px 14px',
                  borderRadius: 8,
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid var(--border, #333)',
                }}
              >
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={renderVideo}
                    onChange={(e) => setRenderVideo(e.target.checked)}
                  />
                  <span>Render Video Penuh (MP4) <span style={{ opacity: 0.6 }}>(jika tidak dicentang, render cepat still JPEG)</span></span>
                </label>
              </div>

              {/* Action Button */}
              <div>
                <button
                  type="button"
                  onClick={handleAnimate}
                  disabled={busy}
                  style={{
                    padding: '12px 24px',
                    borderRadius: 8,
                    border: 'none',
                    fontWeight: 700,
                    fontSize: 14,
                    cursor: busy ? 'not-allowed' : 'pointer',
                    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    boxShadow: '0 4px 14px rgba(99, 102, 241, 0.4)',
                  }}
                >
                  {busy ? '⏳ Sedang Memproses di Blender...' : '🎬 Gerakkan & Render di Blender'}
                </button>
              </div>

              {/* Progress message */}
              {busy && (
                <div
                  style={{
                    padding: '12px 16px',
                    borderRadius: 8,
                    background: 'rgba(99, 102, 241, 0.1)',
                    color: '#818cf8',
                    border: '1px solid rgba(99, 102, 241, 0.3)',
                    fontSize: 13,
                  }}
                >
                  {progressMsg}
                </div>
              )}

              {/* Result Preview Box */}
              {lastResult && (
                <div
                  style={{
                    padding: 16,
                    borderRadius: 10,
                    background: 'rgba(34, 197, 94, 0.08)',
                    border: '1px solid rgba(34, 197, 94, 0.3)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ fontWeight: 700, color: '#22c55e' }}>✓ Animasi Blender Berhasil Dibuat!</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {lastResult.outputs.blend && (
                        <a
                          href={`/api/blender/file/${lastResult.outputs.blend}`}
                          download
                          style={{
                            padding: '6px 12px',
                            borderRadius: 6,
                            background: '#ea580c',
                            color: '#fff',
                            textDecoration: 'none',
                            fontSize: 12,
                            fontWeight: 600,
                          }}
                        >
                          📦 Download .blend
                        </a>
                      )}
                    </div>
                  </div>

                  {/* Still preview */}
                  {lastResult.outputs.preview && (
                    <div style={{ textAlign: 'center', background: '#000', borderRadius: 8, padding: 8 }}>
                      <img
                        src={`/api/blender/file/${lastResult.outputs.preview}`}
                        alt="Preview Render Blender"
                        style={{ maxWidth: '100%', maxHeight: 380, borderRadius: 6, objectFit: 'contain' }}
                      />
                    </div>
                  )}

                  {/* Video preview */}
                  {lastResult.outputs.video && (
                    <div style={{ textAlign: 'center', background: '#000', borderRadius: 8, padding: 8 }}>
                      <video
                        src={`/api/blender/file/${lastResult.outputs.video}`}
                        controls
                        style={{ maxWidth: '100%', maxHeight: 380, borderRadius: 6 }}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: DAFTAR KARAKTER 2.5D */}
          {tab === 'characters' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
              {characters.map((c) => (
                <div
                  key={c.id}
                  style={{
                    padding: 14,
                    borderRadius: 10,
                    background: 'var(--panel2, #181825)',
                    border: '1px solid var(--border, #333)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  <div style={{ textAlign: 'center', background: '#111', borderRadius: 8, padding: 10 }}>
                    <img
                      src={`/api/blender/character-face/${c.id}`}
                      alt={c.name}
                      style={{ width: 100, height: 100, objectFit: 'contain' }}
                      onError={(e) => {
                        ;(e.target as any).style.display = 'none'
                      }}
                    />
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 16 }}>{c.name}</div>
                    <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>{c.style}</div>
                  </div>

                  <div style={{ fontSize: 11, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div>
                      <strong>Pose ({c.poses.length}):</strong>
                      <div style={{ opacity: 0.8, marginTop: 2 }}>{c.poses.slice(0, 5).join(', ')}...</div>
                    </div>
                    <div>
                      <strong>Ekspresi ({c.expressions.length}):</strong>
                      <div style={{ opacity: 0.8, marginTop: 2 }}>{c.expressions.slice(0, 5).join(', ')}...</div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 'auto' }}>
                    <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}>
                      ✓ Kedip Otomatis
                    </span>
                    <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'rgba(99,102,241,0.15)', color: '#818cf8' }}>
                      ✓ Lip-sync (a,i,u,e,o)
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* TAB 3: GALERI OUTPUT */}
          {tab === 'gallery' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {outputs.length === 0 ? (
                <div style={{ textAlign: 'center', opacity: 0.6, padding: 40 }}>Belum ada output render. Buat animasi di tab pertama.</div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
                  {outputs.map((out) => (
                    <div
                      key={out.filename}
                      style={{
                        padding: 12,
                        borderRadius: 8,
                        background: 'var(--panel2, #181825)',
                        border: '1px solid var(--border, #333)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                      }}
                    >
                      {out.type === 'image' && (
                        <img
                          src={out.url}
                          alt={out.filename}
                          style={{ width: '100%', height: 140, objectFit: 'cover', borderRadius: 6, background: '#000' }}
                        />
                      )}
                      {out.type === 'video' && (
                        <video src={out.url} style={{ width: '100%', height: 140, objectFit: 'cover', borderRadius: 6, background: '#000' }} controls />
                      )}
                      {out.type === 'blend' && (
                        <div
                          style={{
                            height: 100,
                            borderRadius: 6,
                            background: 'rgba(234, 88, 12, 0.1)',
                            border: '1px dashed #ea580c',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexDirection: 'column',
                            gap: 4,
                          }}
                        >
                          <span style={{ fontSize: 24 }}>📦</span>
                          <span style={{ fontSize: 12, fontWeight: 600, color: '#ea580c' }}>File Blender (.blend)</span>
                        </div>
                      )}

                      <div style={{ fontSize: 12, fontWeight: 600, wordBreak: 'break-all' }}>{out.filename}</div>
                      <div style={{ fontSize: 11, opacity: 0.6, display: 'flex', justifyContent: 'space-between' }}>
                        <span>{(out.size / 1024).toFixed(1)} KB</span>
                        <span>{out.created_at}</span>
                      </div>
                      <a
                        href={out.url}
                        download
                        style={{
                          textAlign: 'center',
                          padding: '6px 10px',
                          borderRadius: 6,
                          background: 'rgba(255,255,255,0.06)',
                          color: 'inherit',
                          textDecoration: 'none',
                          fontSize: 12,
                          fontWeight: 600,
                          marginTop: 'auto',
                        }}
                      >
                        Unduh File
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}


import type { BuilderDetail, BuilderSummary, CharacterConfig, LibAsset, LibCategory } from './builder/types'
import type { Layer, AiJobInfo, AiStatus, Asset, EnhanceModeId, EnhanceModeInfo, EnhanceOptions, ExportInfo, Geometry, ImageOp, Project, ProjectDoc, ProjectSummary, VersionInfo } from './types'

export const BASE = import.meta.env.VITE_API_URL ?? '/api'
const TOKEN_KEY = 'cm_token'

export const getToken = () => localStorage.getItem(TOKEN_KEY)
export const setToken = (t: string | null) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY))

export class ApiError extends Error {
  status: number
  body?: any
  constructor(message: string, status: number, body?: any) {
    super(message)
    this.status = status
    this.body = body
  }
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', ...(init.headers as any) }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  if (init.body && !(init.body instanceof FormData)) headers['Content-Type'] = 'application/json'

  let res: Response
  try {
    res = await fetch(BASE + path, { ...init, headers })
    // rate limited: wait as the server asks (up to 30 s, twice) instead of failing a long multi-step action half-way
    for (let i = 0; i < 2 && res.status === 429; i++) {
      const wait = Number(res.headers.get('Retry-After'))
      if (!Number.isFinite(wait) || wait <= 0 || wait > 30) break
      await new Promise((r) => setTimeout(r, wait * 1000 + 200))
      res = await fetch(BASE + path, { ...init, headers })
    }
  } catch {
    throw new ApiError('Tidak dapat terhubung ke server.', 0)
  }
  if (res.status === 401 && token && !path.startsWith('/auth/')) {
    setToken(null)
    window.location.assign('/login')
  }
  const body = res.status === 204 ? null : await res.json().catch(() => null)
  if (!res.ok) {
    const first = body?.errors ? Object.values<string[]>(body.errors)[0]?.[0] : undefined
    throw new ApiError(first ?? body?.message ?? `Permintaan gagal (${res.status})`, res.status, body)
  }
  return body as T
}

const json = (method: string, data?: unknown): RequestInit => ({ method, body: data === undefined ? undefined : JSON.stringify(data) })

export const api = {
  authOptions: () => req<{ registration: boolean }>('/auth/options'),
  register: (d: { name: string; email: string; password: string }) =>
    req<{ token: string; user: { id: number; name: string; email: string } }>('/auth/register', json('POST', d)),
  login: (d: { email: string; password: string }) =>
    req<{ token: string; user: { id: number; name: string; email: string } }>('/auth/login', json('POST', d)),
  me: () => req<{ user: { id: number; name: string; email: string } }>('/auth/me'),
  logout: () => req('/auth/logout', json('POST')),

  projects: () => req<{ data: ProjectSummary[] }>('/projects').then((r) => r.data),
  createProject: (name: string) => req<{ data: Project }>('/projects', json('POST', { name })).then((r) => r.data),
  project: (id: number) => req<{ data: Project }>(`/projects/${id}`).then((r) => r.data),
  saveProject: (id: number, d: { name?: string; document?: ProjectDoc; base_revision?: number; snapshot?: boolean; label?: string }) =>
    req<{ data: Project }>(`/projects/${id}`, json('PUT', d)).then((r) => r.data),
  deleteProject: (id: number) => req(`/projects/${id}`, json('DELETE')),
  duplicateProject: (id: number) => req<{ data: Project }>(`/projects/${id}/duplicate`, json('POST', {})).then((r) => r.data),
  versions: (id: number) => req<{ data: VersionInfo[] }>(`/projects/${id}/versions`).then((r) => r.data),
  restoreVersion: (id: number, n: number) => req<{ data: Project }>(`/projects/${id}/versions/${n}/restore`, json('POST', {})).then((r) => r.data),

  assets: (id: number) => req<{ data: Asset[] }>(`/projects/${id}/assets`).then((r) => r.data),
  uploadAsset: (id: number, file: File | Blob, name?: string) => {
    const fd = new FormData()
    fd.append('file', file, name ?? (file as File).name)
    return req<{ data: Asset }>(`/projects/${id}/assets`, { method: 'POST', body: fd }).then((r) => r.data)
  },
  processAsset: (id: number, ops: ImageOp[], name?: string) =>
    req<{ data: Asset; notes: string[]; geometry: Geometry }>(`/assets/${id}/process`, json('POST', { ops, name })),
  enhanceModes: () => req<{ data: { modes: EnhanceModeInfo[]; provider: { configured: boolean; model: string | null; daily_limit: number } } }>('/enhance/modes').then((r) => r.data),
  enhanceAsset: (id: number, mode: EnhanceModeId, options: EnhanceOptions, consentExternal = false) =>
    req<{ data: Asset & { job?: { id: number } }; notes?: string[] }>(`/assets/${id}/enhance`, json('POST', { mode, options, consent_external: consentExternal })),
  assetVersions: (id: number) => req<{ data: (Asset & { notes: string[] })[] }>(`/assets/${id}/versions`).then((r) => r.data),
  characters: () => req<{ data: import('./components/CharacterLibraryDialog').CharacterInfo[] }>('/characters').then((r) => r.data),
  saveCharacter: (projectId: number, body: { name: string; method: string; scene_id: string; layer_ids: string[] }) => req(`/projects/${projectId}/characters`, json('POST', body)),
  instantiateCharacter: (id: number, projectId: number) => req<{ data: { layers: Layer[]; assets: Asset[] } }>(`/characters/${id}/instantiate`, json('POST', { project_id: projectId })).then((r) => r.data),
  deleteCharacter: (id: number) => req(`/characters/${id}`, json('DELETE')),
  // ---- asset library & character builder ----
  libCategories: () => req<{ data: LibCategory[] }>('/library/categories').then((r) => r.data),
  libAssets: (q: { kind?: string; category?: string; q?: string; status?: string; mine?: boolean } = {}) => {
    const p = new URLSearchParams()
    Object.entries(q).forEach(([k, v]) => v !== undefined && v !== '' && p.set(k, v === true ? '1' : String(v)))
    return req<{ data: LibAsset[] }>(`/library/assets?${p}`).then((r) => r.data)
  },
  libUpload: (file: File, category: string, name: string, tags: string) => {
    const fd = new FormData()
    fd.append('file', file, file.name)
    fd.append('category', category)
    fd.append('name', name)
    if (tags) fd.append('tags', tags)
    return req<{ data: LibAsset }>('/library/assets', { method: 'POST', body: fd }).then((r) => r.data)
  },
  libUpdate: (id: number, patch: { name?: string; tags?: string; status?: 'approved' | 'rejected'; category?: string }) => req<{ data: LibAsset }>(`/library/assets/${id}`, json('PATCH', patch)).then((r) => r.data),
  libReplace: (id: number, file: Blob, filename: string) => {
    const fd = new FormData()
    fd.append('file', file, filename)
    return req<{ data: LibAsset; archived_old: boolean; replaced_id?: number }>(`/library/assets/${id}/file`, { method: 'POST', body: fd })
  },
  libDuplicate: (id: number) => req<{ data: LibAsset }>(`/library/assets/${id}/duplicate`, json('POST', {})).then((r) => r.data),
  libDelete: (id: number) => req<{ ok: boolean; archived: boolean }>(`/library/assets/${id}`, json('DELETE')),
  libUpscale: (id: number, factor: number) => req<{ data: { id: number; status: string } }>(`/library/assets/${id}/upscale`, json('POST', { factor })).then((r) => r.data),
  libGenerate: (category: string, prompt: string) => req<{ data: { id: number; status: string } }>('/library/ai/generate', json('POST', { category, prompt })).then((r) => r.data),

  builderList: () => req<{ data: BuilderSummary[] }>('/builder/characters').then((r) => r.data),
  builderGet: (id: number, version?: number) => req<{ data: BuilderDetail }>(`/builder/characters/${id}${version ? `?version=${version}` : ''}`).then((r) => r.data),
  builderSave: (id: number | null, body: { name?: string; config: CharacterConfig; note?: string }, thumb?: Blob) => {
    const fd = new FormData()
    if (body.name) fd.append('name', body.name)
    fd.append('config', JSON.stringify(body.config))
    if (body.note) fd.append('note', body.note)
    if (thumb) fd.append('thumbnail', thumb, 'thumb.png')
    return req<{ data: BuilderDetail }>(id ? `/builder/characters/${id}/versions` : '/builder/characters', { method: 'POST', body: fd }).then((r) => r.data)
  },
  builderRename: (id: number, name: string) => req(`/builder/characters/${id}`, json('PATCH', { name })),
  builderDuplicate: (id: number) => req<{ data: BuilderDetail }>(`/builder/characters/${id}/duplicate`, json('POST', {})).then((r) => r.data),
  builderDelete: (id: number) => req(`/builder/characters/${id}`, json('DELETE')),
  uploadAudio: (id: number, file: File) => {
    const fd = new FormData()
    fd.append('file', file, file.name)
    return req<{ data: Asset }>(`/projects/${id}/audio`, { method: 'POST', body: fd }).then((r) => r.data)
  },
  deleteAsset: (id: number) => req(`/assets/${id}`, json('DELETE')),

  aiStatus: () => req<{ data: AiStatus }>('/ai/status').then((r) => r.data),
  aiMotion: (id: number, prompt: string, sceneId?: string | null) => req<{ data: AiJobInfo }>(`/projects/${id}/ai/motion`, json('POST', { prompt, scene_id: sceneId ?? null })).then((r) => r.data),
  aiJob: (id: number) => req<{ data: AiJobInfo }>(`/ai/jobs/${id}`).then((r) => r.data),
  aiSegment: (assetId: number) => req<{ data: AiJobInfo }>(`/assets/${assetId}/ai/segment`, json('POST', {})).then((r) => r.data),
  aiSegmentApply: (jobId: number, parts: { name: string; x: number; y: number; w: number; h: number }[]) =>
    req<{ data: { name: string; asset: Asset }[] }>(`/ai/jobs/${jobId}/segment/apply`, json('POST', { parts })).then((r) => r.data),
  exports: (id: number) => req<{ data: ExportInfo[] }>(`/projects/${id}/exports`).then((r) => r.data),
  createExport: (id: number, meta: { format: string; width: number; height: number; fps: number; audio?: string; transparent?: number }, file: Blob, filename = 'recording.webm') => {
    const fd = new FormData()
    Object.entries(meta).forEach(([k, v]) => v !== undefined && fd.append(k, String(v)))
    fd.append('file', file, filename)
    return req<{ data: ExportInfo }>(`/projects/${id}/exports`, { method: 'POST', body: fd }).then((r) => r.data)
  },
  exportStatus: (id: number) => req<{ data: ExportInfo }>(`/exports/${id}`).then((r) => r.data),
  downloadExport: async (id: number, filename: string) => {
    const res = await fetch(`${BASE}/exports/${id}/download`, { headers: { Authorization: `Bearer ${getToken()}` } })
    if (!res.ok) throw new ApiError('Gagal mengunduh hasil export.', res.status)
    const url = URL.createObjectURL(await res.blob())
    const a = Object.assign(document.createElement('a'), { href: url, download: filename })
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  },
  cartoonStatus: () => req<{
    today: string
    today_project: { id: number; name: string; created_at: string } | null
    history: Array<{ id: number; name: string; created_at: string; scenes_count: number; has_export: boolean; export_status?: string; export_id?: number }>
    characters: string[]
  }>('/cartoon/status'),
  generateCartoon: (data: { topic?: string; characters?: string[] }) =>
    req<{ data: { project_id: number; title: string; theme: string; duration: number; scenes_count: number; audio_count: number; script: any } }>('/cartoon/generate', json('POST', data)).then((r) => r.data),
}


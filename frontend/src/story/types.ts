export interface StoryCharacter { id?: number | null; name: string; role?: string | null; traits?: string | null; voice?: 'male' | 'female' | null }

/** Something that happens without words: exactly one of an action ("Uki melambai") or a sound effect ("bel"). */
export interface ScriptBeat { action?: string; sfx?: string }

/** `before` = what happens just before this line is spoken. */
export interface ScriptLine { who: string; text: string; before?: ScriptBeat[] }

export interface StoryScript {
  title?: string
  theme?: string
  /** `cast` = who else stands in the scene without speaking; `after` = what happens after the last line (a scene may have only this). */
  scenes: { name: string; location: string; time: string; cast?: string[]; dialog: ScriptLine[]; after?: ScriptBeat[] }[]
}

export type EpisodeStatus = 'planned' | 'scripted' | 'queued' | 'producing' | 'done' | 'failed'

export interface StoryEpisode {
  id: number
  number: number
  title: string
  synopsis: string | null
  script: StoryScript | null
  status: EpisodeStatus
  scheduled_at: string | null
  project_id: number | null
  output_path: string | null
  publish: boolean
  published: boolean
  error: string | null
  scenes: number
}

export interface StorySeries {
  id: number
  title: string
  premise: string
  master_script: string | null
  genre: string | null
  tone: string | null
  narration_style: string | null
  use_narrator: boolean
  narrator_voice: string
  characters: StoryCharacter[]
  notes: string | null
  episodes_planned: number
  auto_run: boolean
  schedule_time: string | null
  auto_publish: boolean
  last_auto_date: string | null
  ai_status: 'idle' | 'working' | 'failed'
  ai_message: string | null
  episodes_count: number
  done_count: number
  episodes?: StoryEpisode[]
  capabilities?: { ai: boolean; publish: boolean; privacy: string }
}

export type SeriesInput = Partial<Pick<StorySeries, 'title' | 'premise' | 'master_script' | 'genre' | 'tone' | 'narration_style' | 'use_narrator' | 'narrator_voice' | 'characters' | 'notes' | 'episodes_planned' | 'auto_run' | 'schedule_time' | 'auto_publish'>>

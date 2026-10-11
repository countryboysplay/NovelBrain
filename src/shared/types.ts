import type { BookError } from '../main/book/validate'
import type { RunStateT } from '../main/run/state'
import type { Usage } from './usage'
import type { Settings, UiSettings } from '../main/settings'
export type { BookError, RunStateT }
/** One line of run/room.jsonl (display only). `needsYou` marks the runner's lines that stop for the writer (#needs-you). */
export interface RoomEntry { at: string; step: string; from: string; to?: string; kind: 'say' | 'dispatch' | 'reply' | 'review' | 'system'; verdict?: 'PASS' | 'FLAG' | 'FAIL'; text: string; needsYou?: true }
export type Status = 'stopped' | 'starting' | 'up' | 'restarting' | 'failed'
export type ServiceName = 'codeburn' | 'headroom'

export interface StepView { id: string; label: string; required: boolean; ok: boolean; skipped: boolean; blockedBy: string | null }

export interface AppState {
  book: { dir: string; title: string; status: 'active' | 'archived' } | null
  run: RunStateT | null
  parked: { scene: string; reason: string }[]
  changes: ChangeSummary[]
  recentBooks: string[]
  errors: BookError[]
  services: Record<ServiceName, Status>
  installed: Record<string, boolean>
  usage: Usage | null
  ports: Record<ServiceName, number>
}

export type PublicSettings = Pick<Settings, 'ui' | 'models' | 'memory' | 'usage' | 'headroom' | 'tab' | 'claudeVersion'>
export type SettingsPatch = {
  ui?: Partial<Omit<UiSettings, 'reader'>> & { reader?: Partial<UiSettings['reader']> }
  models?: Partial<Settings['models']>
  memory?: Partial<Settings['memory']>
  usage?: Partial<Settings['usage']>
  headroom?: boolean
  tab?: string
}

export interface ChangeSummary { id: string; summary: string; files: string[] }
export type ChangeResult = { ok: true; commit: string } | { ok: false; reasons: string[] }
export type ChangePreview = { ok: true; token: string; files: { file: string; before: string; after: string }[] } | { ok: false; error: string }

export type InitResult = { mode: 'setup'; steps: StepView[] } | { mode: 'studio'; state: AppState }
export interface InstallResult { ok: boolean; error?: string; steps: StepView[] }

export type LessonAction = 'added' | 'rewritten' | 'retired' | 'deleted' | 'kept' | 'probation'
export interface LessonLogEntry { at: string; checkpoint: string; lesson: string; action: LessonAction; reason: string; by: string }
export interface LessonView { file: string; scope: 'writer' | 'series' | 'book'; name: string; type: string; summary: string; status: 'live' | 'probation'; live?: string; targets?: string[] }
export interface MemoryLessons { lessons: LessonView[]; log: LessonLogEntry[] }

export interface MemoryStatus {
  log: string[]
  queued: number
  runsToday: number
  spentUsd: number
  spentToday: number
  proposals: { name: string; description: string; text: string }[]
}

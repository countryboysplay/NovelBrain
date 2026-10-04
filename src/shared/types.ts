import type { BookError } from '../main/book/validate'
import type { RunStateT } from '../main/run/state'
export type { BookError, RunStateT }
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
}

export interface ChangeSummary { id: string; summary: string; files: string[] }
export type ChangeResult = { ok: true; commit: string } | { ok: false; reasons: string[] }
export type ChangePreview = { ok: true; token: string; files: { file: string; before: string; after: string }[] } | { ok: false; error: string }

export type InitResult = { mode: 'setup'; steps: StepView[] } | { mode: 'studio'; state: AppState }
export interface InstallResult { ok: boolean; error?: string; steps: StepView[] }

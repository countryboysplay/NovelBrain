import type { AppState, MemoryStatus, PublicSettings, SettingsPatch } from '../../shared/types'
import type { StudioData } from '../../shared/studio'
import type { LogLine } from './lib/selectors'

export type ViewId = 'bible' | 'outline' | 'timeline' | 'series' | 'manuscript' | 'run' | 'room' | 'needs-you' | 'publish' | 'cost' | 'memory' | 'story-map' | 'settings'
export const VIEW_IDS: ViewId[] = ['bible', 'outline', 'timeline', 'series', 'manuscript', 'run', 'room', 'needs-you', 'publish', 'cost', 'memory', 'story-map', 'settings']
export const isViewId = (v: unknown): v is ViewId => VIEW_IDS.includes(v as ViewId)
export interface ViewProps {
  state: AppState
  data: StudioData | null
  mem: MemoryStatus | null
  setMem: (m: MemoryStatus) => void
  settings: PublicSettings
  save: (patch: SettingsPatch) => Promise<void>
  go: (v: ViewId) => void
  log: LogLine[]
}

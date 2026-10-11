import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import { dirname } from 'node:path'
import { ROOM_CHANNELS, type RoomChannel } from '../shared/room'

export interface UiSettings { theme: 'system' | 'night' | 'day'; motion: 'system' | 'reduced'; terminalOpen: boolean; terminalWidth: number; reader: { font: 'atkinson' | 'serif' | 'dyslexic'; size: number; spacing: number }
  /** When the writer last viewed each Writers' room channel (ISO time), for its unread count. App-wide, not per book. */
  roomSeen: Partial<Record<RoomChannel, string>> }

export interface Settings {
  recentBooks: string[]
  headroom: boolean
  ponytail: boolean
  skipped: string[]
  tab: string
  memory: { model: string; deepModel: string; auditModel: string; deepAuditModel: string; indexCap: number }
  usage: { stopAt: number }
  ui: UiSettings
  models: { showrunner: string }
  claudeVersion: string | null
}

export const defaults = (): Settings => ({
  recentBooks: [],
  headroom: true,
  ponytail: true,
  skipped: [],
  tab: 'outline',
  memory: { model: 'haiku', deepModel: 'sonnet', auditModel: 'sonnet', deepAuditModel: 'opus', indexCap: 60 },
  usage: { stopAt: 90 },
  ui: { theme: 'system', motion: 'system', terminalOpen: false, terminalWidth: 640, reader: { font: 'atkinson', size: 19, spacing: 1.6 }, roomSeen: {} },
  models: { showrunner: 'opus' },
  claudeVersion: null
})

export function loadSettings(file: string): Settings {
  let parsed: Partial<Settings> = {}
  try {
    const v = JSON.parse(readFileSync(file, 'utf8'))
    if (v && typeof v === 'object' && !Array.isArray(v)) parsed = v
  } catch {
    // missing or corrupt: fall back to defaults
  }
  const s = { ...defaults(), ...parsed }
  s.recentBooks = Array.isArray(s.recentBooks) ? s.recentBooks.filter(x => typeof x === 'string') : []
  s.skipped = Array.isArray(s.skipped) ? s.skipped.filter(x => typeof x === 'string') : []
  if (typeof s.headroom !== 'boolean') s.headroom = defaults().headroom
  if (typeof s.ponytail !== 'boolean') s.ponytail = defaults().ponytail
  if (typeof s.tab !== 'string') s.tab = defaults().tab
  s.memory = memorySettings(s.memory)
  s.usage = usageSettings(s.usage)
  s.ui = uiSettings(s.ui, defaults().ui)
  s.models = { showrunner: model(obj(s.models).showrunner, 'opus') }
  s.claudeVersion = typeof s.claudeVersion === 'string' && /^[0-9A-Za-z.+-]{1,40}$/.test(s.claudeVersion) ? s.claudeVersion : null
  return s
}

const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/ // no leading '-': it becomes a claude CLI argument
const model = (x: unknown, d: string) => (typeof x === 'string' && MODEL.test(x) ? x : d)
const oneOf = <T extends string>(x: unknown, list: readonly T[], d: T): T => (list.includes(x as T) ? (x as T) : d)
const num = (x: unknown, lo: number, hi: number, d: number) => (typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi ? x : d)
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

function uiSettings(v: unknown, d: UiSettings): UiSettings {
  const u = obj(v), r = obj(u.reader), seen = obj(u.roomSeen)
  const time = (x: unknown): x is string => typeof x === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/.test(x) && Number.isFinite(Date.parse(x))
  return {
    theme: oneOf(u.theme, ['system', 'night', 'day'] as const, d.theme),
    motion: oneOf(u.motion, ['system', 'reduced'] as const, d.motion),
    terminalOpen: typeof u.terminalOpen === 'boolean' ? u.terminalOpen : d.terminalOpen,
    terminalWidth: num(u.terminalWidth, 320, 1600, d.terminalWidth), // px; about 80 columns by default
    reader: { font: oneOf(r.font, ['atkinson', 'serif', 'dyslexic'] as const, d.reader.font), size: num(r.size, 14, 32, d.reader.size), spacing: num(r.spacing, 1.2, 2.4, d.reader.spacing) },
    roomSeen: Object.fromEntries(ROOM_CHANNELS.flatMap(c => { const t = time(seen[c]) ? seen[c] : d.roomSeen[c]; return t ? [[c, t]] : [] }))
  }
}

function usageSettings(v: unknown, d = defaults().usage): Settings['usage'] {
  const stopAt = (v as { stopAt?: unknown } | null)?.stopAt
  return { stopAt: Number.isInteger(stopAt) && (stopAt as number) >= 1 && (stopAt as number) <= 100 ? (stopAt as number) : d.stopAt }
}

function memorySettings(v: unknown, d = defaults().memory): Settings['memory'] {
  const m = v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  const cap = (x: unknown, def: number) => (Number.isInteger(x) && (x as number) >= 1 && (x as number) <= 1000 ? (x as number) : def)
  const auditModel = model(m.auditModel, d.auditModel)
  const deepAuditModel = model(m.deepAuditModel, d.deepAuditModel)
  // A lesson is never audited by its own writer: equal auditors fall back to the defaults.
  const same = auditModel === deepAuditModel
  return {
    model: model(m.model, d.model),
    deepModel: model(m.deepModel, d.deepModel),
    auditModel: same ? defaults().memory.auditModel : auditModel,
    deepAuditModel: same ? defaults().memory.deepAuditModel : deepAuditModel,
    indexCap: cap(m.indexCap, d.indexCap)
  }
}

const PATCHABLE = ['ui', 'models', 'memory', 'usage', 'headroom', 'tab']

/** A renderer's patch, validated like a loaded file against the current values. */
export function patchSettings(s: Settings, patch: unknown): Settings | null {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return null
  const p = patch as Record<string, unknown>
  if (Object.keys(p).some(k => !PATCHABLE.includes(k))) return null
  const ui = obj(p.ui)
  return {
    ...s,
    ui: uiSettings({ ...s.ui, ...ui, reader: { ...s.ui.reader, ...obj(ui.reader) }, roomSeen: { ...s.ui.roomSeen, ...obj(ui.roomSeen) } }, s.ui),
    models: { showrunner: model(obj(p.models).showrunner, s.models.showrunner) },
    memory: memorySettings({ ...s.memory, ...obj(p.memory) }, s.memory),
    usage: usageSettings({ ...s.usage, ...obj(p.usage) }, s.usage),
    headroom: typeof p.headroom === 'boolean' ? p.headroom : s.headroom,
    tab: typeof p.tab === 'string' && /^[a-z-]{1,20}$/.test(p.tab) ? p.tab : s.tab
  }
}

export function saveSettings(file: string, s: Settings): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(`${file}.tmp`, JSON.stringify(s, null, 2))
  renameSync(`${file}.tmp`, file) // a crash mid-write never loses the file
}

export function addRecent(list: string[], dir: string): string[] {
  return [dir, ...list.filter(d => d.toLowerCase() !== dir.toLowerCase())].slice(0, 10)
}

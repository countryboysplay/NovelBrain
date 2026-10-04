import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { stringify } from 'yaml'
import type { z } from 'zod'
import { parseYamlText, RunState } from '../../shared/schemas'

export type RunStateT = z.infer<typeof RunState>

const file = (bookDir: string) => join(bookDir, 'run', 'state.yaml')
const defaults = (): RunStateT => ({ status: 'idle', stopAt: 'act', pauseAtActs: true, spentUsd: 0, current: null, completed: [], parked: [],
  checkedChapters: [], checkedActs: [], resumeAfter: null, lastError: null })

/** Books with a Runner loop in this process; only for them is status 'running' true. */
export const liveRuns = new Set<string>()
export const runKey = (bookDir: string) => resolve(bookDir).toLowerCase()

export function readRunState(bookDir: string, log: (line: string) => void = console.warn): RunStateT {
  if (!existsSync(file(bookDir))) return defaults()
  let s: RunStateT
  let raw: unknown
  try {
    raw = parseYamlText(readFileSync(file(bookDir), 'utf8'))
    s = RunState.parse(raw)
  } catch (e) {
    copyFileSync(file(bookDir), `${file(bookDir)}.bad`)
    // Keep the spending total when the broken file still says it; the warning stays in lastError for the UI.
    const spent = (raw as { spentUsd?: unknown } | undefined)?.spentUsd
    const warning = `run/state.yaml could not be read (${(e as Error).message.split('\n')[0]}); kept it as run/state.yaml.bad and started from defaults`
    s = { ...defaults(), spentUsd: typeof spent === 'number' && spent >= 0 ? spent : 0, lastError: warning }
    writeRunState(bookDir, s)
    log(warning)
    return s
  }
  if (s.status === 'running' && !liveRuns.has(runKey(bookDir))) {
    s = { ...s, status: 'paused', current: null, lastError: 'Novel Brain closed during a step' }
    writeRunState(bookDir, s)
  }
  return s
}

export function writeRunState(bookDir: string, s: RunStateT): void {
  const data = RunState.parse(s)
  mkdirSync(join(bookDir, 'run'), { recursive: true })
  const tmp = `${file(bookDir)}.tmp`
  const fd = openSync(tmp, 'w')
  try {
    writeSync(fd, stringify(data))
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(tmp, file(bookDir))
}

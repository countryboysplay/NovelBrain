import { execFile } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

import type { LessonAction, LessonLogEntry } from '../../shared/types'

const exec = promisify(execFile)

export async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd, windowsHide: true, maxBuffer: 16 << 20 })
  return stdout
}

// The only ignored files the app owns; validation checks every other ignored path like any other.
export const STATE_FILES = ['.state.json', '.queue']
const IDENTITY = ['-c', 'user.name=NovelBrain', '-c', 'user.email=memory@novelbrain.local', '-c', 'commit.gpgsign=false']

export async function ensureRepo(root: string): Promise<void> {
  for (const d of ['topics', 'series', 'books', 'skills', 'inbox']) mkdirSync(join(root, d), { recursive: true })
  const ignore = join(root, '.gitignore')
  const text = existsSync(ignore) ? readFileSync(ignore, 'utf8') : ''
  const missing = STATE_FILES.filter(f => !text.split(/\r?\n/).includes(f))
  if (missing.length) writeFileSync(ignore, `${text}${text && !text.endsWith('\n') ? '\n' : ''}${missing.map(f => `${f}\n`).join('')}`)
  if (!existsSync(join(root, '.git'))) {
    await git(root, 'init', '-q')
    await commit(root, 'Start memory')
    return
  }
  if (!missing.length) return
  // Explicit paths only: a leftover call's output in the tree must never ride along.
  await git(root, 'rm', '--cached', '-q', '--ignore-unmatch', '--', ...STATE_FILES)
  await git(root, 'add', '--', '.gitignore')
  await git(root, ...IDENTITY, 'commit', '-q', '-m', 'Restore .gitignore')
}

export async function commit(root: string, message: string): Promise<boolean> {
  await git(root, 'add', '-A')
  if (!(await git(root, 'status', '--porcelain')).trim()) return false
  await git(root, ...IDENTITY, 'commit', '-q', '-m', message)
  return true
}

export const pathKey = (p: string): string => resolve(p).toLowerCase()

export interface MemState {
  offsets: Record<string, number>
  runs: { day: string; count: number; usd?: number }
  spentUsd: number
  // Set right before a distill run and cleared once validate/commit/rollback finishes.
  // Still set at the next init() means the previous run died mid-distill.
  inFlight: string | null
  log: StoredLogEntry[] // lessons added, rewritten, retired and deleted, with reasons; oldest first (memory:lessons)
  evidenced: string[] // `<pathKey(book)>|<CH-##>` already counted, so a chapter checked again counts once
  keptSkills: string[] // proposals the auditor kept; the rest are audited at the next audit
  hitIn: Record<string, string[]> // live catch (memory-relative path) -> chapters whose findings cited its rules; its audit clears it
}

export type StoredLogEntry = LessonLogEntry & { book: string }
const ACTIONS: LessonAction[] = ['added', 'rewritten', 'retired', 'deleted', 'kept', 'probation']
const isEntry = (a: unknown): a is StoredLogEntry => {
  const r = a as Record<string, unknown> | null
  return !!r && ['at', 'book', 'checkpoint', 'lesson', 'reason', 'by'].every(k => isStr(r[k])) && ACTIONS.includes(r.action as LessonAction)
}
export const LOG_KEPT = 200
export function addLog(s: MemState, entries: StoredLogEntry[]): void {
  s.log = [...s.log, ...entries].slice(-LOG_KEPT)
}

export function readState(root: string): MemState {
  const d: MemState = { offsets: {}, runs: { day: '', count: 0 }, spentUsd: 0, inFlight: null, log: [], evidenced: [], keptSkills: [], hitIn: {} }
  try {
    const v = JSON.parse(readFileSync(join(root, '.state.json'), 'utf8'))
    return {
      offsets: v.offsets && typeof v.offsets === 'object' ? v.offsets : d.offsets,
      runs: typeof v.runs?.day === 'string' && typeof v.runs?.count === 'number'
        ? { day: v.runs.day, count: v.runs.count, ...(typeof v.runs.usd === 'number' && Number.isFinite(v.runs.usd) ? { usd: v.runs.usd } : {}) } : d.runs,
      spentUsd: typeof v.spentUsd === 'number' && Number.isFinite(v.spentUsd) ? v.spentUsd : 0,
      inFlight: typeof v.inFlight === 'string' ? v.inFlight : null,
      log: Array.isArray(v.log) ? v.log.filter(isEntry) : [],
      evidenced: Array.isArray(v.evidenced) ? v.evidenced.filter(isStr) : [],
      keptSkills: Array.isArray(v.keptSkills) ? v.keptSkills.filter(isStr) : [],
      hitIn: v.hitIn && typeof v.hitIn === 'object' && !Array.isArray(v.hitIn)
        ? Object.fromEntries(Object.entries(v.hitIn).filter((e): e is [string, string[]] => Array.isArray(e[1]) && e[1].every(isStr)))
        : {}
    }
  } catch {
    return d
  }
}

export const writeState = (root: string, s: MemState): void => writeFileSync(join(root, '.state.json'), JSON.stringify(s))

export type Job =
  | { kind: 'distill'; transcript: string; book: string }
  | { kind: 'deep'; book: string; act: string }
  | { kind: 'recheck'; file: string }
  | { kind: 'audit'; book: string; at?: string } // at: CH-## or ACT-#, the checkpoint that queued it

const jobKey = (j: Job): string =>
  j.kind === 'distill' ? `d:${pathKey(j.transcript)}` : j.kind === 'deep' ? `p:${pathKey(j.book)}:${j.act}` : j.kind === 'audit' ? `a:${pathKey(j.book)}:${j.at ?? ''}` : `r:${pathKey(j.file)}`
const queueFile = (root: string) => join(root, '.queue')
const isStr = (v: unknown): v is string => typeof v === 'string'

function isJob(v: unknown): v is Job {
  const j = v as Record<string, unknown> | null
  return (
    (j?.kind === 'distill' && isStr(j.transcript) && isStr(j.book)) ||
    (j?.kind === 'deep' && isStr(j.book) && isStr(j.act)) ||
    (j?.kind === 'recheck' && isStr(j.file)) ||
    (j?.kind === 'audit' && isStr(j.book) && (j.at === undefined || (isStr(j.at) && /^(CH-\d{2,}|ACT-\d+)$/.test(j.at))))
  )
}

export function readQueue(root: string): Job[] {
  let text = ''
  try {
    text = readFileSync(queueFile(root), 'utf8')
  } catch {
    return []
  }
  const seen = new Set<string>()
  const jobs: Job[] = []
  for (const line of text.split('\n')) {
    let j: unknown
    try {
      j = JSON.parse(line)
    } catch {
      continue
    }
    if (!isJob(j) || seen.has(jobKey(j))) continue
    seen.add(jobKey(j))
    jobs.push(j)
  }
  return jobs
}

export const enqueue = (root: string, job: Job): void => appendFileSync(queueFile(root), `${JSON.stringify(job)}\n`)

// ponytail: read-then-rewrite can drop an append that lands in between; the next catch-up re-queues it.
export function removeJob(root: string, job: Job): void {
  const rest = readQueue(root).filter(j => jobKey(j) !== jobKey(job))
  writeFileSync(queueFile(root), rest.map(j => `${JSON.stringify(j)}\n`).join(''))
}

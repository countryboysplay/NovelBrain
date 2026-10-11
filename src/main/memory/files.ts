import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { parseYamlText } from '../../shared/schemas'
import type { LessonView } from '../../shared/types'

export const memDir = (): string => process.env.NB_MEMORY_DIR ?? join(homedir(), '.novelbrain', 'memory')
export const claudeProjectsDir = (): string => process.env.NB_CLAUDE_PROJECTS ?? join(homedir(), '.claude', 'projects')
// Same folder naming Claude Code uses under ~/.claude/projects, so memory lines up with transcripts.
export const slugFor = (dir: string): string => dir.replace(/[^a-zA-Z0-9]/g, '-')
export const today = (): string => new Date().toISOString().slice(0, 10)
export const daysBetween = (from: string, to: string): number => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000)

export type MemoryType = 'preference' | 'catch' | 'voice' | 'craft'
export const TYPES: MemoryType[] = ['preference', 'catch', 'voice', 'craft']

export type LessonStatus = 'live' | 'probation'
// Skill rule ids as the kit's reviewers cite them (SK-ENG-04, MYS-CONV-02, GATE-REV-02); never a story id
// (STORY_ID shapes that fit XX-YYYYY-NN: CHAR-/LOC- anywhere, CH-nn, ACT-nn; the rest need 3+ digits or one letter.)
export const RULE_ID = /^(?!.*\b(?:CHAR|LOC)-)(?!.*\b(?:CH|ACT)-\d)[A-Z]{2,4}-[A-Z]{2,5}-\d{2}$/

export interface Meta {
  name: string
  type: MemoryType
  summary: string
  sources: string[]
  verified: string
  used: string
  uses: number
  stale: boolean
  pinned: boolean
  status: LessonStatus // probation: written or rewritten by a model and not yet audited; left out of the briefing
  by: string // the model that wrote the current text; its auditor must be a different model
  rules: string[] // reviewer rule ids a catch targets; evidence is counted on these
  quiet: number // chapters in a row with no finding citing the rules, since the lesson went live
  hits: number // chapters with such findings since it went live
  live: string // the day an audit put it live; '' while on probation and for files from before the audit
}

export interface Memory {
  file: string
  meta: Meta
  body: string
}

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/

export interface BookKeys {
  book: string
  series: string
}

// ponytail: keyed by book id; two books with the same id share book memory (R3).
export function bookKeys(bookDir: string): BookKeys | null {
  try {
    const v = parseYamlText(readFileSync(join(bookDir, 'book.yaml'), 'utf8')) as { id?: unknown; series?: unknown } | null
    if (typeof v?.id !== 'string' || !SLUG.test(v.id)) return null
    const series = typeof v.series === 'string' && v.series ? v.series : v.id
    return SLUG.test(series) ? { book: v.id, series } : null
  } catch {
    return null
  }
}

// Keys become path segments, so only book-id slugs: no '..', separators or NTFS streams.
export function scopeDir(root: string, scope: 'writer' | 'series' | 'book', key = ''): string {
  if (scope === 'writer') return root
  if (!SLUG.test(key)) throw new Error(`invalid memory scope key: ${JSON.stringify(key)}`)
  return join(root, scope === 'series' ? 'series' : 'books', key)
}

export function parseFrontmatter(text: string): { raw: Record<string, unknown>; body: string } | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  if (!m) return null
  const raw: Record<string, unknown> = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^(\w+):\s*(.*)$/.exec(line)
    if (!kv) continue
    const v = kv[2].trim()
    raw[kv[1]] =
      v.startsWith('[') && v.endsWith(']')
        ? v.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean)
        : v === 'true' ? true : v === 'false' ? false : /^\d+$/.test(v) ? Number(v) : v
  }
  return { raw, body: m[2] }
}

export function toMeta(raw: Record<string, unknown>): Meta | null {
  const str = (k: string) => (typeof raw[k] === 'string' && raw[k] ? (raw[k] as string) : null)
  const name = str('name'), summary = str('summary'), verified = str('verified')
  if (!name || !summary || !verified || !TYPES.includes(raw.type as MemoryType)) return null
  return {
    name,
    type: raw.type as MemoryType,
    summary,
    sources: Array.isArray(raw.sources) ? raw.sources.filter((s): s is string => typeof s === 'string') : [],
    verified,
    used: str('used') ?? verified,
    uses: typeof raw.uses === 'number' ? raw.uses : 0,
    stale: raw.stale === true,
    pinned: raw.pinned === true,
    // Files from before the audit have no status: they are live.
    status: raw.status === 'probation' ? 'probation' : 'live',
    by: typeof raw.by === 'string' && /^[A-Za-z0-9._:-]+$/.test(raw.by) ? raw.by : '',
    rules: Array.isArray(raw.rules) ? raw.rules.filter((r): r is string => typeof r === 'string' && RULE_ID.test(r)) : [],
    quiet: typeof raw.quiet === 'number' ? raw.quiet : 0,
    hits: typeof raw.hits === 'number' ? raw.hits : 0,
    live: str('live') ?? ''
  }
}

export function serialize(meta: Meta, body: string): string {
  const lines = Object.entries(meta).map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.join(', ')}]` : v}`)
  return `---\n${lines.join('\n')}\n---\n${body}`
}

export function readMemory(file: string): Memory | null {
  try {
    const p = parseFrontmatter(readFileSync(file, 'utf8'))
    const meta = p ? toMeta(p.raw) : null
    return p && meta ? { file, meta, body: p.body } : null
  } catch {
    return null
  }
}

export function writeMemory(m: Memory): void {
  mkdirSync(dirname(m.file), { recursive: true })
  writeFileSync(m.file, serialize(m.meta, m.body))
}

export const subdirs = (dir: string): string[] =>
  existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name) : []

// user.md plus topics/*.md; the validator only allows user.md at the writer root.
export function listMemories(scopeDir: string): Memory[] {
  const files = [join(scopeDir, 'user.md')]
  const topics = join(scopeDir, 'topics')
  if (existsSync(topics)) files.push(...readdirSync(topics).filter(f => f.endsWith('.md')).map(f => join(topics, f)))
  return files.flatMap(f => {
    const m = existsSync(f) ? readMemory(f) : null
    return m ? [m] : []
  })
}

export const allMemories = (root: string): Memory[] => [
  ...listMemories(root),
  ...subdirs(join(root, 'series')).flatMap(s => listMemories(join(root, 'series', s))),
  ...subdirs(join(root, 'books')).flatMap(b => listMemories(join(root, 'books', b)))
]

export const bookMemories = (root: string, keys: BookKeys): Memory[] => [
  ...listMemories(root),
  ...listMemories(scopeDir(root, 'series', keys.series)),
  ...listMemories(scopeDir(root, 'book', keys.book))
]

export const relPath = (root: string, file: string): string => relative(root, file).split(sep).join('/')

/** memory:lessons: the open book's three scopes, or the writer's alone with no book open. */
export function lessonViews(root: string, bookDir: string | null): LessonView[] {
  const keys = bookDir ? bookKeys(bookDir) : null
  return (keys ? bookMemories(root, keys) : listMemories(root)).map(m => {
    const file = relPath(root, m.file)
    const scope = file.startsWith('books/') ? 'book' : file.startsWith('series/') ? 'series' : 'writer'
    return {
      file, scope, name: m.meta.name, type: m.meta.type, summary: m.meta.summary, status: m.meta.status,
      ...(m.meta.live ? { live: m.meta.live } : {}),
      ...(m.meta.rules.length ? { targets: m.meta.rules } : {})
    }
  })
}

export function bookPath(root: string, id: string): string | null {
  try {
    const p = JSON.parse(readFileSync(join(scopeDir(root, 'book', id), 'book.json'), 'utf8')).path
    return typeof p === 'string' ? p : null
  } catch {
    return null
  }
}

export function writeBookPath(root: string, id: string, path: string): void {
  if (bookPath(root, id) === path) return
  const dir = scopeDir(root, 'book', id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'book.json'), `${JSON.stringify({ path }, null, 2)}\n`)
}

export const knownBooks = (root: string): { id: string; path: string }[] =>
  subdirs(join(root, 'books')).flatMap(id => {
    const path = bookPath(root, id)
    return path === null ? [] : [{ id, path }]
  })

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { parseYamlText } from '../../shared/schemas'
import { join, relative } from 'node:path'
import { bookKeys, daysBetween, listMemories, scopeDir, subdirs, type Memory, type Meta } from './files'

// Writer, series and book indexes are briefed together, so the total cap is split between them.
export const splitCap = (cap: number) => {
  const writer = Math.round(cap * 0.4)
  const series = Math.round(cap * 0.3)
  return { writer, series, book: cap - writer - series }
}
// Catches are inlined in the briefing, so their `used` never moves; the deep pass prunes them instead.
// Voice is kept so a series' voice survives to a sequel written long after.
export const isExempt = (m: Meta): boolean => m.pinned || m.type === 'preference' || m.type === 'catch' || m.type === 'voice'
export const isDecayed = (m: Meta, day: string): boolean => !isExempt(m) && daysBetween(m.used, day) > 30
const rank = (m: Meta) => (m.pinned ? 0 : isExempt(m) ? 1 : 2)

export function renderIndex(root: string, mems: Memory[], cap: number, day: string): string {
  const lines = mems
    .filter(m => !isDecayed(m.meta, day))
    .sort((a, b) => rank(a.meta) - rank(b.meta) || b.meta.used.localeCompare(a.meta.used) || a.meta.name.localeCompare(b.meta.name))
    .slice(0, cap)
    .map(m => `- [${m.meta.name}](${relative(root, m.file).replace(/\\/g, '/')}) — ${m.meta.summary}${m.meta.stale ? ' (may be stale)' : ''}${m.meta.status === 'probation' ? ' (on probation)' : ''}`)
  return lines.length ? `${lines.join('\n')}\n` : ''
}

export function rebuildIndexes(root: string, cap: number, day: string): void {
  const caps = splitCap(cap)
  if (existsSync(root)) writeFileSync(join(root, 'INDEX.md'), renderIndex(root, listMemories(root), caps.writer, day))
  for (const [scope, sub, n] of [['series', 'series', caps.series], ['book', 'books', caps.book]] as const)
    for (const key of subdirs(join(root, sub))) {
      let dir: string
      try {
        dir = scopeDir(root, scope, key)
      } catch {
        continue // not a slug: not ours to index
      }
      writeFileSync(join(dir, 'INDEX.md'), renderIndex(root, listMemories(dir), n, day))
    }
}

export const BRIEFING = '.novelbrain/memory.md'
// Claude Code caps SessionStart hook output at 10,000 characters.
export const BRIEFING_MAX = 9000
const CATCHES_MAX = 6000
const TITLE = "# What this writer's books have taught (Novel Brain memory; read-only)\n"

// Archived books are immutable: no briefing is written into them.
function archived(bookDir: string): boolean {
  try {
    return (parseYamlText(readFileSync(join(bookDir, 'book.yaml'), 'utf8')) as { status?: unknown } | null)?.status === 'archived'
  } catch {
    return false
  }
}

export function writeBriefing(root: string, bookDir: string, cap: number, day: string): void {
  const keys = bookKeys(bookDir)
  if (!keys || !existsSync(join(bookDir, '.novelbrain')) || archived(bookDir)) return
  const caps = splitCap(cap)
  // Probation lessons wait for their audit; they never reach the author (spec 8.1).
  const live = (ms: Memory[]) => ms.filter(m => m.meta.status === 'live')
  const writer = live(listMemories(root)), series = live(listMemories(scopeDir(root, 'series', keys.series))), book = live(listMemories(scopeDir(root, 'book', keys.book)))
  const scopes = ([['Writer', writer, caps.writer], ['Series', series, caps.series], ['This book', book, caps.book]] as const)
    .map(([h, mems, n]) => [h, renderIndex(root, [...mems], n, day).split('\n').filter(Boolean)] as const)
  const blocks = [...book, ...writer]
    .filter(m => m.meta.type === 'catch') // catches are exempt from decay
    .sort((a, b) => b.meta.used.localeCompare(a.meta.used))
    .map(m => `### ${m.meta.name}\n${m.body.trim()}\n`)
  if (!blocks.length && scopes.every(([, l]) => !l.length)) return writeFileSync(join(bookDir, BRIEFING), `${TITLE}\nNo lessons yet.\n`)
  const head = `${TITLE}\nMemory lives in ${root}. Read a lesson's file when its line is relevant.\n\n`
  // Catches take priority, in whole blocks up to 6,000 characters; index lines fill what is left.
  let catches = ''
  for (const b of blocks) if (catches.length + b.length <= CATCHES_MAX) catches += b
  const tail = catches && `\n## Recurring catches (apply before drafting)\n${catches}`
  let room = BRIEFING_MAX - head.length - tail.length, idx = ''
  for (const [h, lines] of scopes) {
    let sec = `## ${h}\n`, n = 0
    for (const l of lines) {
      if (sec.length + l.length + 1 > room) break
      sec += `${l}\n`
      n++
    }
    if (n) (idx += sec), (room -= sec.length)
  }
  writeFileSync(join(bookDir, BRIEFING), head + idx + tail)
}

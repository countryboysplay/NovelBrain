import { existsSync, mkdirSync, renameSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { allMemories, daysBetween, knownBooks, listMemories, readMemory, scopeDir, writeMemory } from './files'
import { isExempt } from './indexes'
import { git } from './store'

export function recordUse(root: string, reads: string[], day: string): number {
  let n = 0
  const seen = new Set<string>()
  for (const p of reads) {
    const rel = relative(root, p)
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || seen.has(rel.toLowerCase())) continue
    seen.add(rel.toLowerCase())
    const m = readMemory(join(root, rel))
    if (!m) continue
    m.meta.used = day
    m.meta.uses += 1
    writeMemory(m)
    n++
  }
  return n
}

export function moveToArchive(root: string, file: string): void {
  const dest = join(root, 'archive', relative(root, file))
  mkdirSync(dirname(dest), { recursive: true })
  renameSync(file, dest)
}

export function archive(root: string, day: string): number {
  let n = 0
  for (const m of allMemories(root)) {
    if (isExempt(m.meta) || daysBetween(m.meta.used, day) <= 90) continue
    moveToArchive(root, m.file)
    n++
  }
  return n
}

export function splitSource(s: string): [string, string] {
  const m = /^(.*)@([0-9a-f]{4,40})$/.exec(s)
  return m ? [m[1], m[2]] : [s, '']
}

export async function lastHash(bookDir: string, file: string): Promise<string> {
  try {
    return (await git(bookDir, 'log', '-1', '--format=%h', '--', file)).trim()
  } catch {
    return ''
  }
}

export const refreshSources = (bookDir: string, sources: string[]): Promise<string[]> =>
  Promise.all(
    sources.map(async s => {
      const [file] = splitSource(s)
      const h = await lastHash(bookDir, file)
      return h ? `${file}@${h}` : file
    })
  )

// The distiller writes whatever path shape it saw in the transcript (often absolute, sometimes
// backslashed). Normalise before stamping so checkSources can compare like with like.
export function normalizeSource(bookDir: string, file: string): string {
  if (isAbsolute(file)) {
    const rel = relative(bookDir, file)
    if (!rel.startsWith('..') && !isAbsolute(rel)) return rel.replace(/\\/g, '/')
  }
  return file.replace(/\\/g, '/')
}

// The distiller has no shell, so it records paths and we add the commit it saw.
export async function stampSources(root: string, bookKey: string, bookDir: string): Promise<void> {
  for (const m of listMemories(scopeDir(root, 'book', bookKey))) {
    if (m.meta.sources.every(s => splitSource(s)[1])) continue
    m.meta.sources = await Promise.all(
      m.meta.sources.map(async s => {
        if (splitSource(s)[1]) return s
        const file = normalizeSource(bookDir, splitSource(s)[0])
        return (await refreshSources(bookDir, [file]))[0]
      })
    )
    writeMemory(m)
  }
}

export async function checkSources(root: string): Promise<string[]> {
  const recheck: string[] = []
  for (const { id, path: dir } of knownBooks(root)) {
    if (!existsSync(dir)) continue
    for (const m of listMemories(scopeDir(root, 'book', id))) {
      if (m.meta.stale) continue
      for (const src of m.meta.sources) {
        const [file, hash] = splitSource(src)
        if (!hash) continue // unstamped: the book isn't git-tracked, nothing to compare
        const now = existsSync(resolve(dir, file)) ? await lastHash(dir, file) : null
        const changed = now === null || (!!now && !now.startsWith(hash) && !hash.startsWith(now))
        if (!changed) continue
        m.meta.stale = true
        writeMemory(m)
        recheck.push(m.file)
        break
      }
    }
  }
  return recheck
}

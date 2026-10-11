import { lstatSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { Book, Character, parseFrontmatter, parseYamlText } from '../../shared/schemas'
import type { SeriesBook } from '../../shared/studio'
import { safeFile } from './studio'

function readBook(dir: string) {
  try { const r = Book.safeParse(parseYamlText(readFileSync(safeFile(dir, 'book.yaml')!, 'utf8'))); return r.success ? r.data : null } catch { return null }
}
function characterNames(dir: string): string[] {
  let names: string[] = []
  try { names = readdirSync(join(dir, 'bible', 'characters')).filter(n => /^CHAR-[A-Z0-9-]+\.md$/.test(n)).sort() } catch { return [] }
  return names.flatMap(n => {
    try { const r = Character.safeParse(parseFrontmatter(readFileSync(safeFile(dir, `bible/characters/${n}`)!, 'utf8'))?.data); return r.success ? [r.data.name] : [] } catch { return [] }
  })
}

// ponytail: reads sibling folders only; a series repo (series.yaml with books/) is read once series promotion exists (R7).
export function seriesBooks(bookDir: string): SeriesBook[] {
  const me = readBook(bookDir)
  if (!me) return []
  const key = me.series ?? me.id
  const parent = dirname(resolve(bookDir))
  let entries: string[] = []
  try { entries = readdirSync(parent) } catch { return [] }
  const books: SeriesBook[] = entries.flatMap(n => {
    const dir = join(parent, n)
    try { if (!lstatSync(dir).isDirectory()) return [] } catch { return [] }
    const b = readBook(dir)
    return b && (b.series ?? b.id) === key
      ? [{ id: b.id, title: b.title, status: b.status, dir, predecessor: b.predecessor, current: resolve(dir).toLowerCase() === resolve(bookDir).toLowerCase(), characters: characterNames(dir) }]
      : []
  })
  const byId = new Map(books.map(b => [b.id, b]))
  const depth = (b: SeriesBook, seen: Set<string> = new Set()): number =>
    b.predecessor && byId.has(b.predecessor) && !seen.has(b.id) ? 1 + depth(byId.get(b.predecessor)!, seen.add(b.id)) : 0
  return books.sort((a, b) => depth(a) - depth(b) || a.title.localeCompare(b.title))
}

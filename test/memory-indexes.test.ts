import { expect, test } from 'vitest'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeMemory, type Meta } from '../src/main/memory/files'
import { rebuildIndexes, writeBriefing } from '../src/main/memory/indexes'
import { archive } from '../src/main/memory/maintain'

const day = '2026-10-04'
const m = (name: string, type: Meta['type'], used = day): Meta => ({ name, type, summary: `${name} summary`, sources: [], verified: day, used, uses: 0, stale: false, pinned: false, status: 'live', by: '', rules: [], quiet: 0, hits: 0, live: '' })
function book(id: string, series: string | null) {
  const d = mkdtempSync(join(tmpdir(), 'nb-brief-'))
  mkdirSync(join(d, '.novelbrain'))
  writeFileSync(join(d, 'book.yaml'), `id: ${id}\nseries: ${series ?? 'null'}\n`)
  return d
}

test('a sequel gets writer and series memory but not the predecessor book memory', () => {
  const root = mkdtempSync(join(tmpdir(), 'nb-mem-'))
  writeMemory({ file: join(root, 'topics', 'short-chapters.md'), meta: m('short-chapters', 'preference'), body: 'x' })
  writeMemory({ file: join(root, 'series', 'first', 'topics', 'clipped.md'), meta: m('clipped', 'voice'), body: 'x' })
  writeMemory({ file: join(root, 'books', 'first', 'topics', 'filter-words.md'), meta: m('filter-words', 'catch'), body: 'Cut "she saw".' })
  rebuildIndexes(root, 60, day)
  const first = book('first', null), sequel = book('second', 'first')
  writeBriefing(root, first, 60, day)
  writeBriefing(root, sequel, 60, day)
  const a = readFileSync(join(first, '.novelbrain', 'memory.md'), 'utf8')
  const b = readFileSync(join(sequel, '.novelbrain', 'memory.md'), 'utf8')
  for (const s of ['short-chapters', 'clipped', 'filter-words', 'Cut "she saw".']) expect(a).toContain(s)
  expect(b).toContain('short-chapters')
  expect(b).toContain('clipped')
  expect(b).not.toContain('filter-words')
})
test('decayed memories leave the index and the briefing; preferences never decay', () => {
  const root = mkdtempSync(join(tmpdir(), 'nb-mem-'))
  writeMemory({ file: join(root, 'topics', 'old-craft.md'), meta: m('old-craft', 'craft', '2026-08-01'), body: 'x' })
  writeMemory({ file: join(root, 'topics', 'old-pref.md'), meta: m('old-pref', 'preference', '2026-08-01'), body: 'x' })
  rebuildIndexes(root, 60, day)
  const idx = readFileSync(join(root, 'INDEX.md'), 'utf8')
  expect(idx).toContain('old-pref')
  expect(idx).not.toContain('old-craft')
})
test('no memories gives a short briefing; no .novelbrain folder writes nothing', () => {
  const root = mkdtempSync(join(tmpdir(), 'nb-mem-'))
  const b = book('x', null)
  writeBriefing(root, b, 60, day)
  expect(readFileSync(join(b, '.novelbrain', 'memory.md'), 'utf8')).toContain('No lessons yet.')
  const bare = mkdtempSync(join(tmpdir(), 'nb-brief-'))
  writeFileSync(join(bare, 'book.yaml'), 'id: y\nseries: null\n')
  expect(() => writeBriefing(root, bare, 60, day)).not.toThrow()
})

// Ruling 3: a book.yaml without valid scope keys gives no briefing.
test('a book without valid keys gets no briefing', () => {
  const root = mkdtempSync(join(tmpdir(), 'nb-mem-'))
  writeMemory({ file: join(root, 'topics', 'p.md'), meta: m('p', 'preference'), body: 'x' })
  const b = book('Not A Slug', null)
  writeBriefing(root, b, 60, day)
  expect(() => readFileSync(join(b, '.novelbrain', 'memory.md'))).toThrow()
})

// SessionStart hook output is capped at 10,000 characters; catches take priority over index lines.
test('the briefing stays within 9,000 characters and keeps every catch over index lines', () => {
  const root = mkdtempSync(join(tmpdir(), 'nb-mem-'))
  for (let i = 0; i < 60; i++)
    writeMemory({ file: join(root, 'books', 'big', 'topics', `l${i}.md`), meta: { ...m(`l${i}`, 'craft'), summary: `l${i} ${'s'.repeat(200)}` }, body: 'x' })
  for (let i = 0; i < 3; i++) writeMemory({ file: join(root, 'books', 'big', 'topics', `c${i}.md`), meta: m(`c${i}`, 'catch'), body: `catch-body-${i} ${'b'.repeat(1000)}` })
  const b = book('big', null)
  writeBriefing(root, b, 200, day)
  const text = readFileSync(join(b, '.novelbrain', 'memory.md'), 'utf8')
  expect(text.length).toBeLessThanOrEqual(9000)
  for (let i = 0; i < 3; i++) expect(text).toContain(`catch-body-${i}`)
  expect(text).toContain('## This book')
  expect(text).not.toContain('## Writer') // empty scope headings are left out
})
test('catches are cut at whole blocks, never mid-block', () => {
  const root = mkdtempSync(join(tmpdir(), 'nb-mem-'))
  for (let i = 0; i < 5; i++) writeMemory({ file: join(root, 'topics', `c${i}.md`), meta: m(`c${i}`, 'catch'), body: `${'b'.repeat(1500)}END${i}` })
  const b = book('cut', null)
  writeBriefing(root, b, 60, day)
  const text = readFileSync(join(b, '.novelbrain', 'memory.md'), 'utf8')
  const shown = text.split('### ').length - 1
  expect(shown).toBe(3) // 4 blocks would pass 6,000
  expect((text.match(/END\d/g) ?? []).length).toBe(shown)
})
test('an old catch never decays: it stays out of the archive and in the briefing', () => {
  const root = mkdtempSync(join(tmpdir(), 'nb-mem-'))
  writeMemory({ file: join(root, 'books', 'old', 'topics', 'filter-words.md'), meta: m('filter-words', 'catch', '2026-06-26'), body: 'Cut "she saw".' })
  expect(archive(root, day)).toBe(0) // 100 days unused
  const b = book('old', null)
  writeBriefing(root, b, 60, day)
  expect(readFileSync(join(b, '.novelbrain', 'memory.md'), 'utf8')).toContain('Cut "she saw".')
})
test('an archived book gets no briefing', () => {
  const root = mkdtempSync(join(tmpdir(), 'nb-mem-'))
  const b = book('old', null)
  writeFileSync(join(b, 'book.yaml'), 'id: old\nseries: null\nstatus: archived\n')
  writeBriefing(root, b, 60, day)
  expect(existsSync(join(b, '.novelbrain', 'memory.md'))).toBe(false)
})
test('an old voice lesson never decays: it stays out of the archive and in the index', () => {
  const root = mkdtempSync(join(tmpdir(), 'nb-mem-'))
  writeMemory({ file: join(root, 'series', 'first', 'topics', 'clipped.md'), meta: m('clipped', 'voice', '2026-06-26'), body: 'x' })
  expect(archive(root, day)).toBe(0) // 100 days unused
  rebuildIndexes(root, 60, day)
  expect(readFileSync(join(root, 'series', 'first', 'INDEX.md'), 'utf8')).toContain('clipped')
})

test('lessons on probation stay out of the briefing and are marked in the index', () => {
  const root = mkdtempSync(join(tmpdir(), 'nb-mem-'))
  writeMemory({ file: join(root, 'books', 'first', 'topics', 'sure.md'), meta: m('sure', 'catch'), body: 'Cut "she saw".' })
  writeMemory({ file: join(root, 'books', 'first', 'topics', 'maybe.md'), meta: { ...m('maybe', 'catch'), status: 'probation', by: 'haiku' }, body: 'Maybe cut adverbs.' })
  writeMemory({ file: join(root, 'topics', 'odd.md'), meta: { ...m('odd', 'craft'), status: 'probation', by: 'haiku' }, body: 'Odd idea.' })
  rebuildIndexes(root, 60, day)
  const first = book('first', null)
  writeBriefing(root, first, 60, day)
  const brief = readFileSync(join(first, '.novelbrain', 'memory.md'), 'utf8')
  expect(brief).toContain('Cut "she saw".')
  for (const s of ['maybe', 'Maybe cut adverbs.', 'odd']) expect(brief).not.toContain(s)
  expect(readFileSync(join(root, 'books', 'first', 'INDEX.md'), 'utf8')).toMatch(/\[maybe\].*\(on probation\)/)
})

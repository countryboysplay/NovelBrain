import { describe, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bookKeys, bookPath, lessonViews, listMemories, readMemory, scopeDir, serialize, writeBookPath, writeMemory, type Meta } from '../src/main/memory/files'

const meta: Meta = { name: 'clipped-dialogue', type: 'voice', summary: 'Dialogue runs clipped', sources: [], verified: '2026-10-04', used: '2026-10-04', uses: 0, stale: false, pinned: false, status: 'live', by: '', rules: [], quiet: 0, hits: 0, live: '' }
const book = (yaml: string) => {
  const d = mkdtempSync(join(tmpdir(), 'nb-mem-book-'))
  writeFileSync(join(d, 'book.yaml'), yaml)
  return d
}

describe('memory files', () => {
  test('round-trips a memory file', () => {
    const root = mkdtempSync(join(tmpdir(), 'nb-mem-'))
    const file = join(root, 'topics', 'clipped-dialogue.md')
    writeMemory({ file, meta, body: 'Keep lines short.\n' })
    expect(readMemory(file)).toEqual({ file, meta, body: 'Keep lines short.\n' })
  })
  test('rejects an unknown type', () => {
    const root = mkdtempSync(join(tmpdir(), 'nb-mem-'))
    mkdirSync(join(root, 'topics'))
    writeFileSync(join(root, 'topics', 'x.md'), serialize({ ...meta, type: 'project' as never }, 'x'))
    expect(listMemories(root)).toEqual([])
  })
  test('a writer root inside a folder named books still lists user.md', () => {
    const root = join(mkdtempSync(join(tmpdir(), 'nb-mem-')), 'books', 'memory')
    writeMemory({ file: join(root, 'user.md'), meta, body: 'x' })
    expect(listMemories(root).map(m => m.file)).toEqual([join(root, 'user.md')])
  })
  test('series key falls back to the book id, so a sequel shares it', () => {
    expect(bookKeys(book('id: first\nseries: null\n'))).toEqual({ book: 'first', series: 'first' })
    expect(bookKeys(book('id: second\nseries: first\n'))).toEqual({ book: 'second', series: 'first' })
    expect(bookKeys(book(': not yaml ['))).toBeNull()
  })
  test('keys that are not book-id slugs give no keys', () => {
    expect(bookKeys(book('id: ok\nseries: ../../x\n'))).toBeNull()
    expect(bookKeys(book('id: ok\nseries: "A: B"\n'))).toBeNull()
    expect(bookKeys(book('id: ../evil\n'))).toBeNull()
    expect(bookKeys(book('id: Bad\n'))).toBeNull()
  })
  test('scopeDir throws on a key that is not a slug', () => {
    for (const k of ['../../x', 'A: B', 'a/b', 'a\\b', '', 'CON.', 'Up']) {
      expect(() => scopeDir('/m', 'series', k)).toThrow()
      expect(() => scopeDir('/m', 'book', k)).toThrow()
    }
  })
  test('scope folders', () => {
    expect(scopeDir('/m', 'writer')).toBe('/m')
    expect(scopeDir('/m', 'series', 's').replace(/\\/g, '/')).toBe('/m/series/s')
    expect(scopeDir('/m', 'book', 'b').replace(/\\/g, '/')).toBe('/m/books/b')
  })
  test('book paths cannot escape the books folder', () => {
    const root = mkdtempSync(join(tmpdir(), 'nb-mem-'))
    mkdirSync(join(root, 'x'))
    for (const d of [root, join(root, 'x')]) writeFileSync(join(d, 'book.json'), JSON.stringify({ path: 'C:/escaped' }))
    expect(bookPath(root, '../x')).toBeNull()
    expect(bookPath(root, '..')).toBeNull()
    expect(() => writeBookPath(root, '../x', 'C:/b')).toThrow()
  })
})

test('a lesson file from before the audit reads as live; rules keep only skill rule ids', () => {
  const root = mkdtempSync(join(tmpdir(), 'nb-mem-'))
  mkdirSync(join(root, 'topics'))
  const file = join(root, 'topics', 'old.md')
  writeFileSync(file, '---\nname: old\ntype: catch\nsummary: s\nsources: []\nverified: 2026-10-04\nrules: [SK-ENG-04, CHAR-AB-12, FACT-003, MG-CON-02, LOC-MILL-01, AB-CH-12, AB-CHAR-12, SK-LOC-12, AB-ACT-12, GATE-DRAFT-03]\n---\nx\n')
  expect(readMemory(file)!.meta).toMatchObject({ status: 'live', by: '', rules: ['SK-ENG-04', 'MG-CON-02', 'GATE-DRAFT-03'], quiet: 0, hits: 0, live: '' })
})
test('status, by, live and the evidence counters round-trip', () => {
  const root = mkdtempSync(join(tmpdir(), 'nb-mem-'))
  const file = join(root, 'topics', 'p.md')
  const m = { ...meta, name: 'p', status: 'probation' as const, by: 'haiku', rules: ['SK-ENG-04'], quiet: 2, hits: 1, live: '2026-10-01' }
  writeMemory({ file, meta: m, body: 'x\n' })
  expect(readMemory(file)!.meta).toEqual(m)
})
test('lessonViews lists the open book three scopes, and only the writer scope with no book', () => {
  const root = mkdtempSync(join(tmpdir(), 'nb-mem-'))
  writeMemory({ file: join(root, 'topics', 'w.md'), meta: { ...meta, name: 'w' }, body: 'x' })
  writeMemory({ file: join(root, 'series', 'first', 'topics', 's.md'), meta: { ...meta, name: 's' }, body: 'x' })
  writeMemory({ file: join(root, 'books', 'first', 'topics', 'b.md'), meta: { ...meta, name: 'b', type: 'catch', status: 'probation' }, body: 'x' })
  writeMemory({ file: join(root, 'books', 'first', 'topics', 'c.md'), meta: { ...meta, name: 'c', type: 'catch', summary: 'Cut filters', rules: ['SK-ENG-04'], live: '2026-10-02' }, body: 'x' })
  writeMemory({ file: join(root, 'books', 'other', 'topics', 'o.md'), meta: { ...meta, name: 'o' }, body: 'x' })
  const views = lessonViews(root, book('id: first\nseries: null\n'))
  expect(views.map(v => `${v.scope} ${v.file} ${v.status}`).sort()).toEqual([
    'book books/first/topics/b.md probation', 'book books/first/topics/c.md live', 'series series/first/topics/s.md live', 'writer topics/w.md live'
  ])
  expect(views.find(v => v.name === 'c')).toEqual({ file: 'books/first/topics/c.md', scope: 'book', name: 'c', type: 'catch', summary: 'Cut filters', status: 'live', live: '2026-10-02', targets: ['SK-ENG-04'] })
  expect(views.find(v => v.name === 'w')).not.toHaveProperty('live')
  expect(views.find(v => v.name === 'w')).not.toHaveProperty('targets')
  expect(lessonViews(root, null).map(v => v.name)).toEqual(['w'])
})

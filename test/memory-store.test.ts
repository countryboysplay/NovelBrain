import { describe, it, test, expect } from 'vitest'
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { commit, enqueue, ensureRepo, git, readQueue, readState, removeJob, writeState, addLog } from '../src/main/memory/store'

const fresh = () => mkdtempSync(join(tmpdir(), 'nb-store-'))

describe('repo', () => {
  it('initialises once, ignoring machine-local files', async () => {
    const root = fresh()
    await ensureRepo(root)
    await ensureRepo(root)
    expect(existsSync(join(root, '.git'))).toBe(true)
    for (const d of ['topics', 'series', 'books', 'skills', 'inbox']) expect(existsSync(join(root, d))).toBe(true)
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toBe('.state.json\n.queue\n')
    expect((await git(root, 'log', '--oneline')).trim().split('\n')).toHaveLength(1)
  })
  it('restores a deleted .gitignore, untracks the state files and commits it', async () => {
    const root = fresh()
    await ensureRepo(root)
    rmSync(join(root, '.gitignore'))
    writeFileSync(join(root, '.state.json'), '{}')
    await commit(root, 'state slipped in')
    await ensureRepo(root)
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toBe('.state.json\n.queue\n')
    expect(await git(root, 'ls-files')).not.toContain('.state.json')
    expect((await git(root, 'log', '-1', '--format=%s')).trim()).toBe('Restore .gitignore')
    expect((await git(root, 'status', '--porcelain')).trim()).toBe('')
  })
  it('commits only when something changed', async () => {
    const root = fresh()
    await ensureRepo(root)
    expect(await commit(root, 'nothing')).toBe(false)
    writeFileSync(join(root, 'topics', 'a.md'), 'x')
    writeFileSync(join(root, '.state.json'), '{}')
    expect(await commit(root, 'add a')).toBe(true)
    expect((await git(root, 'status', '--porcelain')).trim()).toBe('')
  })
})

describe('state', () => {
  it('falls back to defaults when missing or corrupt', () => {
    const root = fresh()
    expect(readState(root)).toEqual({ offsets: {}, runs: { day: '', count: 0 }, spentUsd: 0, inFlight: null, log: [], evidenced: [], keptSkills: [], hitIn: {} })
    writeFileSync(join(root, '.state.json'), '{bad')
    expect(readState(root).spentUsd).toBe(0)
  })
  it('round-trips', () => {
    const root = fresh()
    writeState(root, { offsets: { a: 5 }, runs: { day: '2026-09-24', count: 2 }, spentUsd: 1.25, inFlight: 'x', log: [], evidenced: ['b|CH-01'], keptSkills: ['chase'], hitIn: { 'books/b/topics/x.md': ['CH-01'] } })
    expect(readState(root)).toEqual({ offsets: { a: 5 }, runs: { day: '2026-09-24', count: 2 }, spentUsd: 1.25, inFlight: 'x', log: [], evidenced: ['b|CH-01'], keptSkills: ['chase'], hitIn: { 'books/b/topics/x.md': ['CH-01'] } })
  })
  test('a non-number runs.usd reads as undefined', () => {
    const root = mkdtempSync(join(tmpdir(), 'nb-mem-'))
    writeFileSync(join(root, '.state.json'), JSON.stringify({ runs: { day: '2026-10-04', count: 3, usd: 'lots' } }))
    expect(readState(root).runs).toEqual({ day: '2026-10-04', count: 3 })
    writeFileSync(join(root, '.state.json'), JSON.stringify({ runs: { day: '2026-10-04', count: 3, usd: 1.5 } }))
    expect(readState(root).runs.usd).toBe(1.5)
  })
  test('state defaults spentUsd to 0 for an old file', () => {
    const root = mkdtempSync(join(tmpdir(), 'nb-mem-'))
    writeFileSync(join(root, '.state.json'), JSON.stringify({ offsets: {}, runs: { day: '2026-10-04', count: 3 } }))
    expect(readState(root)).toMatchObject({ runs: { day: '2026-10-04', count: 3 }, spentUsd: 0, inFlight: null })
  })
})

describe('queue', () => {
  it('dedupes by normalized path and skips bad lines', () => {
    const root = fresh()
    enqueue(root, { kind: 'distill', transcript: 'C:\\t\\A.jsonl', book: 'C:\\b' })
    appendFileSync(join(root, '.queue'), 'not json\n{"kind":"other"}\n')
    enqueue(root, { kind: 'distill', transcript: 'c:/t/a.jsonl', book: 'C:\\b' })
    enqueue(root, { kind: 'recheck', file: 'C:\\m\\x.md' })
    expect(readQueue(root)).toEqual([
      { kind: 'distill', transcript: 'C:\\t\\A.jsonl', book: 'C:\\b' },
      { kind: 'recheck', file: 'C:\\m\\x.md' }
    ])
  })
  it('removes one job and keeps the rest', () => {
    const root = fresh()
    enqueue(root, { kind: 'distill', transcript: 'C:\\t\\a.jsonl', book: 'C:\\b' })
    enqueue(root, { kind: 'distill', transcript: 'C:\\t\\b.jsonl', book: 'C:\\b' })
    removeJob(root, { kind: 'distill', transcript: 'C:\\t\\a.jsonl', book: 'C:\\b' })
    expect(readQueue(root)).toEqual([{ kind: 'distill', transcript: 'C:\\t\\b.jsonl', book: 'C:\\b' }])
  })
  it('is empty when the file is missing', () => expect(readQueue(fresh())).toEqual([]))
  test('queue drops malformed lines and duplicates, keyed by kind and target', () => {
    const root = mkdtempSync(join(tmpdir(), 'nb-mem-'))
    enqueue(root, { kind: 'distill', transcript: 'C:/t/a.jsonl', book: 'C:/b' })
    enqueue(root, { kind: 'distill', transcript: 'c:/T/A.jsonl', book: 'C:/b' })
    enqueue(root, { kind: 'deep', book: 'C:/b', act: 'ACT-1' })
    appendFileSync(join(root, '.queue'), '{oops\n{"kind":"deep","book":"C:/b"}\n')
    expect(readQueue(root)).toEqual([
      { kind: 'distill', transcript: 'C:/t/a.jsonl', book: 'C:/b' },
      { kind: 'deep', book: 'C:/b', act: 'ACT-1' }
    ])
  })
})
test('audit jobs need a book; at is a chapter or act id; duplicates collapse', () => {
  const root = mkdtempSync(join(tmpdir(), 'nb-mem-'))
  enqueue(root, { kind: 'audit', book: 'C:/b', at: 'CH-01' })
  enqueue(root, { kind: 'audit', book: 'C:/b' })
  enqueue(root, { kind: 'audit', book: 'c:/B', at: 'CH-01' })
  appendFileSync(join(root, '.queue'), '{"kind":"audit","book":"C:/b","at":"../x"}\n{"kind":"audit"}\n{"kind":"audit","book":"C:/b","at":"ACT-2"}\n')
  expect(readQueue(root)).toEqual([
    { kind: 'audit', book: 'C:/b', at: 'CH-01' },
    { kind: 'audit', book: 'C:/b' },
    { kind: 'audit', book: 'C:/b', at: 'ACT-2' }
  ])
})
test('an old state file gets empty audit fields; malformed log entries are dropped; the log keeps the last 200', () => {
  const root = mkdtempSync(join(tmpdir(), 'nb-mem-'))
  const good = { at: '2026-10-04T10:00:00.000Z', book: 'b', checkpoint: 'CH-01', lesson: 'x', action: 'added' as const, reason: 'r', by: 'sonnet' }
  writeFileSync(join(root, '.state.json'), JSON.stringify({ offsets: {}, runs: { day: '2026-10-04', count: 1 }, log: [good, { ...good, action: 'eaten' }, { at: 1 }], evidenced: ['x', 2] }))
  const s = readState(root)
  expect(s).toMatchObject({ log: [good], evidenced: ['x'], keptSkills: [] })
  addLog(s, Array.from({ length: 250 }, (_, i) => ({ ...good, lesson: `l${i}` })))
  expect(s.log).toHaveLength(200)
  expect(s.log[0].lesson).toBe('l50')
  expect(readState(mkdtempSync(join(tmpdir(), 'nb-mem-')))).toMatchObject({ log: [], evidenced: [], keptSkills: [] })
})

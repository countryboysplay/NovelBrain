import { describe, it, expect } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readMemory, writeBookPath, writeMemory, type Meta } from '../src/main/memory/files'
import { archive, checkSources, recordUse, splitSource, stampSources } from '../src/main/memory/maintain'
import { git } from '../src/main/memory/store'

const DAY = '2026-09-24'
const meta = (over: Partial<Meta> = {}): Meta => ({
  name: 'a', type: 'craft', summary: 's', sources: [], verified: '2026-09-20', used: '2026-09-20', uses: 0, stale: false, pinned: false, status: 'live', by: '', rules: [], quiet: 0, hits: 0, live: '', ...over
})
const fresh = (p: string) => mkdtempSync(join(tmpdir(), p))
const gitc = (cwd: string, ...a: string[]) => git(cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a)

async function bookRepo() {
  const dir = fresh('nb-book-')
  await git(dir, 'init', '-q')
  writeFileSync(join(dir, 'app.md'), 'v1')
  await gitc(dir, 'add', '-A')
  await gitc(dir, 'commit', '-q', '-m', 'v1')
  return dir
}

describe('splitSource', () => {
  it('splits a trailing hash only', () => {
    expect(splitSource('src/a.ts@abc1234')).toEqual(['src/a.ts', 'abc1234'])
    expect(splitSource('node_modules/@lydell/x.js')).toEqual(['node_modules/@lydell/x.js', ''])
  })
})

describe('recordUse', () => {
  it('bumps used and uses for memory files that were read, once per slice', () => {
    const root = fresh('nb-m-')
    const f = join(root, 'topics', 'a.md')
    writeMemory({ file: f, meta: meta(), body: '' })
    expect(recordUse(root, [f, f, 'C:\\elsewhere\\x.md'], DAY)).toBe(1)
    expect(readMemory(f)!.meta).toMatchObject({ used: DAY, uses: 1 })
  })
})

describe('archive', () => {
  it('moves memories unused for over 90 days, except exempt ones', () => {
    const root = fresh('nb-m-')
    writeMemory({ file: join(root, 'topics', 'old.md'), meta: meta({ name: 'old', used: '2026-06-01' }), body: '' })
    writeMemory({ file: join(root, 'topics', 'me.md'), meta: meta({ name: 'me', type: 'preference', used: '2026-01-01' }), body: '' })
    writeMemory({ file: join(root, 'books', 'b', 'topics', 'old.md'), meta: meta({ name: 'old', used: '2026-06-01' }), body: '' })
    expect(archive(root, DAY)).toBe(2)
    expect(existsSync(join(root, 'archive', 'topics', 'old.md'))).toBe(true)
    expect(existsSync(join(root, 'archive', 'books', 'b', 'topics', 'old.md'))).toBe(true)
    expect(existsSync(join(root, 'topics', 'me.md'))).toBe(true)
  })
})

describe('sources', () => {
  it('stamps hashes, then flags changed and deleted sources once', async () => {
    const proj = await bookRepo()
    const root = fresh('nb-m-')
    writeBookPath(root, 'p', proj)
    const f = join(root, 'books', 'p', 'topics', 'a.md')
    writeMemory({ file: f, meta: meta({ sources: ['app.md'] }), body: '' })
    await stampSources(root, 'p', proj)
    expect(readMemory(f)!.meta.sources[0]).toMatch(/^app\.md@[0-9a-f]{7,}$/)
    expect(await checkSources(root)).toEqual([])

    writeFileSync(join(proj, 'app.md'), 'v2')
    await gitc(proj, 'commit', '-qam', 'v2')
    expect(await checkSources(root)).toEqual([f])
    expect(readMemory(f)!.meta.stale).toBe(true)
    expect(await checkSources(root)).toEqual([]) // already stale, not re-queued

    const g = join(root, 'books', 'p', 'topics', 'b.md')
    writeMemory({ file: g, meta: meta({ name: 'b', sources: ['gone.md@abc1234'] }), body: '' })
    expect(await checkSources(root)).toEqual([g])
  })
  it('skips books whose folder is missing on this machine', async () => {
    const root = fresh('nb-m-')
    writeBookPath(root, 'p', 'C:\\no\\such\\dir')
    writeMemory({ file: join(root, 'books', 'p', 'topics', 'a.md'), meta: meta({ sources: ['x@abc1234'] }), body: '' })
    expect(await checkSources(root)).toEqual([])
    rmSync(root, { recursive: true, force: true })
  })
  it('does not flag unhashed sources in a book that is not git-tracked', async () => {
    const proj = fresh('nb-nogit-')
    const root = fresh('nb-m-')
    writeBookPath(root, 'p', proj)
    const f = join(root, 'books', 'p', 'topics', 'a.md')
    writeMemory({ file: f, meta: meta({ sources: ['missing.md'] }), body: '' })
    expect(await checkSources(root)).toEqual([])
    expect(readMemory(f)!.meta.stale).toBe(false)
  })
  it('stamps an absolute source path and does not flag it stale when unchanged', async () => {
    const proj = await bookRepo()
    const root = fresh('nb-m-')
    writeBookPath(root, 'p', proj)
    const f = join(root, 'books', 'p', 'topics', 'a.md')
    writeMemory({ file: f, meta: meta({ sources: [join(proj, 'app.md')] }), body: '' })
    await stampSources(root, 'p', proj)
    expect(readMemory(f)!.meta.sources[0]).toMatch(/^app\.md@[0-9a-f]{7,}$/)
    expect(await checkSources(root)).toEqual([])
  })
  it('stamps a backslash relative source path', async () => {
    const proj = fresh('nb-book-')
    await git(proj, 'init', '-q')
    mkdirSync(join(proj, 'canon'), { recursive: true })
    writeFileSync(join(proj, 'canon', 'app.md'), 'v1')
    await gitc(proj, 'add', '-A')
    await gitc(proj, 'commit', '-q', '-m', 'v1')
    const root = fresh('nb-m-')
    writeBookPath(root, 'p', proj)
    const f = join(root, 'books', 'p', 'topics', 'a.md')
    writeMemory({ file: f, meta: meta({ sources: ['canon\\app.md'] }), body: '' })
    await stampSources(root, 'p', proj)
    expect(readMemory(f)!.meta.sources[0]).toMatch(/^canon\/app\.md@[0-9a-f]{7,}$/)
  })
})

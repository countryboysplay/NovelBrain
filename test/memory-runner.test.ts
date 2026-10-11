import { beforeEach, expect, test, vi } from 'vitest'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { spawn, type ChildProcess } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { MemoryRunner, type Call } from '../src/main/memory/runner'
import { enqueue, readQueue, readState, writeState, git } from '../src/main/memory/store'
import { liveRuns, runKey } from '../src/main/run/state'
import { readMemory, slugFor, writeMemory, type Meta } from '../src/main/memory/files'
import { rebuildIndexes } from '../src/main/memory/indexes'

const fail = vi.hoisted(() => ({ indexes: false, rollback: false, apply: false, commit: (_message: string): boolean => false }))
vi.mock('../src/main/memory/store', async orig => {
  const m = await orig<typeof import('../src/main/memory/store')>()
  // Like a git commit that dies after commit()'s `add -A`: the changes are left staged.
  return { ...m, commit: async (root: string, message: string) => { if (!fail.commit(message)) return m.commit(root, message); await m.git(root, 'add', '-A'); throw new Error('commit failed') } }
})
vi.mock('../src/main/memory/audit', async orig => {
  const m = await orig<typeof import('../src/main/memory/audit')>()
  return { ...m, applyVerdicts: (...a: Parameters<typeof m.applyVerdicts>) => { if (fail.apply) throw new Error('SKILL.md vanished'); return m.applyVerdicts(...a) } }
})
vi.mock('../src/main/memory/validate', async orig => {
  const m = await orig<typeof import('../src/main/memory/validate')>()
  return { ...m, rollback: (root: string) => (fail.rollback ? Promise.reject(new Error('index.lock held')) : m.rollback(root)) }
})
vi.mock('../src/main/memory/indexes', async orig => {
  const m = await orig<typeof import('../src/main/memory/indexes')>()
  return { ...m, rebuildIndexes: (...a: Parameters<typeof m.rebuildIndexes>) => { if (fail.indexes) throw new Error('disk full'); return m.rebuildIndexes(...a) } }
})

const day = '2026-10-04'
const lesson = (name: string, body: string, type = 'catch') =>
  `---\nname: ${name}\ntype: ${type}\nsummary: s\nsources: []\nverified: ${day}\nused: ${day}\nuses: 0\nstale: false\npinned: false\n---\n${body}\n`
let root: string, projects: string, bookDir: string
const settings = () => ({ model: 'haiku', deepModel: 'sonnet', auditModel: 'sonnet', deepAuditModel: 'opus', indexCap: 60 })
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function transcript(chars = 9000) {
  const dir = join(projects, slugFor(bookDir))
  mkdirSync(dir, { recursive: true })
  const f = join(dir, `${Math.random().toString(36).slice(2)}.jsonl`)
  writeFileSync(f, `${JSON.stringify({ type: 'user', cwd: bookDir, message: { content: 'x'.repeat(chars) } })}\n`)
  return f
}
const writes = (rel: string, text: string): Call => async () => {
  mkdirSync(join(root, rel, '..'), { recursive: true })
  writeFileSync(join(root, rel), text)
  return { result: 'changed', costUsd: 0.01 }
}
let audits: { model: string; prompt: string }[] = []
// The auditor gives every lesson and skill on probation one verdict; every other call is c.
const keeping = (c: Call, verdict = 'KEEP'): Call => async (p, o) => {
  if (!p.startsWith('AUDIT')) return c(p, o)
  audits.push({ model: o.model, prompt: p })
  const items = [...p.matchAll(/^### (?:PROBATION|SKILL) (\S+)$/gm)].map(m => ({ lesson: m[1], verdict, reason: 'Holds across scenes.', body: 'Rewritten.' }))
  return { result: JSON.stringify(items), costUsd: 0.02 }
}
const base = (name: string, over: Partial<Meta> = {}): Meta => ({ name, type: 'catch', summary: 's', sources: [], verified: day, used: day, uses: 0, stale: false, pinned: false, status: 'live', by: '', rules: [], quiet: 0, hits: 0, live: day, ...over })
const seedCommit = async () => { await git(root, 'add', '-A'); await git(root, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'seed') }
const chapters = (n: number) => {
  mkdirSync(join(bookDir, 'outline'), { recursive: true })
  const p = (i: number) => String(i).padStart(2, '0')
  writeFileSync(join(bookDir, 'outline', 'outline.yaml'), `acts:\n  - id: ACT-1\n    title: A\n    chapters:\n${Array.from({ length: n }, (_, i) => `      - { id: CH-${p(i + 1)}, title: C, scenes: [SC-0${p(i + 1)}] }\n`).join('')}`)
}
const flag = (scene: string, rule: string) => {
  mkdirSync(join(bookDir, 'reviews', scene), { recursive: true })
  writeFileSync(join(bookDir, 'reviews', scene, 'line.md'), `---\nscene: ${scene}\nreviewer: line\nround: 1\nverdict: FLAG\n---\n\n1. FLAG. Rule: ${rule}\n   Quote: "x"\n   Problem: y\n   Fix: z\n`)
}

beforeEach(() => {
  audits = []
  root = mkdtempSync(join(tmpdir(), 'nb-mr-'))
  projects = mkdtempSync(join(tmpdir(), 'nb-mr-proj-'))
  bookDir = mkdtempSync(join(tmpdir(), 'nb-mr-book-'))
  mkdirSync(join(bookDir, '.novelbrain'))
  writeFileSync(join(bookDir, 'book.yaml'), 'id: first\nseries: null\n')
})

test('a valid distill is committed, indexed, briefed and costed', async () => {
  transcript()
  const r = new MemoryRunner({ root, claudeProjects: projects, settings, call: keeping(writes('books/first/topics/filter-words.md', lesson('filter-words', 'Cut "she saw".'))), today: () => day })
  await r.init()
  await r.addBook(bookDir)
  expect(await git(root, 'log', '--format=%s')).toMatch(/Distill/)
  expect(readFileSync(join(root, 'books', 'first', 'INDEX.md'), 'utf8')).toContain('filter-words')
  expect(readFileSync(join(bookDir, '.novelbrain', 'memory.md'), 'utf8')).toContain('Cut "she saw".')
  expect(r.status()).toMatchObject({ runsToday: 2, spentUsd: 0.03, queued: 0 })
})

test('memory spending today is counted, and a new day starts at zero', async () => {
  transcript()
  const r = new MemoryRunner({ root, claudeProjects: projects, settings, call: async () => ({ result: 'no changes', costUsd: 0.02 }), today: () => day })
  await r.init(); await r.addBook(bookDir)
  expect(r.status()).toMatchObject({ runsToday: 1, spentUsd: 0.02, spentToday: 0.02 })
  const s = readState(root); s.runs = { day: '2026-10-03', count: 5, usd: 3 }; writeState(root, s)
  expect(r.status()).toMatchObject({ runsToday: 0, spentToday: 0 })
})

test('a story fact rolls the whole distill back', async () => {
  transcript()
  const r = new MemoryRunner({ root, claudeProjects: projects, settings, call: writes('books/first/topics/x.md', lesson('x', 'In SC-004 the gun was gone.')), today: () => day })
  await r.init(); await r.addBook(bookDir)
  expect(existsSync(join(root, 'books', 'first', 'topics', 'x.md'))).toBe(false)
  expect(r.log.join('\n')).toMatch(/story fact/)
})

test('a routine distill may not propose a skill', async () => {
  transcript()
  const skill = '---\nname: cut-filters\ndescription: Use when filter words pile up\n---\nCut them.\n'
  const r = new MemoryRunner({ root, claudeProjects: projects, settings, call: writes('inbox/cut-filters/SKILL.md', skill), today: () => day })
  await r.init(); await r.addBook(bookDir)
  expect(existsSync(join(root, 'inbox', 'cut-filters'))).toBe(false)
  expect(r.log.join('\n')).toMatch(/only the deep pass/)
})

test('a short batch advances offsets with no call', async () => {
  const f = transcript(100)
  let calls = 0
  const r = new MemoryRunner({ root, claudeProjects: projects, settings, call: async () => { calls++; return { result: '', costUsd: 0 } }, today: () => day })
  await r.init(); await r.addBook(bookDir)
  expect(calls).toBe(0)
  expect(readQueue(root).length).toBe(0)
  expect(Object.values(readState(root).offsets)).toContain(readFileSync(f).length)
})

test('jobs of a book with a live run wait until its chapter flush', async () => {
  let calls = 0
  const r = new MemoryRunner({ root, claudeProjects: projects, settings, call: async () => { calls++; return { result: 'no changes', costUsd: 0 } }, today: () => day })
  await r.init(); await r.addBook(bookDir)
  liveRuns.add(runKey(bookDir))
  try {
    transcript(); transcript()
    await r.addBook(bookDir) // scan only; the run is live
    expect(calls).toBe(0)
    await r.flush(bookDir, 'chapter')
    expect(calls).toBe(1) // one batched call for the chapter's sessions
  } finally { liveRuns.delete(runKey(bookDir)) }
})

test('there is no daily limit: 100 queued jobs all run in one drain, and runs are still counted', async () => {
  const n = (i: number) => String(i).padStart(3, '0')
  const acts = Array.from({ length: 100 }, (_, i) => `  - id: ACT-${i + 1}\n    title: A\n    chapters:\n      - id: CH-${n(i + 1)}\n        title: C\n        scenes: [SC-${n(i + 1)}]\n`).join('')
  mkdirSync(join(bookDir, 'outline'), { recursive: true })
  writeFileSync(join(bookDir, 'outline', 'outline.yaml'), `acts:\n${acts}`)
  let calls = 0
  const r = new MemoryRunner({ root, claudeProjects: projects, settings, call: async () => { calls++; return { result: 'no changes', costUsd: 0.01 } }, today: () => day })
  await r.init(); await r.addBook(bookDir)
  const s = readState(root); s.runs = { day, count: 60 }; writeState(root, s) // the old cap, already used up
  for (let i = 1; i <= 100; i++) enqueue(root, { kind: 'deep', book: bookDir, act: `ACT-${i}` })
  await r.drain()
  expect(calls).toBe(100)
  expect(readQueue(root).length).toBe(0)
  expect(r.status().runsToday).toBe(160)
  expect(r.status()).not.toHaveProperty('dailyCap')
  expect(r.log.join('\n')).not.toMatch(/cap/i)
}, 300_000)

test('a distill that died mid-run is rolled back at the next start', async () => {
  const r0 = new MemoryRunner({ root, claudeProjects: projects, settings, call: async () => ({ result: '', costUsd: 0 }), today: () => day })
  await r0.init(); r0.stop()
  writeFileSync(join(root, 'topics', 'half.md'), 'partial')
  const s = readState(root); s.inFlight = 'x'; writeState(root, s)
  const r = new MemoryRunner({ root, claudeProjects: projects, settings, call: async () => ({ result: '', costUsd: 0 }), today: () => day })
  await r.init()
  expect(existsSync(join(root, 'topics', 'half.md'))).toBe(false)
  expect(readState(root).inFlight).toBeNull()
})

test('a failing call rolls back, keeps the job and never throws', async () => {
  transcript()
  const r = new MemoryRunner({ root, claudeProjects: projects, settings, call: async () => { writeFileSync(join(root, 'topics', 'y.md'), 'x'); throw Object.assign(new Error('usage limit'), { costUsd: 0.5 }) }, today: () => day })
  await r.init()
  await expect(r.addBook(bookDir)).resolves.toBeUndefined()
  expect(existsSync(join(root, 'topics', 'y.md'))).toBe(false)
  expect(readQueue(root).length).toBe(1)
  expect(r.status().spentUsd).toBe(0.5)
  expect(r.log.join('\n')).toMatch(/usage limit/)
})

test('the act flush runs a deep pass on the deep model with the act reviews', async () => {
  mkdirSync(join(bookDir, 'outline'), { recursive: true })
  writeFileSync(join(bookDir, 'outline', 'outline.yaml'), 'acts:\n  - id: ACT-1\n    title: Beginning\n    chapters:\n      - id: CH-01\n        title: One\n        scenes: [SC-001]\n')
  mkdirSync(join(bookDir, 'reviews', 'SC-001'), { recursive: true })
  writeFileSync(join(bookDir, 'reviews', 'SC-001', 'line.md'), '---\nverdict: FLAG\n---\nFilter words again.\n')
  writeFileSync(join(bookDir, 'reviews', 'SC-001', 'audience.md'), '---\nverdict: PASS\n---\nLovely.\n')
  const seen: { model: string; prompt: string; tools: boolean }[] = []
  const r = new MemoryRunner({ root, claudeProjects: projects, settings, call: async (prompt, o) => { seen.push({ model: o.model, prompt, tools: o.tools }); return { result: 'no changes', costUsd: 0 } }, today: () => day })
  await r.init(); await r.addBook(bookDir)
  await r.flush(bookDir, 'act', 'ACT-1')
  const deep = seen.find(c => c.model === 'sonnet')!
  expect(deep.prompt).toContain('Filter words again.')
  expect(deep.prompt).not.toContain('Lovely.')
  expect(deep.tools).toBe(true)
  expect(readQueue(root).length).toBe(0)
})

test('the deep pass may propose a skill', async () => {
  mkdirSync(join(bookDir, 'outline'), { recursive: true })
  writeFileSync(join(bookDir, 'outline', 'outline.yaml'), 'acts:\n  - id: ACT-1\n    title: Beginning\n    chapters:\n      - id: CH-01\n        title: One\n        scenes: [SC-001]\n')
  const skill = '---\nname: cut-filters\ndescription: Use when filter words pile up\n---\nCut them.\n'
  const r = new MemoryRunner({ root, claudeProjects: projects, settings, call: writes('inbox/cut-filters/SKILL.md', skill), today: () => day })
  await r.init(); await r.addBook(bookDir)
  await r.flush(bookDir, 'act', 'ACT-1')
  expect(existsSync(join(root, 'inbox', 'cut-filters', 'SKILL.md'))).toBe(true)
  expect(await git(root, 'log', '--format=%s')).toMatch(/Deep pass first ACT-1/)
})

test('exclusive waits for a running drain and holds the next one off', async () => {
  const order: string[] = []
  let started!: () => void, release!: () => void
  const callStarted = new Promise<void>(r => (started = r))
  const gate = new Promise<void>(r => (release = r))
  const r = new MemoryRunner({ root, claudeProjects: projects, settings, call: async () => { order.push('call'); started(); await gate; order.push('call-end'); return { result: '', costUsd: 0 } }, today: () => day })
  await r.init()
  transcript()
  const adding = r.addBook(bookDir)
  await callStarted
  const ex = r.exclusive(async () => { order.push('fn'); await sleep(100); enqueue(root, { kind: 'distill', transcript: transcript(), book: bookDir }); order.push('fn-end'); return 7 })
  await sleep(100)
  expect(order).toEqual(['call'])
  const drained = r.drain()
  release()
  expect(await ex).toBe(7)
  await Promise.all([adding, drained])
  // The drain asked for during fn ran only after fn finished.
  expect(order).toEqual(['call', 'call-end', 'fn', 'fn-end', 'call', 'call-end'])
})

test('a throw after the call rolls back, clears inFlight and never reaches a commit', async () => {
  transcript()
  let calls = 0
  const write = writes('books/first/topics/filter-words.md', lesson('filter-words', 'Cut "she saw".'))
  const r = new MemoryRunner({ root, claudeProjects: projects, settings, call: async (p, o) => { calls++; return calls === 1 ? write(p, o) : { result: 'no changes', costUsd: 0 } }, today: () => day })
  await r.init()
  fail.indexes = true
  try { await r.addBook(bookDir) } finally { fail.indexes = false }
  expect(existsSync(join(root, 'books', 'first', 'topics', 'filter-words.md'))).toBe(false)
  expect(readState(root).inFlight).toBeNull()
  expect(readQueue(root).length).toBe(1)
  expect(r.log.join('\n')).toMatch(/disk full/)
  await r.drain() // the retry's "Record memory use" commit holds no model writes
  const log = await git(root, 'log', '--name-only', '--format=%s')
  expect(log).toMatch(/Record memory use/)
  expect(log).not.toContain('filter-words')
})

test('a recheck rewrite naming a story id is rolled back', async () => {
  const file = join(root, 'books', 'first', 'topics', 'old.md')
  const r = new MemoryRunner({ root, claudeProjects: projects, settings, call: async () => ({ result: 'REWRITE\nIn SC-004 the gun was gone.', costUsd: 0 }), today: () => day })
  await r.init(); await r.addBook(bookDir)
  writeMemory({ file, meta: { name: 'old', type: 'catch', summary: 's', sources: [], verified: day, used: day, uses: 0, stale: true, pinned: false, status: 'live', by: '', rules: [], quiet: 0, hits: 0, live: '' }, body: 'Old lesson.\n' })
  await git(root, 'add', '-A'); await git(root, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'seed')
  enqueue(root, { kind: 'recheck', file })
  await r.drain()
  expect(readFileSync(file, 'utf8')).toContain('Old lesson.')
  expect(r.log.join('\n')).toMatch(/Discarded memory changes:.*story fact/)
  expect(readQueue(root).length).toBe(0)
})

test('addBook writes book.json only between calls', async () => {
  let started!: () => void, release!: () => void
  const callStarted = new Promise<void>(res => (started = res))
  const gate = new Promise<void>(res => (release = res))
  const r = new MemoryRunner({ root, claudeProjects: projects, settings, call: async (p, o) => { started(); await gate; return writes('books/first/topics/filter-words.md', lesson('filter-words', 'Cut "she saw".'))(p, o) }, today: () => day })
  await r.init()
  transcript()
  const first = r.addBook(bookDir)
  await callStarted
  const other = mkdtempSync(join(tmpdir(), 'nb-mr-book2-'))
  writeFileSync(join(other, 'book.yaml'), 'id: second\nseries: null\n')
  const second = r.addBook(other)
  await sleep(100)
  expect(existsSync(join(root, 'books', 'second', 'book.json'))).toBe(false)
  release()
  await Promise.all([first, second])
  expect(await git(root, 'log', '--format=%s')).toMatch(/Distill first/)
  expect(existsSync(join(root, 'books', 'second', 'book.json'))).toBe(true)
})

test('an idle drain runs no maintenance', async () => {
  const r = new MemoryRunner({ root, claudeProjects: projects, settings, call: async () => ({ result: '', costUsd: 0 }), today: () => day })
  await r.init(); await r.addBook(bookDir)
  rmSync(join(bookDir, '.novelbrain', 'memory.md'))
  await r.drain()
  expect(existsSync(join(bookDir, '.novelbrain', 'memory.md'))).toBe(false) // maintain would rewrite every briefing
})

test('a failed rollback keeps inFlight, and neither maintain nor exclusive commits the model output', async () => {
  transcript()
  const r = new MemoryRunner({ root, claudeProjects: projects, settings, call: writes('books/first/topics/x.md', lesson('x', 'In SC-004 the gun was gone.')), today: () => day })
  await r.init()
  fail.rollback = true
  try {
    await r.addBook(bookDir) // the story fact fails validation, the rollback throws, then maintain runs
    expect(readState(root).inFlight).not.toBeNull()
    expect(existsSync(join(root, 'books', 'first', 'topics', 'x.md'))).toBe(true)
    let ran = false
    await expect(r.exclusive(async () => { ran = true })).rejects.toThrow(/roll back/)
    expect(ran).toBe(false)
    expect(await git(root, 'log', '--name-only', '--format=%s')).not.toContain('x.md')
    expect(r.log.join('\n')).toMatch(/Could not roll back/)
  } finally { fail.rollback = false }
  await r.drain() // the next drain rolls back first, then retries cleanly
  expect(existsSync(join(root, 'books', 'first', 'topics', 'x.md'))).toBe(false)
  expect(await git(root, 'log', '--name-only', '--format=%s')).not.toContain('x.md')
})

test('a model change to .state.json or a rewrite of .queue discards the update and is restored', async () => {
  transcript()
  const call: Call = async (p, o) => {
    writeFileSync(join(root, '.state.json'), JSON.stringify({ ...readState(root), runs: { day, count: -100 } }))
    return writes('books/first/topics/filter-words.md', lesson('filter-words', 'Cut "she saw".'))(p, o)
  }
  const r = new MemoryRunner({ root, claudeProjects: projects, settings, call, today: () => day })
  await r.init(); await r.addBook(bookDir)
  expect(existsSync(join(root, 'books', 'first', 'topics', 'filter-words.md'))).toBe(false)
  expect(r.log.join('\n')).toMatch(/Discarded memory changes:.*\.state\.json/)
  expect(readState(root).runs.count).toBe(1)
  expect(readState(root).inFlight).toBeNull()

  transcript()
  const r2 = new MemoryRunner({ root, claudeProjects: projects, settings, call: async (p, o) => { writeFileSync(join(root, '.queue'), `${JSON.stringify({ kind: 'recheck', file: join(root, 'books', 'first', 'topics', 'x.md') })}
`); return writes('books/first/topics/filter-words.md', lesson('filter-words', 'Cut "she saw".'))(p, o) }, today: () => day })
  await r2.addBook(bookDir)
  expect(existsSync(join(root, 'books', 'first', 'topics', 'filter-words.md'))).toBe(false)
  expect(r2.log.join('\n')).toMatch(/Discarded memory changes:.*\.queue/)
  expect(readQueue(root).some(j => j.kind === 'recheck')).toBe(false) // the queue the model rewrote was put back

  // Appending to .queue (what the memory hook does during a call) is fine.
  transcript()
  const r3 = new MemoryRunner({ root, claudeProjects: projects, settings, call: async (p, o) => { enqueue(root, { kind: 'distill', transcript: join(projects, 'later.jsonl'), book: bookDir }); return writes('books/first/topics/filter-words.md', lesson('filter-words', 'Cut "she saw".'))(p, o) }, today: () => day })
  await r3.addBook(bookDir)
  expect(existsSync(join(root, 'books', 'first', 'topics', 'filter-words.md'))).toBe(true)
})

test('cancel kills the act pass call, rolls it back, keeps the job, and clears inFlight only after a rollback succeeds', async () => {
  mkdirSync(join(bookDir, 'outline'), { recursive: true })
  writeFileSync(join(bookDir, 'outline', 'outline.yaml'), 'acts:\n  - id: ACT-1\n    title: Beginning\n    chapters:\n      - id: CH-01\n        title: One\n        scenes: [SC-001]\n')
  let started!: () => void
  const nextCall = () => new Promise<void>(res => (started = res))
  const children: ChildProcess[] = []
  // Like runClaude: the model writes, the process is reported through onSpawn, and a killed process rejects.
  const call: Call = async (_p, o) => {
    mkdirSync(join(root, 'topics'), { recursive: true }) // a rollback's git clean removes the empty folder
    writeFileSync(join(root, 'topics', 'half.md'), 'partial')
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { windowsHide: true })
    children.push(child)
    o.onSpawn?.(child.pid)
    started()
    const code = await new Promise(res => child.on('exit', res))
    throw new Error(`claude exited with ${code}`)
  }
  const r = new MemoryRunner({ root, claudeProjects: projects, settings, call, today: () => day })
  await r.init(); await r.addBook(bookDir)
  liveRuns.add(runKey(bookDir))
  try {
    // 1. The rollback fails: the marker stays set and nothing is committed.
    fail.rollback = true
    let call1 = nextCall()
    const t0 = Date.now()
    const flushing = r.flush(bookDir, 'act', 'ACT-1')
    await call1
    expect(readState(root).inFlight).not.toBeNull()
    r.cancel()
    await flushing
    expect(Date.now() - t0).toBeLessThan(20000)
    expect(children[0].exitCode !== null || children[0].signalCode !== null).toBe(true)
    expect(readState(root).inFlight).not.toBeNull()
    expect(readQueue(root)).toEqual([{ kind: 'deep', book: bookDir, act: 'ACT-1' }, { kind: 'audit', book: bookDir, at: 'ACT-1' }])
    expect(r.log.join('\n')).toMatch(/stopped by pause/)
    fail.rollback = false

    // 2. The rollback works: the half-done write is gone, the marker cleared, the job still queued.
    call1 = nextCall()
    const again = r.flush(bookDir, 'act', 'ACT-1')
    await call1
    r.cancel()
    await again
    expect(existsSync(join(root, 'topics', 'half.md'))).toBe(false)
    expect(readState(root).inFlight).toBeNull()
    expect(readQueue(root)).toEqual([{ kind: 'deep', book: bookDir, act: 'ACT-1' }, { kind: 'audit', book: bookDir, at: 'ACT-1' }])
    expect(await git(root, 'log', '--name-only', '--format=%s')).not.toContain('half.md')
  } finally {
    fail.rollback = false
    liveRuns.delete(runKey(bookDir))
    for (const c of children) c.kill()
  }
})

test('a cancel while a flush waits for the lock drops that flush; the job runs at the next drain', async () => {
  mkdirSync(join(bookDir, 'outline'), { recursive: true })
  writeFileSync(join(bookDir, 'outline', 'outline.yaml'), 'acts:\n  - id: ACT-1\n    title: Beginning\n    chapters:\n      - id: CH-01\n        title: One\n        scenes: [SC-001]\n')
  let calls = 0
  const r = new MemoryRunner({ root, claudeProjects: projects, settings, call: async () => { calls++; return { result: 'no changes', costUsd: 0 } }, today: () => day })
  await r.init(); await r.addBook(bookDir)
  let release!: () => void
  const gate = new Promise<void>(res => (release = res))
  const held = r.exclusive(() => gate)
  const flushing = r.flush(bookDir, 'act', 'ACT-1')
  r.cancel()
  release()
  await held; await flushing
  expect(calls).toBe(0)
  expect(readQueue(root).length).toBe(2)
  await r.drain()
  expect(calls).toBe(1)
  expect(readQueue(root).length).toBe(0)
})

test('a recheck of a file outside the memory folder is dropped with a log line', async () => {
  const outside = mkdtempSync(join(tmpdir(), 'nb-mr-out-'))
  const file = join(outside, 'books', 'first', 'topics', 'old.md')
  writeMemory({ file, meta: { name: 'old', type: 'catch', summary: 's', sources: [], verified: day, used: day, uses: 0, stale: true, pinned: false, status: 'live', by: '', rules: [], quiet: 0, hits: 0, live: '' }, body: 'Old lesson.\n' })
  let calls = 0
  const r = new MemoryRunner({ root, claudeProjects: projects, settings, call: async () => { calls++; return { result: 'DELETE', costUsd: 0 } }, today: () => day })
  await r.init(); await r.addBook(bookDir)
  enqueue(root, { kind: 'recheck', file })
  await r.drain()
  expect(existsSync(file)).toBe(true)
  expect(calls).toBe(0)
  expect(readQueue(root).length).toBe(0)
  expect(r.log.join('\n')).toMatch(/dropped a re-check/)
})

test('memory is always on: a leftover .off from the old switch is ignored', async () => {
  writeFileSync(join(root, '.off'), '') // an existing memory folder from before the switch was removed
  transcript()
  const r = new MemoryRunner({ root, claudeProjects: projects, settings, call: keeping(writes('books/first/topics/filter-words.md', lesson('filter-words', 'Cut "she saw".'))), today: () => day })
  await r.init(); await r.addBook(bookDir)
  expect(await git(root, 'log', '--format=%s')).toMatch(/Distill first/)
  expect(readFileSync(join(bookDir, '.novelbrain', 'memory.md'), 'utf8')).toContain('Cut "she saw".')
  expect(r.status()).not.toHaveProperty('enabled')
})

test('a distilled lesson waits on probation, out of the briefing, when the auditor gives no usable answer', async () => {
  transcript()
  const r = new MemoryRunner({ root, claudeProjects: projects, settings, call: writes('books/first/topics/filter-words.md', lesson('filter-words', 'Cut "she saw".')), today: () => day })
  await r.init(); await r.addBook(bookDir)
  expect(readMemory(join(root, 'books', 'first', 'topics', 'filter-words.md'))!.meta).toMatchObject({ status: 'probation', by: 'haiku' })
  expect(readFileSync(join(bookDir, '.novelbrain', 'memory.md'), 'utf8')).not.toContain('Cut "she saw".')
  expect(r.log.join('\n')).toMatch(/audit of first gave no usable answer/)
  expect(readQueue(root)).toEqual([])
})

test('between runs a different model audits the distill at once; KEEP puts it live with the reason recorded', async () => {
  transcript()
  const r = new MemoryRunner({ root, claudeProjects: projects, settings, call: keeping(writes('books/first/topics/filter-words.md', lesson('filter-words', 'Cut "she saw".'))), today: () => day })
  await r.init(); await r.addBook(bookDir)
  expect(audits.map(a => a.model)).toEqual(['sonnet'])
  expect(audits[0].prompt).toContain('### PROBATION books/first/topics/filter-words.md')
  expect(readMemory(join(root, 'books', 'first', 'topics', 'filter-words.md'))!.meta.status).toBe('live')
  expect(readFileSync(join(bookDir, '.novelbrain', 'memory.md'), 'utf8')).toContain('Cut "she saw".')
  expect(await git(root, 'log', '-1', '--format=%B')).toMatch(/^Audit first by sonnet\n\nfilter-words: added\. Holds across scenes\./)
  expect(r.lessons(bookDir)).toEqual({
    lessons: [{ file: 'books/first/topics/filter-words.md', scope: 'book', name: 'filter-words', type: 'catch', summary: 's', status: 'live', live: day }],
    log: [{ at: expect.any(String), checkpoint: 'between runs', lesson: 'filter-words', action: 'added', reason: 'Holds across scenes.', by: 'sonnet' }]
  })
  const other = mkdtempSync(join(tmpdir(), 'nb-mr-book2-'))
  writeFileSync(join(other, 'book.yaml'), 'id: second\nseries: null\n')
  expect(r.lessons(other).log).toEqual([]) // another book's checkpoints are not its log
})

test('during a run the audit waits for the chapter flush', async () => {
  chapters(1)
  const r = new MemoryRunner({ root, claudeProjects: projects, settings, call: keeping(writes('books/first/topics/filter-words.md', lesson('filter-words', 'Cut "she saw".'))), today: () => day })
  await r.init(); await r.addBook(bookDir)
  liveRuns.add(runKey(bookDir))
  try {
    transcript()
    await r.addBook(bookDir)
    expect(audits).toHaveLength(0)
    await r.flush(bookDir, 'chapter', 'CH-01')
    expect(audits).toHaveLength(1)
    expect(r.lessons(bookDir).log.at(-1)!.checkpoint).toBe('CH-01')
    expect(readQueue(root)).toEqual([])
  } finally { liveRuns.delete(runKey(bookDir)) }
})

test('the act flush has opus audit the deep pass lessons and skill proposals; DELETE removes a proposal', async () => {
  chapters(1)
  const deep: Call = async () => {
    mkdirSync(join(root, 'books', 'first', 'topics'), { recursive: true })
    writeFileSync(join(root, 'books', 'first', 'topics', 'slow-middles.md'), lesson('slow-middles', 'Cut slack beats.'))
    mkdirSync(join(root, 'inbox', 'cut-filters'), { recursive: true })
    writeFileSync(join(root, 'inbox', 'cut-filters', 'SKILL.md'), '---\nname: cut-filters\ndescription: Use when filter words pile up\n---\nCut them.\n')
    return { result: 'changed', costUsd: 0 }
  }
  const seen: string[] = []
  const call: Call = async (p, o) => {
    if (!p.startsWith('AUDIT')) return deep(p, o)
    seen.push(o.model)
    return { result: JSON.stringify([
      { lesson: 'books/first/topics/slow-middles.md', verdict: 'KEEP', reason: 'Seen in two chapters.' },
      { lesson: 'inbox/cut-filters/SKILL.md', verdict: 'DELETE', reason: 'One chapter only.' }
    ]), costUsd: 0 }
  }
  const r = new MemoryRunner({ root, claudeProjects: projects, settings, call, today: () => day })
  await r.init(); await r.addBook(bookDir)
  await r.flush(bookDir, 'act', 'ACT-1')
  expect(seen).toEqual(['opus'])
  expect(existsSync(join(root, 'inbox', 'cut-filters'))).toBe(false)
  expect(readMemory(join(root, 'books', 'first', 'topics', 'slow-middles.md'))!.meta.status).toBe('live')
  expect(await git(root, 'log', '-1', '--format=%B')).toMatch(/^Audit first ACT-1 by opus\n\nslow-middles: added\. Seen in two chapters\.\nskill cut-filters: deleted\. One chapter only\./)
  expect(readQueue(root)).toEqual([])
})

test('a REWRITE stays on probation as the auditor model, and the next audit uses the other model', async () => {
  transcript()
  const r = new MemoryRunner({ root, claudeProjects: projects, settings, call: keeping(writes('books/first/topics/filter-words.md', lesson('filter-words', 'Cut "she saw".')), 'REWRITE'), today: () => day })
  await r.init(); await r.addBook(bookDir)
  const m = readMemory(join(root, 'books', 'first', 'topics', 'filter-words.md'))!
  expect(m.meta).toMatchObject({ status: 'probation', by: 'sonnet' })
  expect(m.body).toBe('Rewritten.\n')
  expect(audits.map(a => a.model)).toEqual(['sonnet']) // never re-audited in the same drain
  enqueue(root, { kind: 'audit', book: bookDir })
  await r.drain()
  expect(audits.map(a => a.model)).toEqual(['sonnet', 'opus'])
})

test('evidence: findings citing a live catch in two chapters send it back to probation; three quiet chapters retire one; a chapter counts once', async () => {
  chapters(3)
  const r = new MemoryRunner({ root, claudeProjects: projects, settings, call: async () => ({ result: 'no verdicts', costUsd: 0 }), today: () => day })
  await r.init(); await r.addBook(bookDir)
  writeMemory({ file: join(root, 'books', 'first', 'topics', 'filter-words.md'), meta: base('filter-words', { rules: ['SK-ENG-04'] }), body: 'Cut "she saw".\n' })
  writeMemory({ file: join(root, 'books', 'first', 'topics', 'quiet-one.md'), meta: base('quiet-one', { rules: ['MG-CON-02'] }), body: 'Keep it calm.\n' })
  await seedCommit()
  const fw = () => readMemory(join(root, 'books', 'first', 'topics', 'filter-words.md'))!.meta
  flag('SC-001', 'SK-ENG-04')
  await r.flush(bookDir, 'chapter', 'CH-01')
  await r.flush(bookDir, 'chapter', 'CH-01') // checked again after a revision: counted once
  expect(fw()).toMatchObject({ status: 'live', hits: 1, quiet: 0 })
  flag('SC-002', 'SK-ENG-04')
  await r.flush(bookDir, 'chapter', 'CH-02')
  expect(fw()).toMatchObject({ status: 'probation', hits: 0 })
  await r.flush(bookDir, 'chapter', 'CH-03')
  expect(existsSync(join(root, 'archive', 'books', 'first', 'topics', 'quiet-one.md'))).toBe(true)
  expect(readFileSync(join(bookDir, '.novelbrain', 'memory.md'), 'utf8')).not.toContain('Keep it calm.')
  expect(r.lessons(bookDir).log.map(e => `${e.checkpoint} ${e.lesson} ${e.action} ${e.by}`)).toEqual(['CH-02 filter-words probation evidence', 'CH-03 quiet-one retired evidence'])
  expect(await git(root, 'log', '--format=%s')).toMatch(/^Evidence first CH-03$/m)
  expect(readState(root).inFlight).toBeNull()
})

test('a catch evidence sends back is audited with a note and the reviews that cited it; an ordinary probation lesson has no note', async () => {
  chapters(2)
  const r = new MemoryRunner({ root, claudeProjects: projects, settings, call: keeping(async () => ({ result: '', costUsd: 0 })), today: () => day })
  await r.init(); await r.addBook(bookDir)
  writeMemory({ file: join(root, 'books', 'first', 'topics', 'filter-words.md'), meta: base('filter-words', { rules: ['SK-ENG-04'] }), body: 'Cut "she saw".\n' })
  await seedCommit()
  flag('SC-001', 'SK-ENG-04')
  await r.flush(bookDir, 'chapter', 'CH-01')
  writeMemory({ file: join(root, 'books', 'first', 'topics', 'fresh.md'), meta: base('fresh', { status: 'probation', by: 'haiku', live: '' }), body: 'Fresh.\n' })
  await seedCommit()
  flag('SC-002', 'SK-ENG-04')
  await r.flush(bookDir, 'chapter', 'CH-02')
  const prompt = audits[audits.length - 1].prompt
  const block = (rel: string) => prompt.split('\n### ').find(b => b.startsWith(`PROBATION ${rel}`)) ?? ''
  expect(block('books/first/topics/filter-words.md')).toMatch(/Sent back to probation: findings citing SK-ENG-04 came back in 2 chapters after it went live \(CH-01, CH-02\)/)
  expect(block('books/first/topics/fresh.md')).not.toMatch(/Sent back/)
  expect(prompt).toContain('<<<reviews/SC-001/line.md>>>')
  expect(prompt).toContain('<<<reviews/SC-002/line.md>>>')
  // The audit committed: the note is used once.
  expect(readMemory(join(root, 'books', 'first', 'topics', 'filter-words.md'))!.meta.status).toBe('live')
  expect(readState(root).hitIn).toEqual({})
})

test('story ids and bible names in an auditor reason never reach the log or the commit', async () => {
  mkdirSync(join(bookDir, 'bible', 'characters'), { recursive: true })
  writeFileSync(join(bookDir, 'bible', 'characters', 'CHAR-MARA.md'), '---\nid: CHAR-MARA\nname: Mara Quill\nrole: lead\narcBeats: [a]\n---\nA diver.\n')
  const call: Call = async p => ({ result: p.startsWith('AUDIT') ? JSON.stringify([{ lesson: 'books/first/topics/fine.md', verdict: 'KEEP', reason: 'Holds in SC-004, where Mara Quill cuts it.' }]) : '', costUsd: 0 })
  const r = new MemoryRunner({ root, claudeProjects: projects, settings, call, today: () => day })
  await r.init(); await r.addBook(bookDir)
  writeMemory({ file: join(root, 'books', 'first', 'topics', 'fine.md'), meta: base('fine', { status: 'probation', by: 'haiku', live: '' }), body: 'Fine.\n' })
  await seedCommit()
  enqueue(root, { kind: 'audit', book: bookDir })
  await r.drain()
  expect(r.lessons(bookDir).log.map(e => e.reason)).toEqual(['Holds in [name], where [name] cuts it.'])
  expect(await git(root, 'log', '-1', '--format=%B')).not.toMatch(/SC-004|Mara|Quill/)
})

test('an unreadable outline skips the evidence with a log line; the audit job still finishes', async () => {
  const r = new MemoryRunner({ root, claudeProjects: projects, settings, call: async () => ({ result: '[]', costUsd: 0 }), today: () => day })
  await r.init(); await r.addBook(bookDir)
  await r.flush(bookDir, 'chapter', 'CH-01') // no outline.yaml at all
  expect(r.log.join('\n')).toMatch(/Evidence for CH-01 skipped/)
  expect(readQueue(root)).toEqual([])
  expect(readState(root).inFlight).toBeNull()
})

test('pause kills an audit call: rolled back, the job stays queued, the lesson stays on probation', async () => {
  transcript()
  let started!: () => void
  const auditing = new Promise<void>(res => (started = res))
  const children: ChildProcess[] = []
  const call: Call = async (p, o) => {
    if (!p.startsWith('AUDIT')) return writes('books/first/topics/filter-words.md', lesson('filter-words', 'Cut "she saw".'))(p, o)
    mkdirSync(join(root, 'topics'), { recursive: true })
    writeFileSync(join(root, 'topics', 'half.md'), 'partial')
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { windowsHide: true })
    children.push(child)
    o.onSpawn?.(child.pid)
    started()
    const code = await new Promise(res => child.on('exit', res))
    throw new Error(`claude exited with ${code}`)
  }
  const r = new MemoryRunner({ root, claudeProjects: projects, settings, call, today: () => day })
  await r.init()
  try {
    const adding = r.addBook(bookDir)
    await auditing
    r.cancel()
    await adding
    expect(readMemory(join(root, 'books', 'first', 'topics', 'filter-words.md'))!.meta.status).toBe('probation')
    expect(existsSync(join(root, 'topics', 'half.md'))).toBe(false)
    expect(readState(root).inFlight).toBeNull()
    expect(readQueue(root)).toEqual([{ kind: 'audit', book: bookDir }])
    expect(r.log.join('\n')).toMatch(/stopped by pause \(audit first\)/)
    expect(await git(root, 'log', '--format=%s')).not.toMatch(/^Audit/m)
  } finally { for (const c of children) c.kill() }
})

test('deleteLesson removes a lesson file in its own commit and rewrites the briefing; anything else is refused', async () => {
  const r = new MemoryRunner({ root, claudeProjects: projects, settings, call: async () => ({ result: '', costUsd: 0 }), today: () => day })
  await r.init(); await r.addBook(bookDir)
  writeMemory({ file: join(root, 'books', 'first', 'topics', 'filter-words.md'), meta: base('filter-words'), body: 'Cut "she saw".\n' })
  writeMemory({ file: join(root, 'books', 'first', 'topics', 'maybe.md'), meta: base('maybe', { status: 'probation', by: 'haiku' }), body: 'x\n' })
  const outside = join(mkdtempSync(join(tmpdir(), 'nb-mr-out-')), 'outside.md')
  writeFileSync(outside, lesson('outside', 'x'))
  await seedCommit()
  await r.deleteLesson('books/first/topics/filter-words.md')
  expect(existsSync(join(root, 'books', 'first', 'topics', 'filter-words.md'))).toBe(false)
  expect((await git(root, 'log', '-1', '--format=%s')).trim()).toBe('Delete lesson filter-words (writer)')
  expect(r.lessons(bookDir).log.at(-1)).toMatchObject({ checkpoint: 'writer', by: 'writer', lesson: 'filter-words', action: 'deleted' })
  expect(readFileSync(join(bookDir, '.novelbrain', 'memory.md'), 'utf8')).not.toContain('Cut "she saw".')
  await r.deleteLesson('books/first/topics/maybe.md') // a lesson on probation may be deleted too
  expect(existsSync(join(root, 'books', 'first', 'topics', 'maybe.md'))).toBe(false)
  for (const bad of ['books/first/topics/gone.md', `books/../${relative(root, outside).replace(/\\/g, '/')}`, 'inbox/x/SKILL.md', 'book.json'])
    await expect(r.deleteLesson(bad)).rejects.toThrow(/No lesson at/)
  expect(existsSync(outside)).toBe(true)
})

test('a failed delete commit puts the lesson back and leaves nothing uncommitted', async () => {
  const r = new MemoryRunner({ root, claudeProjects: projects, settings, call: async () => ({ result: '', costUsd: 0 }), today: () => day })
  await r.init(); await r.addBook(bookDir)
  writeMemory({ file: join(root, 'books', 'first', 'topics', 'filter-words.md'), meta: base('filter-words'), body: 'Cut "she saw".\n' })
  rebuildIndexes(root, 60, day)
  await seedCommit()
  fail.indexes = true
  try {
    await expect(r.deleteLesson('books/first/topics/filter-words.md')).rejects.toThrow(/disk full/)
  } finally { fail.indexes = false }
  expect(existsSync(join(root, 'books', 'first', 'topics', 'filter-words.md'))).toBe(true)
  expect((await git(root, 'status', '--porcelain')).trim()).toBe('')
  // The commit itself fails after `add -A` staged the delete and the rewritten indexes.
  fail.commit = m => m.startsWith('Delete lesson')
  try {
    await expect(r.deleteLesson('books/first/topics/filter-words.md')).rejects.toThrow(/commit failed/)
  } finally { fail.commit = () => false }
  expect(existsSync(join(root, 'books', 'first', 'topics', 'filter-words.md'))).toBe(true)
  expect((await git(root, 'status', '--porcelain')).trim()).toBe('')
  expect(r.lessons(bookDir).log).toEqual([])
})

test('deleteLesson refuses a lesson behind a junction out of the memory folder', async () => {
  const r = new MemoryRunner({ root, claudeProjects: projects, settings, call: async () => ({ result: '', costUsd: 0 }), today: () => day })
  await r.init()
  const outside = mkdtempSync(join(tmpdir(), 'nb-mr-out-'))
  writeMemory({ file: join(outside, 'topics', 'x.md'), meta: base('x'), body: 'x\n' })
  symlinkSync(outside, join(root, 'books', 'evil'), 'junction')
  await expect(r.deleteLesson('books/evil/topics/x.md')).rejects.toThrow(/No lesson at/)
  expect(existsSync(join(outside, 'topics', 'x.md'))).toBe(true)
})

test('an update whose commit fails is rolled back to HEAD, keeps its job and clears inFlight', async () => {
  transcript()
  const r = new MemoryRunner({ root, claudeProjects: projects, settings, call: writes('books/first/topics/filter-words.md', lesson('filter-words', 'Cut "she saw".')), today: () => day })
  await r.init()
  fail.commit = m => m.startsWith('Distill')
  try { await r.addBook(bookDir) } finally { fail.commit = () => false }
  expect(existsSync(join(root, 'books', 'first', 'topics', 'filter-words.md'))).toBe(false)
  expect((await git(root, 'status', '--porcelain')).trim()).toBe('')
  expect(readState(root).inFlight).toBeNull()
  expect(readQueue(root).map(j => j.kind)).toEqual(['distill'])
  expect(r.log.join('\n')).toMatch(/commit failed; rolled back/)
})

test('a KEEP whose file now fails the checks (a bible name added since) deletes that lesson; the rest of the audit commits', async () => {
  const r = new MemoryRunner({ root, claudeProjects: projects, settings, call: keeping(async () => ({ result: '', costUsd: 0 })), today: () => day })
  await r.init(); await r.addBook(bookDir)
  writeMemory({ file: join(root, 'topics', 'mara-voice.md'), meta: base('mara-voice', { status: 'probation', by: 'haiku', live: '' }), body: 'Mara speaks in short lines.\n' })
  writeMemory({ file: join(root, 'books', 'first', 'topics', 'fine.md'), meta: base('fine', { status: 'probation', by: 'haiku', live: '' }), body: 'Fine.\n' })
  await seedCommit()
  mkdirSync(join(bookDir, 'bible', 'characters'), { recursive: true })
  writeFileSync(join(bookDir, 'bible', 'characters', 'CHAR-MARA.md'), '---\nid: CHAR-MARA\nname: Mara Quill\nrole: lead\narcBeats: [a]\n---\nA diver.\n')
  enqueue(root, { kind: 'audit', book: bookDir })
  await r.drain()
  expect(audits).toHaveLength(1)
  // The failing lesson is deleted with the reason, so it cannot block every later audit; the rest still applies.
  expect(r.log.join('\n')).not.toMatch(/Discarded memory changes/)
  expect(existsSync(join(root, 'topics', 'mara-voice.md'))).toBe(false)
  expect(readMemory(join(root, 'books', 'first', 'topics', 'fine.md'))!.meta.status).toBe('live')
  expect(await git(root, 'log', '--format=%s')).toMatch(/^Audit/m)
  expect(r.lessons(bookDir).log).toEqual(expect.arrayContaining([
    expect.objectContaining({ lesson: 'mara-voice', action: 'deleted', reason: expect.stringMatching(/failed the memory checks: .*story fact \(\[name\]\)/) }),
    expect.objectContaining({ lesson: 'fine', action: 'added' })
  ]))
  expect(readState(root).inFlight).toBeNull()
  expect(readQueue(root)).toEqual([])
})

test('applyVerdicts throwing rolls the audit back; the job stays queued and inFlight is cleared', async () => {
  transcript()
  const r = new MemoryRunner({ root, claudeProjects: projects, settings, call: keeping(writes('books/first/topics/filter-words.md', lesson('filter-words', 'Cut "she saw".'))), today: () => day })
  await r.init()
  fail.apply = true
  try { await r.addBook(bookDir) } finally { fail.apply = false }
  expect(audits).toHaveLength(1)
  expect(readMemory(join(root, 'books', 'first', 'topics', 'filter-words.md'))!.meta.status).toBe('probation')
  expect(readQueue(root)).toEqual([{ kind: 'audit', book: bookDir }])
  expect(readState(root).inFlight).toBeNull()
  expect(r.log.join('\n')).toMatch(/update failed after the call \(audit first\): SKILL\.md vanished/)
  expect(await git(root, 'log', '--format=%s')).not.toMatch(/^Audit/m)
  await r.drain()
  expect(readMemory(join(root, 'books', 'first', 'topics', 'filter-words.md'))!.meta.status).toBe('live')
})

test("a skill rewrite naming another known book's character is rejected: the inbox is shared", async () => {
  // Book A (first) has Mara; the audit runs for book B (second), which has no bible.
  mkdirSync(join(bookDir, 'bible', 'characters'), { recursive: true })
  writeFileSync(join(bookDir, 'bible', 'characters', 'CHAR-MARA.md'), '---\nid: CHAR-MARA\nname: Mara Quill\nrole: lead\narcBeats: [a]\n---\nA diver.\n')
  const other = mkdtempSync(join(tmpdir(), 'nb-mr-book2-'))
  writeFileSync(join(other, 'book.yaml'), 'id: second\nseries: null\n')
  const call: Call = async p => ({ result: p.startsWith('AUDIT') ? JSON.stringify([{ lesson: 'inbox/chase/SKILL.md', verdict: 'REWRITE', reason: 'Clearer.', summary: 'Use when a scene drags', body: 'Do what Mara does: cut it.' }]) : '', costUsd: 0 })
  const r = new MemoryRunner({ root, claudeProjects: projects, settings, call, today: () => day })
  await r.init(); await r.addBook(bookDir); await r.addBook(other)
  mkdirSync(join(root, 'inbox', 'chase'), { recursive: true })
  writeFileSync(join(root, 'inbox', 'chase', 'SKILL.md'), '---\nname: chase\ndescription: Use when a scene drags\n---\nCut the slack beat.\n')
  await seedCommit()
  enqueue(root, { kind: 'audit', book: other })
  await r.drain()
  expect(existsSync(join(root, 'inbox', 'chase'))).toBe(false) // a rewrite failing the checks deletes the proposal
  expect(r.lessons(other).log).toMatchObject([{ lesson: 'skill chase', action: 'deleted', reason: expect.stringMatching(/failed the memory checks: .*story fact \(\[name\]/) }])
})

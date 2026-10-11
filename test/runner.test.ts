import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parse, stringify } from 'yaml'
import { newBook } from '../src/main/book/create'
import { commitAll, git } from '../src/main/book/git'
import { Runner } from '../src/main/run/runner'
import { readRunState, readSpend } from '../src/main/run/state'
import { REQUIRED_REVIEWERS, RunState } from '../src/shared/schemas'
import { readRoom } from '../src/main/run/room'
import type { RoomEntry } from '../src/shared/types'
import type { Usage } from '../src/shared/usage'

vi.setConfig({ testTimeout: 60000 })

const fake = join(__dirname, 'fixtures', 'fake-claude-headless.cmd')
const opts = { title: 'Run Book', audience: 'adult' as const, genres: ['literary' as const], wordTarget: 60000 }
const SCENES = ['SC-001', 'SC-002', 'SC-003']

let dir: string
let log: string
const put = (rel: string, text: string) => writeFileSync(join(dir, rel), text)
const prompts = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split(/\r?\n/) : [])
const status = (id: string) => parse(readFileSync(join(dir, `outline/scenes/${id}.yaml`), 'utf8')).status
const runner = (o: Partial<ConstructorParameters<typeof Runner>[0]> = {}) =>
  new Runner({ bookDir: dir, command: fake, models: { showrunner: 'opus' }, stepTimeoutMs: 30000, ...o })

beforeEach(async () => {
  dir = await newBook(mkdtempSync(join(tmpdir(), 'nb run ')), opts, resolve('kit/fiction'), resolve('resources/hooks'), resolve('resources/accept/accept.mjs'))
  put('bible/characters/CHAR-RUTH.md', '---\nid: CHAR-RUTH\nname: Ruth Prewitt\nrole: protagonist\narcBeats: [denial, acceptance]\n---\nA farmer.\n')
  put('bible/places/LOC-FIELD.md', '---\nid: LOC-FIELD\nname: The north field\n---\nCorn.\n')
  put('outline/outline.yaml', `acts:\n  - id: ACT-1\n    title: Beginning\n    chapters:\n      - { id: CH-01, title: One, scenes: [${SCENES.join(', ')}] }\n`)
  for (const id of SCENES)
    put(`outline/scenes/${id}.yaml`, `id: ${id}\ntitle: Scene ${id}\ngoal: Ruth finds the dead row\npov: CHAR-RUTH\nlocation: LOC-FIELD\nstoryTime: "Day 1"\nbeats: [Ruth walks the rows]\narcBeats: []\nmustReveal: []\nstatus: planned\n`)
  await commitAll(dir, 'Outline')
  log = join(mkdtempSync(join(tmpdir(), 'nb runlog ')), 'prompts.log')
  process.env.FAKE_LOG = log
  process.env.FAKE_SCENARIO = 'ok'
})
afterEach(() => { for (const k of ['FAKE_SCENARIO', 'FAKE_LOG', 'FAKE_PID_FILE', 'FAKE_COST', 'FAKE_NORESULT', 'FAKE_USAGE']) delete process.env[k] })

const twoActs = () => {
  put('outline/outline.yaml', readFileSync(join(dir, 'outline/outline.yaml'), 'utf8') + '  - id: ACT-2\n    title: Middle\n    chapters:\n      - { id: CH-02, title: Two, scenes: [SC-004] }\n')
  put('outline/scenes/SC-004.yaml', readFileSync(join(dir, 'outline/scenes/SC-003.yaml'), 'utf8').replace(/SC-003/g, 'SC-004'))
}

// One act: the planner reports done (done wins over checkpoint); a second act shows the checkpoint.
test('runs a small book to the act checkpoint', async () => {
  twoActs()
  const r = runner()
  await r.start({ stopAt: 'act' })
  const s = r.status()
  expect(s.status).toBe('checkpoint')
  expect(s.completed).toEqual(SCENES)
  expect(s.checkedChapters).toEqual(['CH-01'])
  expect(s.checkedActs).toEqual(['ACT-1'])
  for (const id of SCENES) expect(status(id)).toBe('accepted')
  expect((await git(dir, 'log', '--format=%s')).split('\n').filter(l => l.startsWith('Accept SC-'))).toHaveLength(3)
  expect(prompts()).toEqual(['/write-scene SC-001', '/write-scene SC-002', '/write-scene SC-003', '/check-chapter CH-01', '/check-act ACT-1'])
  expect(readRunState(dir)).toEqual(s)
})

test('each paid step is itemised in run/spend.jsonl', async () => {
  const r = runner({ now: () => new Date('2026-10-04T12:00:00Z') })
  await r.start({ stopAt: 'act' })
  const spend = readSpend(dir)
  expect(spend.map(e => `${e.kind} ${e.id}`)).toEqual(['scene SC-001', 'scene SC-002', 'scene SC-003', 'chapter CH-01', 'act ACT-1', 'book BOOK'])
  expect(spend.every(e => e.at === '2026-10-04T12:00:00.000Z')).toBe(true)
  expect(spend.reduce((n, e) => n + e.usd, 0)).toBeCloseTo(r.status().spentUsd)
})

test('with act pauses off, a two-act book runs through to done', async () => {
  twoActs()
  const r = runner()
  await r.start({ stopAt: 'book', pauseAtActs: false })
  expect(r.status()).toMatchObject({ status: 'done', pauseAtActs: false, checkedActs: ['ACT-1', 'ACT-2'] })
  expect(prompts().slice(-4)).toEqual(['/write-scene SC-004', '/check-chapter CH-02', '/check-act ACT-2', '/check-book'])
  expect(readRunState(dir).pauseAtActs).toBe(false)
})

test('with act pauses on, a two-act book stops at the first act checkpoint', async () => {
  twoActs()
  const r = runner()
  await r.start({ stopAt: 'book', pauseAtActs: true })
  expect(r.status()).toMatchObject({ status: 'checkpoint', pauseAtActs: true, checkedActs: ['ACT-1'] })
})

test('an old state file without pauseAtActs reads as pausing at acts', () => {
  mkdirSync(join(dir, 'run'), { recursive: true })
  const { pauseAtActs: _, ...old } = readRunState(dir)
  writeFileSync(join(dir, 'run/state.yaml'), stringify(old))
  expect(readRunState(dir).pauseAtActs).toBe(true)
})

test('parks after three failed rounds', async () => {
  process.env.FAKE_SCENARIO = 'fail:SC-002'
  const r = runner()
  await r.start({ stopAt: 'act' })
  expect(r.status()).toMatchObject({ status: 'needs-you', completed: ['SC-001'], parked: ['SC-002'] })
  expect(status('SC-002')).toBe('needs-you')
  expect(prompts().join('\n')).not.toMatch(/SC-003/)
  // The park is the runner's own line in #needs-you; the gate's FAIL reviews of the step are in the room.
  const room = readRoom(dir).filter(e => e.step === 'SC-002')
  expect(room.at(-1)).toMatchObject({ from: 'app', kind: 'system', needsYou: true })
  expect(room.at(-1)!.text.startsWith('SC-002: parked')).toBe(true)
  expect(room.find(e => e.from === 'gate-checker')).toMatchObject({ kind: 'review', verdict: 'FAIL' })
})

test('the room log holds the step\'s real dispatches, replies, reviews and outcome', async () => {
  const r = runner()
  const pushed: RoomEntry[] = []
  r.on('room', (es: RoomEntry[]) => pushed.push(...es))
  await r.start({ stopAt: 'scene' })
  const room = readRoom(dir)
  expect(room).toEqual(pushed)
  const sc = room.filter(e => e.step === 'SC-001')
  expect(sc.map(e => e.kind)).toEqual(['say', 'dispatch', 'reply', ...REQUIRED_REVIEWERS.map(() => 'review'), 'system'])
  expect(sc[1]).toMatchObject({ from: 'showrunner', to: 'author', text: 'Draft SC-001, round 1.' })
  expect(sc[2]).toEqual({ at: sc[2].at, step: 'SC-001', from: 'author', to: 'showrunner', kind: 'reply', text: 'DRAFTED SC-001 round 1' }) // the hand-back frame is gone
  expect(sc.find(e => e.from === 'line-editor')).toMatchObject({ kind: 'review', verdict: 'PASS' })
  expect(sc.at(-1)).toMatchObject({ from: 'app', kind: 'system' })
  expect(sc.at(-1)!.needsYou).toBeUndefined()
  expect(sc.at(-1)!.text.startsWith('SC-001: accepted')).toBe(true)
  expect(room.some(e => e.text.includes('a subagent thinking aloud'))).toBe(false)
})

test('stops at a usage limit and records resumeAfter', async () => {
  process.env.FAKE_SCENARIO = 'limit'
  const r = runner()
  await r.start({ stopAt: 'act' })
  expect(r.status()).toMatchObject({ status: 'usage-limit', resumeAfter: '2:50pm (America/Toronto)' })
  expect(prompts()).toHaveLength(1)
})

test('resumes after a usage limit without redoing accepted scenes', async () => {
  const first = runner()
  first.on('state', s => { if (s.completed.includes('SC-001')) process.env.FAKE_SCENARIO = 'limit' })
  await first.start({ stopAt: 'act' })
  expect(first.status()).toMatchObject({ status: 'usage-limit', completed: ['SC-001'] })
  process.env.FAKE_SCENARIO = 'ok'
  const second = runner()
  await second.start({ stopAt: 'act' })
  expect(second.status()).toMatchObject({ status: 'done', completed: SCENES, resumeAfter: null })
  expect(prompts().filter(p => p.includes('SC-001'))).toHaveLength(1)
})

test('times out a hung step', async () => {
  process.env.FAKE_SCENARIO = 'hang'
  const r = runner({ stepTimeoutMs: 2000 })
  await r.start({ stopAt: 'act' })
  expect(r.status().status).toBe('error')
  expect(r.status().lastError).toMatch(/timed out/)
  expect(prompts()).toEqual(['/write-scene SC-001', '/write-scene SC-001'])
})

test('a step that fails with a non-limit error twice ends in error', async () => {
  process.env.FAKE_SCENARIO = 'nonzero'
  const r = runner()
  await r.start({ stopAt: 'act' })
  expect(r.status()).toMatchObject({ status: 'error', current: null })
  expect(r.status().lastError).toMatch(/exit 3/)
  expect(prompts()).toHaveLength(2)
})

test('does not trust a step that claims acceptance without it', async () => {
  process.env.FAKE_SCENARIO = 'lie'
  const r = runner()
  await r.start({ stopAt: 'act' })
  expect(r.status()).toMatchObject({ status: 'needs-you', completed: [] })
  expect(r.status().lastError).toMatch(/SC-001 claims accepted but has no manuscript or Accept commit; reset it to planned/)
  expect(prompts()).toHaveLength(1) // an untrusted step is not retried
  expect(await git(dir, 'log', '-1', '--format=%s')).toBe('Step SC-001 working files') // failed steps commit their working files too
})

test('a step that forges the accepted status without acceptance stops for the writer', async () => {
  process.env.FAKE_SCENARIO = 'forge'
  const r = runner()
  await r.start({ stopAt: 'act' })
  expect(r.status()).toMatchObject({ status: 'needs-you', completed: [] })
  expect(r.status().lastError).toMatch(/SC-001 claims accepted but has no manuscript or Accept commit; reset it to planned/)
  expect(existsSync(join(dir, 'manuscript/SC-001.md'))).toBe(false)
  expect(prompts()).toHaveLength(1)
  // The app's own voice in the room never repeats the unverified claim, and the stop is in #needs-you once.
  const app = readRoom(dir).filter(e => e.from === 'app')
  expect(app.some(e => e.text.startsWith('SC-001: accepted'))).toBe(false)
  expect(app.filter(e => e.needsYou).map(e => e.text)).toEqual([expect.stringMatching(/SC-001 claims accepted/)])
  // and a later run does not skip the forged scene: no manuscript means not accepted
  process.env.FAKE_SCENARIO = 'ok'
  await runner().start({ stopAt: 'scene' })
  expect(prompts()).toEqual(['/write-scene SC-001', '/write-scene SC-001'])
})

test('a revise that accepted but lost its result line is not run again', async () => {
  process.env.FAKE_SCENARIO = 'revise:CH-01:SC-002'
  process.env.FAKE_NORESULT = 'revise-scene'
  const r = runner()
  await r.start({ stopAt: 'act' })
  expect(r.status().status).toBe('done')
  expect(prompts().filter(p => p.startsWith('/revise-scene'))).toHaveLength(1)
  expect((await git(dir, 'log', '--format=%s')).split('\n').filter(l => l.startsWith('Accept SC-002:'))).toHaveLength(2)
})

test('spending is tracked for display, including failed steps, and never stops the run', async () => {
  process.env.FAKE_SCENARIO = 'error'
  process.env.FAKE_COST = '3'
  const r = runner()
  await r.start({ stopAt: 'act' })
  expect(r.status()).toMatchObject({ status: 'error', spentUsd: 6 })
  process.env.FAKE_SCENARIO = 'ok'
  await r.start({ stopAt: 'scene' })
  expect(r.status()).toMatchObject({ status: 'paused', completed: ['SC-001'], spentUsd: 9 })
  expect(r.status().lastError).toBeNull()
})

test('a chapter check that names no valid scene ids needs the writer', async () => {
  const r = runner()
  const logs: string[] = []
  r.on('log', l => logs.push(l))
  // the chapter check's revise list names an id that is not a scene id
  process.env.FAKE_SCENARIO = 'revise:CH-01:SC-1('
  await r.start({ stopAt: 'act' })
  expect(r.status().status).toBe('needs-you')
  expect(r.status().lastError).toMatch(/CH-01/)
  expect(logs.join('\n')).toMatch(/ignored.*SC-1\(/)
  expect(prompts().some(p => p.startsWith('/revise-scene'))).toBe(false)
  expect(readRoom(dir).filter(e => e.needsYou).map(e => e.text)).toEqual(['CH-01 asked for revisions but named no scene of it']) // once, not twice
})

test('start rejects a bad stop-at with a state event, not a throw', async () => {
  const r = runner()
  const seen: unknown[] = []
  r.on('state', s => seen.push(s))
  await r.start({ stopAt: 'forever' as never })
  expect(seen).toHaveLength(1)
  expect(r.status()).toMatchObject({ status: 'error' })
  expect(r.status().lastError).toMatch(/stop-at/i)
  expect(prompts()).toHaveLength(0)
})

test('a stale running state loads as paused, and released parks are pruned at start', async () => {
  const stale = { ...readRunState(dir), status: 'running', current: { kind: 'scene', id: 'SC-002', round: 1 }, parked: ['SC-002'] }
  mkdirSync(join(dir, 'run'), { recursive: true })
  writeFileSync(join(dir, 'run/state.yaml'), stringify(stale))
  expect(readRunState(dir)).toMatchObject({ status: 'paused', current: null })
  expect(parse(readFileSync(join(dir, 'run/state.yaml'), 'utf8')).status).toBe('paused')
  const r = runner()
  await r.start({ stopAt: 'scene' })
  expect(r.status()).toMatchObject({ status: 'paused', parked: [], completed: ['SC-001'] })
})

test('a corrupt state file is kept as state.yaml.bad and replaced by defaults', () => {
  mkdirSync(join(dir, 'run'), { recursive: true })
  writeFileSync(join(dir, 'run/state.yaml'), 'status: [unclosed\n')
  const logs: string[] = []
  expect(readRunState(dir, l => logs.push(l))).toMatchObject({ status: 'idle', spentUsd: 0 })
  expect(readFileSync(join(dir, 'run/state.yaml.bad'), 'utf8')).toMatch(/unclosed/)
  expect(RunState.parse(parse(readFileSync(join(dir, 'run/state.yaml'), 'utf8'))).status).toBe('idle')
  expect(logs.join()).toMatch(/state\.yaml\.bad/)
})

test('a corrupt state file keeps the spent total and the warning reaches a listener attached later', async () => {
  mkdirSync(join(dir, 'run'), { recursive: true })
  writeFileSync(join(dir, 'run/state.yaml'), 'status: bogus\nspentUsd: 4.5\n')
  const r = runner()
  expect(r.status()).toMatchObject({ status: 'idle', spentUsd: 4.5 })
  expect(r.status().lastError).toMatch(/state\.yaml\.bad/)
  const logs: string[] = []
  r.on('log', l => logs.push(l))
  await new Promise(res => setImmediate(res))
  expect(logs.join()).toMatch(/state\.yaml\.bad/)
})

test('pause kills the running step', async () => {
  process.env.FAKE_SCENARIO = 'hang'
  const pidFile = join(mkdtempSync(join(tmpdir(), 'nb pid ')), 'pid')
  process.env.FAKE_PID_FILE = pidFile
  const r = runner({ stepTimeoutMs: 60000 })
  const t0 = Date.now()
  const run = r.start({ stopAt: 'act' })
  while (!existsSync(pidFile) || !readFileSync(pidFile, 'utf8')) await new Promise(res => setTimeout(res, 100))
  const pid = Number(readFileSync(pidFile, 'utf8'))
  r.pause()
  await run
  expect(Date.now() - t0).toBeLessThan(30000)
  expect(r.status()).toMatchObject({ status: 'paused', current: null })
  expect(() => process.kill(pid, 0)).toThrow()
  expect(prompts()).toHaveLength(1)
})

test('state file is valid after every step', async () => {
  const r = runner()
  const seen: string[] = []
  r.on('state', () => { seen.push(RunState.parse(parse(readFileSync(join(dir, 'run/state.yaml'), 'utf8'))).status) })
  await r.start({ stopAt: 'act' })
  expect(seen.length).toBeGreaterThanOrEqual(6)
  expect(seen.at(-1)).toBe('done')
})

test('a chapter revise reopens the scene and re-checks the chapter', async () => {
  process.env.FAKE_SCENARIO = 'revise:CH-01:SC-002'
  const r = runner()
  await r.start({ stopAt: 'act' })
  expect(prompts()).toEqual(['/write-scene SC-001', '/write-scene SC-002', '/write-scene SC-003', '/check-chapter CH-01',
    '/revise-scene SC-002 reviews/CH-01/arc.md', '/check-chapter CH-01', '/check-act ACT-1', '/check-book'])
  expect(r.status()).toMatchObject({ status: 'done', completed: SCENES, checkedChapters: ['CH-01'], checkedActs: ['ACT-1'] })
  expect(status('SC-002')).toBe('accepted')
})

test('an act revise prunes the checked chapter so it is checked again', async () => {
  process.env.FAKE_SCENARIO = 'actrevise:ACT-1:SC-001'
  const r = runner()
  await r.start({ stopAt: 'act' })
  expect(prompts().slice(4)).toEqual(['/check-act ACT-1', '/revise-scene SC-001 reviews/ACT-1/developmental.md', '/check-chapter CH-01', '/check-act ACT-1', '/check-book'])
  expect(r.status().status).toBe('done')
})

test('working files are committed after a step and canon is never staged by that commit', async () => {
  process.env.FAKE_SCENARIO = 'fail:SC-001'
  writeFileSync(join(dir, 'canon/knowledge.yaml'), 'entries: []\n# staged by someone else\n')
  await git(dir, 'add', 'canon/knowledge.yaml')
  const r = runner()
  await r.start({ stopAt: 'act' })
  expect(r.status().status).toBe('needs-you')
  expect(await git(dir, 'log', '-1', '--format=%s')).toBe('Step SC-001 working files')
  const files = (await git(dir, 'show', '--name-only', '--format=', 'HEAD')).split('\n')
  expect(files).toContain('reviews/SC-001/park.md')
  expect(files).toContain('outline/scenes/SC-001.yaml')
  expect(files).toContain('drafts/SC-001.md')
  expect(files.every(f => /^(bible|outline|notes|reviews|drafts|proposals)\//.test(f))).toBe(true)
  expect(await git(dir, 'diff', '--cached', '--name-only')).toBe('canon/knowledge.yaml')
})

test('accepted steps also commit their reviews, leaving a clean tree', async () => {
  const r = runner()
  await r.start({ stopAt: 'scene' })
  expect(r.status()).toMatchObject({ status: 'paused', completed: ['SC-001'] })
  expect((await git(dir, 'log', '-2', '--format=%s')).split('\n')).toEqual(['Step SC-001 working files', expect.stringMatching(/^Accept SC-001/)])
  expect(await git(dir, 'status', '--porcelain')).toBe('')
})

test('after pause the runner stays active until idle; start is refused meanwhile, then works', async () => {
  process.env.FAKE_SCENARIO = 'hang'
  const pidFile = join(mkdtempSync(join(tmpdir(), 'nb pid ')), 'pid')
  process.env.FAKE_PID_FILE = pidFile
  const r = runner({ stepTimeoutMs: 60000 })
  const run = r.start({ stopAt: 'act' })
  expect(r.isActive()).toBe(true)
  while (!existsSync(pidFile) || !readFileSync(pidFile, 'utf8')) await new Promise(res => setTimeout(res, 100))
  r.pause()
  expect(r.status().status).toBe('paused')
  expect(r.isActive()).toBe(true)
  await expect(r.start({ stopAt: 'act' })).rejects.toThrow(/already going/)
  await r.idle()
  await run
  expect(r.isActive()).toBe(false)
  process.env.FAKE_SCENARIO = 'ok'
  await r.start({ stopAt: 'act' })
  expect(r.status().status).toBe('done')
})

test('an act check that passes awaits the memory deep pass before the checkpoint', async () => {
  twoActs()
  const order: string[] = []
  const r = runner({ onCheckpoint: async (kind, id) => { order.push(`start ${kind} ${id}`); await new Promise(res => setTimeout(res, 50)); order.push(`end ${kind} ${id}`) } })
  r.on('state', s => { if (s.status === 'checkpoint' || s.status === 'done') order.push(s.status) })
  await r.start({ stopAt: 'book' })
  expect(r.status().status).toBe('checkpoint')
  expect(order.indexOf('end act ACT-1')).toBeGreaterThan(-1)
  expect(order.indexOf('end act ACT-1')).toBeLessThan(order.findIndex(x => x === 'checkpoint' || x === 'done'))
  expect(order).toContain('start chapter CH-01')
})

test('a pause during the act memory flush ends the loop at once and calls onPause', async () => {
  twoActs()
  let flushing!: () => void
  const inFlush = new Promise<void>(res => (flushing = res))
  let paused = 0
  // The act flush never settles on its own: the loop must not wait for it after a pause.
  const r = runner({ onCheckpoint: kind => (kind === 'act' ? (flushing(), new Promise<void>(() => {})) : Promise.resolve()), onPause: () => { paused++ } })
  const run = r.start({ stopAt: 'book' })
  await inFlush
  const t0 = Date.now()
  r.pause()
  await r.idle()
  await run
  expect(Date.now() - t0).toBeLessThan(5000)
  expect(r.isActive()).toBe(false)
  expect(paused).toBe(1)
  expect(r.status()).toMatchObject({ status: 'paused', current: null, checkedActs: ['ACT-1'] })
  expect(prompts()).not.toContain('/write-scene SC-004')
})

test('a pause after the act check passes but before its flush only queues the memory jobs', async () => {
  twoActs()
  const seen: string[] = []
  const r = runner({ onCheckpoint: async (kind, id, o) => { seen.push(`${kind} ${id} ${o?.enqueueOnly ? 'queue' : 'run'}`) } })
  // Pause lands while the act check's working files are committed, before onCheckpoint is called.
  r.on('log', l => { if (/ACT-1: pass/.test(l)) r.pause() })
  await r.start({ stopAt: 'book' })
  expect(r.status().status).toBe('paused')
  expect(seen).toContain('act ACT-1 queue')
  expect(seen).not.toContain('act ACT-1 run')
})

test('a failing memory checkpoint is logged and does not stop the run', async () => {
  const r = runner({ onCheckpoint: async () => { throw new Error('distiller down') } })
  const logs: string[] = []
  r.on('log', l => logs.push(l))
  await r.start({ stopAt: 'book' })
  expect(['done', 'checkpoint']).toContain(r.status().status)
  expect(r.status().lastError).toBeNull()
  expect(logs.join('\n')).toMatch(/memory: distiller down/)
})

const RESET = 4102444800 // the fake's default reset (2100-01-01): never passes during a test
function metered(o: Partial<ConstructorParameters<typeof Runner>[0]> = {}) {
  const box: { latest: Usage | null; flushed: number } = { latest: null, flushed: 0 }
  const r = runner({ usage: async () => box.latest, onUsage: u => { box.latest = u }, usageStopAt: () => 90, onUsageStop: async () => { box.flushed++ }, ...o })
  return { r, box }
}
const over = (pct: number, resetsAt: number): Usage => ({ source: 'stream', at: Date.now(), fiveHour: { pct, resetsAt }, sevenDay: null })

test('at 95% of the 5-hour window the run stops before the next scene, flushes memory and waits for the reset', async () => {
  process.env.FAKE_USAGE = '95'
  const { r, box } = metered()
  await r.start({ stopAt: 'book' })
  expect(r.status()).toMatchObject({ status: 'usage-limit', completed: ['SC-001'], current: null, resumeAfter: new Date(RESET * 1000).toLocaleString() })
  expect(r.status().lastError).toMatch(/95% of the 5-hour window \(stop at 90%\)/)
  expect(prompts()).toEqual(['/write-scene SC-001'])
  expect(box.flushed).toBe(1)
  expect(readRoom(dir).at(-1)).toMatchObject({ step: 'SC-002', from: 'app', kind: 'system', text: expect.stringMatching(/^Plan usage is at 95% of the 5-hour window; the run stops until /) })
})

test('at 50% the run goes on', async () => {
  process.env.FAKE_USAGE = '50'
  const { r, box } = metered()
  await r.start({ stopAt: 'book' })
  expect(r.status().status).toBe('done')
  expect(prompts()).toHaveLength(6)
  expect(box.flushed).toBe(0)
})

test('a rate_limit_event with no windows never stops the run', async () => {
  process.env.FAKE_USAGE = 'missing'
  const { r, box } = metered()
  await r.start({ stopAt: 'book' })
  expect(r.status().status).toBe('done')
  expect(box.latest).toBeNull()
})

test('steps with no rate_limit_event at all never stop the run', async () => {
  const { r, box } = metered()
  await r.start({ stopAt: 'book' })
  expect(r.status().status).toBe('done')
  expect(prompts()).toHaveLength(6)
  expect(box.latest).toBeNull()
})

test('a usage reading that fails, or a window with no reset time, never stops the run', async () => {
  const { r } = metered({ usage: async () => { throw new Error('headroom down') } })
  await r.start({ stopAt: 'book' })
  expect(r.status().status).toBe('done')
  const noReset = metered()
  noReset.box.latest = over(99, null as unknown as number)
  await noReset.r.start({ stopAt: 'book' })
  expect(noReset.r.status().status).toBe('done')
})

test('chapter checks follow the same rule', async () => {
  const { r, box } = metered()
  r.on('state', s => { if (s.completed.length === 3) box.latest = over(91, Date.now() + 3_600_000) })
  await r.start({ stopAt: 'book' })
  expect(r.status()).toMatchObject({ status: 'usage-limit', completed: SCENES, checkedChapters: [] })
  expect(prompts()).not.toContain('/check-chapter CH-01')
})

test('with both windows over the stop point the run resumes after the later reset', async () => {
  const { r, box } = metered()
  const soon = Date.now() + 3_600_000, later = Date.now() + 86_400_000
  box.latest = { source: 'stream', at: Date.now(), fiveHour: { pct: 95, resetsAt: soon }, sevenDay: { pct: 92, resetsAt: later } }
  await r.start({ stopAt: 'book' })
  expect(r.status()).toMatchObject({ status: 'usage-limit', resumeAfter: new Date(later).toLocaleString() })
  expect(r.status().lastError).toMatch(/92% of the weekly window/)
})

test('Start before the reset stops at once with no step; after the reset the old reading is ignored', async () => {
  const { r, box } = metered()
  box.latest = over(97, Date.now() + 3_600_000)
  await r.start({ stopAt: 'book' })
  expect(r.status().status).toBe('usage-limit')
  expect(prompts()).toEqual([])
  await r.start({ stopAt: 'book' })
  expect(r.status().status).toBe('usage-limit')
  expect(prompts()).toEqual([])
  box.latest = over(97, Date.now() - 1000)
  await r.start({ stopAt: 'book' })
  expect(r.status().status).toBe('done')
})

test('at 100% the run stops without the memory flush', async () => {
  const { r, box } = metered()
  box.latest = over(100, Date.now() + 3_600_000)
  await r.start({ stopAt: 'book' })
  expect(r.status().status).toBe('usage-limit')
  expect(box.flushed).toBe(0)
})

test('the stopping window under 100% but the other window full skips the memory flush', async () => {
  const { r, box } = metered()
  // The 5-hour window resets later, so overLimit picks it; the weekly window is already full.
  box.latest = { source: 'stream', at: Date.now(), fiveHour: { pct: 95, resetsAt: Date.now() + 7_200_000 }, sevenDay: { pct: 100, resetsAt: Date.now() + 3_600_000 } }
  await r.start({ stopAt: 'book' })
  expect(r.status().status).toBe('usage-limit')
  expect(r.status().lastError).toMatch(/95% of the 5-hour window/)
  expect(box.flushed).toBe(0)
})

test('a failing usage-stop memory flush is logged and the run still stops for usage', async () => {
  const { r, box } = metered({ onUsageStop: async () => { throw new Error('distiller down') } })
  const logs: string[] = []
  r.on('log', l => logs.push(l))
  box.latest = over(95, Date.now() + 3_600_000)
  await r.start({ stopAt: 'book' })
  expect(r.status().status).toBe('usage-limit')
  expect(logs.join('\n')).toMatch(/memory: distiller down/)
})

test('a pause during the usage-stop memory flush ends the run at once and cancels memory', async () => {
  let flushing!: () => void
  const inFlush = new Promise<void>(res => (flushing = res))
  let cancelled = 0
  const { r, box } = metered({ onUsageStop: () => (flushing(), new Promise<void>(() => {})), onPause: () => { cancelled++ } })
  box.latest = over(95, Date.now() + 3_600_000)
  const run = r.start({ stopAt: 'book' })
  await inFlush
  const t0 = Date.now()
  r.pause()
  await r.idle()
  await run
  expect(Date.now() - t0).toBeLessThan(5000)
  expect(cancelled).toBe(1)
  expect(r.status()).toMatchObject({ status: 'paused', resumeAfter: null })
  expect(prompts()).toEqual([])
})

test('a pause while usage is read pauses the run with no step started', async () => {
  let reading!: () => void
  const inRead = new Promise<void>(res => (reading = res))
  let release!: (u: Usage | null) => void
  const { r } = metered({ usage: () => (reading(), new Promise<Usage | null>(res => (release = res))) })
  const run = r.start({ stopAt: 'book' })
  await inRead
  r.pause()
  release(null)
  await run
  expect(r.status()).toMatchObject({ status: 'paused', resumeAfter: null })
  expect(prompts()).toEqual([])
})

test('a finished book is checked as a whole, then the run is done', async () => {
  const r = runner()
  await r.start({ stopAt: 'book' })
  expect(prompts().slice(-3)).toEqual(['/check-chapter CH-01', '/check-act ACT-1', '/check-book'])
  expect(r.status()).toMatchObject({ status: 'done', checkedBook: true })
  expect(readSpend(dir).map(e => e.kind).at(-1)).toBe('book')
})
test('a book check revise reopens the scene and checks its chapter, act and the book again', async () => {
  process.env.FAKE_SCENARIO = 'bookrevise:SC-002'
  const r = runner()
  await r.start({ stopAt: 'book' })
  expect(prompts().slice(5)).toEqual(['/check-book', '/revise-scene SC-002 reviews/BOOK/developmental.md', '/check-chapter CH-01', '/check-act ACT-1', '/check-book'])
  expect(r.status()).toMatchObject({ status: 'done', checkedBook: true })
})
test('accepting a new scene clears the book check', async () => {
  const r = runner()
  await r.start({ stopAt: 'book' })
  put('outline/outline.yaml', readFileSync(join(dir, 'outline/outline.yaml'), 'utf8').replace('SC-003]', 'SC-003, SC-004]'))
  put('outline/scenes/SC-004.yaml', readFileSync(join(dir, 'outline/scenes/SC-003.yaml'), 'utf8').replace(/SC-003/g, 'SC-004'))
  await r.start({ stopAt: 'book' })
  expect(prompts().slice(-1)).toEqual(['/check-book'])
  expect(prompts().filter(p => p === '/check-book')).toHaveLength(2)
})

test('a step that started without the hooks or kit stops the run before anything is written', async () => {
  process.env.FAKE_SCENARIO = 'nokit'
  const versions: string[] = []
  const r = runner({ onClaudeVersion: v => versions.push(v) })
  await r.start({ stopAt: 'act' })
  expect(r.status()).toMatchObject({ status: 'error', completed: [] })
  expect(r.status().lastError).toMatch(/started without the book's hooks or kit/)
  expect(prompts()).toEqual(['/write-scene SC-001']) // not retried
  expect(existsSync(join(dir, 'drafts', 'NOKIT.md'))).toBe(false)
  expect(versions).toEqual(['9.9.9-fake'])
  expect(readRoom(dir).some(e => e.needsYou && /hooks or kit/.test(e.text))).toBe(true)
})

test('every step of a normal run reports the Claude Code version', async () => {
  const versions: string[] = []
  await runner({ onClaudeVersion: v => versions.push(v) }).start({ stopAt: 'scene' })
  expect(versions.length).toBeGreaterThan(0)
  expect(new Set(versions)).toEqual(new Set(['9.9.9-fake']))
})

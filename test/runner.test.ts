import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parse, stringify } from 'yaml'
import { newBook } from '../src/main/book/create'
import { commitAll, git } from '../src/main/book/git'
import { Runner } from '../src/main/run/runner'
import { readRunState } from '../src/main/run/state'
import { RunState } from '../src/shared/schemas'

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
afterEach(() => { for (const k of ['FAKE_SCENARIO', 'FAKE_LOG', 'FAKE_PID_FILE', 'FAKE_COST', 'FAKE_NORESULT']) delete process.env[k] })

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

test('with act pauses off, a two-act book runs through to done', async () => {
  twoActs()
  const r = runner()
  await r.start({ stopAt: 'book', pauseAtActs: false })
  expect(r.status()).toMatchObject({ status: 'done', pauseAtActs: false, checkedActs: ['ACT-1', 'ACT-2'] })
  expect(prompts().slice(-3)).toEqual(['/write-scene SC-004', '/check-chapter CH-02', '/check-act ACT-2'])
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
    '/revise-scene SC-002 reviews/CH-01/arc.md', '/check-chapter CH-01', '/check-act ACT-1'])
  expect(r.status()).toMatchObject({ status: 'done', completed: SCENES, checkedChapters: ['CH-01'], checkedActs: ['ACT-1'] })
  expect(status('SC-002')).toBe('accepted')
})

test('an act revise prunes the checked chapter so it is checked again', async () => {
  process.env.FAKE_SCENARIO = 'actrevise:ACT-1:SC-001'
  const r = runner()
  await r.start({ stopAt: 'act' })
  expect(prompts().slice(4)).toEqual(['/check-act ACT-1', '/revise-scene SC-001 reviews/ACT-1/developmental.md', '/check-chapter CH-01', '/check-act ACT-1'])
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

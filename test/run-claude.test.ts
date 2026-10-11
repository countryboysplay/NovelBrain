import { describe, it, expect, afterEach } from 'vitest'
import { cpSync, existsSync, mkdtempSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { runClaude, parseUsageLimit, parseStepResult, UsageLimitError, kitCheck, KitMissingError, HOOK_LINE } from '../src/main/run/claude'

const fake = join(__dirname, 'fixtures', 'fake-claude-headless.cmd')
const book = () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'nb claude ')), 'book')
  cpSync(join(__dirname, 'fixtures', 'book-ok'), dir, { recursive: true })
  return dir
}
const run = (dir: string, prompt: string, extra: object = {}) => runClaude(prompt, { cwd: dir, command: fake, model: 'sonnet', timeoutMs: 30_000, ...extra })
afterEach(() => { delete process.env.FAKE_SCENARIO; delete process.env.FAKE_PID_FILE; delete process.env.FAKE_LOG; delete process.env.FAKE_COST; delete process.env.FAKE_USAGE })

describe('parseUsageLimit', () => {
  it('recognises the recorded strings and extracts the reset time', () => {
    expect(parseUsageLimit("You've hit your limit · resets 2:50pm (America/Toronto)")?.resetAt).toBe('2:50pm (America/Toronto)')
    expect(parseUsageLimit('Usage limit reached')).toBeInstanceOf(UsageLimitError)
    expect(parseUsageLimit('Claude AI usage limit reached|1760000000')?.resetAt).toBeTruthy()
    expect(parseUsageLimit('all fine')).toBeNull()
    expect(parseUsageLimit('The rate limit reached its peak; no usage limit in the story')).toBeNull()
    expect(parseUsageLimit('The pump limit reached the ceiling')).toBeNull()
  })
})

describe('parseStepResult', () => {
  it('reads the last line that parses as a step object, tolerating fences', () => {
    const r = parseStepResult('Done {"x":1}\n```json\n{"step":"scene","id":"SC-001","outcome":"accepted","rounds":1,"commit":"abc"}\n```\n')
    expect(r).toMatchObject({ step: 'scene', id: 'SC-001', outcome: 'accepted', commit: 'abc' })
  })
  it('returns null on garbage', () => {
    expect(parseStepResult('nothing here\n{not json}\n{"a":1}')).toBeNull()
  })
})

describe('runClaude', () => {
  it('rejects a model name that is not plain', async () => {
    await expect(run(book(), 'x', { model: 'sonnet & calc' })).rejects.toThrow(/invalid model/)
  })
  it('attaches the step cost to the errors it throws when the output has one', async () => {
    process.env.FAKE_SCENARIO = 'error'
    process.env.FAKE_COST = '3'
    await expect(run(book(), '/write-scene SC-001')).rejects.toMatchObject({ costUsd: 3 })
    process.env.FAKE_SCENARIO = 'nonzero'
    const e = await run(book(), '/write-scene SC-001').catch(x => x)
    expect(e.costUsd).toBeUndefined()
  })
  it('throws a clear error on a plain non-zero exit', async () => {
    process.env.FAKE_SCENARIO = 'nonzero'
    await expect(run(book(), '/write-scene SC-001')).rejects.toThrow(/Claude failed \(exit 3\)/)
  })
  it('throws a clear error on exit 0 with no JSON', async () => {
    process.env.FAKE_SCENARIO = 'nojson'
    await expect(run(book(), '/write-scene SC-001')).rejects.toThrow(/Claude failed \(exit 0\).*plain words/)
  })
  it('drives chapter and act revise scenarios once, then passes, with showrunner file sets', async () => {
    const dir = book()
    const log = join(mkdtempSync(join(tmpdir(), 'nb log ')), 'log')
    process.env.FAKE_LOG = log
    process.env.FAKE_SCENARIO = 'revise:CH-01:SC-001'
    const one = parseStepResult((await run(dir, '/check-chapter CH-01')).result)!
    expect(one).toMatchObject({ step: 'chapter', outcome: 'revise', rounds: 1, commit: null, revise: ['SC-001'] })
    expect(readFileSync(join(dir, 'reviews/CH-01/arc.md'), 'utf8')).toMatch(/verdict: FAIL\nrevise: \[SC-001\]/)
    expect(existsSync(join(dir, 'reviews/CH-01/gate.md'))).toBe(true)
    const two = parseStepResult((await run(dir, '/check-chapter CH-01')).result)!
    expect(two).toMatchObject({ outcome: 'pass', revise: [] })
    expect(readFileSync(join(dir, 'reviews/CH-01/arc.md'), 'utf8')).toMatch(/round: 2/)
    process.env.FAKE_SCENARIO = 'actrevise:ACT-1:SC-001'
    expect(parseStepResult((await run(dir, '/check-act ACT-1')).result)).toMatchObject({ step: 'act', outcome: 'revise', revise: ['SC-001'] })
    for (const f of ['developmental', 'continuity', 'gate']) expect(existsSync(join(dir, `reviews/ACT-1/${f}.md`))).toBe(true)
    expect(parseStepResult((await run(dir, '/check-act ACT-1')).result)).toMatchObject({ outcome: 'pass' })
  })
  it('revises an accepted scene at the next round', async () => {
    const dir = book()
    mkdirSync(join(dir, '.novelbrain'))
    cpSync(join(__dirname, '..', 'resources/accept/accept.mjs'), join(dir, '.novelbrain/accept.mjs'))
    const g = (...a: string[]) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' })
    g('init', '-q'); g('config', 'user.name', 't'); g('config', 'user.email', 't@t'); g('add', '-A'); g('-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'start')
    await run(dir, '/write-scene SC-001')
    const r = parseStepResult((await run(dir, '/revise-scene SC-001 reviews/CH-01/arc.md')).result)!
    expect(r).toMatchObject({ outcome: 'accepted', rounds: 1 })
    expect(r.commit).toBeTruthy()
    expect(readFileSync(join(dir, 'outline/scenes/SC-001.yaml'), 'utf8')).toMatch(/status: accepted/)
  })
  it('runs the fake in the book with the pinned flags and env', async () => {
    const dir = book()
    const r = await run(dir, '/check-chapter CH-01', { maxTurns: 7 })
    expect(r.costUsd).toBe(0.01)
    const step = parseStepResult(r.result)!
    expect(step).toMatchObject({ step: 'chapter', id: 'CH-01', outcome: 'pass' })
    expect(step.note).toContain('NoDefaultCurrentDirectoryInExePath=1')
    for (const a of ['-p', '--output-format stream-json', '--verbose', '--model sonnet', '--permission-mode acceptEdits', '--max-turns 7', 'settings.local.json'])
      expect(step.note).toContain(a)
    expect(existsSync(join(dir, 'reviews/CH-01/flow.md'))).toBe(true)
  })
  it('accepts a scene end to end through accept.mjs', async () => {
    const dir = book()
    mkdirSync(join(dir, '.novelbrain'))
    cpSync(join(__dirname, '..', 'resources/accept/accept.mjs'), join(dir, '.novelbrain/accept.mjs'))
    const g = (...a: string[]) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' })
    g('init', '-q'); g('config', 'user.name', 't'); g('config', 'user.email', 't@t'); g('add', '-A'); g('-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'start')
    const step = parseStepResult((await run(dir, '/write-scene SC-001')).result)!
    expect(step.outcome).toBe('accepted')
    expect(step.commit).toBeTruthy()
    expect(readFileSync(join(dir, 'outline/scenes/SC-001.yaml'), 'utf8')).toMatch(/status: accepted/)
  })
  it('parks a failing scene', async () => {
    const dir = book()
    process.env.FAKE_SCENARIO = 'fail:SC-001'
    expect(parseStepResult((await run(dir, '/write-scene SC-001')).result)).toMatchObject({ outcome: 'parked', rounds: 3 })
    expect(readFileSync(join(dir, 'outline/scenes/SC-001.yaml'), 'utf8')).toMatch(/status: needs-you/)
  })
  it('throws UsageLimitError on the limit scenario', async () => {
    process.env.FAKE_SCENARIO = 'limit'
    const e = await run(book(), '/write-scene SC-001').catch(x => x)
    expect(e).toBeInstanceOf(UsageLimitError)
    expect(e.resetAt).toBe('2:50pm (America/Toronto)')
  })
  it('throws on is_error', async () => {
    process.env.FAKE_SCENARIO = 'error'
    await expect(run(book(), '/write-scene SC-001')).rejects.toThrow(/boom/)
  })
  it('omits --settings when null and pins the allowed tools', async () => {
    const step = parseStepResult((await run(book(), '/check-chapter CH-01', { settings: null, allowedTools: ['Read', 'Write'], env: { NB_DISTILLER: '1' } })).result)!
    expect(step.note).not.toContain('--settings')
    expect(step.note).toContain('--allowedTools Read,Write --strict-mcp-config')
    await expect(run(book(), 'x', { allowedTools: ['Read&calc'] })).rejects.toThrow(/invalid tool/)
  })
  it('passes --disallowedTools and validates its names', async () => {
    const step = parseStepResult((await run(book(), '/check-chapter CH-01', { settings: null, allowedTools: [], disallowedTools: ['Bash', 'WebFetch'] })).result)!
    expect(step.note).toContain('--disallowedTools Bash,WebFetch')
    await expect(run(book(), 'x', { disallowedTools: ['Bash(rm *)'] })).rejects.toThrow(/invalid tool/)
  })
  it('reports the rate_limit_event of a call and still reads its result and cost', async () => {
    process.env.FAKE_USAGE = '59'
    const seen: unknown[] = []
    const r = await run(book(), '/check-chapter CH-01', { onUsage: (u: unknown) => seen.push(u) })
    expect(parseStepResult(r.result)).toMatchObject({ step: 'chapter', outcome: 'pass' })
    expect(r.costUsd).toBe(0.01)
    expect(seen).toEqual([expect.objectContaining({ source: 'stream', fiveHour: { pct: 59, resetsAt: 4102444800000 }, sevenDay: { pct: 20, resetsAt: 4102444800000 } })])
  })
  it('reports usage from a failing call too, and none when the event has no windows', async () => {
    process.env.FAKE_USAGE = '95'
    process.env.FAKE_SCENARIO = 'error'
    const seen: unknown[] = []
    await expect(run(book(), '/write-scene SC-001', { onUsage: (u: unknown) => seen.push(u) })).rejects.toThrow(/boom/)
    expect(seen).toHaveLength(1)
    process.env.FAKE_USAGE = 'missing'
    process.env.FAKE_SCENARIO = 'ok'
    const none: unknown[] = []
    await run(book(), '/check-chapter CH-01', { onUsage: (u: unknown) => none.push(u) })
    expect(none).toEqual([])
  })
  it('a throwing onUsage never fails the step', async () => {
    process.env.FAKE_USAGE = '59'
    const r = await run(book(), '/check-chapter CH-01', { onUsage: () => { throw new Error('ui gone') } })
    expect(parseStepResult(r.result)).toMatchObject({ step: 'chapter', outcome: 'pass' })
    expect(r.costUsd).toBe(0.01)
  })
  it('story text saying "hit your limit" in a failed stream with no result line is not a usage limit', async () => {
    process.env.FAKE_SCENARIO = 'prose'
    const e = await run(book(), '/write-scene SC-001').catch(x => x)
    expect(e).not.toBeInstanceOf(UsageLimitError)
    expect(e.message).toMatch(/Claude failed \(exit 1\)/)
  })
  it('times out a hung step and leaves no process behind', async () => {
    const pidFile = join(mkdtempSync(join(tmpdir(), 'nb pid ')), 'pid')
    process.env.FAKE_SCENARIO = 'hang'
    process.env.FAKE_PID_FILE = pidFile
    await expect(run(book(), '/write-scene SC-001', { timeoutMs: 2000 })).rejects.toThrow(/timed out/)
    const pid = Number(readFileSync(pidFile, 'utf8'))
    expect(pid).toBeGreaterThan(0)
    expect(() => process.kill(pid, 0)).toThrow()
  }, 20_000)
})

describe('runClaude onEvent', () => {
  it('sees each stream line as it comes; a throwing listener never fails the step', async () => {
    const seen: unknown[] = []
    const out = await run(book(), '/write-scene SC-001', { onEvent: (v: unknown) => { seen.push(v); throw new Error('listener broke') } })
    expect(out.result).toMatch(/"outcome"/)
    expect(seen.some(v => (v as { type?: string }).type === 'assistant')).toBe(true)
    expect(seen.at(-1)).toMatchObject({ type: 'result' })
  })
})

describe('kitCheck', () => {
  const hook = (stdout: string, outcome = 'success') => ({ type: 'system', subtype: 'hook_response', hook_event: 'SessionStart', outcome, stdout })
  const init = (o: object = {}) => ({ type: 'system', subtype: 'init', agents: ['author', 'Explore'], slash_commands: ['write-scene', 'ponytail'], claude_code_version: '2.1.296', ...o })
  const feed = (...events: unknown[]) => { const c = kitCheck(); let r = null; for (const e of events) r = c(e) ?? r; return r }
  it('passes with the book hook line and the kit', () => expect(feed(hook(`${HOOK_LINE}\nbrief`), init())).toEqual({ ok: true, version: '2.1.296' }))
  it('waits until init', () => expect(feed(hook(HOOK_LINE))).toBeNull())
  it('fails without the hook line, with a failed hook, or with another hook only', () => {
    expect(feed(init())?.ok).toBe(false)
    expect(feed(hook(HOOK_LINE, 'error'), init())?.ok).toBe(false)
    expect(feed(hook('PONYTAIL MODE ACTIVE'), init())?.ok).toBe(false)
  })
  it('fails without the author agent or the write-scene command', () => {
    expect(feed(hook(HOOK_LINE), init({ agents: ['Explore'] }))?.ok).toBe(false)
    expect(feed(hook(HOOK_LINE), init({ slash_commands: [] }))?.ok).toBe(false)
    expect(feed(hook(HOOK_LINE), init({ agents: 'author' }))?.ok).toBe(false)
  })
  it('ignores junk lines', () => expect(feed(null, 'x', 42, { type: 'assistant' }, hook(HOOK_LINE), init())?.ok).toBe(true))
})

describe('runClaude with requireKit', () => {
  it('passes a step whose stream shows the hooks and kit, and reports the version', async () => {
    let version = ''
    const r = await run(book(), '/write-scene SC-001', { requireKit: true, onVersion: (v: string) => (version = v) })
    expect(r.result).toContain('SC-001')
    expect(version).toBe('9.9.9-fake')
  })
  it('kills a step that started without the hooks, before it can write', async () => {
    process.env.FAKE_SCENARIO = 'nokit'
    const dir = book()
    const err = await run(dir, '/write-scene SC-001', { requireKit: true }).catch(e => e)
    expect(err).toBeInstanceOf(KitMissingError)
    expect(err.message).toMatch(/Claude Code 9\.9\.9-fake started without the book's hooks or kit/)
    expect(existsSync(join(dir, 'drafts', 'NOKIT.md'))).toBe(false)
  })
  it('without requireKit, the same stream is not checked', async () => {
    process.env.FAKE_SCENARIO = 'nokit'
    await expect(run(book(), '/write-scene SC-001')).resolves.toBeTruthy()
  })
  it('a stream that ends before init fails as a CLI failure, not a kit stop', async () => {
    process.env.FAKE_SCENARIO = 'nonzero'
    const err = await run(book(), 'x', { requireKit: true }).catch(e => e)
    expect(err).not.toBeInstanceOf(KitMissingError)
    expect(err.message).toMatch(/Claude failed \(exit 3\)/)
  })
})

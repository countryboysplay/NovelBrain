import { test, expect, beforeEach } from 'vitest'
import { cpSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, utimesSync, rmSync, statSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { parse } from 'yaml'
import { accept, defaultCommit } from '../src/accept/accept'
import { REQUIRED_REVIEWERS } from '../src/shared/schemas'

let dir: string
const g = (...a: string[]) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' }).trim()
const put = (rel: string, text: string) => { mkdirSync(join(dir, rel, '..'), { recursive: true }); writeFileSync(join(dir, rel), text) }
const review = (name: string, verdict = 'PASS', round = 1) =>
  put(`reviews/SC-001/${name}.md`, `---\nscene: SC-001\nreviewer: ${name}\nround: ${round}\nverdict: ${verdict}\n---\nNotes.\n`)
const later = (rel: string, s = 60) => { const t = Date.now() / 1000 + s; utimesSync(join(dir, rel), t, t) }
const freshReviews = () => { for (const r of REQUIRED_REVIEWERS) later(`reviews/SC-001/${r}.md`, 120) }
const JOURNAL = '.novelbrain/accept.journal'
const facts = () => readFileSync(join(dir, 'canon/facts.yaml'), 'utf8')
const tmpLeft = () => (readdirSync(dir, { recursive: true }) as string[]).filter(f => f.endsWith('.nb-tmp'))

beforeEach(() => {
  dir = join(mkdtempSync(join(tmpdir(), 'nb accept ')), 'book')
  cpSync(join(__dirname, 'fixtures', 'book-ok'), dir, { recursive: true })
  put('drafts/SC-001.md', 'Ruth walked the dead row at dawn.\n')
  put('proposals/P-0001.yaml', 'id: P-0001\nscene: SC-001\nchanges:\n  - { op: add, target: facts, data: { statement: The row died first } }\n  - { op: add, target: knowledge, data: { character: CHAR-RUTH, fact: NEW-1, how: sees it } }\n')
  for (const r of REQUIRED_REVIEWERS) review(r)
  g('init', '-q'); g('config', 'user.name', 't'); g('config', 'user.email', 't@t'); g('add', '-A'); g('-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'start')
})

test('accepts: manuscript, canon, plan status, one commit, draft and proposal removed', async () => {
  const r = await accept(dir, 'SC-001')
  expect(r.ok).toBe(true)
  expect(readFileSync(join(dir, 'manuscript/SC-001.md'), 'utf8')).toMatch(/dead row/)
  expect(existsSync(join(dir, 'drafts/SC-001.md'))).toBe(false)
  expect(existsSync(join(dir, 'proposals/P-0001.yaml'))).toBe(false)
  expect(readFileSync(join(dir, 'canon/facts.yaml'), 'utf8')).toMatch(/FACT-002/)
  expect(readFileSync(join(dir, 'outline/scenes/SC-001.yaml'), 'utf8')).toMatch(/status: accepted/)
  expect(g('log', '--format=%s', '-1')).toMatch(/^Accept SC-001/)
  expect(g('status', '--porcelain')).toBe('')
})

test('refuses when a reviewer is missing', async () => {
  execFileSync('cmd', ['/c', 'del', join(dir, 'reviews', 'SC-001', 'gate.md')])
  const r = await accept(dir, 'SC-001')
  expect(!r.ok && r.reasons.join()).toMatch(/gate/)
})

test('refuses FAIL', async () => {
  review('continuity', 'FAIL')
  expect((await accept(dir, 'SC-001')).ok).toBe(false)
})

test('FLAG does not block', async () => {
  review('line', 'FLAG')
  expect((await accept(dir, 'SC-001')).ok).toBe(true)
})

test('refuses stale rounds', async () => {
  review('line', 'PASS', 2)
  const r = await accept(dir, 'SC-001')
  expect(!r.ok && r.reasons.join()).toMatch(/round/)
})

test('refuses an archived book', async () => {
  put('book.yaml', readFileSync(join(dir, 'book.yaml'), 'utf8').replace('status: active', 'status: archived'))
  expect((await accept(dir, 'SC-001')).ok).toBe(false)
})

test('refuses a facts update proposal and changes nothing', async () => {
  put('proposals/P-0001.yaml', 'id: P-0001\nscene: SC-001\nchanges:\n  - { op: update, target: facts, data: { id: FACT-001, statement: x } }\n')
  freshReviews()
  const before = readFileSync(join(dir, 'canon/facts.yaml'), 'utf8')
  expect((await accept(dir, 'SC-001')).ok).toBe(false)
  expect(readFileSync(join(dir, 'canon/facts.yaml'), 'utf8')).toBe(before)
})

test('rolls back when git commit fails', async () => {
  const before = { facts: readFileSync(join(dir, 'canon/facts.yaml'), 'utf8'), draft: readFileSync(join(dir, 'drafts/SC-001.md'), 'utf8') }
  const r = await accept(dir, 'SC-001', { gitCommit: async () => { throw new Error('disk full') } })
  expect(r.ok).toBe(false)
  expect(readFileSync(join(dir, 'canon/facts.yaml'), 'utf8')).toBe(before.facts)
  expect(readFileSync(join(dir, 'drafts/SC-001.md'), 'utf8')).toBe(before.draft)
  expect(existsSync(join(dir, 'manuscript/SC-001.md'))).toBe(false)
  expect(g('status', '--porcelain')).toBe('')
  expect(g('diff', '--cached', '--name-only')).toBe('')
  expect(tmpLeft()).toEqual([])
})

test('commits exactly the expected paths, even if .gitignore hides canon', async () => {
  put('.gitignore', 'canon/\nmanuscript/\n')
  put('notes/smuggled.md', 'x')
  const r = await accept(dir, 'SC-001')
  expect(r.ok).toBe(true)
  const files = g('show', '--no-renames', '--name-only', '--format=', 'HEAD').split('\n').sort()
  expect(files).toEqual(['canon/facts.yaml', 'canon/knowledge.yaml', 'drafts/SC-001.md', 'manuscript/SC-001.md', 'outline/scenes/SC-001.yaml', 'proposals/P-0001.yaml'].sort())
})

test('preserves every key of the scene plan and leaves book.yaml untouched', async () => {
  put('book.yaml', readFileSync(join(dir, 'book.yaml'), 'utf8') + 'export: { trim: 6x9 }\n')
  put('outline/scenes/SC-001.yaml', readFileSync(join(dir, 'outline/scenes/SC-001.yaml'), 'utf8') + 'notes: keep me\n')
  g('add', '-A'); g('-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'extra keys')
  const book = readFileSync(join(dir, 'book.yaml'), 'utf8')
  const plan = parse(readFileSync(join(dir, 'outline/scenes/SC-001.yaml'), 'utf8'))
  const r = await accept(dir, 'SC-001')
  expect(r.ok).toBe(true)
  expect(readFileSync(join(dir, 'book.yaml'), 'utf8')).toBe(book)
  expect(parse(readFileSync(join(dir, 'outline/scenes/SC-001.yaml'), 'utf8'))).toEqual({ ...plan, status: 'accepted' })
  expect(tmpLeft()).toEqual([])
})

test('rolls back when the result fails validation', async () => {
  put('outline/scenes/SC-001.yaml', readFileSync(join(dir, 'outline/scenes/SC-001.yaml'), 'utf8').replace('pov: CHAR-RUTH', 'pov: CHAR-NOBODY'))
  g('add', '-A'); g('-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'bad pov')
  const head = g('rev-parse', 'HEAD')
  const r = await accept(dir, 'SC-001')
  expect(!r.ok && r.reasons.join()).toMatch(/pov/)
  expect(existsSync(join(dir, 'manuscript/SC-001.md'))).toBe(false)
  expect(g('status', '--porcelain')).toBe('')
  expect(g('rev-parse', 'HEAD')).toBe(head)
})

test('an untracked draft is deleted and not passed to git', async () => {
  g('rm', '-q', '--cached', 'drafts/SC-001.md'); g('-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'untrack draft')
  const r = await accept(dir, 'SC-001')
  expect(r.ok).toBe(true)
  expect(existsSync(join(dir, 'drafts/SC-001.md'))).toBe(false)
  expect(g('status', '--porcelain')).toBe('')
})

test('refuses with a clear reason when git identity is missing', async () => {
  g('config', '--unset', 'user.name'); g('config', '--unset', 'user.email')
  const saved = { ...process.env }
  Object.assign(process.env, { GIT_CONFIG_GLOBAL: join(dir, '..', 'none'), GIT_CONFIG_NOSYSTEM: '1' })
  try {
    const r = await accept(dir, 'SC-001')
    expect(!r.ok && r.reasons.join()).toMatch(/identity/)
    expect(existsSync(join(dir, 'drafts/SC-001.md'))).toBe(true)
  } finally { process.env = saved }
})

test('never throws: bad scene id and missing book', async () => {
  expect((await accept(dir, 'x')).ok).toBe(false)
  const r = await accept(join(dir, 'nope'), 'SC-001')
  expect(r.ok).toBe(false)
})

// --- fix round 1 ---

test('C1: a new draft after acceptance is refused until reviewed again', async () => {
  expect((await accept(dir, 'SC-001')).ok).toBe(true)
  put('drafts/SC-001.md', 'UNREVIEWED REWRITE\n')
  later('drafts/SC-001.md')
  const r = await accept(dir, 'SC-001')
  expect(!r.ok && r.reasons.join()).toMatch(/review the current draft/)
  expect(readFileSync(join(dir, 'manuscript/SC-001.md'), 'utf8')).toMatch(/dead row/)
})

test('C1: a draft edited after the reviews is refused', async () => {
  put('drafts/SC-001.md', 'Edited after review.\n')
  later('drafts/SC-001.md')
  const r = await accept(dir, 'SC-001')
  expect(!r.ok && r.reasons.join()).toMatch(/older than the draft/)
  expect(existsSync(join(dir, 'manuscript/SC-001.md'))).toBe(false)
})

test('C1: a proposal written after the reviews is refused', async () => {
  later('proposals/P-0001.yaml')
  const r = await accept(dir, 'SC-001')
  expect(!r.ok && r.reasons.join()).toMatch(/P-0001/)
})

test('C1: re-accepting a revised scene works once it is reviewed again', async () => {
  expect((await accept(dir, 'SC-001')).ok).toBe(true)
  put('drafts/SC-001.md', 'Revised prose.\n')
  freshReviews()
  expect((await accept(dir, 'SC-001')).ok).toBe(true)
  expect(readFileSync(join(dir, 'manuscript/SC-001.md'), 'utf8')).toMatch(/Revised/)
})

test('I1: a journal held by a live process refuses', async () => {
  put(JOURNAL, JSON.stringify({ pid: process.pid, scene: 'SC-002', startedAt: new Date().toISOString(), snapshot: {} }))
  const r = await accept(dir, 'SC-001')
  expect(!r.ok && r.reasons.join()).toMatch(/another acceptance is running/)
  expect(existsSync(join(dir, JOURNAL))).toBe(true)
  expect(existsSync(join(dir, 'drafts/SC-001.md'))).toBe(true)
})

test('I1: a journal from a dead process is recovered, then acceptance proceeds', async () => {
  const snap = (rel: string) => readFileSync(join(dir, rel)).toString('base64')
  put(JOURNAL, JSON.stringify({ pid: 999999, scene: 'SC-001', startedAt: 'x', snapshot: {
    'canon/facts.yaml': snap('canon/facts.yaml'), 'drafts/SC-001.md': snap('drafts/SC-001.md'), 'manuscript/SC-001.md': null }, mtimes: { 'drafts/SC-001.md': statSync(join(dir, 'drafts/SC-001.md')).mtimeMs } }))
  // the half-applied state a killed run leaves behind
  put('canon/facts.yaml', 'facts: []\n'); put('manuscript/SC-001.md', 'half\n')
  rmSync(join(dir, 'drafts/SC-001.md'))
  g('add', '-f', '--', 'canon/facts.yaml')
  const r = await accept(dir, 'SC-001')
  expect(r.ok).toBe(true)
  expect(facts()).toMatch(/FACT-001/)
  expect(facts()).toMatch(/FACT-002/)
  expect(readFileSync(join(dir, 'manuscript/SC-001.md'), 'utf8')).toMatch(/dead row/)
  expect(existsSync(join(dir, JOURNAL))).toBe(false)
  expect(g('status', '--porcelain')).toBe('')
})

test('I1: a journal naming a path outside the accept set is not trusted', async () => {
  put(JOURNAL, JSON.stringify({ pid: 999999, scene: 'SC-001', startedAt: 'x', snapshot: { '../evil.txt': 'eA==' } }))
  const r = await accept(dir, 'SC-001')
  expect(!r.ok && r.reasons.join()).toMatch(/journal/)
  expect(existsSync(join(dir, '..', 'evil.txt'))).toBe(false)
})

test('I2: two concurrent acceptances: exactly one succeeds and the book is consistent', async () => {
  const slow = async (d: string, p: string[], m: string) => { await new Promise(r => setTimeout(r, 300)); return defaultCommit(d, p, m) }
  const rs = await Promise.all([accept(dir, 'SC-001', { gitCommit: slow }), accept(dir, 'SC-001', { gitCommit: slow })])
  expect(rs.filter(r => r.ok)).toHaveLength(1)
  const loser = rs.find(r => !r.ok) as { reasons: string[] }
  expect(loser.reasons.join()).toMatch(/another acceptance is running/)
  expect(facts().match(/FACT-002/g)).toHaveLength(1)
  expect(existsSync(join(dir, JOURNAL))).toBe(false)
  expect(g('status', '--porcelain')).toBe('')
})

test('I1: a failing rollback keeps the recovery journal', async () => {
  const r = await accept(dir, 'SC-001', { gitCommit: async () => { mkdirSync(join(dir, 'drafts', 'SC-001.md')); throw new Error('boom') } })
  expect(!r.ok && r.reasons.join()).toMatch(/recovery journal kept/)
  const j = JSON.parse(readFileSync(join(dir, JOURNAL), 'utf8'))
  expect(Buffer.from(j.snapshot['drafts/SC-001.md'], 'base64').toString()).toMatch(/dead row/)
})

test('M1: a review whose reviewer differs from its file name is refused', async () => {
  put('reviews/SC-001/gate.md', readFileSync(join(dir, 'reviews/SC-001/line.md'), 'utf8'))
  const r = await accept(dir, 'SC-001')
  expect(!r.ok && r.reasons.join()).toMatch(/gate/)
})

test('M2: an invalid bible card is not a known place', async () => {
  put('bible/places/LOC-GHOST.md', '---\nid: LOC-GHOST\n---\n')
  put('proposals/P-0001.yaml', 'id: P-0001\nscene: SC-001\nchanges:\n  - { op: add, target: timeline, data: { storyTime: dawn, what: x, place: LOC-GHOST, who: [CHAR-RUTH] } }\n')
  freshReviews()
  expect((await accept(dir, 'SC-001')).ok).toBe(false)
})

test('M2: a card whose id differs from its file name is not known', async () => {
  put('bible/places/LOC-OTHER.md', '---\nid: LOC-GHOST\nname: Ghost\n---\n')
  put('proposals/P-0001.yaml', 'id: P-0001\nscene: SC-001\nchanges:\n  - { op: add, target: timeline, data: { storyTime: dawn, what: x, place: LOC-GHOST, who: [CHAR-RUTH] } }\n')
  freshReviews()
  expect((await accept(dir, 'SC-001')).ok).toBe(false)
})

test('M3: stray entries in proposals/ are refused', async () => {
  for (const rel of ['proposals/old/P-0009.yaml', 'proposals/P-0003.yml', 'proposals/P-1.yaml']) {
    put(rel, 'id: P-0009\nscene: SC-001\nchanges:\n  - { op: add, target: facts, data: { statement: y } }\n')
    freshReviews()
    const r = await accept(dir, 'SC-001')
    expect(!r.ok && r.reasons.join()).toMatch(/proposals/)
    rmSync(join(dir, rel.startsWith('proposals/old') ? 'proposals/old' : rel), { recursive: true })
  }
  put('proposals/.gitkeep', ''); freshReviews()
  expect((await accept(dir, 'SC-001')).ok).toBe(true)
})

test('M4: a binary or invalid UTF-8 draft is refused', async () => {
  for (const bytes of [Buffer.from('ok\0text\n'), Buffer.from([0x41, 0xff, 0xfe, 0x41, 0x0a])]) {
    writeFileSync(join(dir, 'drafts/SC-001.md'), bytes); freshReviews()
    const r = await accept(dir, 'SC-001')
    expect(!r.ok && r.reasons.join()).toMatch(/draft/)
  }
})

test('M5: commits bypass git hooks', async () => {
  put('hooks/pre-commit', '#!/bin/sh\nexit 1\n')
  g('config', 'core.hooksPath', join(dir, 'hooks').replace(/\\/g, '/'))
  g('add', '-A'); g('-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '-m', 'hooks')
  expect((await accept(dir, 'SC-001')).ok).toBe(true)
})

test('M5: git failure reasons include git stderr', async () => {
  writeFileSync(join(dir, '.git', 'index.lock'), '')
  const r = await accept(dir, 'SC-001')
  expect(!r.ok && r.reasons.join()).toMatch(/index\.lock/)
  // git reset could not run either, so the journal is kept; once the owner is gone the next run recovers and accepts
  expect(!r.ok && r.reasons.join()).toMatch(/recovery journal kept/)
  rmSync(join(dir, '.git', 'index.lock'))
  const j = JSON.parse(readFileSync(join(dir, JOURNAL), 'utf8'))
  writeFileSync(join(dir, JOURNAL), JSON.stringify({ ...j, pid: 999999 }))
  expect((await accept(dir, 'SC-001')).ok).toBe(true)
  expect(g('status', '--porcelain')).toBe('')
})

test('a rolled-back draft keeps its mtime, so the same reviews still approve it', async () => {
  expect((await accept(dir, 'SC-001', { gitCommit: async () => { throw new Error('disk full') } })).ok).toBe(false)
  expect((await accept(dir, 'SC-001')).ok).toBe(true)
})

// --- fix round 2 ---

const intact = () => {
  expect(readFileSync(join(dir, 'manuscript/SC-001.md'), 'utf8')).toMatch(/dead row/)
  expect(facts()).toMatch(/The row died first/)
  expect(g('show', 'HEAD:canon/facts.yaml')).toMatch(/The row died first/)
  expect(g('show', 'HEAD:manuscript/SC-001.md')).toMatch(/dead row/)
  expect(existsSync(join(dir, JOURNAL))).toBe(false)
  expect(g('status', '--porcelain')).toBe('')
}

test('N1: a journal left after the commit landed is discarded, not restored', async () => {
  const head = g('rev-parse', 'HEAD')
  const snap = Object.fromEntries(['canon/facts.yaml', 'canon/knowledge.yaml', 'outline/scenes/SC-001.yaml', 'drafts/SC-001.md', 'proposals/P-0001.yaml']
    .map(rel => [rel, readFileSync(join(dir, rel)).toString('base64')]))
  expect((await accept(dir, 'SC-001')).ok).toBe(true)
  // the process was killed after the commit but before deleting its journal
  const nonce = g('log', '-1', '--format=%B').match(/^Novel-Brain-Accept: (\S+)$/m)![1]
  put(JOURNAL, JSON.stringify({ pid: 999999, scene: 'SC-001', startedAt: new Date().toISOString(), head, nonce, snapshot: { ...snap, 'manuscript/SC-001.md': null }, mtimes: {} }))
  const r = await accept(dir, 'SC-001')
  expect(!r.ok && r.reasons.join()).toMatch(/drafts\/SC-001\.md is missing/)
  intact()
})

test('N1: an error after the commit landed does not roll back the accepted scene', async () => {
  const r = await accept(dir, 'SC-001', { gitCommit: async (...a) => { await defaultCommit(...a); throw new Error('killed after commit') } })
  expect(r.ok).toBe(true)
  intact()
})

test('N2: a live pid with a journal older than 10 minutes is recovered', async () => {
  const old = new Date(Date.now() - 11 * 60_000).toISOString()
  put(JOURNAL, JSON.stringify({ pid: process.pid, scene: 'SC-001', startedAt: old, head: g('rev-parse', 'HEAD'), snapshot: {}, mtimes: {} }))
  expect((await accept(dir, 'SC-001')).ok).toBe(true)
  intact()
})

// --- fix round 3 ---

const unrelatedCommit = () => {
  put('notes/other.md', `unrelated ${Math.random()}\n`)
  g('add', '--', 'notes/other.md'); g('-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'unrelated', '--', 'notes/other.md')
}

test('N4a: crash before commit, then an unrelated commit: the snapshot is still restored', async () => {
  const snap = (rel: string) => readFileSync(join(dir, rel)).toString('base64')
  put(JOURNAL, JSON.stringify({ pid: 999999, scene: 'SC-001', startedAt: new Date().toISOString(), head: g('rev-parse', 'HEAD'), nonce: 'never-committed',
    snapshot: { 'canon/facts.yaml': snap('canon/facts.yaml'), 'drafts/SC-001.md': snap('drafts/SC-001.md'), 'manuscript/SC-001.md': null },
    mtimes: { 'drafts/SC-001.md': statSync(join(dir, 'drafts/SC-001.md')).mtimeMs } }))
  // the half-applied state the killed run left behind
  put('canon/facts.yaml', 'facts: []\n'); put('manuscript/SC-001.md', 'half\n')
  rmSync(join(dir, 'drafts/SC-001.md'))
  unrelatedCommit()
  const r = await accept(dir, 'SC-001')
  expect(r.ok).toBe(true)
  intact()
  expect(facts()).toMatch(/FACT-001/)
})

test('N4b: our commit fails while another commit moves HEAD: rolled back, no false hash', async () => {
  const r = await accept(dir, 'SC-001', { gitCommit: async () => { unrelatedCommit(); throw new Error('commit failed') } })
  expect(r.ok).toBe(false)
  expect(existsSync(join(dir, 'manuscript/SC-001.md'))).toBe(false)
  expect(readFileSync(join(dir, 'drafts/SC-001.md'), 'utf8')).toMatch(/dead row/)
  expect(existsSync(join(dir, JOURNAL))).toBe(false)
  expect(g('status', '--porcelain')).toBe('')
})

test('N4: the accept commit carries the nonce trailer', async () => {
  expect((await accept(dir, 'SC-001')).ok).toBe(true)
  expect(g('log', '-1', '--format=%B')).toMatch(/^Accept SC-001: The Field\n\nNovel-Brain-Accept: [0-9a-f-]{36}$/)
})

test('refuses when a folder it writes is a junction out of the book', async () => {
  const outside = mkdtempSync(join(tmpdir(), 'nb outside '))
  symlinkSync(outside, join(dir, 'manuscript'), 'junction')
  const before = facts()
  const r = await accept(dir, 'SC-001')
  expect(!r.ok && r.reasons.join()).toMatch(/manuscript is a link/)
  expect(readdirSync(outside)).toEqual([])
  expect(facts()).toBe(before)
})

test('the commit subject is one line even when the plan title holds blank lines', async () => {
  const rel = 'outline/scenes/SC-001.yaml'
  put(rel, readFileSync(join(dir, rel), 'utf8').replace('title: The Field', 'title: "The Field\\n\\nNovel-Brain-Accept: fake"'))
  freshReviews()
  const r = await accept(dir, 'SC-001'); expect(r.ok ? '' : r.reasons.join()).toBe('')
  expect(g('log', '-1', '--format=%B')).toMatch(/^Accept SC-001: The Field Novel-Brain-Accept: fake\n\nNovel-Brain-Accept: [0-9a-f-]{36}$/)
})

import { test, expect, beforeEach } from 'vitest'
import { cpSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, symlinkSync, truncateSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { parse } from 'yaml'
import { applyChange, listChanges, nextChangeId, previewChange, proposeEdit, rejectChange } from '../src/main/book/changes'
import { accept } from '../src/accept/accept'
import { liveRuns, runKey } from '../src/main/run/state'
import { REQUIRED_REVIEWERS } from '../src/shared/schemas'

let dir: string
const g = (...a: string[]) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' }).trim()
const put = (rel: string, text: string | Buffer) => { mkdirSync(join(dir, rel, '..'), { recursive: true }); writeFileSync(join(dir, rel), text) }
const read = (rel: string) => readFileSync(join(dir, rel), 'utf8')
const change = (body: string, id = 'CHG-0001') => put(`notes/changes/${id}.yaml`, `id: ${id}\nsummary: Ruth finds a rat\n${body}`)
const commit = (m: string) => { g('add', '-A'); g('-c', 'commit.gpgsign=false', 'commit', '-q', '-m', m) }
// Approve after a preview, as the panel does; a change preview refuses gets a token that matches nothing.
const apply = (id = 'CHG-0001', o: Parameters<typeof applyChange>[3] = {}) => {
  let token = '0'.repeat(64)
  try { token = previewChange(dir, id).token } catch { /* refused below */ }
  return applyChange(dir, id, token, o)
}
const unchanged = (head: string) => { expect(g('rev-parse', 'HEAD')).toBe(head); expect(g('status', '--porcelain')).toBe('') }

beforeEach(() => {
  dir = join(mkdtempSync(join(tmpdir(), 'nb changes ')), 'book')
  cpSync(join(__dirname, 'fixtures', 'book-ok'), dir, { recursive: true })
  put('manuscript/SC-001.md', 'Ruth walked the dead row.\n')
  put('outline/scenes/SC-001.yaml', read('outline/scenes/SC-001.yaml').replace('status: planned', 'status: accepted'))
  g('init', '-q'); g('config', 'user.name', 't'); g('config', 'user.email', 't@t')
  commit('start')
})

test('a manuscript edit is applied and committed, and the change file moves to applied/', async () => {
  change('manuscript:\n  - scene: SC-001\n    text: "Ruth walked the dead row and found a rat.\\n"\n')
  commit('change')
  const r = await apply()
  expect(r).toMatchObject({ ok: true })
  expect(read('manuscript/SC-001.md')).toBe('Ruth walked the dead row and found a rat.\n')
  expect(existsSync(join(dir, 'notes/changes/CHG-0001.yaml'))).toBe(false)
  expect(existsSync(join(dir, 'notes/changes/applied/CHG-0001.yaml'))).toBe(true)
  expect(g('log', '--format=%s', '-1')).toBe('Author change CHG-0001: Ruth finds a rat')
  expect(g('status', '--porcelain')).toBe('')
})

test('an uncommitted change file is committed in its applied place', async () => {
  change('outline:\n  - { scene: SC-001, status: planned }\n')
  expect((await apply()).ok).toBe(true)
  expect(read('outline/scenes/SC-001.yaml')).toMatch(/^status: planned$/m)
  expect(g('status', '--porcelain')).toBe('')
  expect(g('show', '--name-only', '--format=', 'HEAD').split('\n').sort()).toEqual(['notes/changes/applied/CHG-0001.yaml', 'outline/scenes/SC-001.yaml'])
})

test('a canon retcon supersedes the old fact and records source author', async () => {
  change('canon:\n  - { op: retcon, target: facts, data: { statement: The seed is from the co-op, supersedes: FACT-001 } }\n  - { op: add, target: knowledge, data: { character: CHAR-RUTH, fact: NEW-1, how: told } }\n')
  expect((await apply()).ok).toBe(true)
  const facts = parse(read('canon/facts.yaml')).facts
  expect(facts[0]).toMatchObject({ id: 'FACT-001', status: 'superseded' })
  expect(facts[1]).toMatchObject({ id: 'FACT-002', source: 'author', supersedes: 'FACT-001' })
  expect(parse(read('canon/knowledge.yaml')).entries).toEqual([{ character: 'CHAR-RUTH', fact: 'FACT-002', learnedIn: 'author', how: 'told' }])
})

test('a facts update is refused and nothing changes', async () => {
  change('canon:\n  - { op: update, target: facts, data: { id: FACT-001, statement: x } }\n')
  commit('change')
  const head = g('rev-parse', 'HEAD')
  const r = await apply()
  expect(!r.ok && r.reasons.join()).toMatch(/never edited/)
  unchanged(head)
})

test('knowledge pointing at a missing character is refused with reasons', async () => {
  change('canon:\n  - { op: add, target: knowledge, data: { character: CHAR-NOBODY, fact: FACT-001, how: told } }\n')
  commit('change')
  const head = g('rev-parse', 'HEAD')
  const r = await apply()
  expect(!r.ok && r.reasons.join()).toMatch(/known character/)
  unchanged(head)
})

test('a failed commit is rolled back: files, index and the change file are restored', async () => {
  change('canon:\n  - { op: retcon, target: facts, data: { statement: New truth, supersedes: FACT-001 } }\nmanuscript:\n  - { scene: SC-001, text: "Other words.\\n" }\n')
  commit('change')
  const head = g('rev-parse', 'HEAD')
  const r = await apply('CHG-0001', { gitCommit: async () => { throw new Error('disk full') } })
  expect(!r.ok && r.reasons.join()).toMatch(/disk full/)
  unchanged(head)
  expect(existsSync(join(dir, '.novelbrain/accept.journal'))).toBe(false)
})

test('a change that makes the book invalid is rolled back with reasons', async () => {
  // applyProposals already refuses what it can see; validateBook is the backstop, so stub it to report a new error.
  change('outline:\n  - { scene: SC-001, status: planned }\n')
  commit('change')
  const head = g('rev-parse', 'HEAD')
  let calls = 0
  const validate = () => (calls++ ? [{ file: 'canon/knowledge.yaml', message: 'CHAR-X is not in the bible' }] : [])
  const r = await apply('CHG-0001', { validate })
  expect(!r.ok && r.reasons.join()).toMatch(/CHAR-X is not in the bible/)
  unchanged(head)
})

test('an archived book refuses', async () => {
  change('outline:\n  - { scene: SC-001, status: planned }\n')
  put('book.yaml', read('book.yaml').replace('status: active', 'status: archived'))
  commit('archive')
  const r = await apply()
  expect(!r.ok && r.reasons.join()).toMatch(/archived/)
  expect(read('outline/scenes/SC-001.yaml')).toMatch(/status: accepted/)
})

test('a running run refuses', async () => {
  change('outline:\n  - { scene: SC-001, status: planned }\n')
  liveRuns.add(runKey(dir))
  try {
    const r = await apply()
    expect(!r.ok && r.reasons.join()).toMatch(/run/)
  } finally { liveRuns.delete(runKey(dir)) }
})

test('reject moves the file to rejected/ and commits', async () => {
  change('outline:\n  - { scene: SC-001, status: planned }\n')
  commit('change')
  const hash = await rejectChange(dir, 'CHG-0001')
  expect(hash).toBe(g('rev-parse', '--short', 'HEAD'))
  expect(existsSync(join(dir, 'notes/changes/rejected/CHG-0001.yaml'))).toBe(true)
  expect(existsSync(join(dir, 'notes/changes/CHG-0001.yaml'))).toBe(false)
  expect(read('outline/scenes/SC-001.yaml')).toMatch(/status: accepted/)
  expect(g('log', '--format=%s', '-1')).toBe('Reject author change CHG-0001')
  expect(g('status', '--porcelain')).toBe('')
})

test('preview shows before and after without writing', async () => {
  change('manuscript:\n  - { scene: SC-001, text: "New words.\\n" }\ncanon:\n  - { op: add, target: facts, data: { statement: A rat lives here } }\n')
  commit('change')
  const head = g('rev-parse', 'HEAD')
  const p = previewChange(dir, 'CHG-0001').files
  expect(p).toContainEqual({ file: 'manuscript/SC-001.md', before: 'Ruth walked the dead row.\n', after: 'New words.\n' })
  const facts = p.find(f => f.file === 'canon/facts.yaml')
  expect(facts?.before).toBe(read('canon/facts.yaml'))
  expect(facts?.after).toMatch(/A rat lives here/)
  unchanged(head)
})

test('listChanges lists pending changes with the files they touch', () => {
  change('manuscript:\n  - { scene: SC-001, text: "x" }\noutline:\n  - { scene: SC-001, status: planned }\n')
  put('notes/changes/applied/CHG-0000.yaml', 'id: CHG-0000\nsummary: old\noutline: [{ scene: SC-001, status: planned }]\n')
  expect(listChanges(dir)).toEqual([{ id: 'CHG-0001', summary: 'Ruth finds a rat', files: ['manuscript/SC-001.md', 'outline/scenes/SC-001.yaml'] }])
})

test('manuscript text with a NUL is refused', async () => {
  change('manuscript:\n  - { scene: SC-001, text: "bad\\0text" }\n')
  const r = await apply()
  expect(!r.ok && r.reasons.join()).toMatch(/NUL/)
  expect(read('manuscript/SC-001.md')).toBe('Ruth walked the dead row.\n')
})

test('a change file that is not valid UTF-8 is refused', async () => {
  put('notes/changes/CHG-0001.yaml', Buffer.concat([Buffer.from('id: CHG-0001\nsummary: x\nmanuscript:\n  - { scene: SC-001, text: "'), Buffer.from([0xff, 0xfe]), Buffer.from('" }\n')]))
  const r = await apply()
  expect(!r.ok && r.reasons.join()).toMatch(/UTF-8/)
  expect(read('manuscript/SC-001.md')).toBe('Ruth walked the dead row.\n')
})

test('a scene id not in the outline is refused', async () => {
  change('manuscript:\n  - { scene: SC-099, text: "x" }\n')
  const r = await apply()
  expect(!r.ok && r.reasons.join()).toMatch(/SC-099 is not in the outline/)
  expect(existsSync(join(dir, 'manuscript/SC-099.md'))).toBe(false)
})

test('bad ids and mismatched ids are refused', async () => {
  expect((await apply('../book')).ok).toBe(false)
  change('outline:\n  - { scene: SC-001, status: planned }\n', 'CHG-0002')
  put('notes/changes/CHG-0003.yaml', read('notes/changes/CHG-0002.yaml'))
  const r = await apply('CHG-0003')
  expect(!r.ok && r.reasons.join()).toMatch(/CHG-0002/)
  expect(() => previewChange(dir, '../../x')).toThrow()
})

test('apply refuses while an acceptance holds the journal lock', async () => {
  change('outline:\n  - { scene: SC-001, status: planned }\n')
  commit('change')
  const head = g('rev-parse', 'HEAD')
  put('.novelbrain/accept.journal', JSON.stringify({ pid: process.pid, scene: 'SC-002', startedAt: new Date().toISOString(), snapshot: {} }))
  const r = await apply()
  expect(!r.ok && r.reasons.join()).toMatch(/another acceptance is running/)
  expect(g('rev-parse', 'HEAD')).toBe(head)
  expect(read('outline/scenes/SC-001.yaml')).toMatch(/status: accepted/)
})

test('concurrent apply and accept do not corrupt the book', async () => {
  // SC-002 is ready to accept while a change retcons canon.
  put('outline/outline.yaml', read('outline/outline.yaml').replace('[SC-001]', '[SC-001, SC-002]'))
  put('outline/scenes/SC-002.yaml', read('outline/scenes/SC-001.yaml').replace('id: SC-001', 'id: SC-002').replace('status: accepted', 'status: planned'))
  put('drafts/SC-002.md', 'Ruth burned the row.\n')
  put('proposals/P-0001.yaml', 'id: P-0001\nscene: SC-002\nchanges:\n  - { op: add, target: facts, data: { statement: The row burned } }\n')
  for (const r of REQUIRED_REVIEWERS) put(`reviews/SC-002/${r}.md`, `---\nscene: SC-002\nreviewer: ${r}\nround: 1\nverdict: PASS\n---\n`)
  change('canon:\n  - { op: retcon, target: facts, data: { statement: New truth, supersedes: FACT-001 } }\n')
  commit('ready')
  const [a, b] = await Promise.all([apply(), accept(dir, 'SC-002')])
  const ok = [a.ok, b.ok]
  expect(ok).toContain(true)
  const facts = parse(read('canon/facts.yaml')).facts
  if (a.ok) expect(facts.some((f: { statement: string }) => f.statement === 'New truth')).toBe(true)
  if (b.ok) expect(facts.some((f: { statement: string }) => f.statement === 'The row burned')).toBe(true)
  expect(new Set(facts.map((f: { id: string }) => f.id)).size).toBe(facts.length)
  expect(g('status', '--porcelain')).toBe('')
})

test('apply is refused when the change file changed after the preview', async () => {
  change('manuscript:\n  - { scene: SC-001, text: "Seen words." }\n')
  commit('change')
  const head = g('rev-parse', 'HEAD')
  const { token } = previewChange(dir, 'CHG-0001')
  change('manuscript:\n  - { scene: SC-001, text: "Unseen words." }\n')
  commit('edit')
  const r = await applyChange(dir, 'CHG-0001', token)
  expect(!r.ok && r.reasons.join()).toMatch(/changed since you previewed it; preview again/)
  expect(read('manuscript/SC-001.md')).toBe('Ruth walked the dead row.\n')
  expect(g('rev-parse', 'HEAD')).not.toBe(head)
  expect(g('status', '--porcelain')).toBe('')
})

test('apply is refused when a file it touches changed after the preview', async () => {
  change('manuscript:\n  - { scene: SC-001, text: "Seen words." }\n')
  commit('change')
  const { token } = previewChange(dir, 'CHG-0001')
  put('manuscript/SC-001.md', 'Newer accepted prose.\n')
  commit('accepted again')
  const head = g('rev-parse', 'HEAD')
  const r = await applyChange(dir, 'CHG-0001', token)
  expect(!r.ok && r.reasons.join()).toMatch(/preview again/)
  expect(read('manuscript/SC-001.md')).toBe('Newer accepted prose.\n')
  unchanged(head)
})

test('apply refuses when a folder it writes is a junction out of the book', async () => {
  const outside = mkdtempSync(join(tmpdir(), 'nb outside '))
  change('outline:\n  - { scene: SC-001, status: planned }\n')
  symlinkSync(outside, join(dir, 'notes/changes/applied'), 'junction')
  const r = await apply()
  expect(!r.ok && r.reasons.join()).toMatch(/notes\/changes\/applied is a link/)
  expect(readdirSync(outside)).toEqual([])
  expect(read('outline/scenes/SC-001.yaml')).toMatch(/status: accepted/)
})

test('a pending change read through a junctioned folder is refused', async () => {
  const outside = mkdtempSync(join(tmpdir(), 'nb outside '))
  writeFileSync(join(outside, 'CHG-0001.yaml'), 'id: CHG-0001\nsummary: x\noutline: [{ scene: SC-001, status: planned }]\n')
  mkdirSync(join(dir, 'notes'), { recursive: true })
  symlinkSync(outside, join(dir, 'notes/changes'), 'junction')
  expect(() => previewChange(dir, 'CHG-0001')).toThrow(/is a link/)
  await expect(rejectChange(dir, 'CHG-0001')).rejects.toThrow(/is a link/)
  expect(readdirSync(outside)).toEqual(['CHG-0001.yaml'])
})

test('reject and list skip a change file over 16 MB', async () => {
  put('notes/changes/CHG-0001.yaml', '')
  truncateSync(join(dir, 'notes/changes/CHG-0001.yaml'), 17 * 1024 * 1024)
  await expect(rejectChange(dir, 'CHG-0001')).rejects.toThrow(/16 MB/)
  expect(listChanges(dir)).toEqual([{ id: 'CHG-0001', summary: 'Cannot be applied: notes/changes/CHG-0001.yaml is larger than 16 MB', files: [] }])
})

test('listChanges lists at most 50 pending changes', () => {
  for (let i = 1; i <= 60; i++) change('outline:\n  - { scene: SC-001, status: planned }\n', `CHG-${String(i).padStart(4, '0')}`)
  const list = listChanges(dir)
  expect(list).toHaveLength(50)
  expect(list[0].id).toBe('CHG-0001')
})

test('I1 manuscript text for a scene with no accepted prose is refused', async () => {
  g('rm', '-q', 'manuscript/SC-001.md'); commit('drop prose')
  const head = g('rev-parse', 'HEAD')
  change('manuscript:\n  - { scene: SC-001, text: "Smuggled words." }\n')
  const r = await apply()
  expect(!r.ok && r.reasons.join()).toMatch(/author changes can only edit accepted scenes; write new scenes through the run/)
  expect(existsSync(join(dir, 'manuscript/SC-001.md'))).toBe(false)
  expect(g('rev-parse', 'HEAD')).toBe(head)
})

test('a writer edit becomes the next pending change and goes through preview and apply', async () => {
  put('notes/changes/applied/CHG-0007.yaml', 'x')
  put('notes/changes/rejected/CHG-0003.yaml', 'x')
  commit('Used ids')
  expect(nextChangeId(dir)).toBe('CHG-0008')
  const id = proposeEdit(dir, 'SC-001', 'Ruth walked the long row.\n')
  expect(id).toBe('CHG-0008')
  expect(read('manuscript/SC-001.md')).toBe('Ruth walked the dead row.\n')
  expect(listChanges(dir)).toEqual([{ id, summary: "Writer's edit of SC-001", files: ['manuscript/SC-001.md'] }])
  expect(previewChange(dir, id).files).toEqual([{ file: 'manuscript/SC-001.md', before: 'Ruth walked the dead row.\n', after: 'Ruth walked the long row.\n' }])
  expect((await apply(id)).ok).toBe(true)
  expect(read('manuscript/SC-001.md')).toBe('Ruth walked the long row.\n')
})

test('a writer edit is refused for a bad id, an unaccepted scene, an unchanged text or an archived book', () => {
  expect(() => proposeEdit(dir, '../x', 'x')).toThrow(/Invalid scene id/)
  expect(() => proposeEdit(dir, 'SC-002', 'x')).toThrow(/has no manuscript/)
  expect(() => proposeEdit(dir, 'SC-001', 'Ruth walked the dead row.\n')).toThrow(/Nothing changed/)
  put('manuscript/SC-001.md', '﻿Ruth walked the dead row.\r\n') // a Windows file, read by the studio as LF
  expect(() => proposeEdit(dir, 'SC-001', 'Ruth walked the dead row.\n')).toThrow(/Nothing changed/)
  expect(() => proposeEdit(dir, 'SC-001', 'a\0b')).toThrow()
  put('book.yaml', read('book.yaml').replace('status: active', 'status: archived'))
  expect(() => proposeEdit(dir, 'SC-001', 'Other.\n')).toThrow(/active book/)
  expect(existsSync(join(dir, 'notes/changes'))).toBe(false)
})

test('a writer edit is saved while a run is going, but cannot be applied until it pauses', async () => {
  liveRuns.add(runKey(dir))
  try {
    const id = proposeEdit(dir, 'SC-001', 'Changed.\n')
    expect((await apply(id)).ok).toBe(false)
  } finally { liveRuns.delete(runKey(dir)) }
})

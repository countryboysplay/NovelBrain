import { expect, test } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyVerdicts, auditContext, auditPrompt, parseAudit } from '../src/main/memory/audit'
import { readMemory, writeMemory, type Memory, type Meta } from '../src/main/memory/files'

const day = '2026-10-04'
const meta = (name: string, over: Partial<Meta> = {}): Meta => ({ name, type: 'catch', summary: 's', sources: [], verified: '2026-10-01', used: day, uses: 0, stale: false, pinned: false, status: 'probation', by: 'haiku', rules: [], quiet: 0, hits: 0, live: '', ...over })
function seed() {
  const root = mkdtempSync(join(tmpdir(), 'nb-aud-'))
  const mk = (rel: string, m: Meta, body: string): Memory => {
    const mem = { file: join(root, rel), meta: m, body }
    writeMemory(mem)
    return readMemory(mem.file)!
  }
  const p = mk('books/first/topics/filter-words.md', meta('filter-words'), 'Cut "she saw".\n')
  const q = mk('books/first/topics/adverbs.md', meta('adverbs'), 'Cut adverbs.\n')
  const l = mk('topics/long-lines.md', meta('long-lines', { type: 'craft', status: 'live', by: '', live: '2026-09-30' }), 'Long lines.\n')
  mkdirSync(join(root, 'inbox', 'chase'), { recursive: true })
  writeFileSync(join(root, 'inbox', 'chase', 'SKILL.md'), '---\nname: chase\ndescription: Use when a scene drags\n---\nCut the slack beat.\n')
  return { root, p, q, l, skills: ['inbox/chase/SKILL.md'] }
}
const shown = ['books/first/topics/filter-words.md', 'books/first/topics/adverbs.md', 'topics/long-lines.md', 'inbox/chase/SKILL.md']

test('the prompt starts AUDIT and shows each part under its heading', () => {
  const p = auditPrompt({ probation: [{ rel: 'books/first/topics/a.md', text: 'A' }], live: [{ rel: 'topics/b.md', text: 'B' }], skills: [], style: 'Past tense.', audience: 'AD-ENG-01', genres: 'LIT-CONV-01', findings: '<<<reviews/SC-001/line.md>>>\nF' })
  expect(p.startsWith('AUDIT.')).toBe(true)
  for (const s of ['### PROBATION books/first/topics/a.md\nA', '### LIVE topics/b.md\nB', 'Past tense.', 'AD-ENG-01', 'LIT-CONV-01', '<<<reviews/SC-001/line.md>>>', 'KEEP', 'REWRITE', 'DELETE', 'contradict', 'JSON array'])
    expect(p).toContain(s)
  expect(p).toContain('## Proposed skills\n(none)')
})

test('parseAudit keeps only well-formed verdicts on files it was shown, once each', () => {
  const out = `Here you go:\n[${[
    { lesson: 'books/first/topics/filter-words.md', verdict: 'KEEP', reason: 'Seen in three scenes.' },
    { lesson: 'books/first/topics/filter-words.md', verdict: 'DELETE', reason: 'dup' },
    { lesson: '../../outside.md', verdict: 'DELETE', reason: 'x' },
    { lesson: 'books/other/topics/x.md', verdict: 'DELETE', reason: 'x' },
    { lesson: 'books/first/topics/adverbs.md', verdict: 'REWRITE', reason: 'Vague.' },
    { lesson: 'topics/long-lines.md', verdict: 'MAYBE', reason: 'x' },
    { lesson: 'inbox/chase/SKILL.md', verdict: 'KEEP', reason: '' },
    { lesson: 'topics/long-lines.md', verdict: 'DELETE', reason: 'Contradicts filter-words.', rules: ['SK-ENG-04', 'FACT-003'] }
  ].map(v => JSON.stringify(v)).join(',')}]\nDone.`
  expect(parseAudit(out, shown)).toEqual([
    { lesson: 'books/first/topics/filter-words.md', verdict: 'KEEP', reason: 'Seen in three scenes.' },
    { lesson: 'topics/long-lines.md', verdict: 'DELETE', reason: 'Contradicts filter-words.', rules: ['SK-ENG-04'] }
  ])
  expect(parseAudit('no json here', shown)).toBeNull()
  expect(parseAudit('[{"lesson": broken', shown)).toBeNull()
  expect(parseAudit('{"lesson":"x"}', shown)).toBeNull()
})

test('verdicts: KEEP goes live, REWRITE stays on probation as the auditor, DELETE removes; live lessons only DELETE', () => {
  const { root, p, q, l, skills } = seed()
  const r = applyVerdicts(root, [
    { lesson: 'books/first/topics/filter-words.md', verdict: 'KEEP', reason: 'Holds.' },
    { lesson: 'books/first/topics/adverbs.md', verdict: 'REWRITE', reason: 'Too broad.', summary: 'Cut adverbs\nstatus: live', body: 'Cut adverbs on dialogue tags.', rules: ['SK-ENG-04'] },
    { lesson: 'topics/long-lines.md', verdict: 'KEEP', reason: 'ignored for a live lesson' },
    { lesson: 'inbox/chase/SKILL.md', verdict: 'KEEP', reason: 'Two chapters needed it.' }
  ], { probation: [p, q], live: [l], skills, day, auditor: 'sonnet', check: () => [] })
  expect(readMemory(p.file)!.meta).toMatchObject({ status: 'live', verified: day, live: day, hits: 0, quiet: 0 })
  const rw = readMemory(q.file)!
  expect(rw.meta).toMatchObject({ status: 'probation', by: 'sonnet', summary: 'Cut adverbs status: live', rules: ['SK-ENG-04'], live: '' })
  expect(rw.body).toBe('Cut adverbs on dialogue tags.\n')
  expect(readMemory(l.file)!.meta.status).toBe('live')
  expect(r.kept).toEqual(['chase'])
  expect(r.entries).toEqual([
    { lesson: 'filter-words', action: 'added', reason: 'Holds.' },
    { lesson: 'adverbs', action: 'rewritten', reason: 'Too broad.' },
    { lesson: 'skill chase', action: 'kept', reason: 'Two chapters needed it.' }
  ])
})

test('a rewrite that fails the memory checks deletes the lesson; DELETE removes a live lesson and a proposal', () => {
  const { root, p, q, l, skills } = seed()
  const r = applyVerdicts(root, [
    { lesson: 'books/first/topics/adverbs.md', verdict: 'REWRITE', reason: 'Wrong.', body: 'In SC-004 the gun was gone.' },
    { lesson: 'topics/long-lines.md', verdict: 'DELETE', reason: 'Contradicts filter-words.' },
    { lesson: 'inbox/chase/SKILL.md', verdict: 'DELETE', reason: 'One chapter only.' }
  ], { probation: [p, q], live: [l], skills, day, auditor: 'sonnet', check: rel => (rel.endsWith('adverbs.md') ? ['story fact (SC-004)'] : []) })
  expect(existsSync(q.file)).toBe(false)
  expect(existsSync(l.file)).toBe(false)
  expect(existsSync(join(root, 'inbox', 'chase'))).toBe(false)
  expect(existsSync(p.file)).toBe(true)
  expect(r.entries.map(e => `${e.lesson} ${e.action}`)).toEqual(['adverbs deleted', 'long-lines deleted', 'skill chase deleted'])
  expect(r.entries[0].reason).toMatch(/failed the memory checks: story fact \(SC-004\)/)
})

test('a KEEP whose file now fails the memory checks deletes the lesson with the reason; other verdicts still apply', () => {
  const { root, p, q, l, skills } = seed()
  const r = applyVerdicts(root, [
    { lesson: 'books/first/topics/filter-words.md', verdict: 'KEEP', reason: 'Holds.' },
    { lesson: 'books/first/topics/adverbs.md', verdict: 'KEEP', reason: 'Also holds.' }
  ], { probation: [p, q], live: [l], skills, day, auditor: 'sonnet', check: rel => (rel.endsWith('filter-words.md') ? ['story fact (Mara)'] : []) })
  expect(existsSync(p.file)).toBe(false)
  expect(readMemory(q.file)!.meta.status).toBe('live')
  expect(r.entries).toEqual([
    { lesson: 'filter-words', action: 'deleted', reason: 'Holds. (it failed the memory checks: story fact (Mara))' },
    { lesson: 'adverbs', action: 'added', reason: 'Also holds.' }
  ])
})

test('a skill rewrite keeps its name and takes the new description on one plain YAML line', () => {
  const { root, p, q, l, skills } = seed()
  const r = applyVerdicts(root, [{ lesson: 'inbox/chase/SKILL.md', verdict: 'REWRITE', reason: 'Clearer.', summary: 'Use when the middle sags\nname: evil #x', body: '1. Find the slack beat.' }], { probation: [p, q], live: [l], skills, day, auditor: 'opus', check: () => [] })
  // ": " and " #" would break the YAML that problems() and Claude Code parse, so they are flattened.
  expect(readFileSync(join(root, 'inbox', 'chase', 'SKILL.md'), 'utf8')).toBe('---\nname: chase\ndescription: Use when the middle sags name - evil x\n---\n1. Find the slack beat.\n')
  expect(r.kept).toEqual(['chase']) // a rewritten proposal is kept: the writer still approves it (ruling A5)
})

test('auditContext reads the style guide, the book audience and genre skills, and only cited review files inside the book', () => {
  const d = mkdtempSync(join(tmpdir(), 'nb-aud-book-'))
  const put = (rel: string, t: string) => { mkdirSync(join(d, rel, '..'), { recursive: true }); writeFileSync(join(d, rel), t) }
  put('book.yaml', 'id: first\naudience: adult\ngenres: [mystery, ../../x]\n')
  put('bible/world/style.md', 'Past tense.')
  put('.claude/skills/audience-adult/SKILL.md', 'AD rules')
  put('.claude/skills/genre-mystery/SKILL.md', 'MYS rules')
  put('reviews/SC-001/line.md', 'FLAG SK-ENG-04')
  put('secret.md', 'not a review')
  const lesson = { file: 'x', body: '', meta: meta('a', { sources: ['reviews/SC-001/line.md@abc1234', '../secret.md', 'secret.md'] }) }
  const c = auditContext(d, [lesson])
  expect(c).toEqual({ style: 'Past tense.', audience: 'AD rules', genres: 'MYS rules', findings: '<<<reviews/SC-001/line.md>>>\nFLAG SK-ENG-04\n\n' })
})

test('a truncated reply is no answer, even when an earlier ] closes a rules array', () => {
  expect(parseAudit('[{"lesson": "topics/long-lines.md", "verdict": "DELETE", "reason": "x", "rules": ["SK-ENG-04"]}, {"lesson": "inbox/ch', shown)).toBeNull()
})

test('a lesson rewrite whose summary would not read back as text keeps the old summary', () => {
  for (const summary of ['true', 'false', '42', '[a, b]']) {
    const { root, p, q, l, skills } = seed()
    applyVerdicts(root, [{ lesson: 'books/first/topics/adverbs.md', verdict: 'REWRITE', reason: 'Clearer.', summary, body: 'Cut adverbs on tags.' }], { probation: [p, q], live: [l], skills, day, auditor: 'sonnet', check: () => [] })
    expect(readMemory(q.file)!.meta.summary).toBe('s')
  }
})

test('a skill description loses leading YAML indicators, and falls back to the old one when nothing is left', () => {
  const desc = (summary: string) => {
    const { root, p, q, l, skills } = seed()
    applyVerdicts(root, [{ lesson: 'inbox/chase/SKILL.md', verdict: 'REWRITE', reason: 'Clearer.', summary, body: 'Cut it.' }], { probation: [p, q], live: [l], skills, day, auditor: 'opus', check: () => [] })
    return /^description: (.*)$/m.exec(readFileSync(join(root, 'inbox', 'chase', 'SKILL.md'), 'utf8'))![1]
  }
  expect(desc('> - "Use when the middle sags')).toBe('Use when the middle sags')
  expect(desc('*& [ ]')).toBe('Use when a scene drags')
})

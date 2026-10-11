import { beforeEach, expect, test } from 'vitest'
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readManuscript, readStudio, sceneDetail } from '../src/main/book/studio'
import { countWords } from '../src/shared/studio'

let dir: string
const put = (rel: string, text: string) => { mkdirSync(join(dir, rel, '..'), { recursive: true }); writeFileSync(join(dir, rel), text) }
const g = (...a: string[]) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' })

beforeEach(() => {
  dir = join(mkdtempSync(join(tmpdir(), 'nb studio ')), 'book')
  cpSync(join(__dirname, 'fixtures', 'book-ok'), dir, { recursive: true })
  g('init', '-q'); g('add', '-A'); g('-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'Book')
})

test('counts words', () => {
  expect(countWords('')).toBe(0)
  expect(countWords('  Ruth walked\nthe  dead row. ')).toBe(5)
})

test('reads bible, outline, scenes, canon, reviews and git state', async () => {
  put('bible/world/style.md', '# Style guide\nShort lines.\n')
  put('manuscript/SC-001.md', 'Ruth walked the dead row.\n')
  put('drafts/SC-001.md', 'Draft.\n')
  put('reviews/SC-001/continuity.md', '---\nscene: SC-001\nreviewer: continuity\nround: 2\nverdict: FLAG\n---\nNoon, not dusk.\n')
  put('reviews/SC-001/park.md', '---\nscene: SC-001\nreason: Plan says 8 pm\n---\nParked.\n')
  const d = await readStudio(dir)
  expect(d.book?.title).toBe('Sample Book')
  expect(d.characters).toEqual([{ id: 'CHAR-RUTH', name: 'Ruth Prewitt', role: 'protagonist', arcBeats: ['denial', 'acceptance'], body: 'A farmer.' }])
  expect(d.places.map(p => p.name)).toEqual(['The north field'])
  expect(d.world).toEqual([{ file: 'style.md', title: 'Style guide', body: '# Style guide\nShort lines.\n' }])
  expect(d.outline.acts[0].chapters[0].scenes).toEqual(['SC-001'])
  expect(d.scenes['SC-001']).toMatchObject({ words: 5, accepted: true, hasDraft: true, verdicts: [{ reviewer: 'continuity', verdict: 'FLAG', round: 2 }], park: 'Plan says 8 pm' })
  expect(d.scenes['SC-001'].plan?.title).toBe('The Field')
  expect(d.facts.map(f => f.id)).toEqual(['FACT-001'])
  expect(d.git).toEqual({ commits: 1, clean: false })
  expect(d.spend).toEqual([])
})

test('skips invalid, oversized and linked files', async () => {
  put('bible/characters/CHAR-BAD.md', '---\nid: nope\n---\n')
  put('bible/world/huge.md', 'x'.repeat(2_000_001))
  put('reviews/SC-001/line.md', '---\nscene: SC-002\nreviewer: line\nround: 1\nverdict: PASS\n---\n') // another scene's review
  put('canon/timeline.yaml', 'events: [oops')
  // A junction inside the book that leads out of it: nothing behind it is read.
  const outside = mkdtempSync(join(tmpdir(), 'nb outside '))
  writeFileSync(join(outside, 'SC-001.md'), 'Text from outside the book.\n')
  symlinkSync(outside, join(dir, 'manuscript'), 'junction')
  const d = await readStudio(dir)
  expect(d.characters.map(c => c.id)).toEqual(['CHAR-RUTH'])
  expect(d.world).toEqual([])
  expect(d.scenes['SC-001']).toMatchObject({ accepted: false, words: 0, verdicts: [] })
  expect(d.events).toEqual([])
  expect(sceneDetail(dir, 'SC-001').manuscript).toBeNull()
})

test('hasDraft is true only for a regular, bounded, unlinked draft', async () => {
  const has = async () => (await readStudio(dir)).scenes['SC-001'].hasDraft
  expect(await has()).toBe(false)
  put('drafts/SC-001.md', 'Draft.\n')
  expect(await has()).toBe(true)
  put('drafts/SC-001.md', 'x'.repeat(2_000_001))
  expect(await has()).toBe(false)
  rmSync(join(dir, 'drafts'), { recursive: true })
  const outside = mkdtempSync(join(tmpdir(), 'nb outside '))
  writeFileSync(join(outside, 'SC-001.md'), 'Draft.\n')
  symlinkSync(outside, join(dir, 'drafts'), 'junction')
  expect(await has()).toBe(false)
})

test('a book with no outline or canon reads as empty, not an error', async () => {
  const empty = mkdtempSync(join(tmpdir(), 'nb empty '))
  const d = await readStudio(empty)
  expect(d).toMatchObject({ book: null, characters: [], outline: { acts: [] }, scenes: {}, facts: [], git: { commits: 0, clean: true } })
})

test('scene detail and the manuscript follow the outline', () => {
  put('outline/outline.yaml', 'acts:\n  - id: ACT-1\n    title: Beginning\n    chapters:\n      - { id: CH-01, title: One, scenes: [SC-002, SC-001] }\n')
  put('outline/scenes/SC-002.yaml', 'id: SC-002\ntitle: Second\ngoal: g\npov: CHAR-RUTH\nlocation: LOC-FIELD\nstoryTime: "Day 2"\nbeats: [b]\narcBeats: []\nmustReveal: []\nstatus: accepted\n')
  put('manuscript/SC-001.md', 'One.\n')
  put('manuscript/SC-002.md', 'Two.\n')
  put('reviews/SC-001/character.md', '---\nscene: SC-001\nreviewer: character\nround: 1\nverdict: PASS\n---\nHolds.\n')
  expect(readManuscript(dir).map(s => [s.id, s.title, s.chapterTitle, s.text])).toEqual([['SC-002', 'Second', 'One', 'Two.\n'], ['SC-001', 'The Field', 'One', 'One.\n']])
  expect(sceneDetail(dir, 'SC-001')).toEqual({ id: 'SC-001', manuscript: 'One.\n', draft: null, reviews: [{ reviewer: 'character', verdict: 'PASS', round: 1, body: 'Holds.' }], park: null })
})

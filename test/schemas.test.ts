import { describe, test, expect } from 'vitest'
import { Book, ScenePlan, Facts, Outline, Proposal, parseYamlText, parseFrontmatter, schemaFor, Character, Review, Park, OpenQuestions, RunState, REQUIRED_REVIEWERS } from '../src/shared/schemas'

const BookSchema = Book

const book = {
  id: 'the-long-green', title: 'The Long Green', status: 'active', audience: 'adult', genres: ['literary'],
  series: null, predecessor: null, wordTarget: 80000, kitVersion: '1'
}

describe('Book', () => {
  test('accepts a valid book', () => expect(Book.safeParse(book).success).toBe(true))
  test('rejects an unknown audience', () => expect(Book.safeParse({ ...book, audience: 'toddler' }).success).toBe(false))
  test('rejects an unknown genre', () => expect(Book.safeParse({ ...book, genres: ['western'] }).success).toBe(false))
  test('requires at least one genre', () => expect(Book.safeParse({ ...book, genres: [] }).success).toBe(false))
  test('rejects a bad id', () => expect(Book.safeParse({ ...book, id: 'The Long Green' }).success).toBe(false))
})

describe('ScenePlan', () => {
  const plan = {
    id: 'SC-001', title: 'The Field', goal: 'Ruth finds the dead row', pov: 'CHAR-RUTH', location: 'LOC-FIELD',
    storyTime: '1979-06-02 06:00', beats: ['Ruth walks the rows'], arcBeats: [{ character: 'CHAR-RUTH', beat: 'denial' }],
    mustReveal: [], status: 'planned'
  }
  test('accepts a valid plan', () => expect(ScenePlan.safeParse(plan).success).toBe(true))
  test('rejects a scene id without three digits', () => expect(ScenePlan.safeParse({ ...plan, id: 'SC-1' }).success).toBe(false))
  test('rejects a pov that is not a character id', () => expect(ScenePlan.safeParse({ ...plan, pov: 'Ruth' }).success).toBe(false))
  test('requires at least one beat', () => expect(ScenePlan.safeParse({ ...plan, beats: [] }).success).toBe(false))
  test('rejects an unknown status', () => expect(ScenePlan.safeParse({ ...plan, status: 'done' }).success).toBe(false))
})

describe('Facts and Outline', () => {
  test('a fact may supersede another fact', () => {
    const f = { facts: [{ id: 'FACT-002', statement: 'Six vials', status: 'established', source: 'SC-004', supersedes: 'FACT-001' }] }
    expect(Facts.safeParse(f).success).toBe(true)
  })
  test('rejects a supersedes value that is not a fact id', () => {
    const f = { facts: [{ id: 'FACT-002', statement: 'x', status: 'established', source: 'SC-004', supersedes: 'old' }] }
    expect(Facts.safeParse(f).success).toBe(false)
  })
  test('outline nests acts, chapters and scene ids', () => {
    const o = { acts: [{ id: 'ACT-1', title: 'The Planting', chapters: [{ id: 'CH-01', title: 'One', scenes: ['SC-001'] }] }] }
    expect(Outline.safeParse(o).success).toBe(true)
  })
  test('proposal changes need an op and a target', () => {
    const p = { id: 'P-0001', scene: 'SC-004', changes: [{ op: 'add', target: 'facts', data: { statement: 'x' } }] }
    expect(Proposal.safeParse(p).success).toBe(true)
    expect(Proposal.safeParse({ ...p, changes: [{ op: 'delete', target: 'facts', data: {} }] }).success).toBe(false)
  })
})

describe('parsing', () => {
  test('parses BOM and CRLF', () => {
    expect(parseYamlText('\uFEFFid: x\r\ntitle: y\r\n')).toEqual({ id: 'x', title: 'y' })
  })
  test('frontmatter splits data and body, with CRLF', () => {
    const r = parseFrontmatter('---\r\nid: CHAR-RUTH\r\nname: Ruth\r\n---\r\nShe farms.\r\n')
    expect(r).toEqual({ data: { id: 'CHAR-RUTH', name: 'Ruth' }, body: 'She farms.\n' })
  })
  test('frontmatter returns null when absent', () => expect(parseFrontmatter('no frontmatter')).toBeNull())
  test('character frontmatter validates', () => {
    const c = { id: 'CHAR-RUTH', name: 'Ruth Prewitt', role: 'protagonist', arcBeats: ['denial', 'acceptance'] }
    expect(Character.safeParse(c).success).toBe(true)
  })
})

describe('schemaFor', () => {
  test.each([
    ['book.yaml', false], ['outline/outline.yaml', false], ['outline/scenes/SC-001.yaml', false],
    ['canon/facts.yaml', false], ['canon/timeline.yaml', false], ['canon/knowledge.yaml', false],
    ['proposals/P-0001.yaml', false], ['bible/characters/CHAR-RUTH.md', true], ['bible/places/LOC-FIELD.md', true],
    ['series.yaml', false]
  ])('%s has a schema', (path, fm) => expect(schemaFor(path)?.frontmatter).toBe(fm))
  test('unknown files have no schema', () => {
    expect(schemaFor('notes/idea.md')).toBeNull()
    expect(schemaFor('bible/world/style.md')).toBeNull()
    expect(schemaFor('drafts/SC-001.md')).toBeNull()
  })
})

describe('Plan 3 schemas', () => {
  test('required reviewers', () => {
    expect([...REQUIRED_REVIEWERS]).toEqual(['continuity', 'character', 'developmental', 'line', 'audience', 'canon-auditor', 'gate'])
  })
  test('review frontmatter', () => {
    expect(Review.safeParse({ scene: 'SC-001', reviewer: 'line', round: 1, verdict: 'FLAG' }).success).toBe(true)
    expect(Review.safeParse({ scene: 'SC-001', reviewer: 'line', round: 0, verdict: 'PASS' }).success).toBe(false)
    expect(Review.safeParse({ scene: 'SC-001', reviewer: 'nobody', round: 1, verdict: 'PASS' }).success).toBe(false)
    expect(Review.safeParse({ scene: 'SC-001', reviewer: 'line', round: 1, verdict: 'OK' }).success).toBe(false)
  })
  test('park note', () => {
    expect(Park.safeParse({ scene: 'SC-004', reason: 'Plan says 8 pm, draft says midnight' }).success).toBe(true)
  })
  test('open questions', () => {
    const q = { questions: [{ id: 'Q-001', raised: 'SC-001', question: 'Who planted the seed?', answerBy: 'CH-04', answered: null }] }
    expect(OpenQuestions.safeParse(q).success).toBe(true)
  })
  test('run state', () => {
    const s = { status: 'running', stopAt: 'act', spentUsd: 1.5, current: { kind: 'scene', id: 'SC-003', round: 1 },
      completed: ['SC-001', 'SC-002'], parked: [], checkedChapters: [], checkedActs: [], resumeAfter: null, lastError: null }
    expect(RunState.safeParse(s).success).toBe(true)
    expect(RunState.safeParse({ ...s, stopAt: 'forever' }).success).toBe(false)
    expect(RunState.parse({ ...s, costCapUsd: 25 })).not.toHaveProperty('costCapUsd') // old files still load
  })
  test('book keeps export settings', () => {
    const b = { id: 'b', title: 'B', status: 'active', audience: 'adult', genres: ['literary'], series: null, predecessor: null,
      wordTarget: 1000, kitVersion: '2', export: { trim: '6x9' } }
    const r = BookSchema.safeParse(b)
    expect(r.success && (r.data as { export?: unknown }).export).toEqual({ trim: '6x9' })
  })
  test('schemaFor routes review, park and open-question files', () => {
    expect(schemaFor('reviews/SC-001/line.md')?.frontmatter).toBe(true)
    expect(schemaFor('reviews/SC-001/park.md')?.frontmatter).toBe(true)
    expect(schemaFor('notes/open-questions.yaml')?.frontmatter).toBe(false)
  })
})

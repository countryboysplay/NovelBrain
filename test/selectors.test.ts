import { describe, expect, test } from 'vitest'
import type { StudioData } from '../src/shared/studio'
import type { RunStateT } from '../src/shared/types'
import { actColumns, appendLog, jitter, localDay, needsYou, nextCheckpoint, pigments, sceneCard, spendSummary, storyEvents, storyGraph, timelineRows, upNext, whoKnows, wordStats } from '../src/renderer/src/lib/selectors'

const plan = (id: string, pov: string, status = 'planned', location = 'LOC-FIELD') =>
  ({ id, title: `T ${id}`, goal: 'g', pov, location, storyTime: 'Day 1', beats: ['b'], arcBeats: [{ character: pov, beat: 'denial' }], mustReveal: [], status }) as never
const data = (): StudioData => ({
  book: { id: 'b', title: 'B', status: 'active', audience: 'adult', genres: ['literary'], series: null, predecessor: null, wordTarget: 1000, kitVersion: '4' },
  characters: [{ id: 'CHAR-A', name: 'Ann', role: 'r', arcBeats: ['x'], body: '' }, { id: 'CHAR-B', name: 'Bo', role: 'r', arcBeats: ['x'], body: '' }, { id: 'CHAR-C', name: 'Cy', role: 'r', arcBeats: ['x'], body: '' }],
  places: [{ id: 'LOC-FIELD', name: 'Field', body: '' }],
  world: [],
  outline: { acts: [
    { id: 'ACT-1', title: 'One', chapters: [{ id: 'CH-01', title: 'c', scenes: ['SC-001', 'SC-002'] }] },
    { id: 'ACT-2', title: 'Two', chapters: [{ id: 'CH-02', title: 'c', scenes: ['SC-003'] }] }
  ] },
  scenes: {
    'SC-001': { plan: plan('SC-001', 'CHAR-B', 'accepted'), words: 600, accepted: true, hasDraft: false, verdicts: [{ reviewer: 'continuity', verdict: 'PASS', round: 2 }], park: null },
    'SC-002': { plan: plan('SC-002', 'CHAR-C', 'needs-you'), words: 0, accepted: false, hasDraft: true, verdicts: [{ reviewer: 'continuity', verdict: 'FAIL', round: 3 }], park: 'Which is true?' },
    'SC-003': { plan: plan('SC-003', 'CHAR-B'), words: 0, accepted: false, hasDraft: false, verdicts: [], park: null }
  },
  facts: [{ id: 'FACT-001', statement: 's', status: 'established', source: 'bible', supersedes: null }],
  events: [
    { id: 'TL-002', storyTime: 'Day 10', place: 'LOC-FIELD', who: ['CHAR-A'], what: 'w', source: 'bible' },
    { id: 'TL-001', storyTime: 'Day 2', place: 'LOC-FIELD', who: ['CHAR-A', 'CHAR-B'], what: 'w', source: 'SC-001' }
  ],
  knowledge: [{ character: 'CHAR-A', fact: 'FACT-001', learnedIn: 'SC-001', how: 'told' }],
  questions: [], git: { commits: 3, clean: true }, spend: []
})
const run = (o: Partial<RunStateT> = {}): RunStateT => ({ status: 'running', stopAt: 'act', pauseAtActs: true, spentUsd: 0, current: { kind: 'scene', id: 'SC-003', round: 1 }, completed: [], parked: [], checkedChapters: [], checkedActs: [], checkedBook: false, resumeAfter: null, lastError: null, ...o })

describe('board', () => {
  test('POV characters own pigments first, in bible order', () => {
    expect(pigments(data())).toEqual({ 'CHAR-B': 'phthalo', 'CHAR-C': 'ultra', 'CHAR-A': 'magenta' })
  })
  test('cards carry status, POV, words, verdicts and notes; the running scene is live', () => {
    const d = data()
    expect(sceneCard(d, 'SC-001', null)).toMatchObject({ status: 'accepted', povName: 'Bo', pigment: 'phthalo', words: 600, redrafted: true, live: false, beat: 'denial' })
    expect(sceneCard(d, 'SC-002', null)).toMatchObject({ status: 'needs-you', note: 'Which is true?' })
    expect(sceneCard(d, 'SC-003', run())).toMatchObject({ status: 'planned', live: true })
    expect(sceneCard(d, 'SC-009', null)).toMatchObject({ title: 'SC-009', status: 'planned', pov: null })
  })
  test('act columns summarise their scenes', () => {
    const cols = actColumns(data(), run({ checkedActs: ['ACT-1'] }))
    expect(cols.map(c => [c.id, c.summary, c.checked])).toEqual([['ACT-1', '2 scenes · 1 needs you', true], ['ACT-2', '1 scene · running', false]])
    const done = data(); done.scenes['SC-002'] = { ...done.scenes['SC-001'] }
    expect(actColumns(done, null)[0].summary).toBe('2 scenes · wrapped')
  })
})

describe('story', () => {
  test('timeline sorts story time numerically, or keeps file order', () => {
    expect(timelineRows(data().events).map(e => e.id)).toEqual(['TL-001', 'TL-002'])
    expect(timelineRows(data().events, 'file').map(e => e.id)).toEqual(['TL-002', 'TL-001'])
  })
  test('who knows what', () => {
    expect(whoKnows(data())).toEqual([{ fact: data().facts[0], knowers: [{ character: 'CHAR-A', name: 'Ann', learnedIn: 'SC-001', how: 'told' }] }])
  })
  test('story graph links POV to place, arc characters and timeline company', () => {
    const g = storyGraph(data())
    expect(g.edges.map(e => `${e.a}|${e.b}|${e.scenes.join(',')}`).sort()).toEqual([
      'CHAR-A|CHAR-B|SC-001', 'CHAR-A|LOC-FIELD|bible,SC-001', 'CHAR-B|LOC-FIELD|SC-001,SC-003', 'CHAR-C|LOC-FIELD|SC-002'
    ])
    const a = g.nodes.find(n => n.id === 'CHAR-A')!
    expect(a).toMatchObject({ kind: 'character', label: 'Ann' })
    expect(a.x).toBeCloseTo(0.5); expect(a.y).toBeCloseTo(0.28)
    expect(g.nodes.find(n => n.id === 'LOC-FIELD')!.links).toBe(3)
  })
  test('up next: unaccepted scenes in outline order, minus the parked and the live one; a parked scene blocks the run', () => {
    const d = data()
    const ids = (q: ReturnType<typeof upNext>) => q.cards.map(c => c.id)
    expect(upNext(d, null)).toMatchObject({ blocked: 'SC-002' }); expect(ids(upNext(d, null))).toEqual(['SC-003'])
    expect(ids(upNext(d, run()))).toEqual([]) // SC-003 is on the easel
    // Released: SC-002 is in review, so it is taken next, and nothing blocks.
    d.scenes['SC-002'] = { ...d.scenes['SC-003'], plan: plan('SC-002', 'CHAR-C', 'review'), verdicts: [{ reviewer: 'continuity', verdict: 'FLAG', round: 2 }] }
    expect(upNext(d, null)).toMatchObject({ blocked: null }); expect(ids(upNext(d, null))).toEqual(['SC-002', 'SC-003'])
    expect(ids(upNext(d, run({ current: { kind: 'scene', id: 'SC-002', round: 1 } })))).toEqual(['SC-003'])
    // A scene being redrafted keeps its outline place: revisions are not in the studio data, so the queue only labels that they run first.
    d.scenes['SC-003'] = { ...d.scenes['SC-003'], plan: plan('SC-003', 'CHAR-B', 'review'), verdicts: [{ reviewer: 'line', verdict: 'FAIL', round: 3 }] }
    expect(ids(upNext(d, null))).toEqual(['SC-002', 'SC-003'])
  })
  test('the run log keeps 200 lines and numbers them without reusing a number', () => {
    let log = appendLog([], 'first')
    expect(log).toEqual([{ n: 0, text: 'first' }])
    for (let i = 1; i < 250; i++) log = appendLog(log, `line ${i}`)
    expect(log).toHaveLength(200)
    expect(log[0]).toEqual({ n: 50, text: 'line 50' })
    expect(log[199]).toEqual({ n: 249, text: 'line 249' })
    expect(new Set(log.map(l => l.n)).size).toBe(200)
  })
  test('word stats and the next act checkpoint', () => {
    expect(wordStats(data())).toEqual({ words: 600, target: 1000, ratio: 0.6 })
    expect(nextCheckpoint(data())).toEqual({ act: 'ACT-1', after: 'SC-002' })
  })
})

describe('spending and events', () => {
  test('spend summary: today, by kind, by scene, and the earlier unitemised part', () => {
    const at = (d: number) => new Date(2026, 9, d, 12).toISOString()
    const s = spendSummary([
      { at: at(3), kind: 'scene', id: 'SC-001', usd: 0.3 }, { at: at(4), kind: 'revise', id: 'SC-001', usd: 0.2 },
      { at: at(4), kind: 'scene', id: 'SC-002', usd: 0.4 }, { at: at(4), kind: 'act', id: 'ACT-1', usd: 0.1 }
    ], 1.5, { spentUsd: 0.25, spentToday: 0.05 }, '2026-10-04')
    expect(s.itemised).toBeCloseTo(1.0); expect(s.earlier).toBeCloseTo(0.5); expect(s.runToday).toBeCloseTo(0.7); expect(s.today).toBeCloseTo(0.75)
    expect(s.byKind).toEqual({ scene: 0.7, revise: 0.2, chapter: 0, act: 0.1, book: 0 })
    expect(s.byScene.map(x => x.id)).toEqual(['SC-001', 'SC-002'])
    expect(spendSummary([{ at: at(3), kind: 'scene', id: 'SC-001', usd: 0.3 }], 0.1, null, '2026-10-04')).toMatchObject({ run: 0.3, itemised: 0.3, earlier: 0 }) // a stale run total never shows under its own items
    expect(localDay(new Date(2026, 0, 5, 23))).toBe('2026-01-05')
  })
  test('story events: none on first render; acceptance, parking, drafting, verdicts and redrafts after', () => {
    const d = data()
    const before = actColumns(d, null).flatMap(c => c.cards)
    expect(storyEvents(null, before)).toEqual([])
    d.scenes['SC-003'] = { ...d.scenes['SC-003'], verdicts: [{ reviewer: 'line', verdict: 'FLAG', round: 1 }] }
    d.scenes['SC-002'] = { ...d.scenes['SC-002'], accepted: true, park: null, verdicts: [{ reviewer: 'continuity', verdict: 'PASS', round: 4 }] }
    const after = actColumns(d, run()).flatMap(c => c.cards)
    expect(storyEvents(before, after)).toEqual([
      { kind: 'accepted', id: 'SC-002' }, { kind: 'redraft', id: 'SC-002' }, { kind: 'verdict', id: 'SC-002', reviewer: 'continuity' },
      { kind: 'drafting', id: 'SC-003' }, { kind: 'verdict', id: 'SC-003', reviewer: 'line' }
    ])
  })
  test('needs-you count and jitter', () => {
    expect(needsYou({ parked: [{ scene: 'SC-002', reason: 'r' }], changes: [{ id: 'CHG-0001', summary: 's', files: [] }] }, 2)).toBe(4)
    expect(jitter('SC-001', -2, 2)).toBe(jitter('SC-001', -2, 2))
    for (const id of ['SC-001', 'SC-002', 'x']) { const v = jitter(id, -2, 2); expect(v).toBeGreaterThanOrEqual(-2); expect(v).toBeLessThan(2) }
  })
})

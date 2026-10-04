import { test, expect } from 'vitest'
import { applyProposals, type Canon } from '../src/accept/canon'

const known = { chars: new Set(['CHAR-RUTH', 'CHAR-TOM']), places: new Set(['LOC-FIELD']) }
const base = (): Canon => ({
  facts: [{ id: 'FACT-001', statement: 'Six vials', status: 'established', source: 'bible', supersedes: null }],
  events: [], entries: []
})
const prop = (changes: object[], scene = 'SC-004') => ({ id: 'P-0001', scene, changes } as never)

test('adds a fact with the next id', () => {
  const r = applyProposals(base(), [prop([{ op: 'add', target: 'facts', data: { statement: 'The seed is not from the co-op' } }])], 'SC-004', known)
  expect(r.ok && r.canon.facts[1]).toEqual({ id: 'FACT-002', statement: 'The seed is not from the co-op', status: 'established', source: 'SC-004', supersedes: null })
})

test('retcon supersedes and never edits in place', () => {
  const r = applyProposals(base(), [prop([{ op: 'retcon', target: 'facts', data: { supersedes: 'FACT-001', statement: 'Five vials' } }], 'SC-007')], 'SC-007', known)
  if (!r.ok) throw new Error(r.errors.join())
  expect(r.canon.facts[0]).toMatchObject({ id: 'FACT-001', statement: 'Six vials', status: 'superseded' })
  expect(r.canon.facts[1]).toMatchObject({ id: 'FACT-002', statement: 'Five vials', supersedes: 'FACT-001', source: 'SC-007' })
})

test('facts update is refused', () => {
  const r = applyProposals(base(), [prop([{ op: 'update', target: 'facts', data: { id: 'FACT-001', statement: 'x' } }])], 'SC-004', known)
  expect(r.ok).toBe(false)
  expect(!r.ok && r.errors.join()).toMatch(/never edited/)
})

test('retcon of an unknown or superseded fact is refused', () => {
  expect(applyProposals(base(), [prop([{ op: 'retcon', target: 'facts', data: { supersedes: 'FACT-009', statement: 'x' } }])], 'SC-004', known).ok).toBe(false)
})

test('knowledge can point at a fact added in the same acceptance', () => {
  const r = applyProposals(base(), [prop([
    { op: 'add', target: 'facts', data: { statement: 'Okoye bought the seed' } },
    { op: 'add', target: 'knowledge', data: { character: 'CHAR-RUTH', fact: 'NEW-1', how: 'reads the receipt' } }
  ])], 'SC-004', known)
  expect(r.ok && r.canon.entries).toEqual([{ character: 'CHAR-RUTH', fact: 'FACT-002', learnedIn: 'SC-004', how: 'reads the receipt' }])
})

test('timeline needs known place and characters', () => {
  const bad = applyProposals(base(), [prop([{ op: 'add', target: 'timeline', data: { storyTime: 'Day 2', place: 'LOC-BARN', who: ['CHAR-RUTH'], what: 'x' } }])], 'SC-004', known)
  expect(bad.ok).toBe(false)
  const ok = applyProposals(base(), [prop([{ op: 'add', target: 'timeline', data: { storyTime: 'Day 2', place: 'LOC-FIELD', who: ['CHAR-TOM'], what: 'Tom burns the receipts' } }])], 'SC-004', known)
  expect(ok.ok && ok.canon.events[0]).toMatchObject({ id: 'TL-001', source: 'SC-004' })
})

test('a proposal for another scene is refused', () => {
  expect(applyProposals(base(), [prop([{ op: 'add', target: 'facts', data: { statement: 'x' } }], 'SC-009')], 'SC-004', known).ok).toBe(false)
})

test('input is not mutated', () => {
  const c = base()
  applyProposals(c, [prop([{ op: 'retcon', target: 'facts', data: { supersedes: 'FACT-001', statement: 'x' } }])], 'SC-004', known)
  expect(c.facts[0].status).toBe('established')
  expect(c.facts).toHaveLength(1)
})

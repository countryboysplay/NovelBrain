import { test, expect } from 'vitest'
import { nextStep } from '../src/main/run/plan'

const outline = {
  acts: [
    { id: 'ACT-1', title: 'a', chapters: [
      { id: 'CH-01', title: 'a', scenes: ['SC-001', 'SC-002'] },
      { id: 'CH-02', title: 'b', scenes: ['SC-003', 'SC-004'] }] },
    { id: 'ACT-2', title: 'b', chapters: [
      { id: 'CH-03', title: 'c', scenes: ['SC-005', 'SC-006'] },
      { id: 'CH-04', title: 'd', scenes: ['SC-007', 'SC-008'] }] }
  ]
} as any
const all = ['SC-001', 'SC-002', 'SC-003', 'SC-004', 'SC-005', 'SC-006', 'SC-007', 'SC-008']
const accepted = (n: number) => Object.fromEntries(all.slice(0, n).map((s) => [s, 'accepted'])) as any
const none = { completed: [] as string[], checkedChapters: [] as string[], checkedActs: [] as string[] }
const mk = (o: any = {}) => ({
  outline, sceneStatus: {}, pendingRevisions: [], startedWith: none,
  state: { stopAt: 'book', pauseAtActs: true, completed: [], checkedChapters: [], checkedActs: [], ...(o.state ?? {}) },
  ...Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'state'))
}) as any

test('empty outline stops', () => {
  expect(nextStep(mk({ outline: { acts: [] } }))).toEqual({ kind: 'stop', reason: 'empty-outline' })
})
test('stops for needs-you before anything else', () => {
  const sceneStatus = { 'SC-005': 'needs-you' } as any
  expect(nextStep(mk({ sceneStatus, pendingRevisions: [{ id: 'SC-001', from: 'x' }] }))).toEqual({ kind: 'stop', reason: 'needs-you' })
})
test('revision before new scenes (first one)', () => {
  const pendingRevisions = [{ id: 'SC-002', from: 'a' }, { id: 'SC-001', from: 'b' }]
  expect(nextStep(mk({ sceneStatus: accepted(1), pendingRevisions }))).toEqual({ kind: 'revise', id: 'SC-002', from: 'a' })
})
test('fresh book starts at the first scene', () => {
  expect(nextStep(mk())).toEqual({ kind: 'scene', id: 'SC-001' })
})
test('nextStep skips accepted scenes (resume case)', () => {
  expect(nextStep(mk({ sceneStatus: accepted(1) }))).toEqual({ kind: 'scene', id: 'SC-002' })
})
test('an interrupted drafting or review scene is the next scene', () => {
  expect(nextStep(mk({ sceneStatus: { ...accepted(1), 'SC-002': 'drafting' } }))).toEqual({ kind: 'scene', id: 'SC-002' })
  expect(nextStep(mk({ sceneStatus: { ...accepted(1), 'SC-002': 'review' } }))).toEqual({ kind: 'scene', id: 'SC-002' })
})
test('chapter check after its last scene', () => {
  expect(nextStep(mk({ sceneStatus: accepted(2) }))).toEqual({ kind: 'chapter', id: 'CH-01' })
})
test('checked chapter moves on to the next scene', () => {
  const state = { checkedChapters: ['CH-01'] }
  expect(nextStep(mk({ sceneStatus: accepted(2), state }))).toEqual({ kind: 'scene', id: 'SC-003' })
})
test('act check after its last chapter check', () => {
  const state = { checkedChapters: ['CH-01', 'CH-02'] }
  expect(nextStep(mk({ sceneStatus: accepted(4), state }))).toEqual({ kind: 'act', id: 'ACT-1' })
})
test('act just checked in this run is a checkpoint', () => {
  const state = { checkedChapters: ['CH-01', 'CH-02'], checkedActs: ['ACT-1'] }
  expect(nextStep(mk({ sceneStatus: accepted(4), state }))).toEqual({ kind: 'stop', reason: 'checkpoint' })
})
test('an act checked before this run does not checkpoint', () => {
  const state = { checkedChapters: ['CH-01', 'CH-02'], checkedActs: ['ACT-1'] }
  const startedWith = { completed: all.slice(0, 4), checkedChapters: ['CH-01', 'CH-02'], checkedActs: ['ACT-1'] }
  expect(nextStep(mk({ sceneStatus: accepted(4), state, startedWith }))).toEqual({ kind: 'scene', id: 'SC-005' })
})
test('stop-at scene after one new acceptance', () => {
  const state = { stopAt: 'scene', completed: ['SC-001'] }
  expect(nextStep(mk({ sceneStatus: accepted(1), state }))).toEqual({ kind: 'stop', reason: 'stop-at' })
})
test('stop-at scene runs a scene when none accepted yet in this run', () => {
  const state = { stopAt: 'scene', completed: ['SC-001'] }
  const startedWith = { ...none, completed: ['SC-001'] }
  expect(nextStep(mk({ sceneStatus: accepted(1), state, startedWith }))).toEqual({ kind: 'scene', id: 'SC-002' })
})
test('stop-at chapter stops after a chapter check', () => {
  const state = { stopAt: 'chapter', checkedChapters: ['CH-01'] }
  expect(nextStep(mk({ sceneStatus: accepted(2), state }))).toEqual({ kind: 'stop', reason: 'stop-at' })
})
test('stop-at chapter keeps going before a chapter check', () => {
  const state = { stopAt: 'chapter' }
  expect(nextStep(mk({ sceneStatus: accepted(1), state }))).toEqual({ kind: 'scene', id: 'SC-002' })
})
test('done when everything is accepted and checked', () => {
  const state = { checkedChapters: ['CH-01', 'CH-02', 'CH-03', 'CH-04'], checkedActs: ['ACT-1', 'ACT-2'] }
  expect(nextStep(mk({ sceneStatus: accepted(8), state }))).toEqual({ kind: 'stop', reason: 'done' })
})
test('done wins over checkpoint when the last act was just checked', () => {
  const state = { checkedChapters: ['CH-01', 'CH-02', 'CH-03', 'CH-04'], checkedActs: ['ACT-1', 'ACT-2'] }
  const startedWith = { ...none, checkedActs: ['ACT-1'] }
  expect(nextStep(mk({ sceneStatus: accepted(8), state, startedWith }))).toEqual({ kind: 'stop', reason: 'done' })
})
test('without act pauses, a just-checked act runs on to the next scene', () => {
  const state = { pauseAtActs: false, checkedChapters: ['CH-01', 'CH-02'], checkedActs: ['ACT-1'] }
  expect(nextStep(mk({ sceneStatus: accepted(4), state }))).toEqual({ kind: 'scene', id: 'SC-005' })
})
test('without act pauses, stop-at act still stops after a new act check', () => {
  const state = { stopAt: 'act', pauseAtActs: false, checkedChapters: ['CH-01', 'CH-02'], checkedActs: ['ACT-1'] }
  expect(nextStep(mk({ sceneStatus: accepted(4), state }))).toEqual({ kind: 'stop', reason: 'stop-at' })
})

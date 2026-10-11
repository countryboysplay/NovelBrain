import { expect, test } from 'vitest'
import type { RunStateT } from '../src/shared/types'
import { cardLabel, dropTitle, excerpt, runLabel, titleCase, usd, wordsLong, wordsShort } from '../src/renderer/src/lib/format'

test('money and words', () => {
  expect(usd(0)).toBe('$0.00'); expect(usd(4.125)).toBe('$4.13'); expect(usd(0.04)).toBe('$0.04')
  expect(wordsShort(812)).toBe('812'); expect(wordsShort(17649)).toBe('17.6k'); expect(wordsShort(2000)).toBe('2k')
  expect(wordsLong(17649)).toBe('17,649')
  expect(titleCase('middle-grade')).toBe('Middle grade')
})
test('labels', () => {
  // Typed, not `as const`: readonly [] is not assignable to RunStateT's string[] and would fail typecheck.
  const base: Omit<RunStateT, 'status'> = { stopAt: 'act', pauseAtActs: true, spentUsd: 0, current: null, completed: [], parked: [], checkedChapters: [], checkedActs: [], checkedBook: false, resumeAfter: null, lastError: null }
  expect(runLabel(null)).toBe('No run')
  expect(runLabel({ ...base, status: 'running', current: { kind: 'scene', id: 'SC-009', round: 1 } })).toBe('Running scene SC-009')
  expect(runLabel({ ...base, status: 'done' })).toBe('Done')
  expect(runLabel({ ...base, status: 'usage-limit', resumeAfter: '2:50pm' })).toBe('Usage limit; resets 2:50pm')
  expect(runLabel({ ...base, status: 'checkpoint' })).toBe('Act checkpoint: your turn')
  expect(cardLabel({ status: 'needs-you', live: false })).toBe('needs you')
  expect(cardLabel({ status: 'planned', live: true })).toBe('wet paint')
})
test('bible text for cards', () => {
  expect(dropTitle('# Style guide\nShort declarative lines.', 'Style guide')).toBe('Short declarative lines.')
  expect(dropTitle('# Rules\nNo magic.', 'Style guide')).toBe('# Rules\nNo magic.')
  expect(excerpt('# Ruth\nA farmer.\n\nShe counts.')).toBe('A farmer. She counts.')
  expect(excerpt('word '.repeat(60), 20)).toBe('word word word word…')
})

import { test, expect } from 'vitest'
import type { RoomEntry } from '../src/shared/types'
import { roomGroups, typing, unread } from '../src/renderer/src/lib/room'

const at = '2026-10-05T12:00:00.000Z'
const e = (step: string, kind: RoomEntry['kind'] = 'say', o: Partial<RoomEntry> = {}): RoomEntry => ({ at, step, from: 'showrunner', kind, text: 't', ...o })
test('consecutive entries of one step form a group; a step that comes back starts a new one', () => {
  expect(roomGroups([e('SC-001'), e('SC-001'), e('SC-002'), e('SC-001')]).map(g => [g.step, g.entries.length])).toEqual([['SC-001', 2], ['SC-002', 1], ['SC-001', 1]])
  expect(roomGroups([])).toEqual([])
})
test('typing: the last unanswered dispatch of the running step, else the showrunner, else nobody', () => {
  const es = [e('SC-001', 'dispatch', { to: 'author' }), e('SC-001', 'reply', { from: 'author' }), e('SC-001', 'dispatch', { to: 'line-editor' }),
    e('SC-001', 'dispatch', { to: 'reader' }), e('SC-001', 'reply', { from: 'reader' })]
  expect(typing(es, 'SC-001')).toBe('line-editor')
  expect(typing(es.slice(0, 2), 'SC-001')).toBe('showrunner')
  expect(typing(es, 'SC-002')).toBe('showrunner')
  expect(typing(es, null)).toBeNull()
})
test('unread: a channel\'s entries newer than when the writer last looked', () => {
  const later = '2026-10-05T12:05:00.000Z'
  const es = [e('SC-001'), e('SC-001', 'review', { from: 'line-editor', at: later }), e('SC-001', 'system', { from: 'app', needsYou: true, at: later })]
  expect(unread(es, 'general', undefined)).toBe(3)
  expect(unread(es, 'general', at)).toBe(2)
  expect(unread(es, 'reviews', at)).toBe(1)
  expect(unread(es, 'needs-you', later)).toBe(0)
  expect(unread(es, 'drafting', undefined)).toBe(0)
})

import { test, expect } from 'vitest'
import { isSceneId, isStopAt, startArg, waitIdle } from '../src/main/run/ipc'

test('validates stop points, scene ids and start arguments', () => {
  expect(['scene', 'chapter', 'act', 'book'].every(isStopAt)).toBe(true)
  for (const v of ['', 'all', 5, null, undefined, {}]) expect(isStopAt(v)).toBe(false)
  expect(isSceneId('SC-001')).toBe(true)
  expect(isSceneId('SC-1234')).toBe(true)
  for (const v of ['SC-01', 'SC-001/..', '../SC-001', 'SC-001\n', 7, null]) expect(isSceneId(v)).toBe(false)
  expect(startArg({ stopAt: 'act' })).toEqual({ stopAt: 'act', pauseAtActs: true })
  expect(startArg({ stopAt: 'book', pauseAtActs: false })).toEqual({ stopAt: 'book', pauseAtActs: false })
  expect(startArg({ stopAt: 'book', pauseAtActs: true })).toEqual({ stopAt: 'book', pauseAtActs: true })
  for (const v of [null, undefined, 'act', {}, { stopAt: 'x' }, { stopAt: 5 }, { stopAt: 'act', pauseAtActs: 'no' }, { stopAt: 'act', pauseAtActs: 0 }, { stopAt: 'act', pauseAtActs: null }]) expect(startArg(v)).toBeNull()
})

test('waitIdle reports idle or timeout', async () => {
  expect(await waitIdle({ idle: () => Promise.resolve() }, 1000)).toBe(true)
  expect(await waitIdle({ idle: () => new Promise<void>(() => {}) }, 20)).toBe(false)
})

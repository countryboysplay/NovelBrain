import { expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { overLimit, usageFromHeadroom, usageFromStream, usageText, type Usage } from '../src/shared/usage'
import { parseStepResult, parseStream } from '../src/main/run/claude'

const now = Date.parse('2026-10-04T12:00:00Z')
const later = now + 3_600_000

test('a stream-json reply: the result line is the reply, the rate_limit_event the usage, in percent and ms', () => {
  const { json, usage } = parseStream(readFileSync(join(__dirname, 'fixtures', 'stream-json.jsonl'), 'utf8'))
  expect(json).toMatchObject({ type: 'result', is_error: false, total_cost_usd: 0.42 })
  expect(parseStepResult(json!.result!)).toMatchObject({ id: 'SC-001', outcome: 'accepted' })
  expect(usage).toMatchObject({ source: 'stream', fiveHour: { pct: 59, resetsAt: 1791158400000 }, sevenDay: { pct: 8, resetsAt: 1791676800000 } })
})

test('parseStream skips broken and non-JSON lines, takes the last result, and keeps the last usable reading', () => {
  const ev = (five?: number) => JSON.stringify({ type: 'rate_limit_event', rate_limit_info: five === undefined ? { status: 'allowed' } : { unifiedWindows: { five_hour: { utilization: five, resetsAt: 1791158400 } } } })
  const out = [
    'Warning: plain CLI text',
    JSON.stringify({ type: 'result', result: 'first', total_cost_usd: 0.1 }),
    ev(0.4),
    ev(),
    JSON.stringify({ type: 'result', result: 'second', total_cost_usd: 0.2 }),
    '{"type":"result","result":"trunc'
  ].join('\n')
  const { json, usage } = parseStream(out)
  expect(json).toMatchObject({ result: 'second', total_cost_usd: 0.2 })
  expect(usage?.fiveHour).toEqual({ pct: 40, resetsAt: 1791158400000 })
  expect(parseStream('')).toEqual({ json: null, usage: null })
})

test('missing or odd fields give no window, never a guess', () => {
  expect(usageFromStream({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } })).toBeNull()
  expect(usageFromStream({ type: 'rate_limit_event' })).toBeNull()
  expect(usageFromStream({ type: 'result' })).toBeNull()
  expect(usageFromStream(null)).toBeNull()
  const one = usageFromStream({ type: 'rate_limit_event', rate_limit_info: { unifiedWindows: { five_hour: { utilization: '0.5' }, seven_day: { utilization: 0.3 } } } })
  expect(one).toMatchObject({ fiveHour: null, sevenDay: { pct: 30, resetsAt: null } })
})

test('Headroom /stats: utilization_pct is already percent and resets_at is ISO', () => {
  const u = usageFromHeadroom({ subscription_window: { latest: { five_hour: { utilization_pct: 56, resets_at: '2026-10-04T13:00:00Z' }, seven_day: { utilization_pct: 8 } } } })
  expect(u).toMatchObject({ source: 'headroom', fiveHour: { pct: 56, resetsAt: Date.parse('2026-10-04T13:00:00Z') }, sevenDay: { pct: 8, resetsAt: null } })
  expect(usageFromHeadroom('<h1>STUB</h1>')).toBeNull()
  expect(usageFromHeadroom({ subscription_window: {} })).toBeNull()
})

test('overLimit: at or over stopAt with a future reset stops; the later reset wins; missing or passed resets never stop', () => {
  const u = (five: number | null, week: number | null, r5: number | null = later, r7: number | null = later + 1000): Usage =>
    ({ source: 'stream', at: now, fiveHour: five === null ? null : { pct: five, resetsAt: r5 }, sevenDay: week === null ? null : { pct: week, resetsAt: r7 } })
  expect(overLimit(u(95, 20), 90, now)).toEqual({ window: '5-hour', pct: 95, resetsAt: later })
  expect(overLimit(u(90, 20), 90, now)?.window).toBe('5-hour')
  expect(overLimit(u(95, 92), 90, now)).toEqual({ window: 'weekly', pct: 92, resetsAt: later + 1000 })
  expect(overLimit(u(89, 20), 90, now)).toBeNull()
  expect(overLimit(u(95, 20, now - 1), 90, now)).toBeNull()
  expect(overLimit(u(95, 20, null), 90, now)).toBeNull()
  expect(overLimit(u(null, null), 90, now)).toBeNull()
  expect(overLimit(null, 90, now)).toBeNull()
})

test('usageText shows each window or unknown', () => {
  expect(usageText(null)).toBe('Usage: 5h unknown · week unknown')
  expect(usageText({ source: 'stream', at: now, fiveHour: { pct: 59.4, resetsAt: later }, sevenDay: null }, now)).toBe('Usage: 5h 59% · week unknown')
  expect(usageText({ source: 'stream', at: now, fiveHour: { pct: 59, resetsAt: now - 1 }, sevenDay: { pct: 8, resetsAt: null } }, now)).toBe('Usage: 5h unknown · week 8%')
})

import { expect, test } from 'vitest'
import { appendFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appendSpend, readSpend } from '../src/main/run/state'

test('the spend ledger round-trips and drops malformed lines', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nb-spend-'))
  expect(readSpend(dir)).toEqual([])
  appendSpend(dir, { at: '2026-10-04T12:00:00.000Z', kind: 'scene', id: 'SC-001', usd: 0.25 })
  appendFileSync(join(dir, 'run', 'spend.jsonl'), '{oops\n{"at":"x","kind":"lunch","id":"SC-1","usd":1}\n{"at":"x","kind":"act","id":"ACT-1","usd":-1}\n')
  appendSpend(dir, { at: '2026-10-04T12:05:00.000Z', kind: 'chapter', id: 'CH-01', usd: 0.1 })
  expect(readSpend(dir)).toEqual([
    { at: '2026-10-04T12:00:00.000Z', kind: 'scene', id: 'SC-001', usd: 0.25 },
    { at: '2026-10-04T12:05:00.000Z', kind: 'chapter', id: 'CH-01', usd: 0.1 }
  ])
})

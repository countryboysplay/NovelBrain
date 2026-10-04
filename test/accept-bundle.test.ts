import { test, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

test('the bundle imports only node: built-ins', () => {
  const src = readFileSync(resolve('resources/accept/accept.mjs'), 'utf8')
  const bare = [...src.matchAll(/(?:from\s+|import\s*\(\s*|require\(\s*)["']([^"']+)["']/g)].map(m => m[1]).filter(s => !s.startsWith('node:'))
  expect(bare.filter(s => !['process', 'buffer'].includes(s))).toEqual([])
})

test('the bundle refuses a bad scene id with exit 1 and JSON output', () => {
  const r = spawnSync('node', [resolve('resources/accept/accept.mjs'), 'SC-1'], { cwd: resolve('test/fixtures/book-ok'), encoding: 'utf8' })
  expect(r.status).toBe(1)
  expect(JSON.parse(r.stdout.trim()).ok).toBe(false)
})

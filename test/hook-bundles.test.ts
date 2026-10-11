import { test, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const hooks = resolve('resources/hooks')

const book = () => {
  const root = join(mkdtempSync(join(tmpdir(), 'nb bundle ')), 'Book')
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, 'book.yaml'), 'id: b\nstatus: active\n')
  return root
}
const runHook = (name: string, input: object, cwd: string) =>
  spawnSync('node', [join(hooks, `${name}.mjs`)], { input: JSON.stringify(input), cwd, encoding: 'utf8' })

test('bundled guard blocks a canon write with exit 2 from outside the repo', () => {
  const b = book()
  const r = runHook('guard', { cwd: b, tool_name: 'Write', tool_input: { file_path: 'canon/facts.yaml' } }, b)
  expect(r.status).toBe(2)
  expect(r.stderr).toMatch(/protected/)
})

test('bundled guard allows a draft write', () => {
  const b = book()
  expect(runHook('guard', { cwd: b, tool_name: 'Write', tool_input: { file_path: 'drafts/a.md' } }, b).status).toBe(0)
})

test('bundled guard blocks git diff --output into canon via Bash', () => {
  const b = book()
  const r = runHook('guard', { cwd: b, tool_name: 'Bash', tool_input: { command: 'git diff --output=canon/x' } }, b)
  expect(r.status).toBe(2)
})

test('bundled validate rejects a bad scene plan', () => {
  const b = book()
  mkdirSync(join(b, 'outline', 'scenes'), { recursive: true })
  writeFileSync(join(b, 'outline', 'scenes', 'SC-001.yaml'), 'id: SC-001\n')
  const r = runHook('validate', { cwd: b, tool_name: 'Write', tool_input: { file_path: 'outline/scenes/SC-001.yaml' } }, b)
  expect(r.status).toBe(2)
})

test('bundled memory hook prints the briefing from outside the repo', () => {
  const b = book()
  mkdirSync(join(b, '.novelbrain'))
  writeFileSync(join(b, '.novelbrain', 'memory.md'), '# lessons\nKeep it tight.\n')
  const r = spawnSync('node', [join(hooks, 'memory.mjs'), 'start'], { input: JSON.stringify({ cwd: b }), cwd: b, encoding: 'utf8' })
  expect(r.status).toBe(0)
  expect(r.stdout).toContain('Keep it tight.')
})

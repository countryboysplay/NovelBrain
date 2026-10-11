import { test, expect } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeBookSettings } from '../src/main/book/settings'

test('registers guard on PreToolUse and validate on PostToolUse with absolute paths', () => {
  const book = mkdtempSync(join(tmpdir(), 'nb-set-'))
  const file = writeBookSettings(book, 'C:\\Program Files\\Novel Brain\\resources\\hooks')
  expect(file).toBe(join(book, '.claude', 'settings.local.json'))
  const s = JSON.parse(readFileSync(file, 'utf8'))
  const pre = s.hooks.PreToolUse[0]
  expect(pre.matcher).toBe('Write|Edit|MultiEdit|NotebookEdit|Bash|PowerShell|mcp__.*')
  expect(pre.hooks[0].command).toBe('node "C:/Program Files/Novel Brain/resources/hooks/guard.mjs"')
  const post = s.hooks.PostToolUse[0]
  expect(post.matcher).toBe('Write|Edit|MultiEdit')
  expect(post.hooks[0].command).toBe('node "C:/Program Files/Novel Brain/resources/hooks/validate.mjs"')
})

test('rewriting replaces the previous paths', () => {
  const book = mkdtempSync(join(tmpdir(), 'nb-set-'))
  writeBookSettings(book, 'C:/old')
  const s = JSON.parse(readFileSync(writeBookSettings(book, 'C:/new'), 'utf8'))
  expect(JSON.stringify(s)).not.toMatch(/C:\/old/)
})

test('registers the memory hook on SessionStart, SessionEnd and PreCompact with a 10 s timeout', () => {
  const book = mkdtempSync(join(tmpdir(), 'nb-set-'))
  const s = JSON.parse(readFileSync(writeBookSettings(book, 'C:/app/hooks'), 'utf8'))
  const mem = (arg: string) => [{ hooks: [{ type: 'command', command: `node "C:/app/hooks/memory.mjs" ${arg}`, timeout: 10 }] }]
  expect(s.hooks.SessionStart).toEqual(mem('start'))
  expect(s.hooks.SessionEnd).toEqual(mem('enqueue'))
  expect(s.hooks.PreCompact).toEqual(mem('enqueue'))
  expect(s.hooks.PreToolUse).toEqual([{ matcher: 'Write|Edit|MultiEdit|NotebookEdit|Bash|PowerShell|mcp__.*', hooks: [{ type: 'command', command: 'node "C:/app/hooks/guard.mjs"' }] }])
  expect(s.hooks.PostToolUse).toEqual([{ matcher: 'Write|Edit|MultiEdit', hooks: [{ type: 'command', command: 'node "C:/app/hooks/validate.mjs"' }] }])
})

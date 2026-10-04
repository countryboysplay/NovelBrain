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

import { test, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findBookRoot, resolveInBook, isProtected } from '../src/shared/bookpath'

const mkBook = () => {
  const root = join(mkdtempSync(join(tmpdir(), 'nb path ')), 'My Book')
  mkdirSync(join(root, 'notes'), { recursive: true })
  writeFileSync(join(root, 'book.yaml'), 'id: x\n')
  return root
}

test('finds the book root from a nested folder', () => {
  const root = mkBook()
  expect(findBookRoot(join(root, 'notes'))!.toLowerCase()).toBe(findBookRoot(root)!.toLowerCase())
})

test('returns null outside any book', () => expect(findBookRoot(mkdtempSync(join(tmpdir(), 'nb-none-')))).toBeNull())

test('relative and absolute paths inside the book', () => {
  const root = mkBook()
  expect(resolveInBook(root, 'notes/a.md')).toEqual({ inside: true, rel: 'notes/a.md' })
  expect(resolveInBook(root, join(root, 'drafts', 'SC-001.md'))).toEqual({ inside: true, rel: 'drafts/SC-001.md' })
})

test('case and separators do not matter', () => {
  const root = mkBook()
  const weird = root.toUpperCase().replace(/\\/g, '/') + '/CANON/../canon/facts.yaml'
  const r = resolveInBook(root, weird)
  expect(r.inside).toBe(true)
  expect(r.rel.toLowerCase()).toBe('canon/facts.yaml')
  expect(isProtected(r.rel)).toBe(true)
})

test('.. escapes are outside', () => {
  const root = mkBook()
  expect(resolveInBook(root, '../other/x.md').inside).toBe(false)
  expect(resolveInBook(root, 'C:/Windows/x.txt').inside).toBe(false)
})

test('a junction inside the book that points outside is outside', () => {
  const root = mkBook()
  const outside = mkdtempSync(join(tmpdir(), 'nb-out-'))
  symlinkSync(outside, join(root, 'notes', 'link'), 'junction')
  expect(resolveInBook(root, 'notes/link/x.md').inside).toBe(false)
})

test('protected paths', () => {
  for (const p of ['canon/facts.yaml', 'manuscript/SC-001.md', 'run/state.yaml', 'book.yaml', 'series.yaml',
    '.claude/settings.local.json', '.novelbrain/accept.mjs', '.git/config', 'Canon/facts.yaml',
    '.mcp.json', '.MCP.json', '.gitignore', '.gitattributes', 'package.json', 'node_modules', 'node_modules/x/y.js',
    'notes/x/.git/config', 'notes/.GIT', 'claude.cmd', 'CLAUDE.BAT', 'x.ps1', 'x.vbs', 'x.js', 'x.mjs', 'x.cjs', 'x.exe', 'x.com'])
    expect(isProtected(p), p).toBe(true)
  for (const p of ['drafts/SC-001.md', 'bible/characters/CHAR-RUTH.md', 'outline/outline.yaml', 'notes/canon/x.md', 'notes/a.b.md', 'notes/.gitignore', 'notes/package.json', 'drafts/notes.js', 'notes/claude.cmd', 'x.md'])
    expect(isProtected(p), p).toBe(false)
})

test('unicode that changes length when lowercased stays protected', () => {
  const root = mkBook()
  const r = resolveInBook(root, 'canon/İ.yaml')
  expect(r.inside).toBe(true)
  expect(r.rel.startsWith('canon/')).toBe(true)
  expect(isProtected(r.rel)).toBe(true)
})

test('trailing dot/space, ADS and device names are protected', () => {
  for (const p of ['book.yaml ', 'book.yaml.', 'canon./facts.yaml', 'canon /x', 'book.yaml:x', 'C:canon/facts.yaml',
    'drafts/CON', 'drafts/nul.txt', 'drafts/COM1', 'drafts/lpt9.md'])
    expect(isProtected(p), p).toBe(true)
  expect(isProtected('drafts/console.md')).toBe(false)
})

test('drive-relative targets never yield a bogus inside path', () => {
  const root = mkBook()
  const r = resolveInBook(root, 'C:canon\\facts.yaml')
  expect(r.inside && !isProtected(r.rel)).toBe(false)
})

test('bare protected folders are protected', () => {
  for (const p of ['canon', 'run', '.claude', 'manuscript', '.git', '.novelbrain']) expect(isProtected(p), p).toBe(true)
})

test('resolveInBook never throws', () => {
  const root = mkBook()
  expect(resolveInBook(root, 'a\0b')).toEqual({ inside: false, rel: '' })
})

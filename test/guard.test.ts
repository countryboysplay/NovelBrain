import { test, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decide, main } from '../src/hooks/guard'

const mkBook = (status = 'active') => {
  const root = join(mkdtempSync(join(tmpdir(), 'nb guard ')), 'Book')
  mkdirSync(join(root, 'notes'), { recursive: true })
  writeFileSync(join(root, 'book.yaml'), `id: b\ntitle: B\nstatus: ${status}\n`)
  return root
}
const write = (cwd: string, file_path: string) => decide({ cwd, tool_name: 'Write', tool_input: { file_path, content: 'x' } })
const bash = (cwd: string, command: string) => decide({ cwd, tool_name: 'Bash', tool_input: { command } })

test('allows writes to drafts, bible, outline, proposals, reviews and notes', () => {
  const b = mkBook()
  for (const p of ['drafts/SC-001.md', 'bible/characters/CHAR-RUTH.md', 'outline/outline.yaml', 'proposals/P-0001.yaml', 'reviews/SC-001.md', 'notes/x.md'])
    expect(write(b, p), p).toEqual({ allow: true })
})

test('blocks canon, manuscript, run and book.yaml', () => {
  const b = mkBook()
  for (const p of ['canon/facts.yaml', 'manuscript/SC-001.md', 'run/state.yaml', 'book.yaml'])
    expect(write(b, p).allow, p).toBe(false)
})

test('guard blocks kit and git internals', () => {
  const b = mkBook()
  for (const p of ['.claude/settings.local.json', '.claude/agents/author.md', '.novelbrain/accept.mjs', '.git/hooks/pre-commit', '.mcp.json', 'claude.cmd', 'package.json', 'notes/x/.git/config'])
    expect(write(b, p).allow, p).toBe(false)
})

test('blocks writes outside the book, including sibling books', () => {
  const b = mkBook()
  expect(write(b, '../Other Book/drafts/x.md').allow).toBe(false)
  expect(write(b, 'C:/Users/Public/x.txt').allow).toBe(false)
})

test('guard blocks a write through a junction', () => {
  const b = mkBook()
  symlinkSync(mkdtempSync(join(tmpdir(), 'nb-out-')), join(b, 'notes', 'link'), 'junction')
  expect(write(b, 'notes/link/x.md').allow).toBe(false)
})

test('blocks every write in an archived book', () => {
  const b = mkBook('archived')
  expect(write(b, 'drafts/SC-001.md').allow).toBe(false)
})

test('checks Edit, MultiEdit and NotebookEdit paths too', () => {
  const b = mkBook()
  expect(decide({ cwd: b, tool_name: 'Edit', tool_input: { file_path: 'canon/facts.yaml' } }).allow).toBe(false)
  expect(decide({ cwd: b, tool_name: 'MultiEdit', tool_input: { file_path: 'manuscript/a.md' } }).allow).toBe(false)
  expect(decide({ cwd: b, tool_name: 'NotebookEdit', tool_input: { notebook_path: 'run/x.ipynb' } }).allow).toBe(false)
})

test('accepts absolute Windows backslash paths as the docs deliver them', () => {
  const b = mkBook()
  expect(write(b, join(b, 'drafts', 'a.md'))).toEqual({ allow: true })
  expect(write(b, join(b, 'canon', 'facts.yaml')).allow).toBe(false)
})

test('allows read-only git and the accept script', () => {
  const b = mkBook()
  for (const c of ['git diff', 'git log --oneline -5', 'git show HEAD:canon/facts.yaml', 'git diff -- drafts/SC-001.md', 'node .novelbrain/accept.mjs SC-012'])
    expect(bash(b, c), c).toEqual({ allow: true })
})

test('refuses other commands', () => {
  const b = mkBook()
  for (const c of ['rm canon/facts.yaml', 'git commit -m x', 'git checkout -- canon', 'node other.mjs', 'node .novelbrain/accept.mjs SC-1', 'del book.yaml', 'git push'])
    expect(bash(b, c).allow, c).toBe(false)
})

test('PowerShell gets the same Bash rules', () => {
  const b = mkBook()
  expect(decide({ cwd: b, tool_name: 'PowerShell', tool_input: { command: 'Remove-Item canon/facts.yaml' } }).allow).toBe(false)
  expect(decide({ cwd: b, tool_name: 'PowerShell', tool_input: { command: 'git diff' } })).toEqual({ allow: true })
})

test('guard refuses shell metacharacters', () => {
  const b = mkBook()
  for (const c of ['git log; del canon\\facts.yaml', 'git diff > canon/x', 'git show $(whoami)', 'git log && rm x', 'git log | tee canon/x', 'git log `x`', 'git log\nrm x'])
    expect(bash(b, c).allow, JSON.stringify(c)).toBe(false)
})

test('other tools are allowed', () => {
  const b = mkBook()
  expect(decide({ cwd: b, tool_name: 'Read', tool_input: { file_path: 'canon/facts.yaml' } })).toEqual({ allow: true })
})

test('outside any book, write tools are blocked', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nb-nobook-'))
  expect(write(dir, 'x.md').allow).toBe(false)
})

test('a write with a missing or empty path is blocked', () => {
  const b = mkBook()
  for (const tool_input of [{}, { file_path: '' }, { file_path: '   ' }, { file_path: 5 }])
    expect(decide({ cwd: b, tool_name: 'Write', tool_input }).allow, JSON.stringify(tool_input)).toBe(false)
  expect(decide({ cwd: b, tool_name: 'NotebookEdit', tool_input: {} }).allow).toBe(false)
})

test('decide never throws, it blocks', () => {
  expect(decide(null as never).allow).toBe(false)
  expect(decide({ cwd: 5, tool_name: 'Write', tool_input: null } as never)).toEqual({
    allow: false,
    reason: 'Novel Brain guard hit an error, so the action was blocked.'
  })
})

test('main exits 2 with the reason on block and 0 on allow', () => {
  const b = mkBook()
  const blocked = main(JSON.stringify({ cwd: b, tool_name: 'Write', tool_input: { file_path: 'canon/facts.yaml' } }))
  expect(blocked.code).toBe(2)
  expect(blocked.stderr).toMatch(/canon/)
  expect(main(JSON.stringify({ cwd: b, tool_name: 'Write', tool_input: { file_path: 'drafts/a.md' } }))).toEqual({ code: 0, stderr: '' })
})

test('main blocks on unreadable input rather than allowing', () => {
  expect(main('not json').code).toBe(2)
  expect(main('null').code).toBe(2)
})

test('git cannot write, run programs or read outside the book', () => {
  const b = mkBook()
  for (const c of ['git diff --output=canon/d.txt', 'git log --output=x', 'git show --format=%s --output=.git/hooks/pre-commit', 'git diff --ext-diff', 'git diff --textconv', 'git diff --no-index a b', 'git -c core.pager=x log', 'git --git-dir=.. log', 'git log -1 --oneline (Remove-Item x)', 'git log @(x)', 'git log {x}', 'git log a,b', 'git log  --oneline', 'git log -n x', 'git log --out=x', 'git log -- -'])
    for (const tool_name of ['Bash', 'PowerShell'])
      expect(decide({ cwd: b, tool_name, tool_input: { command: c } }).allow, `${tool_name}: ${c}`).toBe(false)
})

test('allowed git and accept forms', () => {
  const b = mkBook()
  for (const c of ['git log -n 5', 'git log --max-count=3 --stat', 'git log -3', 'git diff --cached -- drafts/SC-001.md', 'node ./.novelbrain/accept.mjs SC-012', 'node .novelbrain\\accept.mjs SC-012', 'node .\\.novelbrain\\accept.mjs SC-012'])
    expect(bash(b, c), c).toEqual({ allow: true })
})

test('an unparseable book.yaml blocks writes', () => {
  const b = mkBook()
  writeFileSync(join(b, 'book.yaml'), 'status: [archived\n')
  expect(write(b, 'drafts/a.md').allow).toBe(false)
})

test('MCP tools are blocked', () => {
  expect(decide({ cwd: mkBook(), tool_name: 'mcp__srv__write', tool_input: {} }).allow).toBe(false)
})

test('backslash-escaped git options are blocked', () => {
  const b = mkBook()
  for (const c of ['git diff HEAD \\-\\-output canon/x', 'git diff \\--output=x', 'git diff \\-\\-ext-diff', 'git diff \\-\\-no-index a b'])
    for (const tool_name of ['Bash', 'PowerShell'])
      expect(decide({ cwd: b, tool_name, tool_input: { command: c } }).allow, `${tool_name}: ${c}`).toBe(false)
})

test('blocks CLAUDE.md, CLAUDE.local.md, .gitattributes and .mcp.json, whatever the case', () => {
  const b = mkBook()
  for (const p of ['CLAUDE.md', 'claude.md', 'CLAUDE.local.md', '.gitattributes', '.GitAttributes', '.mcp.json', 'notes/CLAUDE.md', 'drafts/x/claude.local.md', 'bible/.gitattributes'])
    expect(write(b, p).allow, p).toBe(false)
  expect(write(b, 'notes/claude-notes.md')).toEqual({ allow: true })
})

test('the shell allows exactly the two touch-up forms of accept', () => {
  const b = mkBook()
  for (const c of ['node .novelbrain/accept.mjs SC-012 --touchup', 'node .novelbrain/accept.mjs SC-012 --sealed'])
    expect(bash(b, c).allow, c).toBe(true)
  for (const c of ['node .novelbrain/accept.mjs SC-012 --force', 'node .novelbrain/accept.mjs SC-012 --touchup --sealed', 'node .novelbrain/accept.mjs --touchup SC-012', 'node .novelbrain/accept.mjs SC-012  --touchup', 'node .novelbrain/accept.mjs SC-012 --sealed; rm x', 'node .novelbrain/accept.mjs SC-012 --touchup && rm x', 'node .novelbrain/accept.mjs SC-012 --touchup\nrm x'])
    expect(bash(b, c).allow, c).toBe(false)
  // The PowerShell tool gets the same exact forms, and a carriage return cannot smuggle a second command in.
  for (const [c, ok] of [['node .novelbrain/accept.mjs SC-012 --touchup', true], ['node .novelbrain/accept.mjs SC-012 --sealed', true], ['node .novelbrain/accept.mjs SC-012 --sealed; Remove-Item x', false]] as const)
    expect(decide({ cwd: b, tool_name: 'PowerShell', tool_input: { command: c } }).allow, c).toBe(ok)
  for (const c of ['node .novelbrain/accept.mjs SC-012 --touchup\rrm x', 'node .novelbrain/accept.mjs SC-012 --sealed\r\nrm x', 'node .novelbrain/accept.mjs SC-012\r --touchup'])
    for (const tool_name of ['Bash', 'PowerShell']) expect(decide({ cwd: b, tool_name, tool_input: { command: c } }).allow, JSON.stringify(c)).toBe(false)
})

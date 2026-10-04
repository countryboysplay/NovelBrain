import { test, expect } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parse, stringify } from 'yaml'
import { newBook } from '../src/main/book/create'
import { git } from '../src/main/book/git'
import { installKit, kitNeedsUpgrade, upgradeKit } from '../src/main/book/kit'

const hooks = resolve('resources/hooks')
const accept = resolve('resources/accept/accept.mjs')
const opts = { title: 'Kit Book', audience: 'adult' as const, genres: ['literary' as const], wordTarget: 80000 }

// Fixture kit, so the test does not depend on real kit content.
function fixtureKit(extra: Record<string, string> = {}): string {
  const k = mkdtempSync(join(tmpdir(), 'nb-kit '))
  const files: Record<string, string> = { 'agents/author.md': 'a', 'commands/write-scene.md': 'c', 'skills/showrunner/SKILL.md': 's',
    'skills/showrunner/ref/x.md': 'x', 'skills/notaskill/readme.md': 'n', 'settings.json': '{}', 'CLAUDE.md': '# kit', ...extra }
  for (const [f, c] of Object.entries(files)) { mkdirSync(join(k, f, '..'), { recursive: true }); writeFileSync(join(k, f), c) }
  return k
}
const mk = async (kit: string) => newBook(mkdtempSync(join(tmpdir(), 'nb-kit-')), opts, kit, hooks, accept)

test('new book gets the kit and kitVersion 3', async () => {
  const dir = await mk(fixtureKit())
  for (const f of ['.claude/agents/author.md', '.claude/commands/write-scene.md', '.claude/skills/showrunner/SKILL.md', '.claude/skills/showrunner/ref/x.md', '.claude/settings.json', '.novelbrain/accept.mjs'])
    expect(existsSync(join(dir, f)), f).toBe(true)
  expect(existsSync(join(dir, '.claude/skills/notaskill'))).toBe(false)
  expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toBe('# kit')
  expect(parse(readFileSync(join(dir, 'book.yaml'), 'utf8')).kitVersion).toBe('3')
  expect(kitNeedsUpgrade(dir)).toBe(false)
})

test('installKit removes stale kit files but keeps the writer\'s own', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nb-kit-'))
  const kit = fixtureKit({ 'agents/old.md': 'o' })
  installKit(dir, kit, accept)
  expect(existsSync(join(dir, '.claude/agents/old.md'))).toBe(true)
  writeFileSync(join(dir, '.claude/agents/mine.md'), 'm')
  const kit2 = fixtureKit()
  installKit(dir, kit2, accept)
  expect(existsSync(join(dir, '.claude/agents/old.md'))).toBe(false)
  expect(existsSync(join(dir, '.claude/agents/mine.md'))).toBe(true)
})

test('upgradeKit installs, bumps, keeps export, commits', async () => {
  const dir = await mk(fixtureKit())
  const y = parse(readFileSync(join(dir, 'book.yaml'), 'utf8'))
  writeFileSync(join(dir, 'book.yaml'), stringify({ ...y, kitVersion: '1', export: { trim: '5x8' } }))
  await git(dir, '-c', 'commit.gpgsign=false', 'commit', '-qam', 'v1')
  expect(kitNeedsUpgrade(dir)).toBe(true)
  const hash = await upgradeKit(dir, fixtureKit({ 'agents/new.md': 'n' }), accept)
  const after = parse(readFileSync(join(dir, 'book.yaml'), 'utf8'))
  expect(after.kitVersion).toBe('3')
  expect(after.export).toEqual({ trim: '5x8' })
  expect(existsSync(join(dir, '.claude/agents/new.md'))).toBe(true)
  expect(await git(dir, 'log', '-1', '--format=%s')).toBe('Update kit to v3')
  expect(await git(dir, 'rev-parse', '--short', 'HEAD')).toBe(hash)
  expect(await git(dir, 'status', '--porcelain')).toBe('')
})

test('upgradeKit refuses an archived book', async () => {
  const dir = await mk(fixtureKit())
  const y = parse(readFileSync(join(dir, 'book.yaml'), 'utf8'))
  writeFileSync(join(dir, 'book.yaml'), stringify({ ...y, status: 'archived', kitVersion: '1' }))
  await expect(upgradeKit(dir, fixtureKit(), accept)).rejects.toThrow(/Archived/)
})

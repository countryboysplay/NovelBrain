import { test, expect } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parse, stringify } from 'yaml'
import { newBook } from '../src/main/book/create'
import { git } from '../src/main/book/git'
import { installKit, kitNeedsUpgrade, upgradeKit, KIT_VERSION } from '../src/main/book/kit'

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

test('new book gets the kit and the current kitVersion', async () => {
  const dir = await mk(fixtureKit())
  for (const f of ['.claude/agents/author.md', '.claude/commands/write-scene.md', '.claude/skills/showrunner/SKILL.md', '.claude/skills/showrunner/ref/x.md', '.claude/settings.json', '.novelbrain/accept.mjs'])
    expect(existsSync(join(dir, f)), f).toBe(true)
  expect(existsSync(join(dir, '.claude/skills/notaskill'))).toBe(false)
  expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toBe('# kit')
  expect(parse(readFileSync(join(dir, 'book.yaml'), 'utf8')).kitVersion).toBe(KIT_VERSION)
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
  expect(after.kitVersion).toBe(KIT_VERSION)
  expect(after.export).toEqual({ trim: '5x8' })
  expect(existsSync(join(dir, '.claude/agents/new.md'))).toBe(true)
  expect(await git(dir, 'log', '-1', '--format=%s')).toBe(`Update kit to v${KIT_VERSION}`)
  expect(await git(dir, 'rev-parse', '--short', 'HEAD')).toBe(hash)
  expect(await git(dir, 'status', '--porcelain')).toBe('')
})

test('upgradeKit refuses an archived book', async () => {
  const dir = await mk(fixtureKit())
  const y = parse(readFileSync(join(dir, 'book.yaml'), 'utf8'))
  writeFileSync(join(dir, 'book.yaml'), stringify({ ...y, status: 'archived', kitVersion: '1' }))
  await expect(upgradeKit(dir, fixtureKit(), accept)).rejects.toThrow(/Archived/)
})

test('upgrading a v3 book git-ignores the memory briefing once and keeps learned skills', async () => {
  const dir = await mk(fixtureKit())
  const y = parse(readFileSync(join(dir, 'book.yaml'), 'utf8'))
  writeFileSync(join(dir, 'book.yaml'), stringify({ ...y, kitVersion: '3' }))
  writeFileSync(join(dir, '.gitignore'), 'exports/\nrun/\n.claude/settings.local.json\n')
  mkdirSync(join(dir, '.claude/skills/learned-x'), { recursive: true })
  writeFileSync(join(dir, '.claude/skills/learned-x/SKILL.md'), 'learned')
  await git(dir, 'add', '-f', '--', '.')
  await git(dir, '-c', 'commit.gpgsign=false', 'commit', '-qm', 'v3')
  writeFileSync(join(dir, '.novelbrain/memory.md'), '# briefing')
  await upgradeKit(dir, fixtureKit(), accept)
  writeFileSync(join(dir, 'book.yaml'), stringify({ ...y, kitVersion: '3' }))
  await git(dir, '-c', 'commit.gpgsign=false', 'commit', '-qm', 'back to v3', '--', 'book.yaml')
  await upgradeKit(dir, fixtureKit(), accept)
  expect(readFileSync(join(dir, '.gitignore'), 'utf8').split('\n').filter(l => l === '.novelbrain/memory.md')).toHaveLength(1)
  expect(existsSync(join(dir, '.claude/skills/learned-x/SKILL.md'))).toBe(true)
  expect(await git(dir, 'ls-files', '--', '.novelbrain/memory.md')).toBe('')
  expect(await git(dir, 'status', '--porcelain')).toBe('')
})

import { expect, test } from 'vitest'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureRepo } from '../src/main/memory/store'
import { approveSkill, listProposals, rejectSkill, rejectedNames, syncSkills } from '../src/main/memory/skills'
import { git } from '../src/main/book/git'

const proposal = (root: string, name: string) => {
  mkdirSync(join(root, 'inbox', name), { recursive: true })
  writeFileSync(join(root, 'inbox', name, 'SKILL.md'), `---\nname: ${name}\ndescription: Use when a chase drags\n---\nCut between pursuer and pursued.\n`)
}
async function newBookRepo(status = 'active') {
  const d = mkdtempSync(join(tmpdir(), 'nb-ls-book-'))
  writeFileSync(join(d, 'book.yaml'), `id: b\nstatus: ${status}\n`)
  await git(d, 'init', '-q')
  return d
}

test('approve moves the proposal to skills and sync copies it into the book with one commit', async () => {
  const root = mkdtempSync(join(tmpdir(), 'nb-ls-'))
  await ensureRepo(root)
  proposal(root, 'chase')
  expect(listProposals(root).map(p => p.name)).toEqual(['chase'])
  await approveSkill(root, 'chase')
  expect(existsSync(join(root, 'skills', 'chase', 'SKILL.md'))).toBe(true)
  expect(listProposals(root)).toEqual([])
  const book = await newBookRepo()
  expect(await syncSkills(root, book)).toBe(true)
  expect(readFileSync(join(book, '.claude', 'skills', 'learned-chase', 'SKILL.md'), 'utf8')).toContain('Cut between')
  expect(await git(book, 'log', '--format=%s')).toContain('Learned skills')
  expect(await syncSkills(root, book)).toBe(false) // nothing new, no commit
})
test('reject removes the proposal and the name is never proposed again', async () => {
  const root = mkdtempSync(join(tmpdir(), 'nb-ls-'))
  await ensureRepo(root)
  proposal(root, 'montage')
  await rejectSkill(root, 'montage')
  expect(listProposals(root)).toEqual([])
  expect(rejectedNames(root)).toEqual(['montage'])
})
test('bad names, missing proposals and archived books are refused', async () => {
  const root = mkdtempSync(join(tmpdir(), 'nb-ls-'))
  await ensureRepo(root)
  await expect(approveSkill(root, '../x')).rejects.toThrow('Invalid skill name')
  await expect(approveSkill(root, 'nope')).rejects.toThrow()
  const archived = await newBookRepo('archived')
  expect(await syncSkills(root, archived)).toBe(false)
})
test('sync commits only learned-* paths and removes skills the writer no longer has', async () => {
  const root = mkdtempSync(join(tmpdir(), 'nb-ls-'))
  await ensureRepo(root)
  proposal(root, 'chase')
  await approveSkill(root, 'chase')
  const book = await newBookRepo()
  mkdirSync(join(book, '.claude', 'skills', 'learned-old'), { recursive: true })
  writeFileSync(join(book, '.claude', 'skills', 'learned-old', 'SKILL.md'), 'old')
  mkdirSync(join(book, '.claude', 'skills', 'mine'), { recursive: true })
  writeFileSync(join(book, '.claude', 'skills', 'mine', 'SKILL.md'), 'mine')
  expect(await syncSkills(root, book)).toBe(true)
  expect(existsSync(join(book, '.claude', 'skills', 'learned-old'))).toBe(false)
  const files = (await git(book, 'show', '--name-only', '--format=', 'HEAD')).split('\n')
  expect(files).toEqual(['.claude/skills/learned-chase/SKILL.md'])
  expect(await git(book, 'status', '--porcelain')).toContain('book.yaml')
})
test('a rejected name cannot be approved later', async () => {
  const root = mkdtempSync(join(tmpdir(), 'nb-ls-'))
  await ensureRepo(root)
  proposal(root, 'montage')
  await rejectSkill(root, 'montage')
  expect(await git(root, 'ls-files', '.rejected')).toContain('.rejected')
  proposal(root, 'montage')
  await expect(approveSkill(root, 'montage')).rejects.toThrow('rejected before')
})
test('sync with no skills at all, and after the last learned skill is removed, returns false', async () => {
  const root = mkdtempSync(join(tmpdir(), 'nb-ls-'))
  await ensureRepo(root)
  const book = await newBookRepo()
  expect(await syncSkills(root, book)).toBe(false)
  proposal(root, 'chase')
  await approveSkill(root, 'chase')
  expect(await syncSkills(root, book)).toBe(true)
  rmSync(join(root, 'skills', 'chase'), { recursive: true })
  expect(await syncSkills(root, book)).toBe(true)
  expect(await git(book, 'ls-files', '.claude')).toBe('')
  expect(await syncSkills(root, book)).toBe(false)
})
test('a book that is not its own git repo is left untouched', async () => {
  const root = mkdtempSync(join(tmpdir(), 'nb-ls-'))
  await ensureRepo(root)
  proposal(root, 'chase')
  await approveSkill(root, 'chase')
  const book = mkdtempSync(join(tmpdir(), 'nb-ls-norepo-'))
  writeFileSync(join(book, 'book.yaml'), 'id: b\nstatus: active\n')
  expect(await syncSkills(root, book)).toBe(false)
  expect(existsSync(join(book, '.claude'))).toBe(false)
  const parent = await newBookRepo()
  const inner = join(parent, 'inner')
  mkdirSync(inner)
  writeFileSync(join(inner, 'book.yaml'), 'id: b\nstatus: active\n')
  expect(await syncSkills(root, inner)).toBe(false)
  expect(existsSync(join(inner, '.claude'))).toBe(false)
})

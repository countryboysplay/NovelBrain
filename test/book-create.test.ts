import { test, expect } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { newBook, slugify } from '../src/main/book/create'
import { git } from '../src/main/book/git'
import { validateBook } from '../src/main/book/validate'

const kit = resolve('kit/fiction')
const hooks = resolve('resources/hooks')
const accept = resolve('resources/accept/accept.mjs')
const opts = { title: 'The Long Green', audience: 'adult' as const, genres: ['literary' as const], wordTarget: 80000 }

test('slugify', () => {
  expect(slugify('The Long Green!')).toBe('the-long-green')
  expect(slugify("  Ruth's  Field -- 2 ")).toBe('ruth-s-field-2')
})

test('creates a valid, committed book with the kit skills and hook settings', async () => {
  const parent = mkdtempSync(join(tmpdir(), 'nb new '))
  const dir = await newBook(parent, opts, kit, hooks, accept)
  expect(dir).toBe(join(parent, 'the-long-green'))
  for (const d of ['bible/characters', 'bible/places', 'bible/world', 'outline/scenes', 'canon', 'manuscript', 'drafts', 'proposals', 'reviews', 'notes', 'art'])
    expect(existsSync(join(dir, d)), d).toBe(true)
  expect(validateBook(dir)).toEqual([])
  expect(readdirSync(join(dir, '.claude', 'skills'))).toContain('audience-adult')
  expect(existsSync(join(dir, '.claude', 'settings.local.json'))).toBe(true)
  expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toMatch(/settings\.local\.json/)
  expect(await git(dir, 'status', '--porcelain')).toBe('')
  expect(await git(dir, 'log', '--format=%s')).toMatch(/Create The Long Green/)
})

test('book.yaml records the options', async () => {
  const dir = await newBook(mkdtempSync(join(tmpdir(), 'nb-new-')), opts, kit, hooks, accept)
  const y = readFileSync(join(dir, 'book.yaml'), 'utf8')
  expect(y).toMatch(/title: The Long Green/)
  expect(y).toMatch(/status: active/)
  expect(y).toMatch(/audience: adult/)
})

test('refuses an existing folder', async () => {
  const parent = mkdtempSync(join(tmpdir(), 'nb-new-'))
  await newBook(parent, opts, kit, hooks, accept)
  await expect(newBook(parent, opts, kit, hooks, accept)).rejects.toThrow(/already exists/)
})

test('refuses invalid options', async () => {
  const parent = mkdtempSync(join(tmpdir(), 'nb-new-'))
  await expect(newBook(parent, { ...opts, genres: [] }, kit, hooks, accept)).rejects.toThrow()
  await expect(newBook(parent, { ...opts, title: '!!!' }, kit, hooks, accept)).rejects.toThrow(/title/)
})

test('removes the folder when a later step fails', async () => {
  const parent = mkdtempSync(join(tmpdir(), 'nb-new-'))
  await expect(newBook(parent, opts, join(parent, 'no-kit'), hooks, accept)).rejects.toThrow()
  expect(existsSync(join(parent, 'the-long-green'))).toBe(false)
})

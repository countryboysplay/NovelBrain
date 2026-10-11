import { test, expect } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parse } from 'yaml'
import { decide } from '../src/hooks/guard'
import { newBook } from '../src/main/book/create'
import { git } from '../src/main/book/git'
import { archiveBook, createSequel, setSeries } from '../src/main/book/lifecycle'
import { validateBook } from '../src/main/book/validate'

const kit = resolve('kit/fiction'), hooks = resolve('resources/hooks'), accept = resolve('resources/accept/accept.mjs')
const opts = { title: 'The Long Green', audience: 'adult' as const, genres: ['literary' as const], wordTarget: 80000 }
const mk = () => newBook(mkdtempSync(join(tmpdir(), 'nb-life-')), opts, kit, hooks, accept)
const yml = (d: string) => parse(readFileSync(join(d, 'book.yaml'), 'utf8'))

test('archive sets status, keeps keys, commits, and the guard then blocks writes', async () => {
  const dir = await mk()
  const hash = await archiveBook(dir)
  expect(hash).toMatch(/^[0-9a-f]+$/)
  expect(yml(dir)).toMatchObject({ status: 'archived', title: 'The Long Green', wordTarget: 80000, audience: 'adult' })
  expect(await git(dir, 'log', '-1', '--format=%s')).toBe('Archive The Long Green')
  expect(await git(dir, 'status', '--porcelain')).toBe('')
  const d = decide({ cwd: dir, tool_name: 'Write', tool_input: { file_path: join(dir, 'drafts', 'SC-001.md') } })
  expect(d.allow).toBe(false)
})

test('archive refuses while a run is running', async () => {
  const dir = await mk()
  mkdirSync(join(dir, 'run'), { recursive: true })
  writeFileSync(join(dir, 'run', 'state.yaml'), 'status: running\n')
  await expect(archiveBook(dir)).rejects.toThrow(/run/i)
  expect(yml(dir).status).toBe('active')
})

test('sequel refuses an active predecessor', async () => {
  const dir = await mk()
  await expect(createSequel(dir, { ...opts, title: 'Greener' }, kit, hooks, accept)).rejects.toThrow(/archive/i)
})

test('sequel copies the bible only, links predecessor and series, validates, commits', async () => {
  const dir = await mk()
  writeFileSync(join(dir, 'bible', 'characters', 'ruth.md'), 'Ruth, a farmer.\n')
  writeFileSync(join(dir, 'drafts', 'SC-001.md'), 'old draft\n')
  writeFileSync(join(dir, 'notes', 'idea.md'), 'old note\n')
  await archiveBook(dir)
  const seq = await createSequel(dir, { ...opts, title: 'Greener Still' }, kit, hooks, accept)
  expect(seq).toBe(join(resolve(dir, '..'), 'greener-still'))
  expect(yml(seq)).toMatchObject({ status: 'active', predecessor: 'the-long-green', series: 'the-long-green' })
  expect(readFileSync(join(seq, 'bible', 'characters', 'ruth.md'), 'utf8')).toMatch(/Ruth/)
  expect(existsSync(join(seq, 'drafts', 'SC-001.md'))).toBe(false)
  expect(readdirSync(join(seq, 'notes')).sort()).toEqual(['.gitkeep', 'predecessor.md'])
  expect(readFileSync(join(seq, 'notes', 'predecessor.md'), 'utf8')).toMatch(/\.\.\/the-long-green\/.*read-only/s)
  expect(validateBook(seq)).toEqual([])
  expect(await git(seq, 'status', '--porcelain')).toBe('')
  expect(await git(seq, 'log', '-1', '--format=%s')).toBe('Start sequel to The Long Green')
  // a third book keeps the series
  await archiveBook(seq)
  const third = await createSequel(seq, { ...opts, title: 'Greenest' }, kit, hooks, accept)
  expect(yml(third)).toMatchObject({ predecessor: 'greener-still', series: 'the-long-green' })
})

test('setSeries writes book.yaml, keeps keys and commits; empty clears it', async () => {
  const dir = await mk()
  await setSeries(dir, 'wild-hearts')
  expect(yml(dir)).toMatchObject({ series: 'wild-hearts', title: 'The Long Green', status: 'active' })
  expect(await git(dir, 'log', '-1', '--format=%s')).toBe('Set series: wild-hearts')
  await setSeries(dir, null)
  expect(yml(dir).series).toBeNull()
  expect(await git(dir, 'log', '-1', '--format=%s')).toBe('Clear series')
  expect(await git(dir, 'status', '--porcelain')).toBe('')
})

test('setSeries refuses a bad name, a running book and an archived book', async () => {
  const dir = await mk()
  await expect(setSeries(dir, 'Wild Hearts!')).rejects.toThrow(/lowercase words joined by hyphens/)
  for (const bad of ['..', 'a/b', 'a\b']) await expect(setSeries(dir, bad)).rejects.toThrow(/hyphens/)
  mkdirSync(join(dir, 'run'), { recursive: true })
  writeFileSync(join(dir, 'run', 'state.yaml'), 'status: running\n')
  await expect(setSeries(dir, 'wild')).rejects.toThrow(/run/i)
  writeFileSync(join(dir, 'run', 'state.yaml'), 'status: idle\n')
  await archiveBook(dir)
  await expect(setSeries(dir, 'wild')).rejects.toThrow(/archived/)
  expect(yml(dir).series).toBeNull()
})

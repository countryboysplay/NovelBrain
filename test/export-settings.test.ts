import { test, expect } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parse } from 'yaml'
import { newBook } from '../src/main/book/create'
import { git } from '../src/main/book/git'
import { archiveBook, setExportSettings } from '../src/main/book/lifecycle'
import { copyrightLine, readExport } from '../src/shared/export'
import { readStudio } from '../src/main/book/studio'

const make = () => newBook(mkdtempSync(join(tmpdir(), 'nb pub ')), { title: 'Pub Book', audience: 'adult', genres: ['literary'], wordTarget: 60000 }, resolve('kit/fiction'), resolve('resources/hooks'), resolve('resources/accept/accept.mjs'))

test('a missing export block means every default', () => {
  expect(readExport(undefined)).toEqual({ error: null, settings: {
    trim: '5.5x8.5', paper: 'cream', font: 'eb-garamond', fontSize: 11, chapterStart: 'next-page', author: '', copyright: '', isbn: '',
    dedication: '', epigraph: '', acknowledgements: '', aboutAuthor: '', alsoBy: [] } })
})

test('a malformed block reports its problem and falls back to defaults', () => {
  const r = readExport({ trim: '8x10', fontSize: 30 })
  expect(r.error).toMatch(/trim/)
  expect(r.settings.trim).toBe('5.5x8.5')
})

test('the copyright line defaults from the year and the author', () => {
  const s = readExport({ author: 'Ruth Writer' }).settings
  expect(copyrightLine(s, 2026)).toBe('© 2026 Ruth Writer. All rights reserved.')
  expect(copyrightLine({ ...s, copyright: 'Text © 2026 R. W.' }, 2026)).toBe('Text © 2026 R. W.')
})

test('setExportSettings writes book.yaml and makes one Publish settings commit', async () => {
  const dir = await make()
  await setExportSettings(dir, { trim: '6x9', author: 'Ruth Writer', alsoBy: ['The Long Green'] })
  const y = parse(readFileSync(join(dir, 'book.yaml'), 'utf8'))
  expect(y.export).toMatchObject({ trim: '6x9', author: 'Ruth Writer', alsoBy: ['The Long Green'], paper: 'cream' })
  expect(y.title).toBe('Pub Book')
  expect(await git(dir, 'log', '-1', '--format=%s')).toBe('Publish settings')
  expect(await git(dir, 'status', '--porcelain')).toBe('')
  const before = await git(dir, 'rev-parse', 'HEAD')
  await setExportSettings(dir, { trim: '6x9', author: 'Ruth Writer', alsoBy: ['The Long Green'] })
  expect(await git(dir, 'rev-parse', 'HEAD')).toBe(before) // unchanged settings make no commit
})

test('setExportSettings refuses bad input, a running book and an archived book', async () => {
  const dir = await make()
  await expect(setExportSettings(dir, { trim: '8x10' })).rejects.toThrow(/trim/)
  await expect(setExportSettings(dir, 'nonsense')).rejects.toThrow()
  mkdirSync(join(dir, 'run'), { recursive: true }) // newBook does not create run/
  writeFileSync(join(dir, 'run', 'state.yaml'), 'status: running\n')
  await expect(setExportSettings(dir, {})).rejects.toThrow(/run is in progress/)
  writeFileSync(join(dir, 'run', 'state.yaml'), 'status: paused\n')
  await archiveBook(dir)
  await expect(setExportSettings(dir, {})).rejects.toThrow(/archived/)
})

test('a malformed export block never stops the studio reading the book', async () => {
  const dir = await make()
  writeFileSync(join(dir, 'book.yaml'), readFileSync(join(dir, 'book.yaml'), 'utf8') + 'export:\n  trim: 99x99\n')
  expect((await readStudio(dir)).book?.title).toBe('Pub Book')
})

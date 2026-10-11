import { test, expect } from '@playwright/test'
import { existsSync, readFileSync, readdirSync, mkdtempSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, nav, publishBook, studioBook } from './e2e'
import type { KdpExport } from '../src/shared/export'

test.setTimeout(180_000)
const exportNow = (win: import('@playwright/test').Page) =>
  win.evaluate(() => (window as unknown as { api: { publishExport(): Promise<unknown> } }).api.publishExport()) as Promise<KdpExport>

test('a finished book exports a KDP interior, an EPUB and the cover record', async () => {
  const book = await publishBook()
  const { app, win } = await launch(book)
  await expect(win.getByRole('heading', { name: 'Publish Book' })).toBeVisible({ timeout: 30_000 })
  const r = await exportNow(win)
  expect(r.ok, JSON.stringify(r.checks)).toBe(true)
  const pages = r.pages!
  expect(pages.length % 2).toBe(0)
  expect(pages.length).toBeGreaterThanOrEqual(24)
  // Front matter and chapter openers carry no head or folio; numbering starts at chapter one, odd folios on rectos.
  const firstNumbered = pages.findIndex(p => p.folio !== '')
  expect(pages[firstNumbered].folio).toBe('2')
  expect(pages[firstNumbered - 1].right).toBe(true)
  expect(pages.slice(0, firstNumbered).every(p => p.head === '' && p.folio === '')).toBe(true)
  for (const p of pages.filter(p => p.folio)) {
    expect(Number(p.folio) % 2 === 1).toBe(p.right)
    expect(p.head).toBe(p.right ? 'Publish Book' : 'Ruth Writer')
  }
  expect(pages.filter(p => p.blank).every(p => !p.head && !p.folio)).toBe(true)
  expect(pages[1].blank).toBe(true) // the half title's blank back

  const pdf = readFileSync(join(book, 'exports', 'publish-book-kdp-interior.pdf')).toString('latin1')
  expect(pdf.startsWith('%PDF-')).toBe(true)
  expect(pdf).toMatch(/\/MediaBox\s*\[\s*0\s+0\s+396\s+612\s*\]/) // 5.5 x 8.5 in, no bleed
  expect(Math.max(...[...pdf.matchAll(/\/Count (\d+)/g)].map(m => Number(m[1])))).toBe(pages.length)
  expect(pdf).toMatch(/\/FontFile[23]?\b/)
  expect(pdf).toMatch(/EBGaramond/)
  const rec = JSON.parse(readFileSync(join(book, 'exports', 'publish-book-kdp.json'), 'utf8'))
  expect(rec).toMatchObject({ pages: pages.length, trim: '5.5x8.5', paper: 'cream', spineWidth: Math.round(pages.length * 0.0025 * 10000) / 10000 })
  const epub = readFileSync(join(book, 'exports', 'publish-book-kdp.epub')).toString('latin1')
  expect(epub.startsWith('PK')).toBe(true)
  for (const n of ['OEBPS/nav.xhtml', 'OEBPS/toc.xhtml', 'OEBPS/ch3.xhtml']) expect(epub).toContain(n)
  expect(readdirSync(join(book, 'exports')).filter(f => f.endsWith('.html'))).toEqual([]) // the temp page is gone
  await app.close()
})

test('preflight blocks an unfinished book and writes nothing', async () => {
  const book = await studioBook()
  const { app, win } = await launch(book)
  await expect(win.getByRole('heading', { name: 'Studio Book' })).toBeVisible({ timeout: 30_000 })
  const r = await exportNow(win)
  expect(r.ok).toBe(false)
  expect(r.checks.find(c => c.id === 'scenes')).toMatchObject({ ok: false, link: { view: 'outline', scene: 'SC-002' } })
  expect(existsSync(join(book, 'exports', 'studio-book-kdp-interior.pdf'))).toBe(false)
  await app.close()
})

test('a book under 24 pages fails the layout check and writes nothing; a linked exports folder is refused', async () => {
  const book = await publishBook({ words: 1200, title: 'Short Book' })
  const { app, win } = await launch(book)
  await expect(win.getByRole('heading', { name: 'Short Book' })).toBeVisible({ timeout: 30_000 })
  const r = await exportNow(win)
  expect(r.ok).toBe(false)
  expect(r.checks.find(c => c.id === 'pages')?.ok).toBe(false)
  expect(existsSync(join(book, 'exports', 'short-book-kdp-interior.pdf'))).toBe(false)
  rmSync(join(book, 'exports'), { recursive: true, force: true })
  symlinkSync(mkdtempSync(join(tmpdir(), 'nb elsewhere ')), join(book, 'exports'), 'junction')
  const linked = await exportNow(win)
  expect(linked).toMatchObject({ ok: false, error: expect.stringMatching(/link/) })
  await app.close()
})

test('the Publish view saves settings, shows preflight and exports', async () => {
  const book = await publishBook({ title: 'View Book' })
  const { app, win } = await launch(book)
  await nav(win, 'Publish')
  await expect(win.getByRole('heading', { name: 'Publish', level: 2 })).toBeVisible()
  const pre = win.getByRole('region', { name: 'Preflight' })
  await expect(pre).toContainText('All 6 scenes are accepted.')
  await win.getByLabel('Trim size').selectOption('6x9')
  await win.getByLabel('Also by (one title per line)').fill('The Long Green')
  await win.getByRole('button', { name: 'Save publish settings' }).click()
  await expect(win.getByRole('status', { name: 'Publish result' })).toContainText('Saved.')
  await win.getByRole('button', { name: 'Export for KDP' }).click()
  await expect(win.getByRole('status', { name: 'Publish result' })).toContainText('Exported', { timeout: 120_000 })
  await expect(win.getByRole('region', { name: 'Last export' })).toContainText('6 x 9 in')
  await expect(win.getByRole('region', { name: 'Last export' })).toContainText('The cover arrives in a later version')
  await app.close()
})

test('the Publish view blocks Export on a failing check and links it to its scene', async () => {
  const book = await studioBook()
  const { app, win } = await launch(book)
  await nav(win, 'Publish')
  await expect(win.getByRole('region', { name: 'Preflight' })).toContainText('not accepted yet')
  await expect(win.getByRole('button', { name: 'Export for KDP' })).toBeDisabled()
  await win.getByRole('button', { name: 'Open SC-002 in Outline' }).click()
  await expect(win.getByRole('heading', { name: 'Outline', level: 2 })).toBeVisible()
  await app.close()
})

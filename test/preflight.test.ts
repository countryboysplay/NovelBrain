import { test, expect } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { layoutChecks, publishState, readKdpRecord, staticChecks } from '../src/main/export/preflight'
import { readExport, type PageFact } from '../src/shared/export'
import { margins } from '../src/main/export/kdp'
import { newBook } from '../src/main/book/create'
import { archiveBook } from '../src/main/book/lifecycle'
import type { ManuscriptScene } from '../src/shared/studio'

const ms = (id: string, text: string): ManuscriptScene => ({ id, title: id, act: 'ACT-1', chapter: 'CH-01', chapterTitle: 'One', text })
const s = (o: object = {}) => readExport({ author: 'R', ...o }).settings
const byId = (cs: { id: string; ok: boolean }[]) => Object.fromEntries(cs.map(c => [c.id, c.ok]))

test('static checks: scenes accepted, no markers, author set, ISBN valid when set', () => {
  expect(byId(staticChecks({ sceneIds: ['SC-001'], accepted: [ms('SC-001', 'Clean prose.')], s: s() }))).toEqual({ scenes: true, markers: true, author: true, isbn: true })
  const bad = staticChecks({ sceneIds: ['SC-001', 'SC-002', 'SC-003'], accepted: [ms('SC-001', 'x')], s: s({ author: ' ', isbn: '9780306406158' }) })
  expect(byId(bad)).toEqual({ scenes: false, markers: true, author: false, isbn: false })
  expect(bad.find(c => c.id === 'scenes')).toMatchObject({ message: '2 of 3 scenes are not accepted yet: SC-002, SC-003.', link: { view: 'outline', scene: 'SC-002' } })
})

test('every marker kind is caught, and ordinary words are not', () => {
  for (const t of ['A TODO here.', 'He said TK.', 'See [[link]].', 'x <!-- note --> y', 'Fix CN-CHK-10.', 'As in SC-004.']) {
    const c = staticChecks({ sceneIds: ['SC-001'], accepted: [ms('SC-001', t)], s: s() }).find(x => x.id === 'markers')!
    expect(c, t).toMatchObject({ ok: false, link: { view: 'manuscript', scene: 'SC-001' } })
  }
  for (const t of ['Todos los días.', 'TKO in the ring.', 'Her score was 98.']) expect(byId(staticChecks({ sceneIds: ['SC-001'], accepted: [ms('SC-001', t)], s: s() })).markers, t).toBe(true)
})

const pg = (n: number, blank: (i: number) => boolean = () => false): PageFact[] => Array.from({ length: n }, (_, i) => ({ right: i % 2 === 0, blank: blank(i), head: '', folio: '' }))

test('layout checks: page range, margins, blank runs and settling', () => {
  const ok = layoutChecks({ pages: pg(40), paper: 'cream', m: margins('5.5x8.5', 40), settled: true })
  expect(ok.every(c => c.ok)).toBe(true)
  expect(byId(layoutChecks({ pages: pg(22), paper: 'cream', m: margins('5.5x8.5', 22), settled: true })).pages).toBe(false)
  expect(byId(layoutChecks({ pages: pg(778), paper: 'cream', m: margins('5.5x8.5', 778), settled: true })).pages).toBe(false)
  expect(byId(layoutChecks({ pages: pg(778), paper: 'white', m: margins('5.5x8.5', 778), settled: true })).pages).toBe(true)
  expect(byId(layoutChecks({ pages: pg(400), paper: 'cream', m: { ...margins('5x8', 100), gutter: 0.5 }, settled: true })).margins).toBe(false)
  expect(byId(layoutChecks({ pages: pg(40, i => i >= 10 && i < 13), paper: 'cream', m: margins('6x9', 40), settled: true })).blanks).toBe(true)
  expect(byId(layoutChecks({ pages: pg(40, i => i >= 10 && i < 14), paper: 'cream', m: margins('6x9', 40), settled: true })).blanks).toBe(false)
  expect(byId(layoutChecks({ pages: pg(40, i => i >= 31), paper: 'cream', m: margins('6x9', 40), settled: true })).blanks).toBe(true)
  expect(byId(layoutChecks({ pages: pg(40, i => i >= 30), paper: 'cream', m: margins('6x9', 40), settled: true })).blanks).toBe(false)
  expect(byId(layoutChecks({ pages: pg(40), paper: 'cream', m: margins('6x9', 40), settled: false })).settled).toBe(false)
})

const make = () => newBook(mkdtempSync(join(tmpdir(), 'nb pf ')), { title: 'PF Book', audience: 'adult', genres: ['literary'], wordTarget: 60000 }, resolve('kit/fiction'), resolve('resources/hooks'), resolve('resources/accept/accept.mjs'))

test('publishState: editable in an active idle book, read-only while running and when archived', async () => {
  const dir = await make()
  expect(publishState(dir)).toMatchObject({ editable: true, why: null, error: null, last: null })
  mkdirSync(join(dir, 'run'), { recursive: true })
  writeFileSync(join(dir, 'run', 'state.yaml'), 'status: running\n')
  expect(publishState(dir)).toMatchObject({ editable: false, why: expect.stringMatching(/run is going/) })
  writeFileSync(join(dir, 'run', 'state.yaml'), 'status: paused\n')
  await archiveBook(dir)
  expect(publishState(dir)).toMatchObject({ editable: false, why: expect.stringMatching(/archived/) })
})

test('publishState shows a malformed export block, and readKdpRecord ignores a bad record', async () => {
  const dir = await make()
  writeFileSync(join(dir, 'book.yaml'), readFileSync(join(dir, 'book.yaml'), 'utf8') + 'export:\n  trim: 99x99\n')
  expect(publishState(dir).error).toMatch(/trim/)
  mkdirSync(join(dir, 'exports'), { recursive: true })
  writeFileSync(join(dir, 'exports', 'pf-book-kdp.json'), '{"pages":"many"}')
  expect(readKdpRecord(dir, 'pf-book')).toBeNull()
  const rec = { pages: 40, trim: '6x9', paper: 'cream', gutter: 0.875, spineWidth: 0.1, exportedAt: '2026-10-11T12:00:00.000Z' }
  writeFileSync(join(dir, 'exports', 'pf-book-kdp.json'), JSON.stringify(rec))
  expect(readKdpRecord(dir, 'pf-book')).toEqual(rec)
})

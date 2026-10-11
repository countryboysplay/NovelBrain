import { test, expect } from 'vitest'
import { lstatSync, mkdtempSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inflateRawSync, crc32 } from 'node:zlib'
import { backMatter, kdpEpub, printHtml } from '../src/main/export/book'
import { exportTarget, type Chapter } from '../src/main/book/export'
import { readExport } from '../src/shared/export'
import { margins } from '../src/main/export/kdp'

function unzip(buf: Buffer) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  const count = buf.readUInt16LE(end + 10)
  let at = buf.readUInt32LE(end + 16)
  const out: { name: string; method: number; data: Buffer }[] = []
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(at + 10), crc = buf.readUInt32LE(at + 16), size = buf.readUInt32LE(at + 20)
    const n = buf.readUInt16LE(at + 28), off = buf.readUInt32LE(at + 42)
    const name = buf.subarray(at + 46, at + 46 + n).toString()
    const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28)
    const raw = buf.subarray(start, start + size)
    const data = method === 0 ? Buffer.from(raw) : inflateRawSync(raw)
    expect(crc32(data), name).toBe(crc)
    out.push({ name, method, data })
    at += 46 + n
  }
  return out
}

const ch = (id: string, title: string, ...texts: string[]): Chapter => ({ id, title, scenes: texts.map((text, i) => ({ id: `SC-00${i + 1}`, title: 's', act: 'ACT-1', chapter: id, chapterTitle: title, text })) })
const base = { title: 'Pub <Book> & "Co"', chapters: [ch('CH-01', 'One', 'First scene.', 'Second scene.'), ch('CH-02', '', 'Third.')], year: 2026, m: margins('5.5x8.5', 100), pad: false, assets: 'file:///C:/app/resources/export/' }
const html = (s: object, extra: object = {}) => printHtml({ ...base, s: readExport(s).settings, ...extra })
const order = (h: string) => [...h.matchAll(/<section class="([^"]+)"/g)].map(m => m[1])

test('page order: front matter, chapters, back matter; empty fields leave their pages out', () => {
  expect(order(html({ author: 'A' }))).toEqual(['front half-title', 'front title-page', 'front copyright', 'chapter first', 'chapter'])
  expect(order(html({ author: 'A', dedication: 'For R.', epigraph: 'Corn.', acknowledgements: 'Thanks.', aboutAuthor: 'Lives.', alsoBy: ['X'] }, { pad: true })))
    .toEqual(['front half-title', 'front title-page', 'front copyright', 'front dedication', 'front epigraph', 'chapter first', 'chapter', 'back first', 'back', 'back', 'pad'])
})

test('chapter starts: chapter one and the first back page are recto; the rest follow the setting', () => {
  expect(html({})).toMatch(/\.chapter\{break-before:page\}/)
  expect(html({ chapterStart: 'recto' })).toMatch(/\.chapter\{break-before:right\}/)
  expect(html({})).toMatch(/\.chapter\.first,\.back\.first\{break-before:right\}/)
})

test('scene breaks, an untitled chapter, the copyright line and the ISBN', () => {
  const h = html({ author: 'Ruth Writer', isbn: '978-0-306-40615-7' })
  expect(h).toContain('<p class="lead">First scene.</p>\n<p class="break">* * *</p>\n<p>Second scene.</p>')
  expect(h).toContain('<h2 class="opener">CH-02</h2>')
  expect(h).toContain('© 2026 Ruth Writer. All rights reserved.')
  expect(h).toContain('ISBN 978-0-306-40615-7')
})

test('every writer field is escaped', () => {
  const evil = '<script>x</script> & "q"'
  const h = html({ author: evil, dedication: evil, epigraph: evil, acknowledgements: evil, aboutAuthor: evil, alsoBy: [evil], copyright: evil, isbn: evil })
  expect(h).not.toContain('<script>x')
  expect(h).toContain('&lt;script&gt;x&lt;/script&gt; &amp; &quot;q&quot;')
  expect(h).toContain('<title>Pub &lt;Book&gt; &amp; &quot;Co&quot;</title>')
})

test('page size, mirrored margins, the chosen font and the bundled Paged.js', () => {
  const h = html({ trim: '6x9', font: 'crimson-pro', fontSize: 11.5 })
  expect(h).toContain('size:6in 9in')
  expect(h).toContain(`@page:left{margin-left:${base.m.outside}in;margin-right:${base.m.gutter}in}`)
  expect(h).toContain(`@page:right{margin-left:${base.m.gutter}in;margin-right:${base.m.outside}in}`)
  expect(h).toContain('url("file:///C:/app/resources/export/crimson-pro-latin-400-italic.woff2")')
  expect(h).toContain('font-size:11.5pt')
  expect(h).toContain('<script src="file:///C:/app/resources/export/paged.js"></script>')
})

test('back matter titles', () => {
  expect(backMatter(readExport({ author: 'R', acknowledgements: 'T', aboutAuthor: 'L', alsoBy: ['X', 'Y'] }).settings).map(b => b.title))
    .toEqual(['Acknowledgements', 'About the author', 'Also by R'])
  expect(backMatter(readExport({ alsoBy: ['X'] }).settings).map(b => b.title)).toEqual(['Also by the author'])
})

test('exportTarget refuses a linked exports folder or file', () => {
  const book = mkdtempSync(join(tmpdir(), 'nb tgt '))
  expect(exportTarget(book, 'a.pdf')).toBe(join(book, 'exports', 'a.pdf'))
  const elsewhere = mkdtempSync(join(tmpdir(), 'nb else '))
  symlinkSync(elsewhere, join(book, 'exports', 'linked.pdf'), 'junction')
  expect(() => exportTarget(book, 'linked.pdf')).toThrow(/link/)
  const other = mkdtempSync(join(tmpdir(), 'nb tgt2 '))
  symlinkSync(elsewhere, join(other, 'exports'), 'junction')
  expect(() => exportTarget(other, 'a.pdf')).toThrow(/link/)
  expect(lstatSync(join(other, 'exports')).isSymbolicLink()).toBe(true)
})

const epub = (s: object) => unzip(kdpEpub({ id: 'pub-book', title: base.title, s: readExport(s).settings, chapters: base.chapters, now: new Date('2026-10-11T12:00:00Z') }))
const file = (files: ReturnType<typeof unzip>, name: string) => files.find(f => f.name === name)!.data.toString('utf8')

test('the EPUB: mimetype first and stored, title page, copyright, matter, an HTML table of contents and the nav', () => {
  const files = epub({ author: 'Ruth Writer', dedication: 'For R.', acknowledgements: 'Thanks.', isbn: '9780306406157' })
  expect(files[0]).toMatchObject({ name: 'mimetype', method: 0 })
  const opf = file(files, 'OEBPS/content.opf')
  expect(opf).toContain('<dc:creator>Ruth Writer</dc:creator>')
  expect(opf).toContain('<dc:identifier id="isbn">urn:isbn:9780306406157</dc:identifier>')
  expect([...opf.matchAll(/<itemref idref="([^"]+)"/g)].map(m => m[1])).toEqual(['title', 'copyright', 'dedication', 'toc', 'c1', 'c2', 'b1'])
  const toc = file(files, 'OEBPS/toc.xhtml')
  expect(toc).toContain('<a href="ch1.xhtml">One</a>')
  expect(toc).toContain('<a href="ch2.xhtml">CH-02</a>')
  expect(toc).toContain('<a href="back1.xhtml">Acknowledgements</a>')
  expect(file(files, 'OEBPS/nav.xhtml')).toContain('epub:type="toc"')
  expect(file(files, 'OEBPS/ch1.xhtml')).toContain('<p class="break">* * *</p>')
  expect(file(files, 'OEBPS/copyright.xhtml')).toContain('© 2026 Ruth Writer. All rights reserved.')
  expect(files.some(f => /half|blank|\.woff2/.test(f.name))).toBe(false)
})

test('EPUB pages are well-formed XHTML even with hostile writer text', () => {
  const evil = '<b>&</p> "q" \u0007 😀'
  for (const f of epub({ author: evil, dedication: evil, epigraph: evil, aboutAuthor: evil, alsoBy: [evil] }).filter(f => f.name.endsWith('.xhtml'))) {
    const t = f.data.toString('utf8')
    expect(t, f.name).not.toContain('<b>&')
    expect(t, f.name).not.toContain('\u0007')
  }
})

test('each chapter opening paragraph carries the lead class, and no ::first-line rule uses a selector Paged.js rewrites', () => {
  const h = html({ author: 'A' })
  expect(h.match(/<p class="lead">/g)).toHaveLength(2)
  expect(h).toContain('<h2 class="opener">One</h2>\n<p class="lead">First scene.</p>')
  for (const rule of h.match(/[^{}]*::first-line/g) ?? []) expect(rule).not.toMatch(/\+|:first-of-type|:nth-/)
})

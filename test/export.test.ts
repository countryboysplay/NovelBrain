import { test, expect } from 'vitest'
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32, inflateRawSync } from 'node:zlib'
import { bookHtml, chaptersOf, epubFiles, proseHtml, readingCopy, zip } from '../src/main/book/export'
import type { ManuscriptScene } from '../src/shared/studio'

const sc = (id: string, chapter: string, text: string): ManuscriptScene => ({ id, title: id, act: 'ACT-1', chapter, chapterTitle: `Title ${chapter}`, text })

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

test('chaptersOf groups scenes by chapter in order', () => {
  const c = chaptersOf([sc('SC-001', 'CH-01', 'a'), sc('SC-002', 'CH-01', 'b'), sc('SC-003', 'CH-02', 'c')])
  expect(c.map(x => [x.id, x.title, x.scenes.length])).toEqual([['CH-01', 'Title CH-01', 2], ['CH-02', 'Title CH-02', 1]])
})

test('proseHtml escapes markup, keeps italics and bold, and turns * * * into a break', () => {
  const h = proseHtml('She wrote <b>&</p> on it.\n\n* * *\n\nIt was *very* **late**.\nStill.')
  expect(h).toBe('<p>She wrote &lt;b&gt;&amp;&lt;/p&gt; on it.</p>\n<p class="break">* * *</p>\n<p>It was <em>very</em> <strong>late</strong>. Still.</p>')
})

test('bookHtml has a title page with the count, and one section per chapter', () => {
  const h = bookHtml('Wild & Free', chaptersOf([sc('SC-001', 'CH-01', 'One.'), sc('SC-002', 'CH-02', 'Two.')]), 2, 9)
  expect(h).toContain('<h1>Wild &amp; Free</h1>')
  expect(h).toContain('2 of 9 scenes')
  expect(h.match(/<section class="chapter">/g)).toHaveLength(2)
  expect(h.indexOf('Title CH-01')).toBeLessThan(h.indexOf('Title CH-02'))
})

test('the EPUB zip: mimetype first and stored, valid CRCs, every manifest file present', () => {
  const files = epubFiles('wild', 'Wild & Free', chaptersOf([sc('SC-001', 'CH-01', 'One <i>.'), sc('SC-002', 'CH-02', 'Two.')]), new Date('2026-10-11T12:00:00.123Z'))
  const z = unzip(zip(files))
  expect(z[0]).toMatchObject({ name: 'mimetype', method: 0 })
  expect(z[0].data.toString()).toBe('application/epub+zip')
  const names = z.map(f => f.name)
  for (const n of ['META-INF/container.xml', 'OEBPS/content.opf', 'OEBPS/nav.xhtml', 'OEBPS/ch1.xhtml', 'OEBPS/ch2.xhtml']) expect(names).toContain(n)
  const opf = z.find(f => f.name === 'OEBPS/content.opf')!.data.toString()
  expect(opf).toContain('<dc:title>Wild &amp; Free</dc:title>')
  expect(opf).toContain('<meta property="dcterms:modified">2026-10-11T12:00:00Z</meta>')
  expect(z.find(f => f.name === 'OEBPS/ch1.xhtml')!.data.toString()).toContain('One &lt;i&gt;.')
})

test('readingCopy refuses a book with no accepted scene, and counts the outline mid-book', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'nb-export-')), 'book')
  cpSync(join(__dirname, 'fixtures', 'book-ok'), dir, { recursive: true })
  mkdirSync(join(dir, 'manuscript'), { recursive: true })
  expect(() => readingCopy(dir)).toThrow(/No scene is accepted yet/)
  writeFileSync(join(dir, 'manuscript', 'SC-001.md'), 'Ruth walked the dead row at dawn.\n')
  const r = readingCopy(dir)
  expect(r.html).toContain('Ruth walked the dead row at dawn.')
  expect(r.html).toMatch(/1 of \d+ scenes|all 1 scene</)
  expect(r.epub.subarray(30, 38).toString()).toBe('mimetype')
})

test('control characters are dropped, an untitled chapter shows its id, a finished book says all its scenes', () => {
  expect(proseHtml('A\u0000b\u000bc\tok')).toBe('<p>Abc\tok</p>')
  const untitled = { ...sc('SC-001', 'CH-01', 'One.'), chapterTitle: '  ' }
  expect(bookHtml('B', chaptersOf([untitled]), 1, 1)).toContain('<h2>CH-01</h2>')
  expect(bookHtml('B', chaptersOf([untitled]), 1, 1)).toContain('Reading copy: all 1 scene<')
  const nav = epubFiles('b', 'B', chaptersOf([untitled]), new Date(0)).find(f => f.name === 'OEBPS/nav.xhtml')!.data.toString()
  expect(nav).toContain('>CH-01</a>')
})

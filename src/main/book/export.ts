import { lstatSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { crc32, deflateRawSync } from 'node:zlib'
import { Book, parseYamlText } from '../../shared/schemas'
import type { ManuscriptScene } from '../../shared/studio'
import { readManuscript, sceneCount } from './studio'

// A reading copy of the accepted scenes: one HTML for the PDF, the same chapters as an EPUB 3.
// KDP export (trim, gutter, front matter, preflight) builds on this in Plan 7.
export interface Chapter { id: string; title: string; scenes: ManuscriptScene[] }

export function chaptersOf(scenes: ManuscriptScene[]): Chapter[] {
  const out: Chapter[] = []
  for (const s of scenes) {
    const last = out[out.length - 1]
    if (last?.id === s.chapter) last.scenes.push(s)
    else out.push({ id: s.chapter, title: s.chapterTitle, scenes: [s] })
  }
  return out
}

// Control characters other than tab and newlines are illegal in XML; the EPUB must stay valid XHTML.
export const esc = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
export const BREAK = '<p class="break">* * *</p>'
const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>')

// Paragraphs, *italic*, **bold**; a paragraph of only * or - (three or more) is a scene break. Output is valid XHTML.
export function proseHtml(md: string): string {
  return md.replace(/\r/g, '').split(/\n\s*\n/).map(b => b.trim()).filter(Boolean)
    .map(b => (/^([*-]\s*){3,}$/.test(b) ? BREAK : `<p>${inline(b.replace(/\s*\n\s*/g, ' '))}</p>`)).join('\n')
}

export const chapterTitle = (c: Chapter) => c.title.trim() || c.id
const chapterBody = (c: Chapter) => `<h2>${esc(chapterTitle(c))}</h2>\n${c.scenes.map(s => proseHtml(s.text)).join(`\n${BREAK}\n`)}`

const CSS = `body{font-family:Garamond,Georgia,serif;font-size:11.5pt;line-height:1.45;margin:0;color:#000}
p{margin:0;text-indent:1.4em;text-align:justify;hyphens:auto;orphans:2;widows:2}
h2+p,.break+p{text-indent:0}
.break{text-align:center;text-indent:0;margin:0.9em 0}
.title{text-align:center;padding-top:2.5in}
.title p{text-indent:0;text-align:center}
.chapter{break-before:page}
h2{text-align:center;font-weight:normal;font-size:16pt;margin:1.6in 0 0.4in}`

export function bookHtml(title: string, chapters: Chapter[], inBook: number, total: number): string {
  return `<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head><body>
<section class="title"><h1>${esc(title)}</h1><p>Reading copy: ${inBook === total ? `all ${total} ${total === 1 ? 'scene' : 'scenes'}` : `${inBook} of ${total} scenes`}</p></section>
${chapters.map(c => `<section class="chapter">${chapterBody(c)}</section>`).join('\n')}
</body></html>`
}

const xhtml = (title: string, body: string) => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en"><head><title>${esc(title)}</title><style>${CSS}</style></head><body>${body}</body></html>`

export function epubFiles(id: string, title: string, chapters: Chapter[], now: Date) {
  const modified = now.toISOString().replace(/\.\d+Z$/, 'Z')
  const ch = chapters.map((c, i) => ({ href: `ch${i + 1}.xhtml`, c }))
  const b = (s: string) => Buffer.from(s, 'utf8')
  return [
    { name: 'mimetype', data: b('application/epub+zip'), store: true },
    { name: 'META-INF/container.xml', data: b(`<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`) },
    { name: 'OEBPS/content.opf', data: b(`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="uid">urn:novelbrain:${esc(id)}</dc:identifier><dc:title>${esc(title)}</dc:title><dc:language>en</dc:language>
<meta property="dcterms:modified">${modified}</meta></metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${ch.map((x, i) => `<item id="c${i + 1}" href="${x.href}" media-type="application/xhtml+xml"/>`).join('')}</manifest>
<spine>${ch.map((_, i) => `<itemref idref="c${i + 1}"/>`).join('')}</spine></package>`) },
    { name: 'OEBPS/nav.xhtml', data: b(xhtml(title, `<nav epub:type="toc"><h1>${esc(title)}</h1><ol>${ch.map(x => `<li><a href="${x.href}">${esc(chapterTitle(x.c))}</a></li>`).join('')}</ol></nav>`)) },
    ...ch.map(x => ({ name: `OEBPS/${x.href}`, data: b(xhtml(chapterTitle(x.c), chapterBody(x.c))) }))
  ] as { name: string; data: Buffer; store?: boolean }[]
}

// A minimal zip (no zip64, fixed 1980 timestamps): enough for an EPUB of one book.
export function zip(files: { name: string; data: Buffer; store?: boolean }[]): Buffer {
  const parts: Buffer[] = [], central: Buffer[] = []
  let offset = 0
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8'), body = f.store ? f.data : deflateRawSync(f.data), crc = crc32(f.data), method = f.store ? 0 : 8
    const h = Buffer.alloc(30)
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(method, 8); h.writeUInt16LE(0x21, 12)
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(body.length, 18); h.writeUInt32LE(f.data.length, 22); h.writeUInt16LE(name.length, 26)
    const c = Buffer.alloc(46)
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(method, 10); c.writeUInt16LE(0x21, 14)
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(body.length, 20); c.writeUInt32LE(f.data.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42)
    parts.push(h, name, body); central.push(c, name)
    offset += 30 + name.length + body.length
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, cd, end])
}

export function readingCopy(dir: string, now = new Date()) {
  const book = Book.parse(parseYamlText(readFileSync(join(dir, 'book.yaml'), 'utf8')))
  const scenes = readManuscript(dir)
  if (!scenes.length) throw new Error('No scene is accepted yet, so there is nothing to export.')
  const chapters = chaptersOf(scenes)
  return { id: book.id, title: book.title, html: bookHtml(book.title, chapters, scenes.length, sceneCount(dir)), epub: zip(epubFiles(book.id, book.title, chapters, now)) }
}

// exports/ is git-ignored. Novel Brain never writes through a link: not the folder, not the file.
export function exportTarget(dir: string, name: string): string {
  const out = join(dir, 'exports')
  mkdirSync(out, { recursive: true })
  if (lstatSync(out).isSymbolicLink()) throw new Error('exports is a link; Novel Brain does not write through links')
  const f = join(out, name)
  if (lstatSync(f, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error(`${f} is a link; Novel Brain does not write through links`)
  return f
}

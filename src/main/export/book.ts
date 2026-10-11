import { BREAK, chapterTitle, esc, proseHtml, zip, type Chapter } from '../book/export'
import { copyrightLine, type ExportSettingsT } from '../../shared/export'
import { TRIMS, type Margins } from './kdp'

// The KDP interior and EPUB share these pages. A blank field leaves its page out.
export function backMatter(s: ExportSettingsT): { title: string; html: string }[] {
  const author = s.author.trim()
  return [
    ...(s.acknowledgements.trim() ? [{ title: 'Acknowledgements', html: proseHtml(s.acknowledgements) }] : []),
    ...(s.aboutAuthor.trim() ? [{ title: 'About the author', html: proseHtml(s.aboutAuthor) }] : []),
    ...(s.alsoBy.length ? [{ title: `Also by ${author || 'the author'}`, html: `<ul class="also">${s.alsoBy.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` }] : [])
  ]
}

export const chapterText = (c: Chapter) => c.scenes.map(x => proseHtml(x.text)).join(`\n${BREAK}\n`)
const sec = (cls: string, inner: string) => `<section class="${cls}">${inner}</section>`

export function printHtml(o: { title: string; s: ExportSettingsT; chapters: Chapter[]; year: number; m: Margins; pad: boolean; assets: string }): string {
  const { s, m } = o, t = TRIMS[s.trim], author = s.author.trim()
  const face = (w: number, style: string) =>
    `@font-face{font-family:Book;src:url("${o.assets}${s.font}-latin-${w}-${style}.woff2") format("woff2");font-weight:${w};font-style:${style}}`
  const css = `${face(400, 'normal')}${face(400, 'italic')}${face(700, 'normal')}
@page{size:${t.w}in ${t.h}in;margin-top:${m.top}in;margin-bottom:${m.bottom}in}
@page:left{margin-left:${m.outside}in;margin-right:${m.gutter}in}
@page:right{margin-left:${m.gutter}in;margin-right:${m.outside}in}
body{font-family:Book,serif;font-size:${s.fontSize}pt;line-height:1.32;color:#000;margin:0}
p{margin:0;text-indent:1.5em;text-align:justify;hyphens:auto;orphans:2;widows:2}
h1,h2{font-weight:normal;text-align:center;break-after:avoid}
.front p,.back p{text-indent:0}
.half-title h1{font-size:${s.fontSize * 1.3}pt;margin-top:2.2in}
.title-page h1{font-size:${s.fontSize * 2.2}pt;margin-top:1.8in}
.title-page .by{text-align:center;font-size:${s.fontSize * 1.3}pt;margin-top:0.4in}
.title-page{break-before:right}
.copyright{break-before:left;padding-top:4in;font-size:${s.fontSize - 2}pt}
.copyright p{text-align:left;margin-bottom:0.6em}
.dedication,.epigraph{break-before:right;padding-top:2in;font-style:italic}
.dedication p,.epigraph p{text-align:center}
.chapter{break-before:${s.chapterStart === 'recto' ? 'right' : 'page'}}
.back{break-before:page}
.chapter.first,.back.first{break-before:right}
.pad{break-before:page}
h2{font-size:${s.fontSize * 1.45}pt;margin:1.4in 0 0.45in}
h2+p,.break+p{text-indent:0}
.lead:not([data-split-from])::first-line{font-variant:small-caps;letter-spacing:.04em}
.break{text-align:center;text-indent:0;margin:.8em 0}
.also{list-style:none;padding:0;text-align:center}
.pagedjs_page{position:relative}
.nb-head,.nb-folio{position:absolute;font-size:${s.fontSize - 2}pt;text-align:center;letter-spacing:.06em}
.nb-head{top:${(m.top * 0.4).toFixed(3)}in;font-variant:small-caps}
.nb-folio{bottom:${(m.bottom * 0.4).toFixed(3)}in}
.pagedjs_left_page .nb-head,.pagedjs_left_page .nb-folio{left:${m.outside}in;right:${m.gutter}in}
.pagedjs_right_page .nb-head,.pagedjs_right_page .nb-folio{left:${m.gutter}in;right:${m.outside}in}`
  const pages = [
    sec('front half-title', `<h1>${esc(o.title)}</h1>`),
    sec('front title-page', `<h1>${esc(o.title)}</h1>${author ? `<p class="by">${esc(author)}</p>` : ''}`),
    sec('front copyright', `<p>${esc(copyrightLine(s, o.year))}</p>${s.isbn.trim() ? `<p>ISBN ${esc(s.isbn.trim())}</p>` : ''}`),
    ...(s.dedication.trim() ? [sec('front dedication', proseHtml(s.dedication))] : []),
    ...(s.epigraph.trim() ? [sec('front epigraph', proseHtml(s.epigraph))] : []),
    // Paged.js rewrites + and :first-of-type selectors and loses their ::first-line, so the opening paragraph carries a class.
    ...o.chapters.map((c, i) => sec(i ? 'chapter' : 'chapter first', `<h2 class="opener">${esc(chapterTitle(c))}</h2>\n${chapterText(c).replace('<p>', '<p class="lead">')}`)),
    ...backMatter(s).map((b, i) => sec(i ? 'back' : 'back first', `<h2 class="opener">${esc(b.title)}</h2>\n${b.html}`)),
    ...(o.pad ? [sec('pad', '<p>&#160;</p>')] : [])
  ]
  return `<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"><title>${esc(o.title)}</title><style>${css}</style><script src="${o.assets}paged.js"></script></head><body>\n${pages.join('\n')}\n</body></html>`
}

const EPUB_CSS = `body{font-family:serif;line-height:1.4;margin:0 0.4em}
p{margin:0;text-indent:1.4em;text-align:justify}
h1,h2{text-align:center;font-weight:normal;page-break-before:always}
h2+p,.break+p,.front p{text-indent:0}
.break{text-align:center;text-indent:0;margin:0.9em 0}
.front p{text-align:center}
.also{list-style:none;padding:0;text-align:center}`
const xhtml = (title: string, body: string) => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en"><head><title>${esc(title)}</title><style>${EPUB_CSS}</style></head><body>${body}</body></html>`

// Kindle EPUB 3: no half title, blanks, heads or folios; an HTML table of contents plus the nav (KPG section 5). The cover comes in Plan 6.
export function kdpEpub(o: { id: string; title: string; s: ExportSettingsT; chapters: Chapter[]; now: Date }): Buffer {
  const { s } = o, author = s.author.trim(), isbn = s.isbn.replace(/[\s-]/g, '')
  const docs: { id: string; href: string; title: string; body: string; toc: boolean }[] = [
    { id: 'title', href: 'title.xhtml', title: o.title, toc: false, body: `<section class="front"><h1>${esc(o.title)}</h1>${author ? `<p>${esc(author)}</p>` : ''}</section>` },
    { id: 'copyright', href: 'copyright.xhtml', title: 'Copyright', toc: false, body: `<section class="front"><p>${esc(copyrightLine(s, o.now.getFullYear()))}</p>${isbn ? `<p>ISBN ${esc(s.isbn.trim())}</p>` : ''}</section>` },
    ...(s.dedication.trim() ? [{ id: 'dedication', href: 'dedication.xhtml', title: 'Dedication', toc: false, body: `<section class="front">${proseHtml(s.dedication)}</section>` }] : []),
    ...(s.epigraph.trim() ? [{ id: 'epigraph', href: 'epigraph.xhtml', title: 'Epigraph', toc: false, body: `<section class="front">${proseHtml(s.epigraph)}</section>` }] : []),
    ...o.chapters.map((c, i) => ({ id: `c${i + 1}`, href: `ch${i + 1}.xhtml`, title: chapterTitle(c), toc: true, body: `<h2>${esc(chapterTitle(c))}</h2>\n${chapterText(c)}` })),
    ...backMatter(s).map((b, i) => ({ id: `b${i + 1}`, href: `back${i + 1}.xhtml`, title: b.title, toc: true, body: `<h2>${esc(b.title)}</h2>\n${b.html}` }))
  ]
  const front = docs.filter(d => !d.toc), body = docs.filter(d => d.toc)
  const links = `<ol>${body.map(d => `<li><a href="${d.href}">${esc(d.title)}</a></li>`).join('')}</ol>`
  const spine = [...front, { id: 'toc' }, ...body]
  const modified = o.now.toISOString().replace(/\.\d+Z$/, 'Z')
  const b = (t: string) => Buffer.from(t, 'utf8')
  return zip([
    { name: 'mimetype', data: b('application/epub+zip'), store: true },
    { name: 'META-INF/container.xml', data: b(`<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`) },
    { name: 'OEBPS/content.opf', data: b(`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="uid">urn:novelbrain:${esc(o.id)}</dc:identifier>${isbn ? `<dc:identifier id="isbn">urn:isbn:${esc(isbn)}</dc:identifier>` : ''}<dc:title>${esc(o.title)}</dc:title>${author ? `<dc:creator>${esc(author)}</dc:creator>` : ''}<dc:language>en</dc:language>
<meta property="dcterms:modified">${modified}</meta></metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="toc" href="toc.xhtml" media-type="application/xhtml+xml"/>${docs.map(d => `<item id="${d.id}" href="${d.href}" media-type="application/xhtml+xml"/>`).join('')}</manifest>
<spine>${spine.map(d => `<itemref idref="${d.id}"/>`).join('')}</spine></package>`) },
    { name: 'OEBPS/nav.xhtml', data: b(xhtml(o.title, `<nav epub:type="toc"><h1>Contents</h1>${links}</nav>`)) },
    { name: 'OEBPS/toc.xhtml', data: b(xhtml('Contents', `<h1>Contents</h1>${links}`)) },
    ...docs.map(d => ({ name: `OEBPS/${d.href}`, data: b(xhtml(d.title, d.body)) }))
  ])
}

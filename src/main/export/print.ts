import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { BrowserWindow, session } from 'electron'
import { Book, parseYamlText } from '../../shared/schemas'
import { readExport, type KdpExport, type PageFact, type Trim } from '../../shared/export'
import { countWords } from '../../shared/studio'
import { chaptersOf, exportTarget } from '../book/export'
import { outlineSceneIds, readManuscript } from '../book/studio'
import { kdpEpub, printHtml } from './book'
import { margins, spineWidth, type Margins } from './kdp'
import { layoutChecks, staticChecks } from './preflight'

// Runs in the print window after Paged.js loads: lay out, then add heads and folios only where they belong
// (never on front matter, blank pages or chapter openers; folio 1 is the first chapter page), and report each page.
const LAYOUT = `(async (a) => {
  await new Paged.Previewer().preview()
  const pages = [...document.querySelectorAll('.pagedjs_page')]
  const first = pages.findIndex(p => p.querySelector('.chapter.first h2.opener'))
  return pages.map((p, i) => {
    const right = p.classList.contains('pagedjs_right_page')
    const blank = !(p.querySelector('.pagedjs_page_content')?.textContent ?? '').trim()
    const shows = !blank && first >= 0 && i >= first && !p.querySelector('h2.opener')
    const head = shows ? (right ? a.title : a.author) : '', folio = shows ? String(i - first + 1) : ''
    for (const [cls, text] of [['nb-head', head], ['nb-folio', folio]]) {
      if (!text) continue
      const d = document.createElement('div'); d.className = cls; d.textContent = text; p.appendChild(d)
    }
    return { right, blank, head, folio }
  })
})`

const PARTITION = 'nb-print' // its own session: nothing but local files loads
let guarded = false

async function layout(o: { file: string; html: (m: Margins, pad: boolean) => string; trim: Trim; guess: number; author: string; title: string }): Promise<{ pdf: Buffer | null; pages: PageFact[]; m: Margins; settled: boolean }> {
  const ses = session.fromPartition(PARTITION)
  if (!guarded) { ses.webRequest.onBeforeRequest((d, cb) => cb({ cancel: !/^(file|data|blob):/.test(d.url) })); guarded = true }
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: PARTITION } }) // never shown, never focused
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', e => e.preventDefault())
  try {
    let m = margins(o.trim, o.guess), pad = false, pages: PageFact[] = []
    // A gutter change can change the page count, and an odd count needs a final blank page; lay out until neither changes.
    for (let pass = 1; pass <= 4; pass++) {
      writeFileSync(o.file, o.html(m, pad))
      await win.loadFile(o.file)
      pages = (await win.webContents.executeJavaScript(`${LAYOUT}(${JSON.stringify({ author: o.author, title: o.title })})`)) as PageFact[]
      const content: number = pages.length - (pad ? 1 : 0), nextPad: boolean = content % 2 === 1
      const next = margins(o.trim, content + (nextPad ? 1 : 0))
      if (next.gutter === m.gutter && nextPad === pad)
        return { pdf: Buffer.from(await win.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true })), pages, m, settled: true }
      m = next; pad = nextPad
    }
    return { pdf: null, pages, m, settled: false }
  } finally {
    win.destroy()
  }
}

export async function exportKdp(dir: string, assetsDir: string, now = new Date()): Promise<KdpExport> {
  const book = Book.parse(parseYamlText(readFileSync(join(dir, 'book.yaml'), 'utf8')))
  const { settings: s, error } = readExport(book.export)
  if (error) return { ok: false, error, checks: [] }
  const scenes = readManuscript(dir)
  const checks = staticChecks({ sceneIds: outlineSceneIds(dir), accepted: scenes, s })
  if (checks.some(c => !c.ok)) return { ok: false, error: 'Preflight found problems, so nothing was exported.', checks }
  const pdfPath = exportTarget(dir, `${book.id}-kdp-interior.pdf`), epubPath = exportTarget(dir, `${book.id}-kdp.epub`)
  const recPath = exportTarget(dir, `${book.id}-kdp.json`), file = exportTarget(dir, '.kdp-interior.html')
  const chapters = chaptersOf(scenes), assets = `${pathToFileURL(assetsDir).href}/`
  const words = scenes.reduce((n, x) => n + countWords(x.text), 0)
  try {
    const lay = await layout({ file, trim: s.trim, guess: Math.max(24, Math.round(words / 300) + 8), author: s.author.trim(), title: book.title,
      html: (m, pad) => printHtml({ title: book.title, s, chapters, year: now.getFullYear(), m, pad, assets }) })
    const all = [...checks, ...layoutChecks({ pages: lay.pages, paper: s.paper, m: lay.m, settled: lay.settled })]
    if (!lay.pdf || all.some(c => !c.ok)) return { ok: false, error: 'Preflight found problems, so nothing was exported.', checks: all, pages: lay.pages }
    const record = { pages: lay.pages.length, trim: s.trim, paper: s.paper, gutter: lay.m.gutter, spineWidth: spineWidth(lay.pages.length, s.paper), exportedAt: now.toISOString() }
    writeFileSync(pdfPath, lay.pdf)
    writeFileSync(epubPath, kdpEpub({ id: book.id, title: book.title, s, chapters, now }))
    writeFileSync(recPath, JSON.stringify(record, null, 2))
    return { ok: true, checks: all, pages: lay.pages, record }
  } finally {
    rmSync(file, { force: true })
  }
}

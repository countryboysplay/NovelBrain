import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { Book, parseYamlText } from '../../shared/schemas'
import { EXPORT_TRIMS, PAPERS, readExport, type Check, type ExportSettingsT, type KdpRecord, type PageFact, type Paper, type PublishState } from '../../shared/export'
import type { ManuscriptScene } from '../../shared/studio'
import { outlineSceneIds, readManuscript, safeFile } from '../book/studio'
import { gutterFloor, isIsbn13, MIN_MARGIN, PAGE_RANGE, type Margins } from './kdp'

const QUOTED = new Set(['TODO', 'TK', '[[', '<!--'])
const MARKERS: [RegExp, string][] = [[/\bTODO\b/, 'TODO'], [/\bTK\b/, 'TK'], [/\[\[/, '[['], [/<!--/, '<!--'], [/\b[A-Z]{2}-CHK-\d+\b/, 'a reviewer rule id'], [/\bSC-\d+\b/, 'a scene id']]

export function staticChecks(o: { sceneIds: string[]; accepted: ManuscriptScene[]; s: ExportSettingsT }): Check[] {
  const done = new Set(o.accepted.map(x => x.id)), missing = o.sceneIds.filter(id => !done.has(id))
  const marked = o.accepted.flatMap(x => { const m = MARKERS.find(([re]) => re.test(x.text)); return m ? [{ id: x.id, what: m[1] }] : [] })
  const isbn = o.s.isbn.trim()
  return [
    missing.length || !o.sceneIds.length
      ? { id: 'scenes', ok: false, message: o.sceneIds.length ? `${missing.length} of ${o.sceneIds.length} scenes are not accepted yet: ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ', …' : ''}.` : 'The outline has no scenes yet.', ...(missing[0] ? { link: { view: 'outline' as const, scene: missing[0] } } : {}) }
      : { id: 'scenes', ok: true, message: `All ${o.sceneIds.length} scenes are accepted.` },
    marked.length
      ? { id: 'markers', ok: false, message: `${marked[0].id} still has ${QUOTED.has(marked[0].what) ? `the marker "${marked[0].what}"` : marked[0].what}${marked.length > 1 ? `, and ${marked.length - 1} more ${marked.length === 2 ? 'scene has' : 'scenes have'} markers` : ''}. Edit it in Manuscript.`, link: { view: 'manuscript', scene: marked[0].id } }
      : { id: 'markers', ok: true, message: 'No draft or reviewer markers are left.' },
    o.s.author.trim() ? { id: 'author', ok: true, message: `Author: ${o.s.author.trim()}.` } : { id: 'author', ok: false, message: 'Add the author name. It prints on the title page and the running heads.' },
    !isbn ? { id: 'isbn', ok: true, message: 'No ISBN (optional; KDP can assign one).' } : isIsbn13(isbn) ? { id: 'isbn', ok: true, message: 'The ISBN is a valid ISBN-13.' } : { id: 'isbn', ok: false, message: 'The ISBN is not a valid ISBN-13. Check the digits, or leave it empty.' }
  ]
}

export function layoutChecks(o: { pages: PageFact[]; paper: Paper; m: Margins; settled: boolean }): Check[] {
  const n = o.pages.length, [lo, hi] = PAGE_RANGE[o.paper], floor = gutterFloor(n)
  const runs: { end: boolean; len: number }[] = []
  o.pages.forEach((p, i) => {
    if (!p.blank) return
    if (i > 0 && o.pages[i - 1].blank) runs[runs.length - 1].len++
    else runs.push({ end: false, len: 1 })
    if (i === n - 1) runs[runs.length - 1].end = true
  })
  const badRun = runs.find(r => (r.end ? r.len >= 10 : r.len >= 4))
  const small = Math.min(o.m.outside, o.m.top, o.m.bottom)
  return [
    n >= lo && n <= hi ? { id: 'pages', ok: true, message: `${n} pages, within KDP's ${lo} to ${hi} for ${o.paper} paper.` }
      : { id: 'pages', ok: false, message: `${n} pages. KDP needs ${lo} to ${hi} pages on ${o.paper} paper.` },
    o.m.gutter >= floor && small >= MIN_MARGIN ? { id: 'margins', ok: true, message: `Gutter ${o.m.gutter}" (KDP needs ${floor}" at ${n} pages); outside, top and bottom at least ${MIN_MARGIN}".` }
      : { id: 'margins', ok: false, message: `The margins are under KDP's minimums: gutter ${o.m.gutter}" of ${floor}", smallest other margin ${small}" of ${MIN_MARGIN}".` },
    badRun ? { id: 'blanks', ok: false, message: `${badRun.len} blank pages in a row${badRun.end ? ' at the end' : ''}. KDP rejects ${badRun.end ? '10 or more at the end' : '4 or more before the end'}.` }
      : { id: 'blanks', ok: true, message: 'No long runs of blank pages.' },
    o.settled ? { id: 'settled', ok: true, message: 'The layout settled.' } : { id: 'settled', ok: false, message: 'The layout did not settle in 4 passes. Try another trim or font size.' }
  ]
}

const KdpRecordSchema = z.object({ pages: z.number().int().positive(), trim: z.enum(EXPORT_TRIMS), paper: z.enum(PAPERS), gutter: z.number(), spineWidth: z.number(), exportedAt: z.string() })
export function readKdpRecord(dir: string, id: string): KdpRecord | null {
  const p = safeFile(dir, `exports/${id}-kdp.json`)
  try { const r = p ? KdpRecordSchema.safeParse(JSON.parse(readFileSync(p, 'utf8'))) : null; return r?.success ? r.data : null } catch { return null }
}

const running = (dir: string) => {
  const p = safeFile(dir, 'run/state.yaml')
  try { return p ? (parseYamlText(readFileSync(p, 'utf8')) as { status?: unknown } | null)?.status === 'running' : false } catch { return false }
}

export function publishState(dir: string): PublishState {
  const book = Book.parse(parseYamlText(readFileSync(join(dir, 'book.yaml'), 'utf8')))
  const { settings, error } = readExport(book.export)
  const why = book.status !== 'active' ? 'This book is archived, so its publish settings are read-only. Export still works.'
    : running(dir) ? 'A run is going. Change the publish settings after it stops. Export still works.' : null
  return { settings, error, editable: why === null, why, checks: staticChecks({ sceneIds: outlineSceneIds(dir), accepted: readManuscript(dir), s: settings }), last: readKdpRecord(dir, book.id) }
}

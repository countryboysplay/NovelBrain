import { z } from 'zod'

// KDP export settings, kept out of schemas.ts so the hook and accept bundles never change for them.
export const EXPORT_TRIMS = ['5x8', '5.25x8', '5.5x8.5', '6x9'] as const
export const PAPERS = ['cream', 'white'] as const
export type Trim = (typeof EXPORT_TRIMS)[number]
export type Paper = (typeof PAPERS)[number]

export const EXPORT_FONTS = ['eb-garamond', 'crimson-pro', 'libre-baskerville'] as const
const page = z.string().max(20_000).default('')
// Every field has a default: a book with no export block gets them all.
export const ExportSettings = z.object({
  trim: z.enum(EXPORT_TRIMS).default('5.5x8.5'),
  paper: z.enum(PAPERS).default('cream'),
  font: z.enum(EXPORT_FONTS).default('eb-garamond'),
  fontSize: z.number().min(10).max(12).multipleOf(0.5).default(11),
  chapterStart: z.enum(['next-page', 'recto']).default('next-page'),
  author: z.string().max(200).default(''),
  copyright: z.string().max(500).default(''),
  isbn: z.string().max(40).default(''),
  dedication: page,
  epigraph: page,
  acknowledgements: page,
  aboutAuthor: page,
  alsoBy: z.array(z.string().trim().min(1).max(200)).max(50).default([])
})
export type ExportSettingsT = z.infer<typeof ExportSettings>

// book.yaml's export block is parsed here only, so a bad one never stops acceptance or the studio.
export function readExport(raw: unknown): { settings: ExportSettingsT; error: string | null } {
  const r = ExportSettings.safeParse(raw ?? {})
  if (r.success) return { settings: r.data, error: null }
  return { settings: ExportSettings.parse({}), error: `book.yaml export: ${r.error.issues.map(i => `${i.path.join('.') || 'block'}: ${i.message}`).join('; ')}` }
}

export const copyrightLine = (s: ExportSettingsT, year: number) =>
  s.copyright.trim() || `© ${year}${s.author.trim() ? ` ${s.author.trim()}` : ''}. All rights reserved.`

export interface Check { id: string; ok: boolean; message: string; link?: { view: 'outline' | 'manuscript'; scene: string } }
/** One laid-out page, as Novel Brain's page script reports it. */
export interface PageFact { right: boolean; blank: boolean; head: string; folio: string }
/** exports/<id>-kdp.json: what Plan 6's cover needs. */
export interface KdpRecord { pages: number; trim: Trim; paper: Paper; gutter: number; spineWidth: number; exportedAt: string }
export interface PublishState { settings: ExportSettingsT; error: string | null; editable: boolean; why: string | null; checks: Check[]; last: KdpRecord | null }
export interface KdpExport { ok: boolean; error?: string; checks: Check[]; pages?: PageFact[]; record?: KdpRecord }

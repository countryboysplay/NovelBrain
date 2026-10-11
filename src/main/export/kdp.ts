import type { Paper, Trim } from '../../shared/export'

// KDP paperback numbers for a no-bleed novel interior, from docs/facts.md ("Novel print layout"). Inches.
export const TRIMS: Record<Trim, { w: number; h: number }> = { '5x8': { w: 5, h: 8 }, '5.25x8': { w: 5.25, h: 8 }, '5.5x8.5': { w: 5.5, h: 8.5 }, '6x9': { w: 6, h: 9 } }
export const MIN_MARGIN = 0.25
export const PAGE_RANGE: Record<Paper, [number, number]> = { cream: [24, 776], white: [24, 828] }
const SPINE: Record<Paper, number> = { cream: 0.0025, white: 0.002252 }

export const gutterFloor = (pages: number) => (pages <= 150 ? 0.375 : pages <= 300 ? 0.5 : pages <= 500 ? 0.625 : pages <= 700 ? 0.75 : 0.875)

export interface Margins { gutter: number; outside: number; top: number; bottom: number }
const r3 = (x: number) => Math.round(x * 1000) / 1000
// House margins: BD-M's 6x9 novel (gutter 0.875, outside 0.75, top 0.5, bottom 0.75) scaled to the trim; KDP's gutter table is a floor.
export function margins(trim: Trim, pages: number): Margins {
  const { w, h } = TRIMS[trim]
  return { gutter: r3(Math.max(gutterFloor(pages), (0.875 * w) / 6)), outside: r3((0.75 * w) / 6), top: r3((0.5 * h) / 9), bottom: r3((0.75 * h) / 9) }
}

export const spineWidth = (pages: number, paper: Paper) => Math.round(pages * SPINE[paper] * 10000) / 10000

export function isIsbn13(s: string): boolean {
  const d = s.replace(/[\s-]/g, '')
  if (!/^97[89]\d{10}$/.test(d)) return false
  const sum = [...d.slice(0, 12)].reduce((n, c, i) => n + Number(c) * (i % 2 ? 3 : 1), 0)
  return (10 - (sum % 10)) % 10 === Number(d[12])
}

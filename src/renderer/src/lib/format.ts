import type { RunStateT } from '../../../shared/types'

export const usd = (n: number): string => `$${(Math.round(n * 100) / 100).toFixed(2)}`
export const wordsShort = (n: number): string => (n < 1000 ? String(n) : `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`)
export const wordsLong = (n: number): string => n.toLocaleString('en-US')
export const titleCase = (s: string): string => { const t = s.replace(/-/g, ' '); return t.charAt(0).toUpperCase() + t.slice(1) }

export function runLabel(run: RunStateT | null): string {
  if (!run) return 'No run'
  switch (run.status) {
    case 'running': return run.current ? `Running ${run.current.kind} ${run.current.id}` : 'Running'
    case 'idle': return 'Not started'
    case 'paused': return 'Paused'
    case 'checkpoint': return 'Act checkpoint: your turn'
    case 'needs-you': return 'Needs you'
    case 'usage-limit': return run.resumeAfter ? `Usage limit; resets ${run.resumeAfter}` : 'Usage limit reached'
    case 'done': return 'Done'
    case 'error': return 'Stopped by an error'
  }
}

export const cardLabel = (c: { status: string; live: boolean }): string =>
  c.live ? 'wet paint' : c.status === 'needs-you' ? 'needs you' : c.status === 'review' ? 'in review' : c.status

/** A bible body without a leading Markdown heading that only repeats the card's title. */
export const dropTitle = (body: string, title: string): string =>
  body.replace(/^\s*#+[ \t]*(.*)\r?\n?/, (line, h: string) => (h.trim().toLowerCase() === title.trim().toLowerCase() ? '' : line)).trimStart()
/** A short plain-text taste of a bible body: headings dropped, whitespace folded, cut at a word. */
export function excerpt(body: string, max = 140): string {
  const t = body.split(/\r?\n/).filter(l => !/^\s*#/.test(l)).join(' ').replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max)
  return `${cut.slice(0, cut.lastIndexOf(' ') > max / 2 ? cut.lastIndexOf(' ') : max).replace(/[\s,;:.]+$/, '')}…`
}

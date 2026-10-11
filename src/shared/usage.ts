// Plan usage, normalised at the boundary (docs/facts.md, "Claude usage limits"): percent 0-100, reset in epoch ms.
export interface UsageWindow { pct: number; resetsAt: number | null }
export interface Usage { fiveHour: UsageWindow | null; sevenDay: UsageWindow | null; source: 'stream' | 'headroom'; at: number }

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const win = (pct: number | null, resetsAt: number | null): UsageWindow | null =>
  pct === null ? null : { pct: Math.min(100, Math.max(0, Math.round(pct * 10) / 10)), resetsAt }
const both = (fiveHour: UsageWindow | null, sevenDay: UsageWindow | null, source: Usage['source'], at: number): Usage | null =>
  fiveHour || sevenDay ? { fiveHour, sevenDay, source, at } : null
type Obj = Record<string, unknown> | undefined
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined)

/** stream-json `rate_limit_event`: unifiedWindows.<window>.utilization is a 0-1 fraction, resetsAt epoch seconds. Undocumented: every field is optional. */
export function usageFromStream(v: unknown, at = Date.now()): Usage | null {
  const e = obj(v)
  if (e?.type !== 'rate_limit_event') return null
  const w = obj(obj(e.rate_limit_info)?.unifiedWindows)
  const one = (k: string) => {
    const x = obj(w?.[k]), p = num(x?.utilization), r = num(x?.resetsAt)
    return win(p === null ? null : p * 100, r === null ? null : r * 1000)
  }
  return both(one('five_hour'), one('seven_day'), 'stream', at)
}

/** Headroom GET /stats `subscription_window.latest`: utilization_pct is 0-100, resets_at ISO. */
export function usageFromHeadroom(v: unknown, at = Date.now()): Usage | null {
  const l = obj(obj(obj(v)?.subscription_window)?.latest)
  const one = (k: string) => {
    const x = obj(l?.[k]), r = typeof x?.resets_at === 'string' ? Date.parse(x.resets_at) : NaN
    return win(num(x?.utilization_pct), Number.isFinite(r) ? r : null)
  }
  return both(one('five_hour'), one('seven_day'), 'headroom', at)
}

/** The window that stops the run: at or over stopAt with a reset still ahead. When both are over, the later reset.
 * A window with no reset time, or one that has reset, never stops the run (ruling A10). */
export function overLimit(u: Usage | null, stopAt: number, now = Date.now()): { window: '5-hour' | 'weekly'; pct: number; resetsAt: number } | null {
  let out: { window: '5-hour' | 'weekly'; pct: number; resetsAt: number } | null = null
  for (const [window, w] of [['5-hour', u?.fiveHour], ['weekly', u?.sevenDay]] as const)
    if (w && w.pct >= stopAt && w.resetsAt !== null && w.resetsAt > now && (!out || w.resetsAt > out.resetsAt)) out = { window, pct: w.pct, resetsAt: w.resetsAt }
  return out
}

const shown = (w: UsageWindow | null | undefined, now: number) => (w && (w.resetsAt === null || w.resetsAt > now) ? `${Math.round(w.pct)}%` : 'unknown')
export const usageText = (u: Usage | null, now = Date.now()): string => `Usage: 5h ${shown(u?.fiveHour, now)} · week ${shown(u?.sevenDay, now)}`

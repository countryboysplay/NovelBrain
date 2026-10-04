import { STOP_AT } from '../../shared/schemas'

export type StopAt = (typeof STOP_AT)[number]
export const isStopAt = (v: unknown): v is StopAt => STOP_AT.some(s => s === v)
export const isSceneId = (v: unknown): v is string => typeof v === 'string' && /^SC-\d{3,}$/.test(v)
/** The options of a run:start argument (pauseAtActs defaults to true), or null when the argument is malformed. */
export const startArg = (o: unknown): { stopAt: StopAt; pauseAtActs: boolean } | null => {
  const { stopAt, pauseAtActs = true } = (o ?? {}) as { stopAt?: unknown; pauseAtActs?: unknown }
  return isStopAt(stopAt) && typeof pauseAtActs === 'boolean' ? { stopAt, pauseAtActs } : null
}
/** True when the runner went idle within ms. */
export async function waitIdle(r: { idle(): Promise<void> }, ms: number): Promise<boolean> {
  let t: NodeJS.Timeout | undefined
  const timeout = new Promise<false>(res => { t = setTimeout(() => res(false), ms) })
  try { return await Promise.race([r.idle().then(() => true as const), timeout]) } finally { clearTimeout(t) }
}

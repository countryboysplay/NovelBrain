import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REQUIRED_REVIEWERS } from '../shared/schemas'

// A touch-up fixes a passing round's FLAG findings: only the flagging reviewers, the canon auditor and the gate rerun.
export const TOUCHUP_MAX_WORDS = 200
// Under run/, which the guard keeps Claude from writing; git-ignored.
export const sealRel = (scene: string) => `run/touchup/${scene}`
export interface Seal { round: number; plan: string; rerun: string[] }
export const sha = (b: string | Buffer) => createHash('sha256').update(b).digest('hex')

export const rerunOf = (flagged: string[]): string[] =>
  REQUIRED_REVIEWERS.filter(r => flagged.includes(r) || r === 'canon-auditor' || r === 'gate')

// seal.json is written last, so a seal that has it is complete.
export function readSeal(dir: string, scene: string): Seal | null {
  const s = join(dir, sealRel(scene))
  try {
    const j = JSON.parse(readFileSync(join(s, 'seal.json'), 'utf8'))
    const known = REQUIRED_REVIEWERS as readonly string[]
    if (Number.isInteger(j?.round) && j.round > 0 && typeof j.plan === 'string' && Array.isArray(j.rerun) &&
      j.rerun.every((r: unknown) => known.includes(r as string)) && existsSync(join(s, 'draft.md')) &&
      REQUIRED_REVIEWERS.every(r => existsSync(join(s, `${r}.md`)))) return { round: j.round, plan: j.plan, rerun: j.rerun }
  } catch { /* no seal */ }
  return null
}

// Words added plus words removed over whitespace-split words, exact up to TOUCHUP_MAX_WORDS.
export function wordsChanged(a: string, b: string): number {
  const x = a.split(/\s+/).filter(Boolean), y = b.split(/\s+/).filter(Boolean)
  let s = 0
  while (s < x.length && s < y.length && x[s] === y[s]) s++
  let e = 0
  while (e < x.length - s && e < y.length - s && x[x.length - 1 - e] === y[y.length - 1 - e]) e++
  const m = x.slice(s, x.length - e), n = y.slice(s, y.length - e)
  // Myers diff, stopped once the edit count passes the cap: O((m+n)*cap) at worst. Over the cap, m + n (an upper bound) is returned.
  if (Math.abs(m.length - n.length) > TOUCHUP_MAX_WORDS) return m.length + n.length
  const max = TOUCHUP_MAX_WORDS, off = max + 1, v = new Int32Array(2 * max + 3)
  for (let d = 0; d <= max; d++) {
    for (let k = -d; k <= d; k += 2) {
      let i = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1
      let j = i - k
      while (i < m.length && j < n.length && m[i] === n[j]) { i++; j++ }
      v[off + k] = i
      if (i >= m.length && j >= n.length) return d
    }
  }
  return m.length + n.length
}

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Outline, parseYamlText } from '../../shared/schemas'
import { RULE_ID, type Meta } from './files'

export const HITS_TO_PROBATION = 2
export const QUIET_TO_RETIRE = 3
// The reviewers' numbered finding line: "1. FLAG. Rule: SK-ENG-04" (kit/fiction/agents/*.md, Output).
const FINDING = /^\s*\d+\.\s+(?:FLAG|FAIL)\.\s+Rule:(.*)$/gm
const TOKEN = /\b[A-Z]{2,4}-[A-Z]{2,5}-\d{2}\b/g

// ponytail: only the last round of each review file is on disk, so a finding a redraft fixed is not counted.
/** Each current review file (book-relative) of a chapter's scenes and of the chapter, with the rule ids its FLAG and FAIL findings cite. */
export function chapterFindings(bookDir: string, chapter: string): Map<string, Set<string>> {
  const outline = Outline.parse(parseYamlText(readFileSync(join(bookDir, 'outline', 'outline.yaml'), 'utf8')))
  const ch = outline.acts.flatMap(a => a.chapters).find(c => c.id === chapter)
  const out = new Map<string, Set<string>>()
  if (!ch) return out
  for (const id of [...ch.scenes, ch.id]) {
    const dir = join(bookDir, 'reviews', id)
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir).filter(n => n.endsWith('.md') && n !== 'park.md')) {
      const rules = new Set<string>()
      for (const m of readFileSync(join(dir, f), 'utf8').matchAll(FINDING))
        for (const r of m[1].match(TOKEN) ?? []) if (RULE_ID.test(r)) rules.add(r)
      if (rules.size) out.set(`reviews/${id}/${f}`, rules)
    }
  }
  return out
}

/** Rule ids cited by FLAG and FAIL findings in the current reviews of a chapter's scenes and of the chapter. */
export const chapterRules = (bookDir: string, chapter: string): Set<string> => new Set([...chapterFindings(bookDir, chapter).values()].flatMap(s => [...s]))

export const tracked = (m: Meta): boolean => m.status === 'live' && m.type === 'catch' && !m.pinned && m.rules.length > 0

/** One chapter's evidence on a live catch: findings citing its rules in two chapters since it went live mean
 * it is not working (back to probation); three chapters in a row with none mean it is solved (retire). */
export function weigh(m: Meta, cited: Set<string>): { meta: Meta; outcome: 'none' | 'probation' | 'retire' } {
  const hit = m.rules.some(r => cited.has(r))
  const hits = m.hits + (hit ? 1 : 0), quiet = hit ? 0 : m.quiet + 1
  if (hits >= HITS_TO_PROBATION) return { meta: { ...m, status: 'probation', hits: 0, quiet: 0, live: '' }, outcome: 'probation' }
  if (quiet >= QUIET_TO_RETIRE) return { meta: { ...m, hits, quiet }, outcome: 'retire' }
  return { meta: { ...m, hits, quiet }, outcome: 'none' }
}

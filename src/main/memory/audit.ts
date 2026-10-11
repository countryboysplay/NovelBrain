import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { AUDIENCES, GENRES, parseYamlText } from '../../shared/schemas'
import type { LessonAction } from '../../shared/types'
import { RULE_ID, parseFrontmatter, relPath, writeMemory, type Memory } from './files'
import { splitSource } from './maintain'

export interface Shown { rel: string; text: string; note?: string }
export interface AuditInput { probation: Shown[]; live: Shown[]; skills: Shown[]; style: string; audience: string; genres: string; findings: string }
export interface Verdict { lesson: string; verdict: 'KEEP' | 'REWRITE' | 'DELETE'; reason: string; summary?: string; body?: string; rules?: string[] }
export interface Outcome { lesson: string; action: LessonAction; reason: string }

const LIVE_MAX = 30_000
const FINDINGS_MAX = 40_000
const REVIEW = /^reviews\/(SC-\d{3,}|CH-\d{2,}|ACT-\d+)\/[a-z-]+\.md$/
const read = (f: string, max: number) => {
  try {
    return readFileSync(f, 'utf8').slice(0, max)
  } catch {
    return ''
  }
}
const oneLine = (s: string, max: number) => s.replace(/\s+/g, ' ').trim().slice(0, max)

/** What the auditor judges against: the style guide (ruling A1), the book's audience and genre skills, and the review files the lessons cite. */
export function auditContext(bookDir: string, lessons: Memory[], extra: string[] = []): Pick<AuditInput, 'style' | 'audience' | 'genres' | 'findings'> {
  let y: { audience?: unknown; genres?: unknown } = {}
  try {
    y = (parseYamlText(readFileSync(join(bookDir, 'book.yaml'), 'utf8')) ?? {}) as typeof y
  } catch {
    // no audience or genre skills then
  }
  const skill = (name: string) => read(join(bookDir, '.claude', 'skills', name, 'SKILL.md'), 20_000)
  const audience = (AUDIENCES as readonly unknown[]).includes(y.audience) ? skill(`audience-${y.audience}`) : ''
  const genres = (Array.isArray(y.genres) ? y.genres : []).filter(g => (GENRES as readonly unknown[]).includes(g)).map(g => skill(`genre-${g}`)).filter(Boolean).join('\n\n')
  // Sources are model-written: only review files inside the book are read.
  // extra: the reviews that sent a catch back to probation (evidence).
  const cited = [...new Set([...lessons.flatMap(m => m.meta.sources.map(s => splitSource(s)[0])), ...extra])].filter(f => REVIEW.test(f))
  let findings = ''
  for (const f of cited) {
    const t = read(join(bookDir, f), 20_000)
    if (t) findings += `<<<${f}>>>\n${t.trim()}\n\n`
  }
  return { style: read(join(bookDir, 'bible', 'world', 'style.md'), 15_000), audience, genres, findings: findings.slice(0, FINDINGS_MAX) }
}

const blocks = (tag: string, xs: Shown[], max = Infinity): string => {
  let out = '', used = 0
  for (const x of xs) {
    // ponytail: past the cap a live lesson is shown by path only; raise LIVE_MAX if the auditor misses contradictions
    const text = used < max ? x.text.trim() : '(text left out)'
    used += text.length
    out += `### ${tag} ${x.rel}\n${x.note ? `(${x.note})\n` : ''}${text}\n\n`
  }
  return out || '(none)\n'
}

export function auditPrompt(i: AuditInput): string {
  return `AUDIT. You are the independent auditor of Novel Brain's memory: lessons about how to write this writer's books, which another model distilled from sessions and reviews. Bad lessons must never reach the author. Judge every lesson under "Lessons on probation" and every proposed skill.

KEEP: true to the findings it cites, agrees with the style guide and the audience and genre skills, and will help in later scenes.
REWRITE: worth keeping but vague, too broad, wrongly worded or partly wrong. Give the corrected text.
DELETE: a story fact (what happens, who knows what, any id such as SC-004 or CHAR-mara), a one-off, unsupported by its findings, or against the style guide, the audience skill or a genre skill.

Rules:
- The style guide wins over every other rule; the audience and genre skills win over general craft advice.
- If two lessons contradict each other, DELETE the weaker one, even one under "Live lessons", and name the other in the reason. Give live lessons no other verdict.
- A lesson marked "Sent back to probation" is not working: REWRITE or DELETE it unless the findings show it was not the cause.
- A catch names the reviewer rule ids it targets in "rules" (such as SK-ENG-04 or MG-CON-02), only ids that appear in the findings below.
- Never write story facts or ids, the book's character or place names in writer-wide lessons (topics/, user.md) or skills, passwords or keys. A rewrite that breaks this is deleted.
- Reply with only a JSON array, one object per verdict:
[{"lesson": "<the path after ###>", "verdict": "KEEP" | "REWRITE" | "DELETE", "reason": "<one sentence>", "summary": "<REWRITE: one line under 100 characters; for a skill, its description starting with Use when>", "body": "<REWRITE: the text without frontmatter>", "rules": ["<REWRITE of a catch: rule ids>"]}]

## Style guide (bible/world/style.md)
${i.style || '(none)'}

## Audience skill
${i.audience || '(none)'}

## Genre skills
${i.genres || '(none)'}

## Reviewer findings the lessons cite
${i.findings || '(none)'}

## Lessons on probation
${blocks('PROBATION', i.probation)}
## Live lessons
${blocks('LIVE', i.live, LIVE_MAX)}
## Proposed skills
${blocks('SKILL', i.skills)}`
}

/** The auditor's JSON array. Null when there is none; entries on files it was not shown, unknown verdicts,
 * empty reasons, REWRITEs without a body and repeats are dropped. */
export function parseAudit(out: string, shown: string[]): Verdict[] | null {
  const a = out.indexOf('['), b = out.lastIndexOf(']')
  if (a < 0 || b < a) return null
  let v: unknown
  try {
    v = JSON.parse(out.slice(a, b + 1))
  } catch {
    return null
  }
  if (!Array.isArray(v)) return null
  const seen = new Set<string>()
  return v.flatMap((x): Verdict[] => {
    const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
    const str = (k: string) => (typeof o[k] === 'string' ? (o[k] as string).trim() : '')
    const lesson = str('lesson'), verdict = str('verdict'), reason = oneLine(str('reason'), 300), body = str('body'), summary = str('summary')
    if (!shown.includes(lesson) || seen.has(lesson) || !['KEEP', 'REWRITE', 'DELETE'].includes(verdict) || !reason) return []
    if (verdict === 'REWRITE' && !body) return []
    seen.add(lesson)
    const rules = Array.isArray(o.rules) ? o.rules.filter((r): r is string => typeof r === 'string' && RULE_ID.test(r)) : undefined
    return [{ lesson, verdict: verdict as Verdict['verdict'], reason, ...(summary && { summary }), ...(body && { body }), ...(rules && { rules }) }]
  })
}

/** Applies the verdicts in deterministic code. check(rel) runs the memory validator on one file. */
export function applyVerdicts(root: string, verdicts: Verdict[], o: { probation: Memory[]; live: Memory[]; skills: string[]; day: string; auditor: string; check: (rel: string) => string[] }): { entries: Outcome[]; kept: string[] } {
  const entries: Outcome[] = [], kept: string[] = []
  const rel = (m: Memory) => relPath(root, m.file)
  const add = (lesson: string, action: LessonAction, reason: string) => entries.push({ lesson, action, reason })
  for (const v of verdicts) {
    const p = o.probation.find(m => rel(m) === v.lesson)
    const l = o.live.find(m => rel(m) === v.lesson)
    if (p) {
      if (v.verdict === 'DELETE') {
        rmSync(p.file, { force: true })
        add(p.meta.name, 'deleted', v.reason)
      } else if (v.verdict === 'KEEP') {
        writeMemory({ ...p, meta: { ...p.meta, status: 'live', verified: o.day, live: o.day, quiet: 0, hits: 0 } })
        // Checked again (a bible name added since, or another book's audit): a failing KEEP left on probation would
        // roll back every later audit, so it is deleted like a failing rewrite.
        const bad = o.check(v.lesson)
        if (bad.length) {
          rmSync(p.file, { force: true })
          add(p.meta.name, 'deleted', `${v.reason} (it failed the memory checks: ${bad.join('; ')})`)
        } else add(p.meta.name, 'added', v.reason)
      } else {
        // The auditor wrote this text, so it waits on probation for the other auditor (ruling A5).
        // A summary the frontmatter would read back as a boolean, number or list makes the file invalid: keep the old one.
        const summary = v.summary ? oneLine(v.summary, 100) : ''
        writeMemory({ ...p, body: `${v.body}\n`, meta: { ...p.meta, summary: (!/^(true|false|\d+|\[.*\])$/.test(summary) && summary) || p.meta.summary, rules: v.rules ?? p.meta.rules, by: o.auditor, verified: o.day, live: '' } })
        const bad = o.check(v.lesson)
        if (bad.length) {
          rmSync(p.file, { force: true })
          add(p.meta.name, 'deleted', `${v.reason} (its rewrite failed the memory checks: ${bad.join('; ')})`)
        } else add(p.meta.name, 'rewritten', v.reason)
      }
    } else if (l) {
      // Live lessons are shown for contradictions only: the weaker one is deleted (ruling A4).
      if (v.verdict !== 'DELETE') continue
      rmSync(l.file, { force: true })
      add(l.meta.name, 'deleted', v.reason)
    } else if (o.skills.includes(v.lesson)) {
      const name = v.lesson.split('/')[1]
      const file = join(root, v.lesson)
      if (v.verdict === 'DELETE') {
        rmSync(dirname(file), { recursive: true, force: true })
        add(`skill ${name}`, 'deleted', v.reason)
      } else if (v.verdict === 'KEEP') {
        kept.push(name)
        add(`skill ${name}`, 'kept', v.reason)
      } else {
        const old = parseFrontmatter(readFileSync(file, 'utf8'))?.raw.description
        // A plain YAML scalar: ": " or " #" inside it, or a leading indicator (- > | " [ & * ...), would break the
        // frontmatter problems() and Claude Code parse. Nothing left: the old description.
        const yamlSafe = (s: string) => oneLine(s, 200).replace(/:(\s|$)/g, ' -$1').replace(/\s#/g, ' ').replace(/^[^\p{L}\p{N}]+/u, '').trim()
        const description = (v.summary && yamlSafe(v.summary)) || (typeof old === 'string' ? old : '')
        writeFileSync(file, `---\nname: ${name}\ndescription: ${description}\n---\n${v.body}\n`)
        const bad = o.check(v.lesson)
        if (bad.length) {
          rmSync(dirname(file), { recursive: true, force: true })
          add(`skill ${name}`, 'deleted', `${v.reason} (its rewrite failed the memory checks: ${bad.join('; ')})`)
        } else {
          kept.push(name) // still a proposal the writer approves; no second audit (ruling A5)
          add(`skill ${name}`, 'rewritten', v.reason)
        }
      }
    }
  }
  return { entries, kept }
}

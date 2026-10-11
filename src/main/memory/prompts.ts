import type { Memory } from './files'

type Indexes = { writer: string; series: string; book: string }

const INTRO = `You maintain Novel Brain's memory: lessons about how to write this writer's books. Your working directory is the memory folder.`

// Shared by the distill and deep passes. "inbox/" is left out of the never-touch list:
// distill must not mention it at all, and the deep pass writes proposals there.
const formatAndRules = (seriesDir: string, bookDir: string, day: string): string => `## Where memories go
- topics/<name>.md: the writer's preferences and craft lessons that hold for every book (types preference, craft)
- ${seriesDir}/topics/<name>.md: this series' voice (type voice)
- ${bookDir}/topics/<name>.md: recurring reviewer catches in this book (type catch)

## File format (exactly this; one lesson per file; at most 200 lines)
---
name: <kebab-case, same as the file name>
type: preference | catch | voice | craft
summary: <one line, under 100 characters>
sources: [<book-relative paths the lesson came from, such as reviews/SC-004/line.md; [] if none>]
rules: [<for a catch: the reviewer rule ids it targets, such as SK-ENG-04 or MG-CON-02, never a story id; [] otherwise>]
verified: ${day}
used: ${day}
uses: 0
stale: false
pinned: false
---
<the lesson, then **Why:** and **How to apply:** lines>

## Rules
- Never store story facts: what happens, who knows what, ids such as SC-004 or CHAR-mara, or anything canon, the outline or the manuscript already says. Story facts belong to canon and are written only by acceptance. A validator discards the whole update if it finds one.
- Writer-wide files (topics/) may not name the book's characters or places.
- A catch is worth saving when reviewers flagged the same kind of problem in two or more scenes.
- Save only lessons that will still matter in later scenes. Never save what only mattered to one session.
- Before creating a file, check the indexes and Grep for an existing lesson on the same subject. Update it instead of creating a duplicate.
- If a session shows a lesson is wrong, rewrite it and set verified to ${day}; if it no longer holds, delete the file.
- Never store passwords, API keys or tokens.
- Only create, edit or delete files in the locations above. Never touch INDEX.md, book.json, skills/ or anything else.
- Finish with one line saying what changed, or "no changes".

## Current indexes
`

const indexBlock = (i: Indexes): string => `### Writer
${i.writer || '(empty)'}
### Series
${i.series || '(empty)'}
### Book
${i.book || '(empty)'}
`

export function distillPrompt(o: { slices: string; indexes: Indexes; seriesDir: string; bookDir: string; day: string }): string {
  return `${INTRO}
Below are excerpts of recent Claude Code sessions in one book. Update the memory so future sessions write better, and nothing else.

${formatAndRules(o.seriesDir, o.bookDir, o.day)}${indexBlock(o.indexes)}
## Session excerpts
${o.slices}
`
}

export function deepPrompt(o: { act: string; reviews: string; indexes: Indexes; seriesDir: string; bookDir: string; skills: string[]; rejected: string[]; day: string }): string {
  return `${INTRO}
This is the deeper pass at the end of ${o.act}. Below are the reviewers' findings for the act.
1. Merge duplicate lessons and delete ones the act's reviews show are no longer needed.
2. Record each recurring catch (two or more chapters) in ${o.bookDir}/topics/; if it would hold for any book, in topics/ without names.
3. Propose a learned skill only when the same multi-step fix or procedure was needed in two or more chapters. Write it to inbox/<name>/SKILL.md with frontmatter \`name\` (the folder name) and \`description\` (starts with "Use when"), then the procedure. Never propose these names, which exist or were rejected: ${[...o.skills, ...o.rejected].join(', ') || '(none)'}.

${formatAndRules(o.seriesDir, o.bookDir, o.day)}${indexBlock(o.indexes)}
## Act review findings
${o.reviews}
`
}

export function recheckPrompt(m: Memory, sources: { file: string; text: string | null }[]): string {
  const files = sources.map(s => `<<<${s.file}>>>\n${s.text ?? '(deleted)'}`).join('\n\n')
  return `RECHECK. A saved memory may be out of date because the files it was based on changed.
Compare it with the current files below. Reply with exactly one of these as the first line:
KEEP (still accurate)
DELETE (no longer true or no longer useful)
REWRITE (needs updating), followed on the next lines by the corrected memory text only, without frontmatter.

## Memory: ${m.meta.name}
${m.body.trim()}

## Current files
${files}
`
}

export function parseVerdict(out: string): { verdict: 'KEEP' | 'DELETE' | 'REWRITE'; body: string } | null {
  const m = /^(KEEP|DELETE|REWRITE)\b.*$/m.exec(out)
  if (!m) return null
  return { verdict: m[1] as 'KEEP' | 'DELETE' | 'REWRITE', body: out.slice(m.index + m[0].length).replace(/^\r?\n/, '') }
}

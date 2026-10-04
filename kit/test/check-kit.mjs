import { parse } from 'yaml'
import { basename } from 'node:path'

const READER = ['Read', 'Glob', 'Grep', 'Write']
const EDITOR = ['Read', 'Glob', 'Grep', 'Write', 'Edit']
// The Plan 3 Task 6 table: model (aliases recorded in docs/facts.md), exact tool set, and for reviewers
// the short name used in `reviewer:` and in reviews/<ID>/<short>.md (REVIEWERS in src/shared/schemas.ts).
export const AGENTS = {
  'story-architect': { model: 'opus', tools: EDITOR },
  author: { model: 'opus', tools: EDITOR },
  'canon-keeper': { model: 'sonnet', tools: READER },
  'canon-auditor': { model: 'haiku', tools: READER, review: 'canon-auditor' },
  'continuity-reviewer': { model: 'sonnet', tools: READER, review: 'continuity' },
  'character-reviewer': { model: 'sonnet', tools: READER, review: 'character' },
  'developmental-editor': { model: 'sonnet', tools: READER, review: 'developmental' },
  'line-editor': { model: 'sonnet', tools: READER, review: 'line' },
  'audience-reviewer': { model: 'sonnet', tools: READER, review: 'audience' },
  'arc-auditor': { model: 'sonnet', tools: READER, review: 'arc' },
  'flow-reader': { model: 'sonnet', tools: READER, review: 'flow' },
  'gate-checker': { model: 'opus', tools: READER, review: 'gate' },
}
export const MODELS = ['opus', 'sonnet', 'haiku']
const KEYS = ['name', 'description', 'model', 'tools', 'skills', 'maxTurns']
const HEADINGS = ['Job', 'Read', 'Write', 'Output', 'Rules', 'Return']
const FORBIDDEN_TOOLS = /^(Bash|PowerShell|Agent|Task|mcp__.*)$/
const PLACEHOLDER = /\b(TODO|TBD|FIXME|lorem ipsum)\b/i

// Body lines with fenced code blocks blanked, so `## ` inside an example is not a heading.
const unfenced = (lines) => {
  let inFence = false
  return lines.map((l) => {
    if (l.startsWith('```')) { inFence = !inFence; return '' }
    return inFence ? '' : l
  })
}

// Returns a list of problems with one agent file; empty means valid.
// knownSkills, when given, is the set of skill folder names an agent may preload via `skills:`.
export function checkAgent(text, file, knownSkills) {
  const errors = []
  text = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!m) return ['frontmatter: missing or unterminated']
  let fm
  try { fm = parse(m[1]) } catch (e) { return [`frontmatter: does not parse (${e.message})`] }
  if (!fm || typeof fm !== 'object') return ['frontmatter: not a mapping']
  const name = basename(file, '.md')
  const row = AGENTS[name]

  for (const k of Object.keys(fm)) if (!KEYS.includes(k)) errors.push(`frontmatter: key ${k} is not allowed`)
  if (fm.name !== name) errors.push(`name "${fm.name}" does not match file name "${name}"`)
  if (typeof fm.description !== 'string' || fm.description.length < 40) errors.push('description shorter than 40 characters')
  if (!MODELS.includes(fm.model)) errors.push(`model "${fm.model}" is not one of ${MODELS.join(', ')}`)
  if (row && fm.model !== row.model) errors.push(`model "${fm.model}" should be "${row.model}"`)

  const tools = typeof fm.tools === 'string' ? fm.tools.split(',').map((t) => t.trim()).filter(Boolean)
    : Array.isArray(fm.tools) ? fm.tools.map(String) : []
  if (tools.length === 0) errors.push('tools: missing (an agent without tools inherits every tool)')
  for (const t of tools) if (FORBIDDEN_TOOLS.test(t)) errors.push(`tools: ${t} is not allowed`)
  if (row && tools.length && [...tools].sort().join(',') !== [...row.tools].sort().join(','))
    errors.push(`tools: "${tools.join(', ')}" should be "${row.tools.join(', ')}"`)

  if (fm.skills !== undefined) {
    if (!Array.isArray(fm.skills)) errors.push('skills: must be a YAML list')
    else if (knownSkills) for (const s of fm.skills) if (!knownSkills.has(s)) errors.push(`skills: ${s} does not exist`)
  }

  const body = m[2].split('\n')
  const plain = unfenced(body)
  const headings = plain.filter((l) => l.startsWith('## ')).map((l) => l.slice(3).trim())
  for (const h of HEADINGS) if (!headings.includes(h)) errors.push(`missing heading: ${h}`)

  if (row?.review) {
    const start = plain.indexOf('## Output')
    const end = plain.findIndex((l, i) => i > start && l.startsWith('## '))
    const output = start < 0 ? '' : body.slice(start, end < 0 ? undefined : end).join('\n')
    if (!new RegExp(`reviewer: ${row.review}(?![a-z-])`).test(output)) errors.push(`Output: no "reviewer: ${row.review}" example`)
    if (!output.includes(`/${row.review}.md`)) errors.push(`Output: does not name the path .../${row.review}.md`)
  }

  // Book-dependent skills are not preloaded; the agent must Read their SKILL.md from the book's .claude/skills/.
  const joined = m[2]
  for (const kind of ['audience', 'genre']) {
    if (!new RegExp(`\\b${kind}-<`).test(joined)) continue
    if (!new RegExp(`Read \`\\.claude/skills/${kind}-<[a-z]+>/SKILL\\.md\``).test(joined))
      errors.push(`mentions ${kind} skills but has no "Read \`.claude/skills/${kind}-<...>/SKILL.md\`" instruction`)
  }

  text.split('\n').forEach((l, i) => {
    if (l.includes('\u2014')) errors.push(`em dash on line ${i + 1}`)
    if (PLACEHOLDER.test(l)) errors.push(`placeholder text on line ${i + 1}`)
  })
  return errors
}

const lineProblems = (text) => text.split('\n').flatMap((l, i) => [
  ...(l.includes('\u2014') ? [`em dash on line ${i + 1}`] : []),
  ...(PLACEHOLDER.test(l) ? [`placeholder text on line ${i + 1}`] : []),
])
const frontmatter = (text) => {
  const m = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!m) return { error: 'frontmatter: missing or unterminated' }
  try {
    const fm = parse(m[1])
    return fm && typeof fm === 'object' ? { fm, body: m[2] } : { error: 'frontmatter: not a mapping' }
  } catch (e) { return { error: `frontmatter: does not parse (${e.message})` } }
}

// The slash commands: eight the showrunner runs (Plan 3 Task 7) and propose-change (Task 14).
export const COMMANDS = ['write-scene', 'revise-scene', 'review-scene', 'plan-chapter', 'check-chapter', 'check-act', 'check-book', 'new-character', 'propose-change']
// Operational skills: not research skills, so check-skills skips them and these checks apply instead.
export const OP_SKILLS = ['showrunner', 'book-rules', 'scene-context', 'proposal-format', 'style']
const COMMAND_KEYS = ['description', 'argument-hint', 'allowed-tools', 'disallowed-tools', 'model', 'effort', 'disable-model-invocation', 'user-invocable']

// A command file: description and argument-hint, a body that hands off to the showrunner (or book-rules) using 0-based arguments.
export function checkCommand(text) {
  const { fm, body, error } = frontmatter(text)
  if (error) return [error]
  const errors = []
  for (const k of Object.keys(fm)) if (!COMMAND_KEYS.includes(k)) errors.push(`frontmatter: key ${k} is not allowed`)
  if (typeof fm.description !== 'string' || fm.description.length < 20) errors.push('description shorter than 20 characters')
  if (typeof fm['argument-hint'] !== 'string' || !fm['argument-hint'].trim()) errors.push('argument-hint missing')
  if (!/\b(showrunner|book-rules)\b/.test(body)) errors.push('body does not reference the showrunner or book-rules skill')
  if (!/\$(ARGUMENTS|0)\b/.test(body)) errors.push('body uses neither $ARGUMENTS nor $0')
  if (/\$[1-9]\b/.test(body) && !/\$0\b/.test(body)) errors.push('arguments are 0-based: $1 without $0')
  return [...errors, ...lineProblems(text)]
}

// An operational skill: name matching its folder and a description long enough to trigger on.
export function checkOpSkill(text, dir) {
  const { fm, body, error } = frontmatter(text)
  if (error) return [error]
  const errors = []
  if (fm.name !== dir) errors.push(`name "${fm.name}" does not match folder "${dir}"`)
  if (typeof fm.description !== 'string' || fm.description.length < 40) errors.push('description shorter than 40 characters')
  if (!body.trim()) errors.push('body is empty')
  return [...errors, ...lineProblems(text)]
}

import { appendFileSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parseFrontmatter, Review } from '../../shared/schemas'
import { REVIEWER_ROLE } from '../../shared/crew'
import type { RoomEntry } from '../../shared/types'

// Display only, like spend.jsonl: nothing decides anything from the room (ruling R11).
export const ROOM_TEXT = 600
const file = (bookDir: string) => join(bookDir, 'run', 'room.jsonl')
export const clip = (s: string): string => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > ROOM_TEXT ? `${t.slice(0, ROOM_TEXT - 1)}…` : t
}
const ROLE = /^[a-z][a-z-]{1,40}$/
const VERDICT = /^(PASS|FLAG|FAIL)\b/
type Block = { type?: unknown; text?: unknown; id?: unknown; name?: unknown; input?: { subagent_type?: unknown; prompt?: unknown; description?: unknown } | null; tool_use_id?: unknown; content?: unknown }

/** A subagent's report without Claude Code's hand-back frame: the indented lines after "The report follows:", dedented
 *  (the agentId and usage trailer at column zero are dropped). Text with no frame is kept as it is. */
export function unframe(text: string): string {
  if (!text.startsWith('[Subagent hand-back]')) return text
  const m = text.match(/The report follows:[^\n]*\n/)
  if (!m) return text
  const lines = text.slice(m.index! + m[0].length).split('\n')
  const end = lines.findIndex(l => l.trim() && !/^\s/.test(l))
  return (end < 0 ? lines : lines.slice(0, end)).map(l => l.replace(/^ {2}/, '')).join('\n')
}

/** One stream-json line of a step's main session as room entries. `agents` pairs each Agent call with its reply. */
export function roomFromEvent(step: string, v: unknown, agents: Map<string, string>, at: string): RoomEntry[] {
  const e = v as { type?: unknown; parent_tool_use_id?: unknown; message?: { content?: unknown } } | null
  const out: RoomEntry[] = []
  const reply = (id: string, raw: string): void => {
    const role = agents.get(id)!
    agents.delete(id)
    const text = clip(raw)
    const verdict = text.match(VERDICT)?.[1] as RoomEntry['verdict'] | undefined
    out.push({ at, step, from: role, to: 'showrunner', kind: 'reply', ...(verdict ? { verdict } : {}), text })
  }
  // A background agent's tool result is only a launch notice (kept as `bg:<id>`); its answer comes later in a
  // task_notification system line whose summary is the agent's final text (Claude Code 2.1.296, probed).
  const n = v as { type?: unknown; subtype?: unknown; tool_use_id?: unknown; summary?: unknown } | null
  if (n?.type === 'system' && n.subtype === 'task_notification' && agents.has(`bg:${n.tool_use_id}`)) {
    reply(`bg:${n.tool_use_id}`, typeof n.summary === 'string' ? n.summary : '')
    return out
  }
  if (!e || typeof e !== 'object' || (e.type !== 'assistant' && e.type !== 'user')) return []
  if (e.parent_tool_use_id) return [] // a subagent's own turns: the room shows what it was asked and what it answered
  const blocks = Array.isArray(e.message?.content) ? (e.message!.content as Block[]) : []
  for (const b of blocks) {
    if (!b || typeof b !== 'object') continue
    if (e.type === 'assistant' && b.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
      out.push({ at, step, from: 'showrunner', kind: 'say', text: clip(b.text) })
    } else if (e.type === 'assistant' && b.type === 'tool_use' && (b.name === 'Agent' || b.name === 'Task') && typeof b.id === 'string') {
      const sub = b.input?.subagent_type
      const role = typeof sub === 'string' && ROLE.test(sub) ? sub : 'agent'
      agents.set(b.id, role)
      const ask = typeof b.input?.prompt === 'string' ? b.input.prompt : typeof b.input?.description === 'string' ? b.input.description : ''
      out.push({ at, step, from: 'showrunner', to: role, kind: 'dispatch', text: clip(ask) })
    } else if (e.type === 'user' && b.type === 'tool_result' && typeof b.tool_use_id === 'string' && agents.has(b.tool_use_id)) {
      const raw = typeof b.content === 'string' ? unframe(b.content)
        : Array.isArray(b.content) ? (b.content as Block[]).filter(c => c?.type === 'text' && typeof c.text === 'string').map(c => unframe(c.text as string)).join('\n') : ''
      if (!raw.startsWith('Async agent launched')) reply(b.tool_use_id, raw)
      else { agents.set(`bg:${b.tool_use_id}`, agents.get(b.tool_use_id)!); agents.delete(b.tool_use_id) }
    }
  }
  return out
}

/** One entry per review file of the step's target written since the step began: its verdict and first FAIL or FLAG finding. */
export function reviewEntries(bookDir: string, step: string, sinceMs: number, at: string): RoomEntry[] {
  const dir = join(bookDir, 'reviews', step)
  let names: string[]
  try { names = readdirSync(dir) } catch { return [] } // no reviews for this step
  return names.filter(n => /^[a-z-]+\.md$/.test(n) && n !== 'park.md').sort().flatMap(n => {
    try {
      if (statSync(join(dir, n)).mtimeMs < sinceMs) return []
      const fm = parseFrontmatter(readFileSync(join(dir, n), 'utf8'))
      const r = fm ? Review.safeParse(fm.data) : null
      if (!fm || !r?.success || r.data.scene !== step) return []
      // An early gate (no reviews stage) always carries GATE-REV-00's FAIL; judge it by its other findings, as the showrunner does.
      const early = r.data.reviewer === 'gate' && fm.body.includes('GATE-REV-00')
      const findings = fm.body.split(/^(?=\d+\. (?:FAIL|FLAG)\.)/m).filter(f => /^\d+\. (FAIL|FLAG)\./.test(f) && !(early && f.includes('GATE-REV-00')))
      const verdict = !early ? r.data.verdict : findings.some(f => /^\d+\. FAIL/.test(f)) ? 'FAIL' : findings.length ? 'FLAG' : 'PASS'
      const finding = findings.length ? findings[0].split(/\r?\n/).slice(0, 3).join(' ') : 'No findings.'
      return [{ at, step, from: REVIEWER_ROLE[r.data.reviewer], kind: 'review' as const, verdict, text: clip(`Round ${r.data.round}. ${finding.replace(/^\d+\. (FAIL|FLAG)\.\s*/, '')}`) }]
    } catch {
      return [] // a file mid-write costs only its own bubble
    }
  })
}

export function appendRoom(bookDir: string, entries: RoomEntry[]): void {
  if (!entries.length) return
  mkdirSync(join(bookDir, 'run'), { recursive: true })
  appendFileSync(file(bookDir), entries.map(e => JSON.stringify(e)).join('\n') + '\n')
}

const KINDS: RoomEntry['kind'][] = ['say', 'dispatch', 'reply', 'review', 'system']
const VERDICTS = ['PASS', 'FLAG', 'FAIL']
// ponytail: the file is never trimmed and is read whole; trim it at book open if runs make it large.
export function readRoom(bookDir: string, max = 2000): RoomEntry[] {
  let text: string
  try { text = readFileSync(file(bookDir), 'utf8') } catch { return [] }
  return text.split('\n').flatMap((line): RoomEntry[] => {
    try {
      const e = JSON.parse(line)
      if (!e || typeof e.at !== 'string' || typeof e.step !== 'string' || typeof e.from !== 'string' || !KINDS.includes(e.kind) || typeof e.text !== 'string') return []
      return [{ at: e.at, step: e.step, from: e.from, ...(typeof e.to === 'string' ? { to: e.to } : {}), kind: e.kind,
        ...(VERDICTS.includes(e.verdict) ? { verdict: e.verdict } : {}), text: e.text.slice(0, ROOM_TEXT), ...(e.needsYou === true ? { needsYou: true as const } : {}) }]
    } catch { return [] }
  }).slice(-max)
}

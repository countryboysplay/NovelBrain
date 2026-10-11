import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseFrontmatter } from '../shared/schemas'
import { CREW_ROLES, type CrewMember, type CrewState } from '../shared/crew'
import { STORY_ID, nameTerms, wholeWord } from './memory/validate'

export const SVG_MAX = 8192
const TAGS = new Set(['svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'linearGradient', 'radialGradient', 'stop', 'defs', 'title'])
const ATTRS = new Set(['d', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'width', 'height', 'points', 'fill', 'stroke', 'stroke-width',
  'stroke-linecap', 'stroke-linejoin', 'opacity', 'fill-opacity', 'stroke-opacity', 'transform', 'viewBox', 'xmlns', 'id', 'offset', 'stop-color',
  'stop-opacity', 'gradientUnits', 'gradientTransform'])
// One tag (quoted attributes only) or one run of text, matched where the last one ended.
const TOKEN = /<(\/?)([A-Za-z][\w:-]*)((?:\s+[^\s=<>/]+\s*=\s*(?:"[^"<>]*"|'[^'<>]*'))*)\s*(\/?)>|([^<]+)/y
const ATTR = /([^\s=<>/]+)\s*=\s*(?:"([^"<>]*)"|'([^'<>]*)')/g

/** Null when the SVG is safe to show as an <img>; otherwise the first reason it is not. Allow-list only. */
export function svgProblem(svg: unknown): string | null {
  if (typeof svg !== 'string' || !svg.trim()) return 'no SVG'
  if (Buffer.byteLength(svg, 'utf8') > SVG_MAX) return `SVG over ${SVG_MAX} bytes`
  if (/<!|<\?|&(?!amp;|lt;|gt;|quot;|#39;)/.test(svg)) return 'SVG has a DOCTYPE, entity, comment or processing instruction'
  const s = svg.trim()
  const stack: string[] = []
  let roots = 0
  TOKEN.lastIndex = 0
  while (TOKEN.lastIndex < s.length) {
    const m = TOKEN.exec(s)
    if (!m) return 'SVG does not parse'
    const [, close, tag, attrs, selfClose, text] = m
    if (text !== undefined) {
      if (text.trim() && stack.at(-1) !== 'title') return 'text outside <title>'
      continue
    }
    if (!TAGS.has(tag)) return `element <${tag}> is not allowed`
    if (close) {
      if (attrs.trim() || selfClose || stack.pop() !== tag) return 'SVG tags do not match'
      continue
    }
    if (!stack.length && (roots++ || tag !== 'svg')) return 'SVG must be one <svg> element'
    if (stack.at(-1) === 'title') return 'elements inside <title>'
    for (const [, name, dq, sq] of attrs.matchAll(ATTR)) {
      const value = dq ?? sq ?? ''
      if (!ATTRS.has(name)) return `attribute ${name} is not allowed`
      if (/url\(/i.test(value) && !/^url\(#[A-Za-z][\w-]*\)$/.test(value.trim())) return 'url() may only point inside the SVG'
      if (/javascript:|data:|expression\(/i.test(value)) return `attribute ${name} has a script or data value`
      if (name === 'xmlns' && value !== 'http://www.w3.org/2000/svg') return 'wrong SVG namespace'
    }
    if (!selfClose) stack.push(tag)
  }
  if (stack.length || roots !== 1) return 'SVG tags do not match'
  if (!/^<svg\b[^>]*\sviewBox=["']0 0 64 64["']/.test(s)) return 'the <svg> needs viewBox="0 0 64 64"'
  return null
}

const NAME = /^[A-Za-z][A-Za-z' -]{0,19}$/
// Whole words, full names and their capitalised parts (the memory validator's terms). A crew name matches in any case;
// an about line only as written, as memory does, so an ordinary word ("will", "hope") never clashes with a character.
const bibleHit = (text: string, bible: string[], flags = 'iu'): string | undefined => nameTerms(bible).find(n => wholeWord(n, flags).test(text))

export function nameProblem(name: unknown, others: string[], bible: string[]): string | null {
  if (typeof name !== 'string' || !NAME.test(name) || name.trim() !== name) return 'A name is 1 to 20 letters, spaces, hyphens or apostrophes'
  if (others.some(o => o.toLowerCase() === name.toLowerCase())) return `${name} is already in the crew`
  const hit = bibleHit(name, bible)
  return hit ? `${name} matches ${hit} in this book's bible` : null
}
export function aboutProblem(about: unknown, bible: string[]): string | null {
  if (typeof about !== 'string' || !/^[^<>\r\n]{1,140}$/.test(about)) return 'about must be one plain line of at most 140 characters'
  if (STORY_ID.test(about)) return 'about names a story id'
  const hit = bibleHit(about, bible, 'u')
  return hit ? `about names ${hit}` : null
}

/** The portrait call: the role as context only; how it looks is the agent's own choice (owner ruling). */
export const crewPrompt = (role: string, description: string): string => `CREW
You are one member of Novel Brain's writers' room, a team of Claude agents that write novels together. Who you are, in the words of your job description:

${description}

Draw what you think you look like: a self-portrait from your own imagination. How you look is entirely up to you. Then choose a first name for yourself, and write one sentence about yourself in your own words.

Reply with one line of JSON and nothing after it: {"name": "...", "about": "...", "svg": "..."}
- name: one first name, 1 to 20 letters (spaces, hyphens and apostrophes allowed).
- about: one sentence, at most 140 characters, plain text.
- svg: one <svg> element with xmlns="http://www.w3.org/2000/svg" and viewBox="0 0 64 64", at most 8,000 bytes, using only svg, g, path, circle, ellipse, rect, line, polyline, polygon, linearGradient, radialGradient, stop, defs and title, with geometry, fill, stroke, opacity and gradient attributes only: no text elements, no style, no images, no links, no scripts.
Role: ${role}
`

export function parseCrewReply(result: string): { name: string; about: string; svg: string } | null {
  for (const raw of result.split(/\r?\n/).reverse()) {
    const line = raw.trim().replace(/^`+|`+$/g, '')
    if (!line.startsWith('{')) continue
    try {
      const v = JSON.parse(line)
      if (typeof v?.name === 'string' && typeof v.about === 'string' && typeof v.svg === 'string') return { name: v.name.trim(), about: v.about.trim(), svg: v.svg }
    } catch {
      // not JSON; keep looking upward
    }
  }
  return null
}

/** The role's own description from the kit: the agent file's, or the showrunner skill's. */
export function roleDescription(kitDir: string, role: string): string | null {
  const file = role === 'showrunner' ? join(kitDir, 'skills', 'showrunner', 'SKILL.md') : join(kitDir, 'agents', `${role}.md`)
  try {
    const d = (parseFrontmatter(readFileSync(file, 'utf8'))?.data as { description?: unknown } | null)?.description
    return typeof d === 'string' ? d : null
  } catch {
    return null
  }
}

export type CrewCall = (prompt: string) => Promise<{ result: string; costUsd: number; model: string }>
interface Saved { name: string; about: string; made: string; model: string; renamed?: boolean }
interface CrewFile { members: Record<string, Saved>; spentUsd: number }
const isRole = (role: string) => CREW_ROLES.some(r => r.role === role)

/** App-wide crew in <userData>/crew: crew.json and one <role>.svg each. Display only; nothing decides anything from it. */
export class Crew {
  private making: Promise<void> | null = null
  constructor(private o: { dir: string; call: CrewCall; describe: (role: string) => string | null; bible: () => string[]; onChange: () => void; log: (l: string) => void }) {}

  private read(): CrewFile {
    try {
      const v = JSON.parse(readFileSync(join(this.o.dir, 'crew.json'), 'utf8'))
      return { members: v?.members && typeof v.members === 'object' ? v.members : {}, spentUsd: Number.isFinite(v?.spentUsd) ? v.spentUsd : 0 }
    } catch {
      return { members: {}, spentUsd: 0 }
    }
  }
  private write(f: CrewFile): void {
    mkdirSync(this.o.dir, { recursive: true })
    const p = join(this.o.dir, 'crew.json')
    writeFileSync(`${p}.tmp`, JSON.stringify(f, null, 2))
    renameSync(`${p}.tmp`, p)
  }
  // Re-validated on every read: a hand-edited file falls back to initials.
  private svg(role: string): string | null {
    const p = join(this.o.dir, `${role}.svg`)
    if (!existsSync(p)) return null
    const s = readFileSync(p, 'utf8')
    return svgProblem(s) ? null : s
  }

  state(): CrewState {
    const f = this.read(), bible = this.o.bible()
    const members = CREW_ROLES.map(({ role, label }) => {
      const m = f.members[role]
      const ok = !!m && !nameProblem(m.name, [], []) && !aboutProblem(m.about, []) // shape only: a clash is shown, not hidden
      const svg = ok ? this.svg(role) : null
      return {
        role, label, name: ok ? m.name : null, about: ok ? m.about : null,
        avatar: svg ? `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}` : null,
        clash: (!ok ? false : bibleHit(m.name, bible) ? 'name' : aboutProblem(m.about, bible) ? 'about' : false) as CrewMember['clash'], renamed: !!m?.renamed
      }
    })
    return { members, spentUsd: f.spentUsd, making: !!this.making }
  }

  /** Draws every member without a valid portrait, one call each; a failure leaves initials and is tried again next start. */
  ensure(): Promise<void> {
    this.making ??= (async () => {
      for (const { role } of CREW_ROLES) {
        if (this.state().members.find(m => m.role === role)?.avatar) continue
        await this.make(role).then(() => this.o.onChange(), e => this.o.log(`crew: ${role} not drawn: ${e instanceof Error ? e.message : String(e)}`))
      }
    })().finally(() => { this.making = null; this.o.onChange() })
    return this.making
  }

  redraw(role: string): Promise<void> {
    if (!isRole(role)) return Promise.reject(new Error('Unknown role'))
    if (this.making) return Promise.reject(new Error('The crew is being drawn; try again in a moment.'))
    this.making = this.make(role).finally(() => { this.making = null; this.o.onChange() })
    return this.making
  }

  rename(role: string, name: unknown): void {
    if (!isRole(role)) throw new Error('Unknown role')
    if (this.making) throw new Error('The crew is being drawn; try again in a moment.')
    const f = this.read(), m = f.members[role]
    if (!m) throw new Error('This member has not drawn itself yet.')
    const bad = nameProblem(name, Object.entries(f.members).filter(([k]) => k !== role).map(([, v]) => v.name), this.o.bible())
    if (bad) throw new Error(bad)
    f.members[role] = { ...m, name: name as string, renamed: true }
    this.write(f)
    this.o.onChange()
  }

  private async make(role: string): Promise<void> {
    const description = this.o.describe(role)
    if (!description) throw new Error('no role description in the kit')
    const r = await this.o.call(crewPrompt(role, description))
    const f = this.read()
    f.spentUsd += r.costUsd // paid for even when the reply is unusable
    this.write(f)
    const reply = parseCrewReply(r.result)
    if (!reply) throw new Error('the reply had no {name, about, svg} line')
    const prev = f.members[role], bible = this.o.bible()
    const name = prev?.renamed ? prev.name : reply.name // a writer's rename survives a redraw
    const others = Object.entries(f.members).filter(([k]) => k !== role).map(([, v]) => v.name)
    const bad = svgProblem(reply.svg) ?? (prev?.renamed ? null : nameProblem(name, others, bible)) ?? aboutProblem(reply.about, bible)
    if (bad) throw new Error(bad)
    writeFileSync(join(this.o.dir, `${role}.svg`), reply.svg)
    f.members[role] = { name, about: reply.about, made: new Date().toISOString(), model: r.model, ...(prev?.renamed ? { renamed: true } : {}) }
    this.write(f)
  }
}

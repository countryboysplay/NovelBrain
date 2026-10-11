import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { ID, parseFrontmatter as parseBible, parseYamlText } from '../../shared/schemas'
import { parseFrontmatter, readMemory } from './files'
import { git, STATE_FILES } from './store'

// Whole token shapes, not bare prefixes: "risk-free" must not trip the scan.
export const SECRET =
  /\bsk-[A-Za-z0-9_-]{20,}|\bghp_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{30,}|\bAKIA[0-9A-Z]{16}\b|\bxox[bp]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/
// Every canon and outline id shape in schemas.ts, unanchored.
export const STORY_ID = new RegExp(Object.values(ID).map(r => String.raw`\b(?:${r.source.slice(1, -1)})\b`).join('|'))
export const MEMORY = /^(user\.md|topics\/[^/]+\.md|(series|books)\/[^/]+\/topics\/[^/]+\.md)$/
/** A lesson path from outside (the renderer): a memory location with no traversal, backslash or drive/stream colon. */
export const isLessonFile = (v: unknown): v is string => typeof v === 'string' && MEMORY.test(v) && !/\.\.|\\|:/.test(v)
const SKILL = /^inbox\/([a-z0-9]+(?:-[a-z0-9]+)*)\/SKILL\.md$/
// Capitalised words too common to count as a name on their own ("The north field").
const STOP = new Set(['The', 'And', 'Old', 'New', 'Saint', 'Lord', 'Lady', 'Mister', 'Miss'])

export function bibleNames(bookDir: string): string[] {
  return ['characters', 'places'].flatMap(d => {
    const dir = join(bookDir, 'bible', d)
    if (!existsSync(dir)) return []
    return readdirSync(dir).filter(f => f.endsWith('.md')).flatMap(f => {
      try {
        const name = (parseBible(readFileSync(join(dir, f), 'utf8'))?.data as { name?: unknown } | null)?.name
        return typeof name === 'string' && name.length >= 3 ? [name] : []
      } catch {
        return [] // a bad file costs only its own name
      }
    })
  })
}

export async function changedFiles(root: string): Promise<string[]> {
  const out = await git(root, '-c', 'core.excludesFile=', 'status', '--porcelain', '-uall', '-z', '--no-renames', '--ignored=matching')
  return out
    .split('\0')
    .filter(Boolean)
    .filter(e => !(e.startsWith('!! ') && STATE_FILES.includes(e.slice(3))))
    .map(e => e.slice(3))
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// Case-sensitive whole words: "Mara" and "Mara Quill" match, "every" does not match "Eve".
export const nameTerms = (names: string[]): string[] => {
  const words = names.flatMap(n => n.split(/\s+/).filter(w => w.length >= 3 && /^\p{Lu}/u.test(w) && !STOP.has(w)))
  return [...names.map(n => n.trim().replace(/\s+/g, ' ')), ...words]
}
export const wholeWord = (n: string, flags: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(n)}(?![\\p{L}\\p{N}])`, flags)
function nameHit(text: string, names: string[]): string | undefined {
  const flat = text.replace(/\s+/g, ' ')
  return nameTerms(names).find(n => wholeWord(n, 'u').test(flat))
}

/** Model text bound for the memory repo's log and commits (no story facts in memory): story ids and bible names, full names first, become "[name]". */
export function scrub(text: string, names: string[]): string {
  const flat = text.replace(/\s+/g, ' ').replace(new RegExp(STORY_ID.source, 'g'), '[name]')
  return nameTerms(names).reduce((t, n) => t.replace(wholeWord(n, 'gu'), '[name]'), flat)
}

export function problems(root: string, files: string[], names: string[], rejected: string[]): string[] {
  const out: string[] = []
  for (const f of files) {
    const skill = SKILL.exec(f)
    if (!skill && !MEMORY.test(f)) {
      out.push(`${f}: not a memory file location`)
      continue
    }
    const full = join(root, f)
    if (!existsSync(full)) continue // deleting a memory or a proposal is allowed
    const text = readFileSync(full, 'utf8')
    if (SECRET.test(text)) out.push(`${f}: looks like it contains a secret`)
    const id = STORY_ID.exec(text)
    if (id) out.push(`${f}: story fact (${id[0]}); story facts belong to canon`)
    // Writer-wide lessons and skills apply to every book, so they may not name this book's people or places (R7).
    if (skill || /^(user\.md|topics\/)/.test(f)) {
      const hit = nameHit(text, names)
      if (hit) out.push(`${f}: story fact (${hit}); writer lessons and skills may not name the book's characters or places`)
    }
    if (skill) {
      const fm = parseFrontmatter(text)
      // Claude Code reads the block as YAML, so the keys must come from a real YAML parse (quoted keys count).
      let keys: string[] | null = null
      try {
        const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1]
        const data = block === undefined ? null : parseYamlText(block)
        if (data && typeof data === 'object' && !Array.isArray(data)) keys = Object.keys(data)
      } catch {
        keys = null
      }
      if (!fm || !keys || fm.raw.name !== skill[1] || typeof fm.raw.description !== 'string' || !fm.raw.description)
        out.push(`${f}: a skill needs name (same as its folder) and description`)
      else if (keys.some(k => k !== 'name' && k !== 'description')) out.push(`${f}: a skill may hold only name and description in its frontmatter`)
      else if (rejected.includes(skill[1])) out.push(`${f}: ${skill[1]} was rejected before`)
    } else if (!readMemory(full)) out.push(`${f}: missing or invalid frontmatter`)
    // Body lines only: the frontmatter block never pushes a file over.
    if (text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').split('\n').length > 200) out.push(`${f}: over 200 lines`)
  }
  return out
}

// -ff removes nested repos and -x removes ignored files; only the root state files survive.
// reset first: after commit()'s `add -A` a failed commit leaves the changes staged, and checkout restores from the index.
export async function rollback(root: string): Promise<void> {
  await git(root, 'reset', '-q')
  await git(root, 'checkout', '--', '.')
  await git(root, 'clean', '-ffdxq', ...STATE_FILES.flatMap(f => ['-e', `/${f}`]))
}

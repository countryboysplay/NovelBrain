import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { parseFrontmatter, parseYamlText, schemaFor } from '../../shared/schemas'

export interface BookError { file: string; message: string }

const SKIP = new Set(['.git', '.claude', '.novelbrain', 'node_modules', 'exports', 'run'])

const isFile = (p: string) => { try { return statSync(p).isFile() } catch { return false } }
const code = (e: unknown) => (e as NodeJS.ErrnoException).code ?? 'unknown'

// Symlinks and junctions are never followed: no loops, no escapes from the book folder.
function walk(root: string, err: (file: string, message: string) => void, dir = root, out: string[] = []): string[] {
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch (e) {
    err(relative(root, dir).split(sep).join('/') || '.', `could not be read: ${code(e)}`)
    return out
  }
  for (const ent of entries) {
    if (SKIP.has(ent.name) || ent.isSymbolicLink()) continue
    const full = join(dir, ent.name)
    if (ent.isDirectory()) walk(root, err, full, out)
    else out.push(relative(root, full).split(sep).join('/'))
  }
  return out
}

export function validateBook(dir: string): BookError[] {
  const errors: BookError[] = []
  const err = (file: string, message: string) => errors.push({ file, message })
  const data = new Map<string, any>()

  if (!existsSync(join(dir, 'book.yaml'))) err('book.yaml', 'missing')

  for (const rel of walk(dir, err)) {
    const rule = schemaFor(rel)
    if (!rule) continue
    let raw: string
    try { raw = readFileSync(join(dir, rel), 'utf8') } catch (e) { err(rel, `could not be read: ${code(e)}`); continue }
    let value: unknown
    try {
      if (rule.frontmatter) {
        const fm = parseFrontmatter(raw)
        if (!fm) { err(rel, 'missing frontmatter block'); continue }
        value = fm.data
      } else value = parseYamlText(raw)
    } catch (e) {
      err(rel, `YAML could not be read: ${(e as Error).message.split('\n')[0]}`)
      continue
    }
    const r = rule.schema.safeParse(value)
    if (!r.success) {
      for (const issue of r.error.issues) err(rel, `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      continue
    }
    data.set(rel, r.data)
  }

  const chars = new Set<string>(), places = new Set<string>(), facts = new Set<string>()
  for (const [rel, v] of data) {
    if (rel.startsWith('bible/characters/')) chars.add(v.id)
    if (rel.startsWith('bible/places/')) places.add(v.id)
    const want = rel.match(/(CHAR-[A-Z0-9-]+|LOC-[A-Z0-9-]+|SC-\d+)\.(md|yaml)$/)?.[1]
    if (want && v.id !== want) err(rel, `id ${v.id} does not match its file name`)
  }
  const factList: any[] = data.get('canon/facts.yaml')?.facts ?? []
  for (const f of factList) {
    if (facts.has(f.id)) err('canon/facts.yaml', `${f.id} appears more than once`)
    facts.add(f.id)
  }
  for (const f of factList) {
    if (f.supersedes === f.id) err('canon/facts.yaml', `${f.id} supersedes itself`)
    else if (f.supersedes && !facts.has(f.supersedes)) err('canon/facts.yaml', `${f.id} supersedes unknown ${f.supersedes}`)
  }

  const outline = data.get('outline/outline.yaml')
  for (const act of outline?.acts ?? [])
    for (const ch of act.chapters)
      for (const sc of ch.scenes)
        if (!isFile(join(dir, 'outline', 'scenes', `${sc}.yaml`))) err('outline/outline.yaml', `${sc} has no plan file`)

  for (const [rel, v] of data) {
    if (!rel.startsWith('outline/scenes/')) continue
    if (!chars.has(v.pov)) err(rel, `pov ${v.pov} is not a character in the bible`)
    if (!places.has(v.location)) err(rel, `location ${v.location} is not a place in the bible`)
    for (const a of v.arcBeats) if (!chars.has(a.character)) err(rel, `arc beat character ${a.character} is not in the bible`)
    for (const f of v.mustReveal) if (!facts.has(f)) err(rel, `mustReveal ${f} is not a canon fact`)
  }
  for (const e of data.get('canon/knowledge.yaml')?.entries ?? []) {
    if (!chars.has(e.character)) err('canon/knowledge.yaml', `${e.character} is not in the bible`)
    if (!facts.has(e.fact)) err('canon/knowledge.yaml', `${e.fact} is not a canon fact`)
  }
  return errors
}

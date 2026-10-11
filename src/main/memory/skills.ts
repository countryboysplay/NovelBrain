import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { parseYamlText } from '../../shared/schemas'
import { ensureIdentity, git as bookGit } from '../book/git'
import { parseFrontmatter, subdirs } from './files'
import { commit, pathKey } from './store'
import { problems } from './validate'

export interface Proposal { name: string; description: string; text: string }

const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/
function checkName(name: string): void {
  if (!NAME.test(name)) throw new Error('Invalid skill name')
}

export function listProposals(root: string): Proposal[] {
  return subdirs(join(root, 'inbox')).flatMap(name => {
    const file = join(root, 'inbox', name, 'SKILL.md')
    if (!NAME.test(name) || !existsSync(file)) return []
    const fm = parseFrontmatter(readFileSync(file, 'utf8'))
    const description = fm?.raw.description
    return fm && fm.raw.name === name && typeof description === 'string' && description ? [{ name, description, text: fm.body }] : []
  })
}

export function rejectedNames(root: string): string[] {
  try {
    return readFileSync(join(root, '.rejected'), 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean)
  } catch {
    return []
  }
}

export async function approveSkill(root: string, name: string): Promise<void> {
  checkName(name)
  const rel = `inbox/${name}/SKILL.md`
  if (!existsSync(join(root, rel))) throw new Error(`No proposed skill named ${name}`)
  const bad = problems(root, [rel], [], rejectedNames(root))
  if (bad.length) throw new Error(bad.join('\n'))
  const dest = join(root, 'skills', name)
  rmSync(dest, { recursive: true, force: true })
  mkdirSync(join(root, 'skills'), { recursive: true })
  renameSync(join(root, 'inbox', name), dest)
  await commit(root, `Approve skill ${name}`)
}

export async function rejectSkill(root: string, name: string): Promise<void> {
  checkName(name)
  rmSync(join(root, 'inbox', name), { recursive: true, force: true })
  if (!rejectedNames(root).includes(name)) appendFileSync(join(root, '.rejected'), `${name}\n`)
  await commit(root, `Reject skill ${name}`)
}

export async function syncSkills(root: string, bookDir: string): Promise<boolean> {
  try {
    const y = parseYamlText(readFileSync(join(bookDir, 'book.yaml'), 'utf8')) as { status?: unknown } | null
    if (y?.status !== 'active') return false
  } catch {
    return false // unreadable book.yaml: treat like the guard does, no writes
  }
  // The book must be its own repo; git -C would otherwise walk up and commit into an enclosing one.
  const top = await bookGit(bookDir, 'rev-parse', '--show-toplevel').catch(() => '')
  if (!top || pathKey(realpathSync.native(top)) !== pathKey(realpathSync.native(bookDir))) return false
  const skills = join(root, 'skills')
  const want = subdirs(skills).filter(n => NAME.test(n) && existsSync(join(skills, n, 'SKILL.md')))
  const dir = join(bookDir, '.claude', 'skills')
  for (const d of subdirs(dir)) {
    if (d.startsWith('learned-') && !want.includes(d.slice(8))) rmSync(join(dir, d), { recursive: true, force: true })
  }
  for (const n of want) {
    mkdirSync(join(dir, `learned-${n}`), { recursive: true })
    copyFileSync(join(skills, n, 'SKILL.md'), join(dir, `learned-${n}`, 'SKILL.md'))
  }
  // Explicit paths (git add has no --ignore-unmatch): the files written above plus every tracked learned-* file,
  // which covers the ones just deleted.
  const tracked = (await bookGit(bookDir, 'ls-files', '-z', '--', '.claude/skills'))
    .split('\0')
    .filter(p => /^\.claude\/skills\/learned-[^/]+\//.test(p))
  const paths = [...new Set([...want.map(n => `.claude/skills/learned-${n}/SKILL.md`), ...tracked])]
  if (!paths.length) return false
  await bookGit(bookDir, 'add', '-f', '-A', '--', ...paths)
  if (!(await bookGit(bookDir, 'status', '--porcelain', '--', ...paths))) return false
  await ensureIdentity(bookDir)
  await bookGit(bookDir, '-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '-m', 'Learned skills', '--', ...paths)
  return true
}

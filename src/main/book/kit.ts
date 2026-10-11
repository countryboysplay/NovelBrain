import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parse, stringify } from 'yaml'
import { BRIEFING } from '../memory/indexes'
import { git } from './git'

export const KIT_VERSION = '14'

const MANIFEST = join('.novelbrain', 'kit-manifest.json')

const walk = (root: string, rel = ''): string[] =>
  readdirSync(join(root, rel), { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(root, join(rel, e.name)) : [join(rel, e.name)])

// Copies the kit into the book. Files a previous install put in agents/commands/skills but the kit no longer has
// are removed (tracked by a manifest, so a writer's own files are left alone).
export function installKit(bookDir: string, kitDir: string, acceptBundle: string): void {
  const files: [string, string][] = [] // [source, book-relative destination]
  for (const d of ['agents', 'commands'])
    if (existsSync(join(kitDir, d))) for (const f of walk(join(kitDir, d))) files.push([join(kitDir, d, f), join('.claude', d, f)])
  const skills = join(kitDir, 'skills')
  for (const name of readdirSync(skills))
    if (existsSync(join(skills, name, 'SKILL.md')))
      for (const f of walk(join(skills, name))) files.push([join(skills, name, f), join('.claude', 'skills', name, f)])
  files.push([join(kitDir, 'settings.json'), join('.claude', 'settings.json')], [join(kitDir, 'CLAUDE.md'), 'CLAUDE.md'],
    [acceptBundle, join('.novelbrain', 'accept.mjs')])

  const manifest = join(bookDir, MANIFEST)
  const prev: string[] = existsSync(manifest) ? JSON.parse(readFileSync(manifest, 'utf8')) : []
  const next = files.map(([, to]) => to)
  for (const old of prev) if (!next.includes(old)) rmSync(join(bookDir, old), { force: true })
  for (const [from, to] of files) {
    mkdirSync(dirname(join(bookDir, to)), { recursive: true })
    cpSync(from, join(bookDir, to))
  }
  writeFileSync(manifest, JSON.stringify(next, null, 2))
}

const readMeta = (bookDir: string) => parse(readFileSync(join(bookDir, 'book.yaml'), 'utf8')) as Record<string, unknown>

export const kitNeedsUpgrade = (bookDir: string): boolean => readMeta(bookDir)?.kitVersion !== KIT_VERSION

export async function upgradeKit(bookDir: string, kitDir: string, acceptBundle: string): Promise<string> {
  const meta = readMeta(bookDir)
  if (meta.status === 'archived') throw new Error('Archived books keep their kit.')
  installKit(bookDir, kitDir, acceptBundle)
  writeFileSync(join(bookDir, 'book.yaml'), stringify({ ...meta, kitVersion: KIT_VERSION }))
  const ignore = join(bookDir, '.gitignore')
  const ignored = existsSync(ignore) ? readFileSync(ignore, 'utf8') : ''
  if (!ignored.split(/\r?\n/).includes(BRIEFING)) writeFileSync(ignore, `${ignored}${ignored && !ignored.endsWith('\n') ? '\n' : ''}${BRIEFING}\n`)
  // Explicit .novelbrain paths: a force-add of the folder would commit the git-ignored memory briefing.
  const paths = ['.claude/agents', '.claude/commands', '.claude/skills', '.claude/settings.json', 'CLAUDE.md', '.novelbrain/accept.mjs', '.novelbrain/kit-manifest.json', 'book.yaml', '.gitignore']
    .filter(p => existsSync(join(bookDir, p)))
  await git(bookDir, 'add', '-f', '--', ...paths)
  await git(bookDir, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', `Update kit to v${KIT_VERSION}`)
  return git(bookDir, 'rev-parse', '--short', 'HEAD')
}

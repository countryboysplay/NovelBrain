import { existsSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

// Resolve symlinks and junctions in the deepest existing ancestor, then re-append the rest.
function realish(p: string): string {
  const rest: string[] = []
  let cur = resolve(p)
  while (!existsSync(cur)) {
    const parent = dirname(cur)
    if (parent === cur) return resolve(p)
    rest.unshift(basename(cur))
    cur = parent
  }
  return join(realpathSync.native(cur), ...rest)
}

export function findBookRoot(start: string): string | null {
  let cur = realish(start)
  for (;;) {
    if (existsSync(join(cur, 'book.yaml'))) return cur
    const parent = dirname(cur)
    if (parent === cur) return null
    cur = parent
  }
}

export function resolveInBook(root: string, target: string): { inside: boolean; rel: string } {
  const outside = { inside: false, rel: '' }
  try {
    if (target.includes('\0')) return outside
    const realRoot = realish(root)
    const abs = realish(resolve(realRoot, target))
    const r = relative(realRoot, abs) // case-insensitive on Windows
    if (r === '' || r === '..' || r.startsWith('..' + sep) || isAbsolute(r)) return outside
    return { inside: true, rel: r.split(sep).join('/') }
  } catch {
    return outside // fail closed
  }
}

export const PROTECTED = ['canon/', 'manuscript/', 'run/', '.claude/', '.novelbrain/', '.git/', 'book.yaml', 'series.yaml',
  '.mcp.json', '.gitignore', '.gitattributes', 'package.json', 'node_modules/']

// Root-level launchers and scripts: a planted one could be run by the shell or Node from the book folder.
const ROOT_EXEC = /^[^/]+\.(cmd|bat|ps1|vbs|js|mjs|cjs|exe|com)$/i

// Only the app writes these: CLAUDE.md files persist instructions into later sessions (nested ones load too),
// and .gitattributes can change how acceptance stages files.
const APP_ONLY_NAMES = ['claude.md', 'claude.local.md', '.gitattributes']

const DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

export function isProtected(rel: string): boolean {
  const r = rel.toLowerCase()
  if (PROTECTED.some(p => (p.endsWith('/') ? r.startsWith(p) || r === p.slice(0, -1) : r === p))) return true
  if (ROOT_EXEC.test(rel) || r.split('/').some(s => s === '.git' || APP_ONLY_NAMES.includes(s))) return true
  // Windows strips trailing dots/spaces and treats ':' and device names specially: deny them outright.
  return rel.split(/[\/]/).some(s => s !== '.' && s !== '..' && s !== '' && (/[. ]$/.test(s) || s.includes(':') || DEVICE.test(s)))
}

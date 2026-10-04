import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parse, stringify } from 'yaml'
import { Book } from '../../shared/schemas'
import { newBook, NewBookOpts } from './create'
import { ensureIdentity, git } from './git'

const readBook = (dir: string): Record<string, unknown> => parse(readFileSync(join(dir, 'book.yaml'), 'utf8'))

function writeBook(dir: string, meta: Record<string, unknown>) {
  const p = Book.safeParse(meta)
  if (!p.success) throw new Error(p.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '))
  writeFileSync(join(dir, 'book.yaml'), stringify(meta)) // keep unknown keys as read
}

async function commitPaths(dir: string, message: string, paths: string[]): Promise<string> {
  await ensureIdentity(dir)
  await git(dir, 'add', '-f', '--', ...paths)
  await git(dir, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', message, '--', ...paths)
  return git(dir, 'rev-parse', '--short', 'HEAD')
}

function runIsRunning(dir: string): boolean {
  const f = join(dir, 'run', 'state.yaml')
  if (!existsSync(f)) return false
  try { return (parse(readFileSync(f, 'utf8')) as { status?: string } | null)?.status === 'running' } catch { return false }
}

export async function archiveBook(bookDir: string): Promise<string> {
  if (runIsRunning(bookDir)) throw new Error('A run is in progress. Stop it before archiving this book.')
  const meta = readBook(bookDir)
  writeBook(bookDir, { ...meta, status: 'archived' })
  return commitPaths(bookDir, `Archive ${meta.title}`, ['book.yaml'])
}

export async function createSequel(predecessorDir: string, opts: NewBookOpts, kitDir: string, hooksDir: string, acceptBundle: string): Promise<string> {
  const pred = readBook(predecessorDir)
  if (pred.status !== 'archived') throw new Error('Archive the previous book before starting a sequel.')
  const dir = await newBook(dirname(predecessorDir), opts, kitDir, hooksDir, acceptBundle)
  const predFolder = String(pred.id)
  writeBook(dir, { ...readBook(dir), predecessor: predFolder, series: (pred.series as string | null) ?? predFolder })
  for (const d of ['characters', 'places', 'world']) cpSync(join(predecessorDir, 'bible', d), join(dir, 'bible', d), { recursive: true })
  writeFileSync(join(dir, 'notes', 'predecessor.md'),
    `# Predecessor\n\nThis book follows "${pred.title}", in the folder \`../${predFolder}/\`. Its \`canon/\` is read-only reference: read it, never copy it into this book's canon.\n`)
  await commitPaths(dir, `Start sequel to ${pred.title}`, ['book.yaml', 'bible', 'notes/predecessor.md'])
  return dir
}

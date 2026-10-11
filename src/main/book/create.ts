import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { stringify } from 'yaml'
import { AUDIENCES, Book, GENRES } from '../../shared/schemas'
import { commitAll, ensureIdentity, git } from './git'
import { installKit, KIT_VERSION } from './kit'
import { writeBookSettings } from './settings'

export interface NewBookOpts {
  title: string
  audience: (typeof AUDIENCES)[number]
  genres: (typeof GENRES)[number][]
  wordTarget: number
}

export const slugify = (title: string) =>
  title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

const DIRS = ['bible/characters', 'bible/places', 'bible/world', 'outline/scenes', 'canon', 'manuscript', 'drafts', 'proposals', 'reviews', 'notes', 'art']

const GITIGNORE = ['exports/', 'run/', '.claude/settings.local.json', '.novelbrain/memory.md', ''].join('\n')

export async function newBook(parentDir: string, opts: NewBookOpts, kitDir: string, hooksDir: string, acceptBundle: string): Promise<string> {
  const id = slugify(opts.title)
  if (!id) throw new Error('The title needs at least one letter or digit.')
  const meta = { id, title: opts.title.trim(), status: 'active', audience: opts.audience, genres: opts.genres,
    series: null, predecessor: null, wordTarget: opts.wordTarget, kitVersion: KIT_VERSION }
  const parsed = Book.safeParse(meta)
  if (!parsed.success) throw new Error(parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '))
  const dir = join(parentDir, id)
  if (existsSync(dir)) throw new Error(`${dir} already exists.`)

  try {
    for (const d of DIRS) mkdirSync(join(dir, d), { recursive: true })
    for (const d of ['manuscript', 'drafts', 'proposals', 'reviews', 'notes', 'art', 'bible/characters', 'bible/places', 'bible/world', 'outline/scenes'])
      writeFileSync(join(dir, d, '.gitkeep'), '')
    writeFileSync(join(dir, 'book.yaml'), stringify(parsed.data))
    writeFileSync(join(dir, 'outline', 'outline.yaml'), stringify({ acts: [] }))
    writeFileSync(join(dir, 'canon', 'facts.yaml'), stringify({ facts: [] }))
    writeFileSync(join(dir, 'canon', 'timeline.yaml'), stringify({ events: [] }))
    writeFileSync(join(dir, 'canon', 'knowledge.yaml'), stringify({ entries: [] }))
    writeFileSync(join(dir, '.gitignore'), GITIGNORE)

    installKit(dir, kitDir, acceptBundle)
    writeBookSettings(dir, hooksDir)

    await git(dir, 'init', '-q')
    await ensureIdentity(dir)
    await commitAll(dir, `Create ${parsed.data.title}`)
    return dir
  } catch (e) {
    rmSync(dir, { recursive: true, force: true })
    throw e
  }
}

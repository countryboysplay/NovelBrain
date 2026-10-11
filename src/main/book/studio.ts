import { lstatSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { z } from 'zod'
import { Book, Character, Facts, Knowledge, MAX_SCENE_BYTES, OpenQuestions, Outline, Park, Place, Review, ScenePlan, Timeline, parseFrontmatter, parseYamlText } from '../../shared/schemas'
import { countWords, type ManuscriptScene, type SceneDetail, type SceneInfo, type StudioData, type Verdict } from '../../shared/studio'
import { readSpend } from '../run/state'
import { git } from './git'

const MAX = 2 * MAX_SCENE_BYTES // house setting: the studio reads no single file over 2 MB

// Claude writes most of these files, so they are untrusted: regular files only (never a link or junction), bounded, schema-checked.
// Path of a regular, bounded, link-free file; null otherwise.
export function safeFile(dir: string, rel: string): string | null {
  try {
    let p = dir
    for (const part of rel.split('/')) { p = join(p, part); if (lstatSync(p).isSymbolicLink()) return null }
    const st = lstatSync(p)
    return st.isFile() && st.size <= MAX ? p : null
  } catch { return null }
}
function text(dir: string, rel: string): string | null {
  const p = safeFile(dir, rel)
  try { return p === null ? null : readFileSync(p, 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n') } catch { return null }
}
function yaml<T>(dir: string, rel: string, schema: z.ZodType<T>): T | null {
  const t = text(dir, rel)
  if (t === null) return null
  try { const r = schema.safeParse(parseYamlText(t)); return r.success ? r.data : null } catch { return null }
}
function front<T>(dir: string, rel: string, schema: z.ZodType<T>): (T & { body: string }) | null {
  const t = text(dir, rel)
  if (t === null) return null
  try {
    const fm = parseFrontmatter(t)
    const r = fm ? schema.safeParse(fm.data) : null
    return fm && r?.success ? { ...r.data, body: fm.body.trim() } : null
  } catch { return null }
}
const list = (dir: string, rel: string, re: RegExp): string[] => {
  try { return readdirSync(join(dir, rel)).filter(n => re.test(n)).sort() } catch { return [] }
}
function reviews(dir: string, id: string): (Verdict & { body: string })[] {
  return list(dir, `reviews/${id}`, /^[a-z-]+\.md$/).filter(n => n !== 'park.md').flatMap(n => {
    const r = front(dir, `reviews/${id}/${n}`, Review)
    return r && r.scene === id ? [{ reviewer: r.reviewer, verdict: r.verdict, round: r.round, body: r.body }] : []
  })
}
const park = (dir: string, id: string) => front(dir, `reviews/${id}/park.md`, Park)?.reason ?? null
const outlineOf = (dir: string) => yaml(dir, 'outline/outline.yaml', Outline) ?? { acts: [] }
export const outlineSceneIds = (dir: string) => outlineOf(dir).acts.flatMap(a => a.chapters.flatMap(c => c.scenes))
export const sceneCount = (dir: string) => outlineSceneIds(dir).length

export async function readStudio(dir: string): Promise<StudioData> {
  const outline = outlineOf(dir)
  const scenes: Record<string, SceneInfo> = {}
  for (const id of outline.acts.flatMap(a => a.chapters.flatMap(c => c.scenes))) {
    const ms = text(dir, `manuscript/${id}.md`)
    scenes[id] = {
      plan: yaml(dir, `outline/scenes/${id}.yaml`, ScenePlan),
      words: ms === null ? 0 : countWords(ms),
      accepted: ms !== null,
      hasDraft: safeFile(dir, `drafts/${id}.md`) !== null,
      verdicts: reviews(dir, id).map(({ body: _, ...v }) => v),
      park: park(dir, id)
    }
  }
  const [commits, porcelain] = await Promise.all([
    git(dir, 'rev-list', '--count', 'HEAD').catch(() => '0'),
    git(dir, '--no-optional-locks', 'status', '--porcelain').catch(() => '') // no index.lock: acceptance commits run meanwhile
  ])
  return {
    book: yaml(dir, 'book.yaml', Book),
    characters: list(dir, 'bible/characters', /^CHAR-[A-Z0-9-]+\.md$/).flatMap(n => front(dir, `bible/characters/${n}`, Character) ?? []),
    places: list(dir, 'bible/places', /^LOC-[A-Z0-9-]+\.md$/).flatMap(n => front(dir, `bible/places/${n}`, Place) ?? []),
    world: list(dir, 'bible/world', /\.md$/).flatMap(file => {
      const body = text(dir, `bible/world/${file}`)
      return body === null ? [] : [{ file, title: body.match(/^#\s+(.+)$/m)?.[1].trim() ?? file.replace(/\.md$/, ''), body }]
    }),
    outline,
    scenes,
    facts: yaml(dir, 'canon/facts.yaml', Facts)?.facts ?? [],
    events: yaml(dir, 'canon/timeline.yaml', Timeline)?.events ?? [],
    knowledge: yaml(dir, 'canon/knowledge.yaml', Knowledge)?.entries ?? [],
    questions: yaml(dir, 'notes/open-questions.yaml', OpenQuestions)?.questions ?? [],
    git: { commits: Number(commits) || 0, clean: porcelain === '' },
    spend: readSpend(dir)
  }
}

export const sceneDetail = (dir: string, id: string): SceneDetail =>
  ({ id, manuscript: text(dir, `manuscript/${id}.md`), draft: text(dir, `drafts/${id}.md`), reviews: reviews(dir, id), park: park(dir, id) })

export function readManuscript(dir: string): ManuscriptScene[] {
  return outlineOf(dir).acts.flatMap(a => a.chapters.flatMap(c => c.scenes.flatMap(id => {
    const t = text(dir, `manuscript/${id}.md`)
    return t === null ? [] : [{ id, title: yaml(dir, `outline/scenes/${id}.yaml`, ScenePlan)?.title ?? id, act: a.id, chapter: c.id, chapterTitle: c.title, text: t }]
  })))
}

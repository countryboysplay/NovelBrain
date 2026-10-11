import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { parseDocument, stringify } from 'yaml'
import type { z } from 'zod'
import { Book, ChangeRequest, Character, Facts, Knowledge, Outline, Place, Timeline, parseYamlText } from '../../shared/schemas'
import { applyProposals, type Canon } from '../../accept/canon'
import {
  JOURNAL, TRAILER, defaultCommit, git, head, ids, landed, linkedFolders, lock, msg, readYaml, restore, writeAtomic, writeJournal,
  type GitCommit, type Mtimes, type Result, type Snapshot
} from '../../accept/accept'
import { validateBook, type BookError } from './validate'
import { ensureIdentity } from './git'
import { liveRuns, runKey } from '../run/state'

type Change = z.infer<typeof ChangeRequest>
type Opts = { gitCommit?: GitCommit; validate?: (dir: string) => BookError[] }

export const isChangeId = (v: unknown): v is string => typeof v === 'string' && /^CHG-\d{4,}$/.test(v)
const MAX_FILE = 16 * 1024 * 1024 // house setting: a change file is at most 16 MB
const CANON = { facts: 'canon/facts.yaml', timeline: 'canon/timeline.yaml', knowledge: 'canon/knowledge.yaml' } as const
const MAX_LISTED = 50 // house setting: the panel lists at most 50 pending changes
const pending = (id: string) => `notes/changes/${id}.yaml`
const STALE = 'the change or the book changed since you previewed it; preview again'

// The pending file's bytes: not through a linked folder, a regular file, at most 16 MB.
function readPending(dir: string, id: string): Buffer {
  if (!isChangeId(id)) throw new Error(`${String(id) || '(empty)'} is not a change id`)
  const rel = pending(id)
  const linked = linkedFolders(dir, [rel])
  if (linked.length) throw new Error(linked.join('; '))
  let st
  try { st = lstatSync(join(dir, rel)) } catch { throw new Error(`${rel} is missing`) }
  if (!st.isFile()) throw new Error(`${rel} is not a regular file`)
  if (st.size > MAX_FILE) throw new Error(`${rel} is larger than 16 MB`)
  return readFileSync(join(dir, rel))
}

// The change file is Claude-written, so it is untrusted: a regular file, bounded, UTF-8 without NUL, schema-valid.
function readChange(dir: string, id: string): { change: Change; bytes: Buffer } {
  const rel = pending(id)
  const bytes = readPending(dir, id)
  let text: string
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { throw new Error(`${rel} is not valid UTF-8 text`) }
  if (text.includes('\0')) throw new Error(`${rel} contains a NUL byte`)
  let raw: unknown
  try { raw = parseYamlText(text) } catch (e) { throw new Error(`${rel} could not be read: ${msg(e)}`) }
  const r = ChangeRequest.safeParse(raw)
  if (!r.success) throw new Error(r.error.issues.map(i => `${rel}: ${i.path.join('.') || '(root)'}: ${i.message}`).join('; '))
  if (r.data.id !== id) throw new Error(`${rel} says it is ${r.data.id}`)
  return { change: r.data, bytes }
}

// What the writer approves: the change file and the current state of every file it touches.
function tokenFor(dir: string, bytes: Buffer, c: Change): string {
  const h = createHash('sha256').update(`${bytes.length}\0`).update(bytes)
  for (const rel of touched(c).sort()) {
    const cur = existsSync(join(dir, rel)) ? readFileSync(join(dir, rel)) : null
    h.update(`\0${rel}\0${cur ? cur.length : 'absent'}\0`)
    if (cur) h.update(cur)
  }
  return h.digest('hex')
}

function touched(c: Change): string[] {
  const files: string[] = (c.canon ?? []).map(x => CANON[x.target])
  for (const m of c.manuscript ?? []) files.push(`manuscript/${m.scene}.md`)
  for (const o of c.outline ?? []) files.push(`outline/scenes/${o.scene}.yaml`)
  return [...new Set(files)]
}

// Every file the change writes and its new text; nothing is written here.
function compute(dir: string, c: Change): { writes: Map<string, string> } | { errors: string[] } {
  const errors: string[] = []
  const writes = new Map<string, string>()
  let outline
  try { outline = Outline.safeParse(readYaml(join(dir, 'outline/outline.yaml'))) } catch { outline = null }
  if (!outline?.success) return { errors: ['outline/outline.yaml is missing or not valid'] }
  const scenes = new Set(outline.data.acts.flatMap(a => a.chapters.flatMap(ch => ch.scenes)))
  const sceneOk = (scene: string) => {
    if (!scenes.has(scene)) errors.push(`${scene} is not in the outline`)
    else if (!existsSync(join(dir, `outline/scenes/${scene}.yaml`))) errors.push(`${scene} has no plan file`)
    else return true
    return false
  }

  if (c.canon?.length) {
    const canon = { facts: [], events: [], entries: [] } as unknown as Canon
    const files = { facts: [CANON.facts, Facts], events: [CANON.timeline, Timeline], entries: [CANON.knowledge, Knowledge] } as const
    for (const [k, [rel, schema]] of Object.entries(files) as [keyof Canon, readonly [string, typeof Facts | typeof Timeline | typeof Knowledge]][]) {
      if (!existsSync(join(dir, rel))) continue
      let r
      try { r = schema.safeParse(readYaml(join(dir, rel))) } catch { r = null }
      if (!r?.success) return { errors: [`${rel} is not valid`] }
      ;(canon as unknown as Record<string, unknown>)[k] = (r.data as Record<string, unknown>)[k]
    }
    const known = { chars: ids(join(dir, 'bible/characters'), Character), places: ids(join(dir, 'bible/places'), Place) }
    const applied = applyProposals(canon, [{ id: c.id, scene: 'author', changes: c.canon }], 'author', known)
    if (!applied.ok) return { errors: applied.errors }
    for (const [k, [rel]] of Object.entries(files) as [keyof Canon, readonly [string, unknown]][])
      if (JSON.stringify(applied.canon[k]) !== JSON.stringify(canon[k])) writes.set(rel, stringify({ [k]: applied.canon[k] }))
  }
  for (const m of c.manuscript ?? []) {
    const rel = `manuscript/${m.scene}.md`
    if (writes.has(rel)) errors.push(`${m.scene} has more than one manuscript text`)
    else if (!sceneOk(m.scene)) continue
    else if (!existsSync(join(dir, rel))) errors.push(`${m.scene} has no manuscript yet: author changes can only edit accepted scenes; write new scenes through the run`)
    else writes.set(rel, m.text)
  }
  for (const o of c.outline ?? []) {
    const rel = `outline/scenes/${o.scene}.yaml`
    if (!sceneOk(o.scene) || writes.has(rel)) continue
    const doc = parseDocument(readFileSync(join(dir, rel), 'utf8').replace(/^﻿/, ''))
    doc.set('status', o.status)
    writes.set(rel, String(doc))
  }
  return errors.length ? { errors } : { writes }
}

export function listChanges(bookDir: string): { id: string; summary: string; files: string[] }[] {
  let names: string[]
  try { names = readdirSync(join(bookDir, 'notes/changes')) } catch { return [] }
  return names.filter(n => /^CHG-\d{4,}\.yaml$/.test(n)).sort().slice(0, MAX_LISTED).flatMap(n => {
    const id = n.slice(0, -5)
    try {
      const { change } = readChange(bookDir, id)
      return [{ id, summary: change.summary, files: touched(change) }]
    } catch (e) {
      return statSync(join(bookDir, pending(id)), { throwIfNoEntry: false })?.isFile() ? [{ id, summary: `Cannot be applied: ${msg(e)}`, files: [] }] : []
    }
  })
}

export function previewChange(bookDir: string, id: string): { token: string; files: { file: string; before: string; after: string }[] } {
  const { change, bytes } = readChange(bookDir, id)
  const r = compute(bookDir, change)
  if ('errors' in r) throw new Error(r.errors.join('; '))
  return {
    token: tokenFor(bookDir, bytes, change),
    files: [...r.writes].map(([file, after]) => ({
      file, before: existsSync(join(bookDir, file)) ? readFileSync(join(bookDir, file), 'utf8') : '', after
    }))
  }
}

// Book checks, then the same .novelbrain lock acceptance uses, so an apply never interleaves with an accept.
async function guarded(dir: string, id: string, gitCommit: GitCommit | undefined, fn: () => Promise<Result>): Promise<Result> {
  const refuse = (...reasons: string[]): Result => ({ ok: false, reasons })
  try {
    if (!isChangeId(id)) return refuse(`${String(id) || '(empty)'} is not a change id`)
    let book
    try { book = Book.safeParse(readYaml(join(dir, 'book.yaml'))) } catch (e) { return refuse(`book.yaml could not be read: ${msg(e)}`) }
    if (!book.success) return refuse('book.yaml is not valid')
    if (book.data.status !== 'active') return refuse(`the book is ${book.data.status}`)
    if (liveRuns.has(runKey(dir))) return refuse('a run is going; pause it first')
    if (!gitCommit) await ensureIdentity(dir)
    const held = lock(dir, id)
    if (held) return refuse(held)
    let keep = false
    try {
      const r = await fn()
      keep = !r.ok && r.reasons.some(x => x.includes('recovery journal kept'))
      return r
    } finally {
      if (!keep) rmSync(join(dir, JOURNAL), { force: true })
    }
  } catch (e) {
    return refuse(`internal error: ${msg(e)}`)
  }
}

// Write `writes` (null deletes), validate, commit exactly those paths; restore everything on failure.
async function transact(dir: string, id: string, writes: Map<string, string | Buffer | null>, message: string, o: Opts & { check?: boolean }): Promise<Result> {
  const p = (rel: string) => join(dir, rel)
  const paths = [...writes.keys()]
  const linked = linkedFolders(dir, paths)
  if (linked.length) return { ok: false, reasons: linked }
  const snapshot: Snapshot = new Map(paths.map(rel => [rel, existsSync(p(rel)) ? readFileSync(p(rel)) : null]))
  const mtimes: Mtimes = Object.fromEntries(paths.filter(rel => snapshot.get(rel)).map(rel => [rel, statSync(p(rel)).mtimeMs]))
  const validate = o.validate ?? validateBook
  const key = (e: BookError) => `${e.file}: ${e.message}`
  const baseline = o.check ? new Set(validate(dir).map(key)) : new Set<string>()
  const rollback = (why: string[]): Result => {
    const errors = restore(dir, snapshot, mtimes)
    return { ok: false, reasons: errors.length ? [...why, `rollback failed (${errors.join('; ')}); recovery journal kept`] : why }
  }
  const head0 = head(dir), nonce = randomUUID()
  try {
    writeJournal(dir, id, snapshot, mtimes, false, nonce)
    for (const [rel, data] of writes) data === null ? rmSync(p(rel), { force: true }) : writeAtomic(p(rel), data)
    if (o.check) {
      const bad = validate(dir).map(key).filter(k => !baseline.has(k))
      if (bad.length) return rollback(bad)
    }
    return { ok: true, commit: await (o.gitCommit ?? defaultCommit)(dir, paths, `${message}\n\n${TRAILER}: ${nonce}`) }
  } catch (e) {
    if (landed(dir, head0, nonce)) return { ok: true, commit: git(dir, 'log', '--format=%h', '-F', `--grep=${TRAILER}: ${nonce}`, '-1') }
    return rollback([`internal error: ${msg(e)}`])
  }
}

// Move the pending file into applied/ or rejected/; a used id is never overwritten.
function archive(dir: string, id: string, bytes: Buffer, to: 'applied' | 'rejected', writes: Map<string, string | Buffer | null>): string | null {
  if (['applied', 'rejected'].some(d => existsSync(join(dir, `notes/changes/${d}/${id}.yaml`)))) return `${id} was already used; write the change again with the next number`
  writes.set(pending(id), null)
  writes.set(`notes/changes/${to}/${id}.yaml`, bytes)
  return null
}

// token: previewChange's token for what the writer saw; anything changed since then refuses.
export function applyChange(bookDir: string, id: string, token: string, opts: Opts = {}): Promise<Result> {
  return guarded(bookDir, id, opts.gitCommit, async () => {
    let read
    try { read = readChange(bookDir, id) } catch (e) { return { ok: false, reasons: [msg(e)] } }
    const r = compute(bookDir, read.change)
    if ('errors' in r) return { ok: false, reasons: r.errors }
    if (tokenFor(bookDir, read.bytes, read.change) !== token) return { ok: false, reasons: [STALE] }
    const writes = new Map<string, string | Buffer | null>(r.writes)
    const used = archive(bookDir, id, read.bytes, 'applied', writes)
    if (used) return { ok: false, reasons: [used] }
    const summary = read.change.summary.replace(/\s+/g, ' ').trim().slice(0, 120)
    return transact(bookDir, id, writes, `Author change ${id}: ${summary}`, { ...opts, check: true })
  })
}

export async function rejectChange(bookDir: string, id: string, opts: Opts = {}): Promise<string> {
  const r = await guarded(bookDir, id, opts.gitCommit, async () => {
    let bytes
    try { bytes = readPending(bookDir, id) } catch (e) { return { ok: false, reasons: [msg(e)] } }
    const writes = new Map<string, string | Buffer | null>()
    const used = archive(bookDir, id, bytes, 'rejected', writes)
    if (used) return { ok: false, reasons: [used] }
    return transact(bookDir, id, writes, `Reject author change ${id}`, opts)
  })
  if (!r.ok) throw new Error(r.reasons.join('; '))
  return r.commit
}

/** One past the highest change id used anywhere: pending, applied or rejected. */
export function nextChangeId(bookDir: string): string {
  let max = 0
  for (const d of ['notes/changes', 'notes/changes/applied', 'notes/changes/rejected']) {
    let names: string[] = []
    try { names = readdirSync(join(bookDir, d)) } catch { /* none yet */ }
    for (const n of names) { const m = /^CHG-(\d{4,})\.yaml$/.exec(n); if (m) max = Math.max(max, Number(m[1])) }
  }
  return `CHG-${String(max + 1).padStart(4, '0')}`
}

/** The writer's edit of an accepted scene, saved as a pending author change; only preview and approve apply it. */
export function proposeEdit(bookDir: string, scene: string, text: string): string {
  if (!/^SC-\d{3,}$/.test(scene)) throw new Error('Invalid scene id')
  let book
  try { book = Book.safeParse(readYaml(join(bookDir, 'book.yaml'))) } catch { book = null }
  if (!book?.success || book.data.status !== 'active') throw new Error('Only an active book can be edited')
  const rel = `manuscript/${scene}.md`
  const linked = linkedFolders(bookDir, [rel, 'notes/changes/new.yaml'])
  if (linked.length) throw new Error(linked.join('; '))
  if (!existsSync(join(bookDir, rel))) throw new Error(`${scene} has no manuscript yet`)
  const lf = (s: string) => s.replace(/^﻿/, '').replace(/\r\n/g, '\n') // as the studio reads it
  if (lf(readFileSync(join(bookDir, rel), 'utf8')) === lf(text)) throw new Error('Nothing changed')
  const id = nextChangeId(bookDir)
  const change = ChangeRequest.parse({ id, summary: `Writer's edit of ${scene}`, manuscript: [{ scene, text }] })
  mkdirSync(join(bookDir, 'notes/changes'), { recursive: true })
  try { writeFileSync(join(bookDir, pending(id)), stringify(change), { flag: 'wx' }) } // never overwrites a change Claude wrote meanwhile
  catch (e) { throw (e as NodeJS.ErrnoException).code === 'EEXIST' ? new Error('Another change took that id; try again') : e }
  return id
}

import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, utimesSync, writeFileSync, writeSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { parseDocument, stringify } from 'yaml'
import {
  Book, Character, Facts, Knowledge, Place, Proposal, REQUIRED_REVIEWERS, Review, ScenePlan, Timeline, parseFrontmatter, parseYamlText
} from '../shared/schemas'
import { validateBook } from '../main/book/validate'
import { applyProposals, type Canon } from './canon'
import { TOUCHUP_MAX_WORDS, readSeal, rerunOf, sealRel, sha, wordsChanged, type Seal } from './touchup'
import type { z } from 'zod'

export type Result = { ok: true; commit: string } | { ok: false; reasons: string[] }
export type GitCommit = (dir: string, paths: string[], message: string) => Promise<string>
export type Snapshot = Map<string, Buffer | null>
export type Mtimes = Record<string, number>

export const JOURNAL = '.novelbrain/accept.journal'
// Only these paths may appear in a journal; anything else means accept or an author change did not write it.
const JOURNAL_PATH = /^(canon\/(facts|timeline|knowledge)\.yaml|manuscript\/SC-\d{3,}\.md|outline\/scenes\/SC-\d{3,}\.yaml|drafts\/SC-\d{3,}\.md|proposals\/P-\d{4,}\.yaml|notes\/changes\/((applied|rejected)\/)?CHG-\d{4,}\.yaml)$/

export const git = (dir: string, ...args: string[]) =>
  execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
export const msg = (e: unknown) => {
  const first = (e instanceof Error ? e.message : String(e)).split('\n')[0]
  const stderr = String((e as { stderr?: unknown })?.stderr ?? '').trim().split('\n')[0]
  return stderr ? `${first}: ${stderr}` : first
}

// Stage and commit exactly `paths`; deleted files are staged as deletions, untracked absent files are skipped.
export const defaultCommit: GitCommit = async (dir, paths, message) => {
  const tracked = new Set(git(dir, 'ls-files', '-z', '--', ...paths).split('\0').filter(Boolean))
  const live = paths.filter(p => tracked.has(p) || existsSync(join(dir, p)))
  git(dir, 'add', '-f', '-A', '--', ...live)
  git(dir, '-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', ...message.split('\n\n').flatMap(m => ['-m', m]), '--', ...live)
  return git(dir, 'rev-parse', '--short', 'HEAD')
}

// null for a repo with no commits (or no repo at all)
export const head = (dir: string) => { try { return git(dir, 'rev-parse', '-q', '--verify', 'HEAD') } catch { return null } }
// Did the commit carrying this acceptance's nonce trailer land after fromHead? (HEAD moving alone proves nothing.)
export const TRAILER = 'Novel-Brain-Accept'
export function landed(dir: string, fromHead: string | null, nonce: string): boolean {
  try {
    return git(dir, 'log', '--format=%B', fromHead ? `${fromHead}..HEAD` : 'HEAD').split('\n').some(l => l.trim() === `${TRAILER}: ${nonce}`)
  } catch { return false }
}
// An acceptance takes seconds; an older journal belongs to a dead run whose pid was reused.
const LIVE_MS = 10 * 60_000

export const hasIdentity = (dir: string) => {
  try { return !!git(dir, 'config', '--get', 'user.name') && !!git(dir, 'config', '--get', 'user.email') } catch { return false }
}

// Folders between the book root and each path must be real folders: a symlink or junction would carry writes
// (and git add) out of the book. Returns one reason per linked folder.
export function linkedFolders(dir: string, paths: string[]): string[] {
  const out = new Set<string>()
  for (const rel of paths) {
    const parts = rel.split('/').slice(0, -1)
    for (let i = 1; i <= parts.length; i++) {
      const sub = parts.slice(0, i).join('/')
      if (lstatSync(join(dir, sub), { throwIfNoEntry: false })?.isSymbolicLink()) { out.add(`${sub} is a link; Novel Brain does not write through links`); break }
    }
  }
  return [...out]
}

export function writeAtomic(file: string, data: string | Buffer) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(`${file}.nb-tmp`, data)
  renameSync(`${file}.nb-tmp`, file)
}

export const readYaml = (file: string) => parseYamlText(readFileSync(file, 'utf8'))

// Known ids come only from cards that pass their schema and whose file name matches the id.
export function ids(dir: string, schema: typeof Character | typeof Place): Set<string> {
  const out = new Set<string>()
  if (!existsSync(dir)) return out
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.md')) continue
    try {
      const r = schema.safeParse(parseFrontmatter(readFileSync(join(dir, f), 'utf8'))?.data)
      if (r.success && `${r.data.id}.md` === f) out.add(r.data.id)
    } catch { /* invalid bible files are validateBook's concern */ }
  }
  return out
}

// Restore every snapshot path; returns the failures (empty means fully restored).
// mtimes are restored too: reviews are checked against the draft's mtime.
export function restore(dir: string, snapshot: Snapshot, mtimes: Mtimes): string[] {
  const errors: string[] = []
  for (const [rel, bytes] of snapshot) {
    try {
      rmSync(join(dir, `${rel}.nb-tmp`), { force: true })
      if (bytes) {
        writeAtomic(join(dir, rel), bytes)
        if (typeof mtimes[rel] === 'number') utimesSync(join(dir, rel), new Date(), new Date(mtimes[rel]))
      } else rmSync(join(dir, rel), { force: true })
    } catch (e) { errors.push(`${rel}: ${msg(e)}`) }
  }
  if (snapshot.size) try { git(dir, 'reset', '-q', '--', ...snapshot.keys()) } catch (e) { errors.push(`git reset: ${msg(e)}`) }
  return errors
}

// The journal is the lock: open 'wx' fails if it exists. It is written in place (renaming over it hits EPERM on
// Windows); the snapshot is written once, before any book file changes, so a torn journal never hides changes.
export function writeJournal(dir: string, scene: string, snapshot: Snapshot, mtimes: Mtimes, create: boolean, nonce?: string) {
  const file = join(dir, JOURNAL)
  mkdirSync(dirname(file), { recursive: true })
  const snap = Object.fromEntries([...snapshot].map(([k, v]) => [k, v ? v.toString('base64') : null]))
  const fd = openSync(file, create ? 'wx' : 'w')
  try {
    writeSync(fd, JSON.stringify({ pid: process.pid, scene, startedAt: new Date().toISOString(), head: head(dir), nonce, snapshot: snap, mtimes }))
    fsyncSync(fd)
  } finally { closeSync(fd) }
}

const alive = (pid: number) => {
  try { process.kill(pid, 0); return true } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM' }
}

// Take the lock, recovering first from a journal left by a dead process. Returns a refusal reason or null.
export function lock(dir: string, scene: string): string | null {
  for (let i = 0; i < 3; i++) {
    try { writeJournal(dir, scene, new Map(), {}, true); return null } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
    }
    let j: { pid?: unknown; scene?: unknown; startedAt?: unknown; head?: unknown; nonce?: unknown; snapshot?: unknown; mtimes?: unknown }
    try { j = JSON.parse(readFileSync(join(dir, JOURNAL), 'utf8')) } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue
      // Torn journal: its run died before changing anything (or is still writing it, for a few ms).
      if (!(e instanceof SyntaxError)) return `${JOURNAL} could not be read: ${msg(e)}`
      if (Date.now() - statSync(join(dir, JOURNAL)).mtimeMs < 60_000) return 'another acceptance is running'
      rmSync(join(dir, JOURNAL), { force: true })
      continue
    }
    if (typeof j.pid !== 'number' || !j.snapshot || typeof j.snapshot !== 'object') return `${JOURNAL} is malformed; it needs a person to check it`
    if (alive(j.pid) && Date.now() - Date.parse(String(j.startedAt)) < LIVE_MS) return `another acceptance is running (${String(j.scene)}, pid ${j.pid})`
    // That run's own commit landed: its snapshot is stale and must not be restored.
    if (typeof j.nonce === 'string' && landed(dir, typeof j.head === 'string' ? j.head : null, j.nonce)) { rmSync(join(dir, JOURNAL), { force: true }); continue }
    const entries = Object.entries(j.snapshot as Record<string, unknown>)
    if (entries.some(([k, v]) => !JOURNAL_PATH.test(k) || (v !== null && typeof v !== 'string')))
      return `${JOURNAL} names paths accept never writes; it needs a person to check it`
    const errors = restore(dir, new Map(entries.map(([k, v]) => [k, v === null ? null : Buffer.from(v as string, 'base64')])), (j.mtimes ?? {}) as Mtimes)
    if (errors.length) return `could not recover the interrupted acceptance of ${String(j.scene)} (${errors.join('; ')}); recovery journal kept`
    rmSync(join(dir, JOURNAL), { force: true })
  }
  return 'another acceptance is running'
}

export type SealResult = { ok: true; rerun: string[] } | { ok: false; reasons: string[] }
type Refusal = { ok: false; reasons: string[] }

export async function accept(bookDir: string, scene: string, opts: { gitCommit?: GitCommit; sealed?: boolean } = {}): Promise<Result> {
  try {
    return await run(bookDir, scene, !opts.gitCommit, async (): Promise<Result> => {
      if (opts.sealed) { const why = unseal(bookDir, scene); if (why) return { ok: false, reasons: [why] } }
      return locked(bookDir, scene, opts.gitCommit)
    })
  } catch (e) {
    return { ok: false, reasons: [`internal error: ${msg(e)}`] }
  }
}

// Keep a passing round (draft, proposals, the eight reviews) so a FLAG-only fix needs only its reruns.
export async function seal(bookDir: string, scene: string): Promise<SealResult> {
  try {
    return await run(bookDir, scene, false, async () => sealLocked(bookDir, scene))
  } catch (e) {
    return { ok: false, reasons: [`internal error: ${msg(e)}`] }
  }
}

async function run<T extends { ok: boolean }>(dir: string, scene: string, needsIdentity: boolean, body: () => Promise<T>): Promise<T | Refusal> {
  const refuse = (...reasons: string[]): Refusal => ({ ok: false, reasons })

  // 1. scene id and book status
  if (!/^SC-\d{3,}$/.test(scene)) return refuse(`${scene || '(empty)'} is not a scene id`)
  let book
  try { book = Book.safeParse(readYaml(join(dir, 'book.yaml'))) } catch (e) { return refuse(`book.yaml could not be read: ${msg(e)}`) }
  if (!book.success) return refuse('book.yaml is not valid')
  if (book.data.status !== 'active') return refuse(`the book is ${book.data.status}`)
  if (needsIdentity && !hasIdentity(dir)) return refuse('git identity (user.name and user.email) is not set in the book repository')

  // Everything after this reads and writes under the lock, so a concurrent run never sees a half-applied book.
  const held = lock(dir, scene)
  if (held) return refuse(held)
  let keepJournal = false
  try {
    const r = await body()
    const reasons = (r as { reasons?: unknown }).reasons
    keepJournal = !r.ok && Array.isArray(reasons) && reasons.some(x => String(x).includes('recovery journal kept'))
    return r
  } finally {
    if (!keepJournal) rmSync(join(dir, JOURNAL), { force: true })
  }
}

interface Rev { name: string; rel: string; round: number; verdict: string }
interface Checked {
  plan: z.infer<typeof ScenePlan>; planText: string; planRel: string; draftRel: string; msRel: string; draft: Buffer; draftText: string
  reviews: Rev[]; round: number; proposals: z.infer<typeof Proposal>[]; proposalRels: string[]; touch: Seal | null
}

// Steps 2 to 4 and freshness: may this scene's review set be accepted (or sealed)? Reads only.
function check(dir: string, scene: string): Checked | string[] {
  const p = (rel: string) => join(dir, rel)
  const mtime = (rel: string) => statSync(p(rel)).mtimeMs

  // 2. plan and draft
  const planRel = `outline/scenes/${scene}.yaml`, draftRel = `drafts/${scene}.md`, msRel = `manuscript/${scene}.md`
  if (!existsSync(p(planRel))) return [`${planRel} is missing`]
  const planText = readFileSync(p(planRel), 'utf8')
  let plan
  try { plan = ScenePlan.safeParse(parseYamlText(planText)) } catch (e) { return [`${planRel} could not be read: ${msg(e)}`] }
  if (!plan.success) return [`${planRel} is not a valid scene plan`]
  if (!existsSync(p(draftRel))) return [`${draftRel} is missing`]
  const draft = readFileSync(p(draftRel))
  let draftText: string
  try { draftText = new TextDecoder('utf-8', { fatal: true }).decode(draft) } catch { return [`${draftRel} is not valid UTF-8 text`] }
  if (draftText.includes('\0')) return [`${draftRel} contains a NUL byte`]
  if (!draftText.trim()) return [`${draftRel} is empty`]

  // 3. reviews
  const reasons: string[] = []
  const reviews: Rev[] = []
  for (const name of REQUIRED_REVIEWERS) {
    const rel = `reviews/${scene}/${name}.md`
    if (!existsSync(p(rel))) { reasons.push(`${name} review is missing`); continue }
    let r
    try { r = Review.safeParse(parseFrontmatter(readFileSync(p(rel), 'utf8'))?.data) } catch { r = null }
    if (!r?.success) { reasons.push(`${name} review is not valid`); continue }
    if (r.data.scene !== scene) { reasons.push(`${name} review is for ${r.data.scene}`); continue }
    if (r.data.reviewer !== name) { reasons.push(`${name} review says it was written by ${r.data.reviewer}`); continue }
    reviews.push({ name, rel, round: r.data.round, verdict: r.data.verdict })
  }
  const round = Math.max(0, ...reviews.map(r => r.round))
  // A seal counts only for a mixed set one round on from it; after a full round a leftover seal is ignored.
  let touch: Seal | null = null
  if (new Set(reviews.map(r => r.round)).size > 1) { const s = readSeal(dir, scene); if (s && s.round === round - 1) touch = s }
  const rerun = new Set(touch ? rerunOf(touch.rerun) : [])
  const sealed = (name: string) => readFileSync(join(p(sealRel(scene)), `${name}.md`))
  for (const r of reviews) {
    if (touch && !rerun.has(r.name)) {
      if (r.round !== touch.round || !readFileSync(p(r.rel)).equals(sealed(r.name))) reasons.push(`${r.name} review changed since the touch-up was sealed`)
    } else if (r.round !== round) reasons.push(`${r.name} review is at round ${r.round}, not ${round}`)
    if (r.verdict === 'FAIL') reasons.push(`${r.name} review is FAIL`)
  }
  if (reasons.length) return reasons

  // 4. proposals for this scene (a file that cannot be read might be for this scene, so it refuses)
  const proposals: z.infer<typeof Proposal>[] = []
  const proposalRels: string[] = []
  const propDir = p('proposals')
  for (const ent of existsSync(propDir) ? readdirSync(propDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)) : []) {
    if (ent.name === '.gitkeep' && ent.isFile()) continue
    const rel = `proposals/${ent.name}`
    if (!ent.isFile() || !/^P-\d{4,}\.yaml$/.test(ent.name)) { reasons.push(`${rel} is not a proposal file (proposals/P-####.yaml)`); continue }
    let raw: unknown
    try { raw = readYaml(p(rel)) } catch (e) { reasons.push(`${rel} could not be read: ${msg(e)}`); continue }
    if ((raw as { scene?: unknown } | null)?.scene !== scene) continue
    const r = Proposal.safeParse(raw)
    if (!r.success) { reasons.push(`${rel} is not a valid proposal`); continue }
    proposals.push(r.data)
    proposalRels.push(rel)
  }
  if (reasons.length) return reasons

  // A touch-up changes only the prose, and only a little: the plan and proposals are the ones the sealed round approved.
  if (touch) {
    const s = p(sealRel(scene))
    if (sha(planText) !== touch.plan) reasons.push(`${planRel} changed since the touch-up was sealed`)
    const was = existsSync(join(s, 'proposals')) ? readdirSync(join(s, 'proposals')).sort() : []
    const now = proposalRels.map(r => r.slice('proposals/'.length)).sort()
    if (was.join() !== now.join() || now.some(f => !readFileSync(join(s, 'proposals', f)).equals(readFileSync(p(`proposals/${f}`)))))
      reasons.push('the proposal changed since the touch-up was sealed; run a full round')
    const n = wordsChanged(readFileSync(join(s, 'draft.md'), 'utf8'), draftText)
    if (n > TOUCHUP_MAX_WORDS) reasons.push(`the touch-up changes ${n} words, more than ${TOUCHUP_MAX_WORDS}; run a full round`)
    if (reasons.length) return reasons
  }

  // Reviews must be at least as new as everything they approve (in a touch-up, the reruns are the ones that read this draft).
  const fresh = touch ? reviews.filter(r => rerun.has(r.name)) : reviews
  const oldest = Math.min(...fresh.map(r => mtime(r.rel)))
  if (oldest < mtime(draftRel)) return ['reviews are older than the draft; review the current draft']
  for (const rel of proposalRels)
    if (oldest < mtime(rel)) reasons.push(`reviews are older than ${rel}; review the current draft`)
  if (reasons.length) return reasons

  return { plan: plan.data, planText, planRel, draftRel, msRel, draft, draftText, reviews, round, proposals, proposalRels, touch }
}

async function locked(dir: string, scene: string, gitCommit: GitCommit | undefined): Promise<Result> {
  const p = (rel: string) => join(dir, rel)
  const refuse = (...reasons: string[]): Result => ({ ok: false, reasons })
  const mtime = (rel: string) => statSync(p(rel)).mtimeMs

  const c = check(dir, scene)
  if (Array.isArray(c)) return refuse(...c)
  const { plan, planText, planRel, draftRel, msRel, draft, proposals, proposalRels } = c

  // 5. canon
  const canonRel = { facts: 'canon/facts.yaml', events: 'canon/timeline.yaml', entries: 'canon/knowledge.yaml' } as const
  const schemas = { facts: Facts, events: Timeline, entries: Knowledge } as const
  const canon = { facts: [], events: [], entries: [] } as unknown as Canon
  for (const k of ['facts', 'events', 'entries'] as const) {
    if (!existsSync(p(canonRel[k]))) continue
    let r
    try { r = schemas[k].safeParse(readYaml(p(canonRel[k]))) } catch { r = null }
    if (!r?.success) return refuse(`${canonRel[k]} is not valid`)
    ;(canon as unknown as Record<string, unknown>)[k] = (r.data as Record<string, unknown>)[k]
  }
  const known = { chars: ids(p('bible/characters'), Character), places: ids(p('bible/places'), Place) }
  const applied = applyProposals(canon, proposals, scene, known)
  if (!applied.ok) return refuse(...applied.errors)

  // 6. snapshot, journalled so a killed run is undone by the next one
  const paths = [...Object.values(canonRel), msRel, planRel, draftRel, ...proposalRels]
  const linked = linkedFolders(dir, paths)
  if (linked.length) return refuse(...linked)
  const snapshot: Snapshot = new Map(paths.map(rel => [rel, existsSync(p(rel)) ? readFileSync(p(rel)) : null]))
  const mtimes: Mtimes = Object.fromEntries(paths.filter(rel => snapshot.get(rel)).map(rel => [rel, mtime(rel)]))

  const rollback = (why: string[]): Result => {
    const errors = restore(dir, snapshot, mtimes)
    return errors.length ? refuse(...why, `rollback failed (${errors.join('; ')}); recovery journal kept`) : refuse(...why)
  }

  const head0 = head(dir), nonce = randomUUID()
  try {
    writeJournal(dir, scene, snapshot, mtimes, false, nonce)

    // 7. write
    for (const k of ['facts', 'events', 'entries'] as const)
      if (JSON.stringify(applied.canon[k]) !== JSON.stringify(canon[k])) writeAtomic(p(canonRel[k]), stringify({ [k]: applied.canon[k] }))
    writeAtomic(p(msRel), draft)
    const doc = parseDocument(planText.replace(/^﻿/, ''))
    doc.set('status', 'accepted')
    writeAtomic(p(planRel), String(doc))
    for (const rel of [draftRel, ...proposalRels]) rmSync(p(rel))

    // 8. validate what this acceptance owns
    const bad = validateBook(dir).filter(e => e.file.startsWith('canon/') || e.file.startsWith('manuscript/') || e.file === planRel)
    if (bad.length) return rollback(bad.map(e => `${e.file}: ${e.message}`))

    // 9. commit
    const commit = await (gitCommit ?? defaultCommit)(dir, paths, `Accept ${scene}: ${plan.title.replace(/\s+/g, ' ').trim()}\n\n${TRAILER}: ${nonce}`)
    removeSeal(dir, scene)
    return { ok: true, commit }
  } catch (e) {
    // 10. restore, unless our commit landed before the error: then the scene is accepted and the files match it
    if (landed(dir, head0, nonce)) { removeSeal(dir, scene); return { ok: true, commit: git(dir, 'log', '--format=%h', '-F', `--grep=${TRAILER}: ${nonce}`, '-1') } }
    return rollback([`internal error: ${msg(e)}`])
  }
}

// The seal lives in run/ (git-ignored, guarded); a folder on its way that is a link would carry writes out of the book.
const sealLinked = (dir: string, scene: string) => linkedFolders(dir, [`${sealRel(scene)}/proposals/P-0000.yaml`])

// Best effort: a leftover seal is ignored once a later round is complete.
function removeSeal(dir: string, scene: string) {
  try { if (!sealLinked(dir, scene).length) rmSync(join(dir, sealRel(scene)), { recursive: true, force: true }) } catch { /* ignored by round */ }
}

function sealLocked(dir: string, scene: string): SealResult {
  const c = check(dir, scene)
  if (Array.isArray(c)) return { ok: false, reasons: c }
  if (c.touch) return { ok: false, reasons: ['the reviews are already a touch-up; accept it, or accept with --sealed'] }
  const linked = sealLinked(dir, scene)
  if (linked.length) return { ok: false, reasons: linked }
  const s = join(dir, sealRel(scene))
  // seal.json goes first and comes back last, so a run killed in between leaves no seal.
  rmSync(join(s, 'seal.json'), { force: true })
  rmSync(s, { recursive: true, force: true })
  mkdirSync(join(s, 'proposals'), { recursive: true })
  writeFileSync(join(s, 'draft.md'), c.draft)
  for (const r of c.reviews) writeFileSync(join(s, `${r.name}.md`), readFileSync(join(dir, r.rel)))
  for (const rel of c.proposalRels) writeFileSync(join(s, rel), readFileSync(join(dir, rel)))
  const flagged = c.reviews.filter(r => r.verdict === 'FLAG').map(r => r.name)
  writeFileSync(join(s, 'seal.json'), JSON.stringify({ round: c.round, plan: sha(c.planText), rerun: flagged }))
  return { ok: true, rerun: rerunOf(flagged) }
}

// Put the sealed draft, proposals and reviews back (reviews last, so they are newer than the draft), under the lock.
// Idempotent: a run killed halfway is finished by running it again.
function unseal(dir: string, scene: string): string | null {
  const s = join(dir, sealRel(scene))
  const sealLink = sealLinked(dir, scene)
  if (sealLink.length) return sealLink[0]
  const sl = readSeal(dir, scene)
  if (!sl) return `there is no sealed touch-up for ${scene}`
  const planRel = `outline/scenes/${scene}.yaml`
  if (!existsSync(join(dir, planRel)) || sha(readFileSync(join(dir, planRel), 'utf8')) !== sl.plan) return `${planRel} changed since the touch-up was sealed`
  const props = existsSync(join(s, 'proposals')) ? readdirSync(join(s, 'proposals')) : []
  if (props.some(f => !/^P-\d{4,}\.yaml$/.test(f))) return `${sealRel(scene)} is malformed; run a full round`
  // A proposal for this scene that the sealed round never reviewed would ride in on the restored reviews.
  for (const f of existsSync(join(dir, 'proposals')) ? readdirSync(join(dir, 'proposals')) : []) {
    if (props.includes(f) || !/^P-\d{4,}\.yaml$/.test(f)) continue // anything else the check refuses
    let raw: unknown
    try { raw = readYaml(join(dir, 'proposals', f)) } catch { continue } // the check refuses it
    if ((raw as { scene?: unknown } | null)?.scene === scene) return `proposals/${f} is not in the sealed touch-up; run a full round`
  }
  for (const f of props) {
    if (!existsSync(join(dir, 'proposals', f))) continue
    let raw: unknown
    try { raw = readYaml(join(dir, 'proposals', f)) } catch { continue } // unreadable: restoring it is the fix
    const owner = (raw as { scene?: unknown } | null)?.scene
    if (typeof owner === 'string' && owner !== scene) return `proposals/${f} now belongs to ${owner}; run a full round`
  }
  const linked = linkedFolders(dir, [`drafts/${scene}.md`, `reviews/${scene}/gate.md`, ...props.map(f => `proposals/${f}`)])
  if (linked.length) return linked[0]
  writeAtomic(join(dir, 'drafts', `${scene}.md`), readFileSync(join(s, 'draft.md')))
  for (const f of props) writeAtomic(join(dir, 'proposals', f), readFileSync(join(s, 'proposals', f)))
  for (const r of REQUIRED_REVIEWERS) writeAtomic(join(dir, 'reviews', scene, `${r}.md`), readFileSync(join(s, `${r}.md`)))
  return null
}

if (process.argv[1] && /accept\.(mjs|ts)$/.test(process.argv[1])) {
  const [scene = '', flag, ...extra] = process.argv.slice(2)
  const job: Promise<Result | SealResult> =
    extra.length ? Promise.resolve({ ok: false, reasons: [`unexpected arguments: ${extra.join(' ')}`] })
    : flag === undefined ? accept(process.cwd(), scene)
    : flag === '--touchup' ? seal(process.cwd(), scene)
    : flag === '--sealed' ? accept(process.cwd(), scene, { sealed: true })
    : Promise.resolve({ ok: false, reasons: [`unknown option ${flag}`] })
  job.then(
    r => { process.stdout.write(JSON.stringify(r) + '\n'); process.exit(r.ok ? 0 : r.reasons.some(x => x.startsWith('internal error')) ? 2 : 1) },
    e => { process.stdout.write(JSON.stringify({ ok: false, reasons: [`internal error: ${String(e)}`] }) + '\n'); process.exit(2) }
  )
}

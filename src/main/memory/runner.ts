import { existsSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { Outline, parseYamlText } from '../../shared/schemas'
import type { MemoryLessons } from '../../shared/types'
import { killTree } from '../run'
import { liveRuns, runKey } from '../run/state'
import { applyVerdicts, auditContext, auditPrompt, parseAudit, type Outcome } from './audit'
import { HITS_TO_PROBATION, QUIET_TO_RETIRE, chapterFindings, chapterRules, tracked, weigh } from './evidence'
import { bookKeys, bookMemories, knownBooks, lessonViews, listMemories, readMemory, relPath, scopeDir, slugFor, subdirs, today, writeBookPath, writeMemory, type BookKeys, type Memory } from './files'
import { rebuildIndexes, writeBriefing } from './indexes'
import { archive, checkSources, moveToArchive, recordUse, refreshSources, splitSource, stampSources } from './maintain'
import { deepPrompt, distillPrompt, parseVerdict, recheckPrompt } from './prompts'
import { listProposals, rejectedNames, type Proposal } from './skills'
import { addLog, commit, enqueue, ensureRepo, git, pathKey, readQueue, readState, removeJob, writeState, type Job } from './store'
import { sliceTranscript } from './transcript'
import { MEMORY, SECRET, bibleNames, changedFiles, isLessonFile, problems, rollback, scrub } from './validate'

export type Call = (prompt: string, o: { model: string; tools: boolean; onSpawn?: (pid: number | undefined) => void }) => Promise<{ result: string; costUsd: number }>
export interface MemoryOpts {
  root: string
  claudeProjects: string
  settings: () => { model: string; deepModel: string; auditModel: string; deepAuditModel: string; indexCap: number }
  call: Call
  today?: () => string
}

const MIN_CHARS = 8_000 // ~2k tokens: less isn't worth a model call
const MAX_CHARS = 80_000
const REVIEWS_MAX = 60_000
const SEP = '\n\n--- session ---\n\n'
const msg = (err: unknown) => (err instanceof Error ? err.message : String(err))
const bookOf = (j: Job): string | null => (j.kind === 'recheck' ? null : j.book)
const readText = (f: string) => (existsSync(f) ? readFileSync(f, 'utf8') : '')

export class MemoryRunner {
  log: string[] = []
  private halted = false
  private maintained = '' // day of the last maintain
  private tail: Promise<unknown> = Promise.resolve()
  private pending: Promise<void> | null = null
  private epoch = 0 // bumped by cancel(): a drain started under an older epoch stops
  private live = 0 // the epoch of the drain going now
  private pid: number | undefined // the model call's process
  private readonly day: () => string

  constructor(private readonly o: MemoryOpts) {
    this.day = o.today ?? today
  }

  private say(line: string): void {
    this.log = [...this.log, line].slice(-50)
  }

  // One at a time: drains, flushes and exclusive() callers queue behind each other.
  private locked<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.tail.then(fn, fn)
    this.tail = p.catch(() => undefined)
    return p
  }

  /** Runs fn with no drain in progress and holds drains off until it ends (commit() stages with -A). */
  exclusive<T>(fn: () => Promise<T>): Promise<T> {
    return this.locked(async () => {
      if (!(await this.recover())) throw new Error('Memory has an unfinished update it could not roll back yet; try again in a minute.')
      return fn()
    })
  }

  // A set inFlight marker means a call's output may still be on disk: nothing may be committed until a
  // rollback succeeds. False means it failed and the marker stays set.
  private async recover(): Promise<boolean> {
    if (!readState(this.o.root).inFlight) return true
    try {
      await rollback(this.o.root)
    } catch (err) {
      this.say(`Could not roll back an unfinished memory update: ${msg(err)}; nothing is committed until it can.`)
      return false
    }
    this.patchState(s => (s.inFlight = null))
    return true
  }

  async init(): Promise<boolean> {
    const { root } = this.o
    try {
      await ensureRepo(root)
      // Left by the old Memory on/off switch: memory is always on now. Removed so validation never sees it.
      rmSync(join(root, '.off'), { force: true })
      const s = readState(root)
      if (s.inFlight) {
        // ponytail: this also reverts hand edits made while the app was closed mid-distill; the marker
        // only survives a crash, kill or quit, so the window is narrow.
        await rollback(root)
        s.inFlight = null
        writeState(root, s)
        this.say('Rolled back a memory update that was cut off.')
      }
      for (const b of knownBooks(root)) if (existsSync(b.path)) this.scan(b.path)
    } catch (err) {
      this.say(`Memory could not start: ${msg(err)}`)
      this.halted = true
      return false
    }
    await this.drain()
    return true
  }

  async addBook(bookDir: string): Promise<void> {
    try {
      const keys = bookKeys(bookDir)
      if (!keys) return this.say(`Memory skips ${bookDir}: its book.yaml has no usable id.`)
      // Under the lock: book.json written during a call would fail that call's validation.
      await this.locked(async () => {
        writeBookPath(this.o.root, keys.book, bookDir)
        this.scan(bookDir)
      })
      await this.drain()
      writeBriefing(this.o.root, bookDir, this.o.settings().indexCap, this.day())
    } catch (err) {
      this.say(`Memory could not add ${bookDir}: ${msg(err)}`)
    }
  }

  /** id: the chapter or act whose check passed. enqueueOnly: the writer already paused; queue the jobs and run nothing now. */
  async flush(bookDir: string, kind: 'chapter' | 'act', id?: string, o?: { enqueueOnly?: boolean }): Promise<void> {
    try {
      this.scan(bookDir)
      if (kind === 'act' && id) enqueue(this.o.root, { kind: 'deep', book: bookDir, act: id })
      // After the distill and deep jobs: the chapter's evidence, then the audit of every lesson on probation.
      if (id) enqueue(this.o.root, { kind: 'audit', book: bookDir, at: id })
      if (!o?.enqueueOnly) await this.drain(runKey(bookDir))
    } catch (err) {
      this.say(`Memory flush failed: ${msg(err)}`)
    }
  }

  stop(): void {
    this.halted = true
  }

  /** The writer paused: kill the model call going now, if any, and stop its drain and any flush waiting for
   * the lock. The call's changes are rolled back and its job stays queued for the next act check or drain. */
  cancel(): void {
    this.epoch++
    killTree(this.pid)
  }

  private get cancelled(): boolean {
    return this.epoch !== this.live
  }

  status(): { log: string[]; queued: number; runsToday: number; spentUsd: number; spentToday: number } {
    const s = readState(this.o.root)
    return {
      log: this.log,
      queued: readQueue(this.o.root).length,
      runsToday: s.runs.day === this.day() ? s.runs.count : 0,
      spentUsd: s.spentUsd,
      spentToday: s.runs.day === this.day() ? s.runs.usd ?? 0 : 0
    }
  }

  // ponytail: Claude Code truncates folder slugs over 200 characters and adds a hash, so books with
  // paths that long are not found here and get only the jobs their memory hook queues.
  private scan(bookDir: string): void {
    const { root } = this.o
    const dir = join(this.o.claudeProjects, slugFor(bookDir))
    if (!existsSync(dir)) return
    const offsets = readState(root).offsets
    const queued = new Set(readQueue(root).flatMap(j => (j.kind === 'distill' ? [pathKey(j.transcript)] : [])))
    for (const f of readdirSync(dir).filter(n => n.endsWith('.jsonl')).map(n => join(dir, n))) {
      if (statSync(f).size > (offsets[pathKey(f)] ?? 0) && !queued.has(pathKey(f))) enqueue(root, { kind: 'distill', transcript: f, book: bookDir })
    }
  }

  drain(flushing?: string): Promise<void> {
    if (flushing !== undefined) {
      const e = this.epoch
      return this.locked(() => this.drainNow(flushing, e))
    }
    // Plain drains (the 60 s timer, init, addBook) coalesce while one is waiting for the lock.
    this.pending ??= this.locked(() => {
      this.pending = null
      return this.drainNow()
    })
    return this.pending
  }

  private async drainNow(flushing?: string, epoch = this.epoch): Promise<void> {
    this.live = epoch
    if (this.halted || this.cancelled) return
    const { root } = this.o
    try {
      const held = (j: Job) => {
        const b = bookOf(j)
        return b !== null && liveRuns.has(runKey(b)) && runKey(b) !== flushing
      }
      let ran = false
      for (let job = readQueue(root).find(j => !held(j)); job && !this.halted && !this.cancelled; job = readQueue(root).find(j => !held(j))) {
        const ok =
          job.kind === 'distill'
            ? await this.distill(readQueue(root).filter((j): j is Extract<Job, { kind: 'distill' }> => j.kind === 'distill' && pathKey(j.book) === pathKey(job!.book!)))
            : job.kind === 'deep'
              ? await this.deep(job)
              : job.kind === 'audit'
                ? await this.audit(job)
                : await this.recheck(job)
        if (!ok) break // the job stays queued; the next drain retries it
        ran = true
      }
      // Idle timer drains skip it: checkSources runs git once per stamped source.
      if (!this.cancelled && (ran || this.maintained !== this.day())) await this.maintain()
    } catch (err) {
      this.say(`Memory job failed: ${msg(err)}`)
    }
  }

  // Runs per day and spending are counted for display only: there is no daily limit.
  private counted(costUsd: unknown): void {
    this.patchState(s => {
      if (s.runs.day !== this.day()) s.runs = { day: this.day(), count: 0, usd: 0 }
      const usd = typeof costUsd === 'number' && Number.isFinite(costUsd) ? costUsd : 0
      s.runs.count += 1
      s.runs.usd = (s.runs.usd ?? 0) + usd
      s.spentUsd += usd
    })
  }

  private patchState(fn: (s: ReturnType<typeof readState>) => void): void {
    const s = readState(this.o.root)
    fn(s)
    writeState(this.o.root, s)
  }

  private indexes(keys: BookKeys) {
    const read = (dir: string) => (existsSync(join(dir, 'INDEX.md')) ? readFileSync(join(dir, 'INDEX.md'), 'utf8') : '')
    const { root } = this.o
    return { writer: read(root), series: read(scopeDir(root, 'series', keys.series)), book: read(scopeDir(root, 'book', keys.book)) }
  }

  // Validates and commits whatever the call (and apply) changed, or rolls it all back. Null means the
  // call or a step after it failed: stop draining and keep the job. Otherwise the call's reply.
  private async update(o: {
    prompt: string; model: string; tools: boolean; label: string; message: string | (() => string); book: { dir: string; keys: BookKeys }; skills: boolean
    apply?: (result: string) => Promise<void> // writes the app makes from a no-tools reply; validated like model writes
    by?: string // the model whose writes these are; its new and changed lessons go on probation (audits pass none)
    onCommit?: () => void // state written only once the update is committed
  }): Promise<string | null> {
    const { root } = this.o
    // A marker still set here means an earlier update died between call and commit: never stage its output.
    if (!(await this.recover())) return null
    // Commits hand edits too, so a rollback below only ever undoes the call.
    await commit(root, 'Record memory use')
    if (this.cancelled) return null
    this.patchState(s => (s.inFlight = o.label))
    // The model can reach the app's own state and queue: any change to .state.json, or a .queue line
    // removed or rewritten (the memory hook only appends), is undone and fails the update.
    const stateFile = join(root, '.state.json'), queueFile = join(root, '.queue')
    const state0 = readText(stateFile), queue0 = readText(queueFile)
    let res: { result: string; costUsd: number }
    try {
      const onSpawn = (pid: number | undefined) => {
        this.pid = pid
        if (this.cancelled) killTree(pid)
      }
      res = await this.o.call(o.prompt, { model: o.model, tools: o.tools, onSpawn }).finally(() => (this.pid = undefined))
      // Cancelled after the process ended but before its reply: still discarded.
      if (this.cancelled) throw Object.assign(new Error('cancelled'), { costUsd: res.costUsd })
    } catch (err) {
      this.restore(stateFile, state0, queueFile, queue0)
      this.counted((err as { costUsd?: unknown }).costUsd)
      const undone = await this.recover()
      this.say(this.cancelled
        ? `Memory call stopped by pause (${o.label}); ${undone ? 'rolled back' : 'not rolled back yet'}, the job waits for the next act check or drain.`
        : `Memory call failed (${o.label}): ${msg(err)}; the job waits for the next drain.`)
      return null
    }
    const tampered = this.restore(stateFile, state0, queueFile, queue0)
    this.counted(res.costUsd)
    try {
      // A no-tools call has no business writing anything.
      if (!o.tools && (await changedFiles(root)).length) await rollback(root)
      // New and changed lessons wait on probation for an auditor that is a different model (spec 8.1).
      if (o.by)
        for (const f of await changedFiles(root)) {
          const m = MEMORY.test(f) ? readMemory(join(root, f)) : null
          if (m) writeMemory({ ...m, meta: { ...m.meta, status: 'probation', by: o.by, quiet: 0, hits: 0, live: '' } })
        }
      await o.apply?.(res.result)
      const files = await changedFiles(root)
      const bad = this.problems(files, o.book.dir)
      if (!o.skills && files.some(f => f.startsWith('inbox/'))) bad.push('inbox/: only the deep pass may propose skills')
      bad.push(...tampered)
      if (bad.length) {
        await rollback(root)
        this.say(`Discarded memory changes: ${bad.join('; ')}`)
      } else {
        await stampSources(root, o.book.keys.book, o.book.dir)
        rebuildIndexes(root, this.o.settings().indexCap, this.day())
        await commit(root, typeof o.message === 'string' ? o.message : o.message())
        // A proposal whose text changed is audited again (an audit's own rewrite is kept again by onCommit).
        const touched = files.flatMap(f => /^inbox\/([^/]+)\/SKILL\.md$/.exec(f)?.[1] ?? [])
        if (touched.length) this.patchState(s => (s.keptSkills = s.keptSkills.filter(n => !touched.includes(n))))
        o.onCommit?.()
        // Audits never queue audits, and one queued audit per book is enough: a chapter or act flush queues
        // its own before the drain, so a rewrite always waits for the next audit job (ruling A5).
        const queued = readQueue(root).some(j => j.kind === 'audit' && pathKey(j.book) === pathKey(o.book.dir))
        if (o.by && !queued && (bookMemories(root, o.book.keys).some(m => m.meta.status === 'probation') || this.pendingSkills().length))
          enqueue(root, { kind: 'audit', book: o.book.dir })
        this.briefAll()
      }
    } catch (err) {
      const undone = await this.recover()
      this.say(`Memory update failed after the call (${o.label}): ${msg(err)}; ${undone ? 'rolled back' : 'not rolled back yet'}, the job waits for the next drain.`)
      return null
    }
    this.patchState(s => (s.inFlight = null))
    return res.result
  }

  // Puts back the state and queue files as they were before the call; names what the call changed.
  private restore(stateFile: string, state0: string, queueFile: string, queue0: string): string[] {
    const out: string[] = []
    if (readText(stateFile) !== state0) {
      writeFileSync(stateFile, state0)
      out.push('.state.json: changed by the call')
    }
    if (!readText(queueFile).startsWith(queue0)) {
      writeFileSync(queueFile, queue0)
      out.push('.queue: lines removed or rewritten by the call')
    }
    return out
  }

  private briefAll(): void {
    for (const b of knownBooks(this.o.root)) {
      try {
        writeBriefing(this.o.root, b.path, this.o.settings().indexCap, this.day())
      } catch (err) {
        this.say(`Could not write the memory briefing of ${b.id}: ${msg(err)}`)
      }
    }
  }

  private async distill(jobs: Extract<Job, { kind: 'distill' }>[]): Promise<boolean> {
    const { root } = this.o
    const bookDir = jobs[0].book
    const reads: string[] = []
    // Uses are counted once, when the batch completes, so retries after a failure never recount.
    const done = (offsets: Record<string, number>) => {
      recordUse(root, reads, this.day())
      this.patchState(s => Object.assign(s.offsets, offsets))
      for (const j of jobs) removeJob(root, j)
      return true
    }
    const keys = bookKeys(bookDir)
    if (!keys) {
      this.say(`Memory dropped ${jobs.length} jobs of ${bookDir}: its book.yaml has no usable id.`)
      return done({})
    }
    writeBookPath(root, keys.book, bookDir)
    const offsets: Record<string, number> = {}
    const texts: string[] = []
    const day = this.day()
    for (const j of jobs) {
      if (!existsSync(j.transcript)) continue
      const key = pathKey(j.transcript)
      const slice = sliceTranscript(j.transcript, readState(root).offsets[key] ?? 0)
      reads.push(...slice.reads)
      if (slice.text) texts.push(slice.text)
      offsets[key] = slice.end
    }
    // ponytail: oldest text dropped first when a chapter's sessions exceed 80k chars
    const slices = texts.join(SEP).slice(-MAX_CHARS)
    if (slices.length < MIN_CHARS) return done(offsets)
    const prompt = distillPrompt({ slices, indexes: this.indexes(keys), seriesDir: `series/${keys.series}`, bookDir: `books/${keys.book}`, day })
    const out = await this.update({ prompt, model: this.o.settings().model, tools: true, label: `distill ${keys.book}`, message: `Distill ${keys.book}`, book: { dir: bookDir, keys }, skills: false, by: this.o.settings().model })
    return out !== null && done(offsets)
  }

  private actReviews(bookDir: string, act: string): string | null {
    const outline = Outline.parse(parseYamlText(readFileSync(join(bookDir, 'outline', 'outline.yaml'), 'utf8')))
    const a = outline.acts.find(x => x.id === act)
    if (!a) return null
    const ids = [...a.chapters.flatMap(c => c.scenes), ...a.chapters.map(c => c.id), a.id]
    let out = ''
    for (const id of ids) {
      const dir = join(bookDir, 'reviews', id)
      if (!existsSync(dir)) continue
      for (const f of readdirSync(dir).filter(n => n.endsWith('.md')).sort()) {
        const text = readFileSync(join(dir, f), 'utf8')
        if (/FLAG|FAIL/.test(text)) out += `<<<reviews/${id}/${f}>>>\n${text.trim()}\n\n`
      }
    }
    return out.slice(0, REVIEWS_MAX)
  }

  private async deep(job: Extract<Job, { kind: 'deep' }>): Promise<boolean> {
    const { root } = this.o
    const keys = bookKeys(job.book)
    let reviews: string | null = null
    try {
      reviews = keys && this.actReviews(job.book, job.act)
    } catch (err) {
      this.say(`Deep pass of ${job.act} skipped: ${msg(err)}`)
    }
    if (!keys || reviews === null) {
      removeJob(root, job)
      return true
    }
    writeBookPath(root, keys.book, job.book)
    const prompt = deepPrompt({
      act: job.act,
      reviews: reviews || '(no reviewer flagged anything)',
      indexes: this.indexes(keys),
      seriesDir: `series/${keys.series}`,
      bookDir: `books/${keys.book}`,
      skills: subdirs(join(root, 'skills')),
      rejected: rejectedNames(root),
      day: this.day()
    })
    const ok = null !== await this.update({ prompt, model: this.o.settings().deepModel, tools: true, label: `deep ${keys.book} ${job.act}`, message: `Deep pass ${keys.book} ${job.act}`, book: { dir: job.book, keys }, skills: true, by: this.o.settings().deepModel })
    if (ok) removeJob(root, job)
    return ok
  }

  private async recheck(job: Extract<Job, { kind: 'recheck' }>): Promise<boolean> {
    const { root } = this.o
    // Only a book lesson inside the memory folder (books/<id>/topics/<name>.md): the queue is a file anyone can edit.
    const file = resolve(job.file)
    const id = /^books\/([^/]+)\/topics\/[^/]+\.md$/.exec(relative(root, file).replace(/\\/g, '/'))?.[1]
    if (!id) {
      this.say(`Memory dropped a re-check of ${job.file}: not a book lesson in the memory folder.`)
      removeJob(root, job)
      return true
    }
    const m = readMemory(file)
    const dir = knownBooks(root).find(b => b.id === id)?.path
    if (!m || !dir) {
      removeJob(root, job)
      return true
    }
    const sources = m.meta.sources.map(s => {
      const f = resolve(dir, splitSource(s)[0])
      return { file: splitSource(s)[0], text: existsSync(f) ? readFileSync(f, 'utf8').slice(0, 20_000) : null }
    })
    const keys = bookKeys(dir) ?? { book: id, series: id }
    const apply = async (out: string) => {
      const v = parseVerdict(out)
      if (!v || (v.verdict === 'REWRITE' && !v.body.trim()) || SECRET.test(v.body)) {
        this.say(`Re-check of ${m.meta.name} gave no usable answer; it stays marked stale.`)
        return
      }
      const day = this.day()
      if (v.verdict === 'DELETE') rmSync(file)
      else
        writeMemory({
          ...m,
          body: v.verdict === 'REWRITE' ? v.body : m.body,
          meta: {
            ...m.meta, verified: day, stale: false, sources: await refreshSources(dir, m.meta.sources),
            // A rewrite is the re-checker's text: it waits on probation like any other (KEEP leaves the status as it is).
            ...(v.verdict === 'REWRITE' && { status: 'probation' as const, by: this.o.settings().model, quiet: 0, hits: 0, live: '' })
          }
        })
    }
    const out = await this.update({ prompt: recheckPrompt(m, sources), model: this.o.settings().model, tools: false, label: `recheck ${m.meta.name}`, message: `Re-check ${m.meta.name}`, book: { dir, keys }, skills: false, apply, by: this.o.settings().model })
    if (out === null) return false
    removeJob(root, job)
    return true
  }

  // The inbox is shared by every book, so a proposal may name no known book's people or places; lessons are
  // checked against the book they belong to.
  private problems(files: string[], bookDir: string): string[] {
    const { root } = this.o
    const inbox = files.filter(f => f.startsWith('inbox/')), rest = files.filter(f => !f.startsWith('inbox/'))
    return [...problems(root, rest, bibleNames(bookDir), rejectedNames(root)), ...(inbox.length ? problems(root, inbox, this.allNames(bookDir), rejectedNames(root)) : [])]
  }

  private allNames(bookDir: string): string[] {
    return [...new Set([bookDir, ...knownBooks(this.o.root).map(b => b.path)].flatMap(d => bibleNames(d)))]
  }

  // One log line per outcome, tagged with the book so memory:lessons shows each book its own checkpoints.
  private record(book: string, checkpoint: string, by: string, entries: Outcome[]): void {
    if (!entries.length) return
    const at = new Date().toISOString()
    this.patchState(s => addLog(s, entries.map(e => ({ at, book, checkpoint, by, ...e }))))
  }

  /** memory:lessons: the book's lessons (or the writer's alone) and the log of its checkpoints and the writer's deletes. */
  lessons(bookDir: string | null): MemoryLessons {
    const id = bookDir ? bookKeys(bookDir)?.book ?? null : null
    return {
      lessons: lessonViews(this.o.root, bookDir),
      log: readState(this.o.root).log.filter(e => e.book === '' || e.book === id).map(({ book: _book, ...e }) => e)
    }
  }

  // A different model from the producer (ruling A2): the audit model, or the deep audit model when the producer is
  // the audit model. Settings never let the two audit models be equal.
  private auditorFor(by: string): string {
    const s = this.o.settings()
    // A pre-4b lesson has no `by`: it is treated as written by memory.model.
    return (by || s.model) === s.auditModel ? s.deepAuditModel : s.auditModel
  }

  private pendingSkills(): Proposal[] {
    const kept = readState(this.o.root).keptSkills
    return listProposals(this.o.root).filter(p => !kept.includes(p.name))
  }

  private async audit(job: Extract<Job, { kind: 'audit' }>): Promise<boolean> {
    const { root } = this.o
    const keys = bookKeys(job.book)
    if (!keys) {
      removeJob(root, job)
      return true
    }
    if (job.at?.startsWith('CH-') && !(await this.evidence(job.book, keys, job.at))) return false
    // One call per auditor; skills come from the deep pass, so the deep pass's auditor takes them.
    const groups = new Map<string, string[]>()
    for (const m of bookMemories(root, keys).filter(m => m.meta.status === 'probation')) {
      const a = this.auditorFor(m.meta.by)
      groups.set(a, [...(groups.get(a) ?? []), m.file])
    }
    const skillAuditor = this.auditorFor(this.o.settings().deepModel)
    if (this.pendingSkills().length && !groups.has(skillAuditor)) groups.set(skillAuditor, [])
    for (const [auditor, files] of groups) if (!(await this.auditWith(job, keys, auditor, files, auditor === skillAuditor))) return false
    removeJob(root, job)
    return true
  }

  private async auditWith(job: Extract<Job, { kind: 'audit' }>, keys: BookKeys, auditor: string, files: string[], withSkills: boolean): Promise<boolean> {
    const { root } = this.o
    const day = this.day()
    // Re-read: an earlier group's call may have deleted or rewritten lessons. Only this book's three scopes.
    const mems = bookMemories(root, keys)
    const probation = mems.filter(m => m.meta.status === 'probation' && files.includes(m.file))
    const skills = withSkills ? this.pendingSkills().map(p => `inbox/${p.name}/SKILL.md`) : []
    if (!probation.length && !skills.length) return true
    const live = mems.filter(m => m.meta.status === 'live')
    const shown = (ms: Memory[]) => ms.map(m => ({ rel: relPath(root, m.file), text: readFileSync(m.file, 'utf8') }))
    // A catch evidence sent back: say why, and show the reviews whose findings cited its rules.
    const hitIn = readState(root).hitIn, extra: string[] = []
    const notes = new Map<string, string>()
    for (const m of probation) {
      const chs = hitIn[relPath(root, m.file)] ?? []
      if (chs.length < HITS_TO_PROBATION) continue
      notes.set(m.file, `Sent back to probation: findings citing ${m.meta.rules.join(', ')} came back in ${chs.length} chapters after it went live (${chs.join(', ')}); their reviews are under the reviewer findings`)
      for (const ch of chs) {
        try {
          for (const [f, rules] of chapterFindings(job.book, ch)) if (m.meta.rules.some(r => rules.has(r))) extra.push(f)
        } catch {
          // an unreadable outline: the note alone
        }
      }
    }
    const input = {
      probation: shown(probation).map((x, i) => ({ ...x, note: notes.get(probation[i].file) })),
      live: shown(live),
      skills: skills.map(r => ({ rel: r, text: readFileSync(join(root, r), 'utf8') })),
      ...auditContext(job.book, probation, extra)
    }
    const where = `${keys.book}${job.at ? ` ${job.at}` : ''}`
    let done: { entries: Outcome[]; kept: string[] } = { entries: [], kept: [] }
    const apply = async (out: string) => {
      // Exactly the paths the prompt shows.
      const verdicts = parseAudit(out, [...input.probation, ...input.live, ...input.skills].map(x => x.rel))
      if (!verdicts) return this.say(`The ${auditor} audit of ${where} gave no usable answer; its lessons stay on probation.`)
      done = applyVerdicts(root, verdicts, { probation, live, skills, day, auditor, check: f => this.problems([f], job.book) })
      // Reasons go into the log and the commit: no story ids or bible names in memory.
      const names = this.allNames(job.book)
      done.entries = done.entries.map(e => ({ ...e, reason: scrub(e.reason, names) }))
    }
    const out = await this.update({
      prompt: auditPrompt(input), model: auditor, tools: false, label: `audit ${where}`, book: { dir: job.book, keys }, skills: true, apply,
      message: () => [`Audit ${where} by ${auditor}`, '', ...done.entries.map(e => `${e.lesson}: ${e.action}. ${e.reason}`)].join('\n'),
      // Recorded only once the verdicts are committed, so a rolled-back audit leaves no log line.
      onCommit: () => {
        this.patchState(s => {
          s.keptSkills = [...new Set([...s.keptSkills, ...done.kept])]
          for (const m of probation) delete s.hitIn[relPath(root, m.file)]
        })
        this.record(keys.book, job.at ?? 'between runs', auditor, done.entries)
      }
    })
    return out !== null
  }

  // Deterministic, no model call. inFlight guards the writes: a crash before the commit is rolled back at the next start.
  private async evidence(bookDir: string, keys: BookKeys, chapter: string): Promise<boolean> {
    const { root } = this.o
    const key = `${pathKey(bookDir)}|${chapter}`
    if (readState(root).evidenced.includes(key)) return true
    if (!(await this.recover())) return false
    let cited: Set<string>
    try {
      cited = chapterRules(bookDir, chapter)
    } catch (err) {
      this.say(`Evidence for ${chapter} skipped: ${msg(err)}`)
      return true
    }
    const entries: Outcome[] = []
    const hits = new Map<string, boolean>() // a tracked catch -> its rules were cited (false: retired)
    this.patchState(s => (s.inFlight = `evidence ${keys.book} ${chapter}`))
    try {
      for (const m of listMemories(scopeDir(root, 'book', keys.book)).filter(m => tracked(m.meta))) {
        const w = weigh(m.meta, cited)
        if (m.meta.rules.some(r => cited.has(r))) hits.set(relPath(root, m.file), true)
        if (w.outcome === 'retire') {
          hits.set(relPath(root, m.file), false)
          moveToArchive(root, m.file)
          entries.push({ lesson: m.meta.name, action: 'retired', reason: `No finding cited ${m.meta.rules.join(', ')} for ${QUIET_TO_RETIRE} chapters: solved.` })
          continue
        }
        writeMemory({ ...m, meta: w.meta })
        if (w.outcome === 'probation')
          entries.push({ lesson: m.meta.name, action: 'probation', reason: `Findings citing ${m.meta.rules.join(', ')} came back in ${HITS_TO_PROBATION} chapters after it went live, so it is not working; back on probation for a new audit.` })
      }
      rebuildIndexes(root, this.o.settings().indexCap, this.day())
      await commit(root, `Evidence ${keys.book} ${chapter}`)
    } catch (err) {
      const undone = await this.recover()
      this.say(`Evidence for ${chapter} failed: ${msg(err)}; ${undone ? 'rolled back' : 'not rolled back yet'}.`)
      return false
    }
    this.patchState(s => {
      s.inFlight = null
      s.evidenced = [...s.evidenced, key].slice(-500)
      for (const [rel, hit] of hits) {
        if (hit) s.hitIn[rel] = [...new Set([...(s.hitIn[rel] ?? []), chapter])]
        else delete s.hitIn[rel]
      }
    })
    this.record(keys.book, chapter, 'evidence', entries)
    this.briefAll()
    return true
  }

  /** memory:deleteLesson: one lesson file under the memory root (live or on probation), in its own commit, logged. */
  deleteLesson(rel: string): Promise<void> {
    return this.exclusive(async () => {
      const { root } = this.o
      const file = resolve(root, rel)
      const inside = relative(root, file)
      // Real paths too: a symlinked or junctioned books/<x> must not carry the delete out of the root.
      const real = (() => {
        try {
          const r = relative(realpathSync.native(root), realpathSync.native(file))
          return !!r && !r.startsWith('..') && !isAbsolute(r)
        } catch {
          return false
        }
      })()
      const ok = isLessonFile(rel) && !!inside && !inside.startsWith('..') && !isAbsolute(inside) && real
      const m = ok ? readMemory(file) : null
      if (!m) throw new Error(`No lesson at ${rel}`)
      const text = readFileSync(file, 'utf8')
      rmSync(file)
      try {
        rebuildIndexes(root, this.o.settings().indexCap, this.day())
        await commit(root, `Delete lesson ${m.meta.name} (writer)`)
      } catch (err) {
        // Never leave an uncommitted delete: put the file back, unstage what commit() may have staged and
        // rebuild the indexes with the lesson back, so the tree matches HEAD again.
        writeFileSync(file, text)
        await git(root, 'reset', '-q').catch(() => undefined)
        try {
          rebuildIndexes(root, this.o.settings().indexCap, this.day())
        } catch {
          // the indexes are rebuilt at the next update or maintain
        }
        throw err
      }
      this.record('', 'writer', 'writer', [{ lesson: m.meta.name, action: 'deleted', reason: 'Deleted by the writer.' }])
      this.briefAll()
    })
  }

  private async maintain(): Promise<void> {
    const { root } = this.o
    const day = this.day()
    this.maintained = day
    if (!(await this.recover())) return
    for (const file of await checkSources(root)) enqueue(root, { kind: 'recheck', file })
    archive(root, day)
    rebuildIndexes(root, this.o.settings().indexCap, day)
    await commit(root, 'Maintain memory')
    this.briefAll()
  }
}

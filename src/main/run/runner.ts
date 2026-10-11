import { EventEmitter } from 'node:events'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { z } from 'zod'
import { Outline, parseYamlText, SCENE_STATUS, STOP_AT } from '../../shared/schemas'
import { validateBook } from '../book/validate'
import { ensureIdentity, git } from '../book/git'
import { killTree } from '../run'
import { nextStep, type Step } from './plan'
import { KitMissingError, parseStepResult, runClaude, UsageLimitError } from './claude'
import { overLimit, type Usage } from '../../shared/usage'
import { appendSpend, liveRuns, readRunState, runKey, writeRunState, type RunStateT } from './state'
import { appendRoom, clip, reviewEntries, roomFromEvent } from './room'
import type { RoomEntry } from '../../shared/types'

type StopAt = (typeof STOP_AT)[number]
type SceneStatus = (typeof SCENE_STATUS)[number]
type OutlineT = z.infer<typeof Outline>
type Work = Exclude<Step, { kind: 'stop' }>

// Claude-writable folders; canon, manuscript and plan status changes are committed by accept.
const WORKING = ['bible', 'outline', 'notes', 'reviews', 'drafts', 'proposals']
const STOPPED = { done: 'done', checkpoint: 'checkpoint', 'needs-you': 'needs-you', 'stop-at': 'paused', 'empty-outline': 'needs-you' } as const
const SCENE_ID = /^SC-\d{3,}$/
const REVIEW_FILE = /^reviews\/(CH-\d+|ACT-\d+|BOOK)\/[a-z-]+\.md$/

export interface RunnerOpts {
  bookDir: string
  command: string
  models: { showrunner: string }
  stepTimeoutMs: number
  headroomUrl?: () => string | undefined
  now?: () => Date
  /** Memory flush after a chapter or act check passes. Chapters are not awaited; acts are, so the deep pass ends before an act checkpoint. */
  /** enqueueOnly is set when the writer paused before the flush started: queue the memory jobs, run nothing. */
  onCheckpoint?: (kind: 'chapter' | 'act', id: string, o?: { enqueueOnly: boolean }) => Promise<void>
  /** Called by pause(): stops the memory pass, so nothing keeps working for a run the writer paused. */
  onPause?: () => void
  /** Latest plan usage; checked before every step. */
  usage?: () => Promise<Usage | null>
  /** Each step's reading, passed to runClaude. */
  onUsage?: (u: Usage) => void
  /** Percent (settings usage.stopAt); no check without it. */
  usageStopAt?: () => number
  /** Runs the book's queued memory jobs before a usage stop. */
  onUsageStop?: () => Promise<void>
  /** The Claude Code version from each step's init (Settings shows it). */
  onClaudeVersion?: (v: string) => void
}

/** The writer must decide; never retried. */
class NeedsYou extends Error {}
/** The step's claim does not match the book; the writer must look, never retried. */
class Untrusted extends Error {}

export class Runner extends EventEmitter {
  private s: RunStateT
  private pending: { id: string; from: string }[] = []
  private revised = new Set<string>() // chapters and acts that already asked for a revision
  private pid: number | undefined
  private pausing = false
  private active = false
  private backlog: string[] = []
  private loopDone: Promise<void> | null = null
  private wake: (() => void) | undefined // ends the wait for the act flush when the writer pauses

  constructor(private o: RunnerOpts) {
    super()
    this.on('newListener', ev => {
      if (ev !== 'log' || !this.backlog.length) return
      const lines = this.backlog.splice(0)
      setImmediate(() => { for (const l of lines) this.emit('log', l) })
    })
    this.s = readRunState(o.bookDir, l => this.log(l))
  }

  status(): RunStateT {
    return structuredClone(this.s)
  }

  isActive(): boolean {
    return this.active
  }

  /** Resolves when no run loop is unwinding or going (after pause, when its git work has finished). */
  idle(): Promise<void> {
    return this.loopDone ?? Promise.resolve()
  }

  pause(): void {
    if (!this.active) return
    this.pausing = true
    killTree(this.pid)
    this.finish('paused', null)
    this.o.onPause?.()
    this.wake?.()
  }

  /** The writer reviewed a parked scene: set its plan to planned (committed) and drop it from the parked list. */
  async release(id: string): Promise<void> {
    if (!SCENE_ID.test(id)) throw new Error('Invalid scene id')
    if (this.active) throw new Error('Pause the run before releasing a scene.')
    if (this.planStatus(id) !== 'needs-you') throw new Error(`${id} is not waiting for you.`)
    const rel = `outline/scenes/${id}.yaml`
    const f = join(this.o.bookDir, rel)
    writeFileSync(f, readFileSync(f, 'utf8').replace(/^status:.*$/m, 'status: planned'))
    await ensureIdentity(this.o.bookDir)
    await git(this.o.bookDir, 'add', '-f', '--', rel)
    await git(this.o.bookDir, '-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '-m', `Release ${id} to planned`, '--', rel)
    this.s = { ...this.s, parked: this.s.parked.filter(p => p !== id) }
    this.save()
    this.say(id, `Released ${id} to planned`)
  }

  start(o: { stopAt: StopAt; pauseAtActs?: boolean }): Promise<void> {
    if (this.active) return Promise.reject(new Error('The run is already going.'))
    const p: Promise<void> = this.go(o).finally(() => { if (this.loopDone === p) this.loopDone = null })
    this.loopDone = p
    return p
  }

  private async go(o: { stopAt: StopAt; pauseAtActs?: boolean }): Promise<void> {
    if (!STOP_AT.includes(o.stopAt)) return this.finish('error', `Cannot start: stop-at must be one of ${STOP_AT.join(', ')} (got ${String(o.stopAt)}).`)
    this.active = true
    this.pausing = false
    liveRuns.add(runKey(this.o.bookDir))
    try {
      this.s = { ...readRunState(this.o.bookDir, l => this.log(l)), stopAt: o.stopAt, pauseAtActs: o.pauseAtActs ?? true, status: 'running', resumeAfter: null, lastError: null, current: null }
      // A park the writer released (plan no longer needs-you) is no longer parked.
      this.s.parked = this.s.parked.filter(id => this.planStatus(id) === 'needs-you')
      const bad = validateBook(this.o.bookDir)
      if (bad.length) return this.finish('error', bad.slice(0, 3).map(e => `${e.file}: ${e.message}`).join('; '))
      this.save()
      await this.loop()
    } catch (e) {
      if (!this.pausing) this.finish('error', (e as Error).message)
    } finally {
      this.active = false
      liveRuns.delete(runKey(this.o.bookDir))
    }
  }

  private readOutline(): OutlineT {
    return Outline.parse(parseYamlText(readFileSync(join(this.o.bookDir, 'outline', 'outline.yaml'), 'utf8')))
  }

  private async loop(): Promise<void> {
    const startedWith = { completed: [...this.s.completed], checkedChapters: [...this.s.checkedChapters], checkedActs: [...this.s.checkedActs] }
    let failed = { key: '', count: 0 }
    while (!this.pausing) {
      const outline = this.readOutline()
      const sceneStatus = this.sceneStatus(outline)
      const step = nextStep({ outline, sceneStatus, state: this.s, startedWith, pendingRevisions: this.pending })
      if (step.kind === 'stop') {
        const parked = Object.keys(sceneStatus).filter(id => sceneStatus[id] === 'needs-you')
        return this.finish(STOPPED[step.reason],
          step.reason === 'needs-you' ? `${parked.join(', ')} needs you` : step.reason === 'empty-outline' ? 'The outline has no scenes yet.' : null)
      }
      if (await this.usageStop(step.id)) return
      const key = `${step.kind} ${step.id}`
      const head0 = await git(this.o.bookDir, 'rev-parse', 'HEAD')
      try {
        await this.run(step, head0)
        failed = { key: '', count: 0 }
      } catch (e) {
        const msg = (e as Error).message
        await this.commitWorkingFiles(step.id).catch(err => this.log(`working files of ${step.id} not committed: ${(err as Error).message}`))
        // Acceptance is final: if it landed, the step is done whatever went wrong after it.
        const landed = (step.kind === 'scene' || step.kind === 'revise') && await this.landed(step.id, head0)
        if (landed) {
          this.recordAccepted(step)
          this.log(`${step.id} was accepted although the step then failed (${msg}); it is not run again`)
          this.say(step.id, `${step.id} was accepted`)
        }
        if (this.pausing) { this.save(); return }
        if (e instanceof UsageLimitError) {
          this.s.resumeAfter = e.resetAt
          this.say(step.id, e.message)
          return this.finish('usage-limit', e.message)
        }
        if (e instanceof KitMissingError) {
          // Never retried: the next step would start the same way.
          this.say(step.id, msg, true)
          return this.finish('error', msg)
        }
        if (e instanceof NeedsYou || e instanceof Untrusted) {
          this.say(step.id, msg, true)
          return this.finish('needs-you', msg)
        }
        if (!landed) {
          failed = { key, count: failed.key === key ? failed.count + 1 : 1 }
          this.log(`${key} failed: ${msg}`)
          this.say(step.id, `${step.id} failed: ${msg}`)
          if (failed.count >= 2) return this.finish('error', msg)
        }
      }
      this.s.current = null
      this.save() // a pause during the step already set status 'paused'; this keeps it and the loop ends
    }
  }

  private async run(step: Work, head0: string): Promise<void> {
    const prompt = step.kind === 'scene' ? `/write-scene ${step.id}`
      : step.kind === 'revise' ? `/revise-scene ${step.id} ${step.from}`
      : step.kind === 'book' ? '/check-book'
      : `/check-${step.kind} ${step.id}`
    this.s.current = { kind: step.kind === 'revise' ? 'scene' : step.kind, id: step.id, round: 1 }
    this.save()
    this.log(prompt)
    let out
    const t0 = Date.now(), agents = new Map<string, string>()
    try {
      out = await runClaude(prompt, {
        cwd: this.o.bookDir, command: this.o.command, model: this.o.models.showrunner, timeoutMs: this.o.stepTimeoutMs,
        headroomUrl: this.o.headroomUrl?.(), onUsage: this.o.onUsage,
        requireKit: true, onVersion: v => this.o.onClaudeVersion?.(v),
        onSpawn: pid => { this.pid = pid; if (this.pausing) killTree(pid) },
        onEvent: v => this.room(roomFromEvent(step.id, v, agents, this.at()))
      })
    } catch (e) {
      const cost = (e as { costUsd?: unknown }).costUsd
      if (typeof cost === 'number') { this.s.spentUsd += cost; this.spend(step, cost) }
      else this.log(`${step.id}: the step's cost is unknown and is not in the spending total`)
      throw e
    } finally {
      this.pid = undefined
      this.room(reviewEntries(this.o.bookDir, step.id, t0 - 1000, this.at()))
    }
    this.s.spentUsd += out.costUsd
    this.spend(step, out.costUsd)
    await this.commitWorkingFiles(step.id)
    const r = parseStepResult(out.result)
    if (!r || r.id !== step.id) throw new Error(`${step.id}: the step did not end with its result line`)
    this.log(`${step.id}: ${r.outcome}${r.note ? ` (${r.note})` : ''}`)
    const note = r.note ? ` (${r.note})` : ''

    if (step.kind === 'scene' || step.kind === 'revise') {
      // Claude can write the plan's status, so only an acceptance commit plus the manuscript file count.
      // The room's app voice says only what was verified; an unverified claim is said by the Untrusted stop.
      if (await this.landed(step.id, head0)) { this.say(step.id, `${step.id}: accepted${note}`); return this.recordAccepted(step) }
      if (r.outcome === 'accepted') throw new Untrusted(`${step.id} claims accepted but has no manuscript or Accept commit; reset it to planned`)
      if (r.outcome === 'parked') {
        if (this.planStatus(step.id) !== 'needs-you') throw new Untrusted(`${step.id}: the step says parked but the plan is ${this.planStatus(step.id) ?? 'missing'}`)
        this.say(step.id, `${step.id}: parked${note}`, true)
        if (!this.s.parked.includes(step.id)) this.s.parked.push(step.id)
        if (step.kind === 'revise') this.pending = this.pending.filter(p => p.id !== step.id)
        return
      }
      throw new Error(`${step.id}: ${r.outcome}${note}`)
    }
    // A chapter, act or book check that stops for the writer says so once, through its NeedsYou stop.
    this.say(step.id, `${step.id}: ${r.outcome}${note}`)

    if (r.outcome === 'pass') {
      if (step.kind === 'book') { this.s.checkedBook = true; return } // no memory flush: the act flush already ran
      const list = step.kind === 'chapter' ? this.s.checkedChapters : this.s.checkedActs
      if (!list.includes(step.id)) list.push(step.id)
      // Errors are only logged: memory never changes the run's status.
      const flush = Promise.resolve().then(() => this.o.onCheckpoint?.(step.kind as 'chapter' | 'act', step.id, { enqueueOnly: this.pausing })).catch(e => this.log(`memory: ${e instanceof Error ? e.message : String(e)}`))
      // A pause ends the wait at once: idle() and isActive() never wait for the memory call.
      if (step.kind === 'act' && !this.pausing) {
        this.save()
        await Promise.race([flush, new Promise<void>(res => (this.wake = res))])
        this.wake = undefined
      }
      return
    }
    if (r.outcome === 'revise' && r.revise?.length) {
      if (this.revised.has(step.id)) throw new NeedsYou(`${step.id} asked for revisions a second time: ${r.revise.join(', ')}`)
      this.revised.add(step.id)
      const outline = this.readOutline()
      const owner = (id: string) => {
        for (const act of outline.acts) for (const ch of act.chapters) if (ch.scenes.includes(id)) return { ch: ch.id, act: act.id }
        return null
      }
      const ids = r.revise.filter(id => {
        const o = SCENE_ID.test(id) ? owner(id) : null
        const ok = !!o && (step.kind === 'book' || (step.kind === 'chapter' ? o.ch : o.act) === step.id)
        if (!ok) this.log(`${step.id}: ignored revise id ${JSON.stringify(id)} (not a scene of ${step.id})`)
        return ok
      })
      if (!ids.length) throw new NeedsYou(`${step.id} asked for revisions but named no scene of it`)
      for (const id of ids) {
        const named = r.note?.match(new RegExp(`${id} from (reviews/[^\\s:;,]+\\.md)`))?.[1]
        const from = named && REVIEW_FILE.test(named) ? named : `reviews/${step.id}/${step.kind === 'chapter' ? 'arc' : 'developmental'}.md`
        if (!this.pending.some(p => p.id === id)) this.pending.push({ id, from })
        // The reopened scene's chapter and act must be checked again.
        const o = owner(id)!
        this.s.checkedChapters = this.s.checkedChapters.filter(c => c !== o.ch)
        this.s.checkedActs = this.s.checkedActs.filter(a => a !== o.act)
        this.s.checkedBook = false
      }
      return
    }
    if (r.outcome === 'parked' || r.outcome === 'revise') throw new NeedsYou(`${step.id} needs you: ${r.note ?? r.outcome}`)
    throw new Error(`${step.id}: ${r.outcome}${r.note ? ` (${r.note})` : ''}`)
  }

  // Before every step: at or over usage.stopAt in a window that has not reset, run the memory queue while
  // allowance is left, then stop until the reset. Missing data never stops the run (ruling A10).
  private async usageStop(id: string): Promise<boolean> {
    const stopAt = this.o.usageStopAt?.()
    if (stopAt === undefined || !this.o.usage) return false
    const u = await this.o.usage().catch(e => (this.log(`usage: ${e instanceof Error ? e.message : String(e)}`), null))
    if (this.pausing) return true // paused while reading (Headroom can take 3 s): pause() already finished the run
    const over = overLimit(u, stopAt)
    if (!over) return false
    // No memory call when any window is already full: it would only hit the limit (ruling M6).
    if (overLimit(u, 100)) this.log(`Plan usage is at ${over.pct}% of the ${over.window} window; a window is full, so memory waits for the next run`)
    else {
      this.log(`Plan usage is at ${over.pct}% of the ${over.window} window; memory runs before the run stops`)
      const flush = Promise.resolve().then(() => this.o.onUsageStop?.()).catch(e => this.log(`memory: ${e instanceof Error ? e.message : String(e)}`))
      // A pause ends the wait at once; pause() has called onPause, which cancels the memory call.
      await Promise.race([flush, new Promise<void>(res => (this.wake = res))])
      this.wake = undefined
    }
    if (this.pausing) return true // pause() already finished the run as paused
    this.s.resumeAfter = new Date(over.resetsAt).toLocaleString()
    this.say(id, `Plan usage is at ${over.pct}% of the ${over.window} window; the run stops until ${this.s.resumeAfter}.`)
    this.finish('usage-limit', `Plan usage is at ${over.pct}% of the ${over.window} window (stop at ${stopAt}%). The run can resume after ${this.s.resumeAfter}.`)
    return true
  }

  private recordAccepted(step: Work): void {
    if (!this.s.completed.includes(step.id)) this.s.completed.push(step.id)
    this.s.checkedBook = false // a newly accepted or revised scene means the book changed
    this.pending = this.pending.filter(p => p.id !== step.id)
  }

  /** True when an acceptance commit for the scene landed since head0 and its manuscript file exists (Claude can write neither). */
  private async landed(id: string, head0: string): Promise<boolean> {
    if (!existsSync(join(this.o.bookDir, 'manuscript', `${id}.md`))) return false
    const subjects = await git(this.o.bookDir, 'log', `${head0}..HEAD`, '--format=%s').catch(() => '')
    return subjects.split('\n').some(s => s.startsWith(`Accept ${id}:`))
  }

  private async commitWorkingFiles(id: string): Promise<void> {
    const dirs = WORKING.filter(d => existsSync(join(this.o.bookDir, d)))
    await git(this.o.bookDir, 'add', '-f', '--', ...dirs)
    const changed = await git(this.o.bookDir, 'diff', '--cached', '--name-only', '--', ...dirs)
    // `commit -- <dirs>` commits only these paths, even if something else is staged.
    if (changed) await git(this.o.bookDir, '-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '-m', `Step ${id} working files`, '--', ...dirs)
  }

  private planStatus(id: string): SceneStatus | null {
    try {
      const st = (parseYamlText(readFileSync(join(this.o.bookDir, 'outline', 'scenes', `${id}.yaml`), 'utf8')) as { status?: unknown })?.status
      return SCENE_STATUS.includes(st as SceneStatus) ? (st as SceneStatus) : null
    } catch {
      return null
    }
  }

  // A plan saying accepted without its manuscript file was not accepted by acceptance.
  private sceneStatus(outline: OutlineT): Record<string, SceneStatus> {
    const out: Record<string, SceneStatus> = {}
    for (const id of outline.acts.flatMap(a => a.chapters.flatMap(c => c.scenes))) {
      const st = this.planStatus(id) ?? 'planned'
      out[id] = st === 'accepted' && !existsSync(join(this.o.bookDir, 'manuscript', `${id}.md`)) ? 'planned' : st
    }
    return out
  }

  private finish(status: RunStateT['status'], lastError: string | null): void {
    this.s.status = status
    this.s.lastError = lastError
    this.s.current = null
    if (lastError) this.log(lastError)
    this.save()
  }

  private save(): void {
    writeRunState(this.o.bookDir, this.s)
    this.emit('state', this.status())
  }

  private spend(step: Work, usd: number): void {
    try { appendSpend(this.o.bookDir, { at: (this.o.now?.() ?? new Date()).toISOString(), kind: step.kind, id: step.id, usd }) }
    catch (e) { this.log(`spending not itemised: ${(e as Error).message}`) }
  }

  private at(): string { return (this.o.now?.() ?? new Date()).toISOString() }
  /** The Writers' room (run/room.jsonl, display only): a failed write is only logged. */
  private room(entries: RoomEntry[]): void {
    if (!entries.length) return
    try { appendRoom(this.o.bookDir, entries) } catch (e) { this.log(`room not written: ${(e as Error).message}`) }
    try { this.emit('room', entries) } catch (e) { this.log(`room: ${(e as Error).message}`) }
  }
  /** The runner's own line in the room; needsYou puts it in #needs-you. */
  private say(step: string, text: string, needsYou = false): void {
    this.room([{ at: this.at(), step, from: 'app', kind: 'system', text: clip(text), ...(needsYou ? { needsYou: true as const } : {}) }])
  }

  private log(line: string): void {
    const text = `${(this.o.now?.() ?? new Date()).toISOString()} ${line}`
    if (this.listenerCount('log')) this.emit('log', text)
    else if (this.backlog.push(text) > 50) this.backlog.shift() // ponytail: only the latest lines wait for a listener
  }
}

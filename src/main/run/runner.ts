import { EventEmitter } from 'node:events'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { z } from 'zod'
import { Outline, parseYamlText, SCENE_STATUS, STOP_AT } from '../../shared/schemas'
import { validateBook } from '../book/validate'
import { ensureIdentity, git } from '../book/git'
import { killTree } from '../run'
import { nextStep, type Step } from './plan'
import { parseStepResult, runClaude, UsageLimitError } from './claude'
import { liveRuns, readRunState, runKey, writeRunState, type RunStateT } from './state'

type StopAt = (typeof STOP_AT)[number]
type SceneStatus = (typeof SCENE_STATUS)[number]
type OutlineT = z.infer<typeof Outline>
type Work = Exclude<Step, { kind: 'stop' }>

// Claude-writable folders; canon, manuscript and plan status changes are committed by accept.
const WORKING = ['bible', 'outline', 'notes', 'reviews', 'drafts', 'proposals']
const STOPPED = { done: 'done', checkpoint: 'checkpoint', 'needs-you': 'needs-you', 'stop-at': 'paused', 'empty-outline': 'needs-you' } as const
const SCENE_ID = /^SC-\d{3,}$/
const REVIEW_FILE = /^reviews\/(CH|ACT)-\d+\/[a-z-]+\.md$/

export interface RunnerOpts {
  bookDir: string
  command: string
  models: { showrunner: string }
  stepTimeoutMs: number
  headroomUrl?: () => string | undefined
  now?: () => Date
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
      const key = `${step.kind} ${step.id}`
      const head0 = await git(this.o.bookDir, 'rev-parse', 'HEAD')
      try {
        await this.run(step, head0)
        failed = { key: '', count: 0 }
      } catch (e) {
        const msg = (e as Error).message
        await this.commitWorkingFiles(step.id).catch(err => this.log(`working files of ${step.id} not committed: ${(err as Error).message}`))
        // Acceptance is final: if it landed, the step is done whatever went wrong after it.
        const landed = step.kind !== 'chapter' && step.kind !== 'act' && await this.landed(step.id, head0)
        if (landed) {
          this.recordAccepted(step)
          this.log(`${step.id} was accepted although the step then failed (${msg}); it is not run again`)
        }
        if (this.pausing) { this.save(); return }
        if (e instanceof UsageLimitError) {
          this.s.resumeAfter = e.resetAt
          return this.finish('usage-limit', e.message)
        }
        if (e instanceof NeedsYou) return this.finish('needs-you', msg)
        if (e instanceof Untrusted) return this.finish('needs-you', msg)
        if (!landed) {
          failed = { key, count: failed.key === key ? failed.count + 1 : 1 }
          this.log(`${key} failed: ${msg}`)
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
      : `/check-${step.kind} ${step.id}`
    this.s.current = { kind: step.kind === 'revise' ? 'scene' : step.kind, id: step.id, round: 1 }
    this.save()
    this.log(prompt)
    let out
    try {
      out = await runClaude(prompt, {
        cwd: this.o.bookDir, command: this.o.command, model: this.o.models.showrunner, timeoutMs: this.o.stepTimeoutMs,
        headroomUrl: this.o.headroomUrl?.(),
        onSpawn: pid => { this.pid = pid; if (this.pausing) killTree(pid) }
      })
    } catch (e) {
      const cost = (e as { costUsd?: unknown }).costUsd
      if (typeof cost === 'number') this.s.spentUsd += cost
      else this.log(`${step.id}: the step's cost is unknown and is not in the spending total`)
      throw e
    } finally {
      this.pid = undefined
    }
    this.s.spentUsd += out.costUsd
    await this.commitWorkingFiles(step.id)
    const r = parseStepResult(out.result)
    if (!r || r.id !== step.id) throw new Error(`${step.id}: the step did not end with its result line`)
    this.log(`${step.id}: ${r.outcome}${r.note ? ` (${r.note})` : ''}`)

    if (step.kind === 'scene' || step.kind === 'revise') {
      // Claude can write the plan's status, so only an acceptance commit plus the manuscript file count.
      if (await this.landed(step.id, head0)) return this.recordAccepted(step)
      if (r.outcome === 'accepted') throw new Untrusted(`${step.id} claims accepted but has no manuscript or Accept commit; reset it to planned`)
      if (r.outcome === 'parked') {
        if (this.planStatus(step.id) !== 'needs-you') throw new Untrusted(`${step.id}: the step says parked but the plan is ${this.planStatus(step.id) ?? 'missing'}`)
        if (!this.s.parked.includes(step.id)) this.s.parked.push(step.id)
        if (step.kind === 'revise') this.pending = this.pending.filter(p => p.id !== step.id)
        return
      }
      throw new Error(`${step.id}: ${r.outcome}${r.note ? ` (${r.note})` : ''}`)
    }

    const list = step.kind === 'chapter' ? this.s.checkedChapters : this.s.checkedActs
    if (r.outcome === 'pass') { if (!list.includes(step.id)) list.push(step.id); return }
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
        const ok = !!o && (step.kind === 'chapter' ? o.ch : o.act) === step.id
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
      }
      return
    }
    if (r.outcome === 'parked' || r.outcome === 'revise') throw new NeedsYou(`${step.id} needs you: ${r.note ?? r.outcome}`)
    throw new Error(`${step.id}: ${r.outcome}${r.note ? ` (${r.note})` : ''}`)
  }

  private recordAccepted(step: Work): void {
    if (!this.s.completed.includes(step.id)) this.s.completed.push(step.id)
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

  private log(line: string): void {
    const text = `${(this.o.now?.() ?? new Date()).toISOString()} ${line}`
    if (this.listenerCount('log')) this.emit('log', text)
    else if (this.backlog.push(text) > 50) this.backlog.shift() // ponytail: only the latest lines wait for a listener
  }
}

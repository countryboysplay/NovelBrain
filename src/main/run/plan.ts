import type { z } from 'zod'
import type { Outline, SCENE_STATUS, RunState } from '../../shared/schemas'

type OutlineT = z.infer<typeof Outline>
type SceneStatus = (typeof SCENE_STATUS)[number]
type RunStateT = z.infer<typeof RunState>

export type Step =
  | { kind: 'scene'; id: string }
  | { kind: 'revise'; id: string; from: string }
  | { kind: 'chapter'; id: string }
  | { kind: 'act'; id: string }
  | { kind: 'stop'; reason: 'done' | 'stop-at' | 'needs-you' | 'checkpoint' | 'empty-outline' }

const stop = (reason: Extract<Step, { kind: 'stop' }>['reason']): Step => ({ kind: 'stop', reason })

/** Pure: decides the run loop's next step. `startedWith` is the RunState lists when start() was called. */
export function nextStep(input: {
  outline: OutlineT
  sceneStatus: Record<string, SceneStatus>
  state: Pick<RunStateT, 'stopAt' | 'pauseAtActs' | 'completed' | 'checkedChapters' | 'checkedActs'>
  startedWith: { completed: string[]; checkedChapters: string[]; checkedActs: string[] }
  pendingRevisions: { id: string; from: string }[]
}): Step {
  const { outline, sceneStatus, state, startedWith, pendingRevisions } = input
  const scenes = outline.acts.flatMap((a) => a.chapters.flatMap((c) => c.scenes))
  if (scenes.length === 0) return stop('empty-outline')
  if (scenes.some((s) => sceneStatus[s] === 'needs-you')) return stop('needs-you')
  if (pendingRevisions.length) return { kind: 'revise', ...pendingRevisions[0] }

  const accepted = (s: string): boolean => sceneStatus[s] === 'accepted'
  let next: Step | null = null
  walk: for (const act of outline.acts) {
    for (const ch of act.chapters) {
      const open = ch.scenes.find((s) => !accepted(s))
      if (open) { next = { kind: 'scene', id: open }; break walk }
      if (!state.checkedChapters.includes(ch.id)) { next = { kind: 'chapter', id: ch.id }; break walk }
    }
    if (!state.checkedActs.includes(act.id)) { next = { kind: 'act', id: act.id }; break }
  }
  if (!next) return stop('done')

  const gained = (now: string[], then: string[]): boolean => now.some((x) => !then.includes(x))
  if (gained(state.checkedActs, startedWith.checkedActs)) {
    if (state.pauseAtActs) return stop('checkpoint')
    if (state.stopAt === 'act') return stop('stop-at')
  }
  if (state.stopAt === 'chapter' && gained(state.checkedChapters, startedWith.checkedChapters)) return stop('stop-at')
  if (state.stopAt === 'scene' && next.kind === 'scene' && gained(state.completed, startedWith.completed)) return stop('stop-at')
  return next
}

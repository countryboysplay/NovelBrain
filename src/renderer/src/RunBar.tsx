import { useState } from 'react'
import type { AppState } from '../../shared/types'

const STOPS = ['scene', 'chapter', 'act', 'book'] as const

export function RunBar({ state }: { state: AppState }) {
  const [stopAt, setStopAt] = useState<(typeof STOPS)[number]>('act')
  const [pauseAtActs, setPauseAtActs] = useState(true)
  const [error, setError] = useState('')
  const run = state.run
  if (!state.book || !run) return null
  const running = run.status === 'running'
  const archived = state.book.status !== 'active'
  const act = async (p: Promise<{ ok: boolean; error?: string }>) => setError((await p).error ?? '')

  return (
    <section className="runbar" aria-label="Run">
      <label>Stop at <select value={stopAt} onChange={e => setStopAt(e.target.value as typeof stopAt)}>{STOPS.map(s => <option key={s}>{s}</option>)}</select></label>
      <label><input type="checkbox" checked={pauseAtActs} onChange={e => setPauseAtActs(e.target.checked)} /> Pause at act checkpoints</label>
      <button disabled={running || archived} onClick={() => void act(window.api.runStart({ stopAt, pauseAtActs }))}>Start</button>
      <button disabled={!running} onClick={() => void window.api.runPause()}>Pause</button>
      <p>
        <span role="status">Status: {run.status}{run.current ? ` · Step: ${run.current.kind} ${run.current.id}` : ''}</span>
        <span>{' · '}Spent so far: ${run.spentUsd.toFixed(2)}</span>
        {run.status === 'usage-limit' && run.resumeAfter && <span>{' · '}Resume after: {run.resumeAfter}</span>}
        {run.lastError && <span>{' · '}Last error: {run.lastError}</span>}
      </p>
      {error && <p role="alert">{error}</p>}
      {state.parked.length > 0 && (
        <ul aria-label="Parked scenes">
          {state.parked.map(p => (
            <li key={p.scene}>
              {p.scene}: {p.reason}{' '}
              <button disabled={running} aria-label={`Release ${p.scene}`} onClick={() => void act(window.api.runRelease(p.scene))}>Release</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

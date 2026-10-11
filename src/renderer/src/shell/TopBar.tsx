import { useState } from 'react'
import type { AppState, MemoryStatus } from '../../../shared/types'
import type { StudioData } from '../../../shared/studio'
import type { ViewId } from '../views'
import { Logo } from '../Logo'
import { Wells } from '../paint'
import { localDay, sceneCard, spendSummary } from '../lib/selectors'
import { runLabel, titleCase, usd } from '../lib/format'
import { usageText } from '../../../shared/usage'
import { NewBookForm } from './NewBookForm'

export function TopBar({ state, data, mem, go }: { state: AppState; data: StudioData | null; mem: MemoryStatus | null; go: (v: ViewId) => void }) {
  const [creating, setCreating] = useState(false)
  const run = state.run
  const live = run?.status === 'running' && run.current?.kind === 'scene' ? run.current.id : null
  const card = live && data ? sceneCard(data, live, run) : null
  const reported = !!(state.usage?.fiveHour || state.usage?.sevenDay)
  const today = spendSummary(data?.spend ?? [], run?.spentUsd ?? 0, mem, localDay(new Date())).today
  const b = data?.book
  return (
    <header className="top">
      <div className="brand"><Logo size={26} /><span>Novel Brain</span></div>
      <div className="book">
        <h1>{state.book?.title ?? 'No book open'}</h1>
        {b && <p>{[b.series ? `Series ${b.series}` : null, ...b.genres.map(titleCase), titleCase(b.audience)].filter(Boolean).join(' · ')}</p>}
      </div>
      {state.book?.status === 'archived' && <span className="badge">Archived</span>}
      <div className="sp" />
      {state.book && (
        <div className={`run-pill run-${run?.status ?? 'none'}`}>
          <span className="run-dot" aria-hidden="true" />
          <span role="status" aria-label="Run status">{card ? <>Running · <b>{card.id}<span className="wide"> {card.title}</span></b><span className="wide"> · {card.verdicts.length ? 'in review' : 'drafting'}</span></> : runLabel(run)}</span>
          {card && card.verdicts.length > 0 && <Wells verdicts={card.verdicts} />}
          <button className="link" onClick={() => go('run')}>Open run</button>
        </div>
      )}
      <p className="cost"><b>{usd(today)}</b> today</p>
      <p className={`tag headroom svc-${state.services.headroom}`}><span className="dot-mark" aria-hidden="true" />Headroom {state.services.headroom === 'up' ? 'on' : 'off'}</p>
      <p className={`tag usage${reported ? '' : ' sr-only'}`}>{usageText(state.usage)}</p> {/* read out, and shown once a plan window has reported */}
      <div className="top-actions">
        <button onClick={() => void window.api.pickBook()}>Open book…</button>
        <button onClick={() => setCreating(true)}>New book…</button>
      </div>
      {creating && <NewBookForm onClose={() => setCreating(false)} />}
      {state.errors.length > 0 && (
        <details className="errors paper">
          <summary>{state.errors.length} problem{state.errors.length === 1 ? '' : 's'} in this book</summary>
          <ul>{state.errors.map((e, i) => <li key={i}><code>{e.file}</code> {e.message}</li>)}</ul>
        </details>
      )}
    </header>
  )
}

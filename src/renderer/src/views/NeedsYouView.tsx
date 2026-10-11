import { useEffect, useState } from 'react'
import type { SceneDetail } from '../../../shared/studio'
import type { ViewProps } from '../views'
import { sceneCard } from '../lib/selectors'
import { reviewerName, useCrew } from '../lib/crew'
import { SceneCard } from './SceneCard'
import { ChangesPanel } from './ChangesPanel'
import { SkillProposals } from './SkillProposals'

export function NeedsYouView({ state, data, mem, setMem }: ViewProps) {
  const [details, setDetails] = useState<Record<string, SceneDetail>>({})
  const [error, setError] = useState('')
  const crew = useCrew()
  const running = state.run?.status === 'running'
  const ids = state.parked.map(p => p.scene).join(',')
  useEffect(() => {
    let live = true
    void Promise.all(state.parked.map(p => window.api.studioScene(p.scene))).then(ds => {
      if (live) setDetails(Object.fromEntries(ds.flatMap(d => (d ? [[d.id, d]] : []))))
    })
    return () => { live = false }
  }, [ids])
  const release = async (scene: string) => { const r = await window.api.runRelease(scene); setError(r.error ?? '') }
  const nothing = !state.parked.length && !state.changes.length && !mem?.proposals.length
  return (
    <section className="view needs-view" aria-labelledby="view-title">
      <h2 id="view-title">Needs you</h2>
      {nothing && <p className="empty">Nothing is waiting for you. Parked scenes, author changes and proposed skills appear here.</p>}
      {state.parked.length > 0 && (
        <section aria-labelledby="parked-title">
          <h3 id="parked-title">Parked scenes</h3>
          <ul aria-label="Parked scenes" className="parked">
            {state.parked.map(p => {
              const d = details[p.scene]
              return (
                <li key={p.scene}>
                  {data && <SceneCard card={sceneCard(data, p.scene, state.run)} />}
                  <div className="paper needs">
                    <p><strong>{p.scene}</strong>: {p.reason}</p>
                    {d?.reviews.filter(r => r.verdict !== 'PASS').map(r => <p key={r.reviewer} className="prose"><strong>{reviewerName(crew, r.reviewer)}, {r.verdict.toLowerCase()}, round {r.round}:</strong> {r.body}</p>)}
                    {d?.draft && <details><summary>Current draft</summary><p className="prose">{d.draft}</p></details>}
                    <button disabled={running} title={running ? 'Pause the run before releasing a scene.' : undefined} aria-label={`Release ${p.scene}`} onClick={() => void release(p.scene)}>Release</button>
                    <p className="muted">Release sets the scene back to planned so the next run drafts it again. Fix the plan or the bible with Claude first if the reviewers were right.</p>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      )}
      {error && <p role="alert">{error}</p>}
      <ChangesPanel state={state} />
      {mem && <SkillProposals mem={mem} running={running} setMem={setMem} />}
    </section>
  )
}

import { useEffect, useRef, useState } from 'react'
import type { SceneDetail, StudioData } from '../../../shared/studio'
import { Wells } from '../paint'
import { reviewerName, useCrew } from '../lib/crew'

/** The scene's sheet, pinned beside the board: non-blocking, focus moves in, Escape closes it. */
export function SceneDialog({ id, data, onClose }: { id: string; data: StudioData; onClose: () => void }) {
  const ref = useRef<HTMLElement>(null)
  const [detail, setDetail] = useState<SceneDetail | null>(null)
  const crew = useCrew()
  useEffect(() => { ref.current?.focus() }, [id])
  useEffect(() => { setDetail(null) }, [id]) // another card: never show the last scene's reviews under this title
  useEffect(() => { // refetched on each poll so the live scene's sheet shows new verdicts; a stale reply is dropped
    let live = true
    void window.api.studioScene(id).then(d => { if (live) setDetail(d) })
    return () => { live = false }
  }, [id, data])
  const plan = data.scenes[id]?.plan
  const name = (cid: string) => data.characters.find(c => c.id === cid)?.name ?? cid
  const place = (lid: string) => data.places.find(p => p.id === lid)?.name ?? lid
  const round = Math.max(0, ...(detail?.reviews ?? []).map(r => r.round))
  const notes = (detail?.reviews ?? []).filter(r => r.verdict !== 'PASS')
  return (
    <aside ref={ref} role="dialog" aria-labelledby="scene-title" className="paper scene-panel vt-scene" tabIndex={-1}
      onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}>
      <button className="link close" onClick={onClose}>Close</button>
      <h3 id="scene-title">{plan?.title ?? id}</h3>
      <p className="meta">{id}{plan && <> · {name(plan.pov)} · {place(plan.location)} · {plan.storyTime}</>}</p>
      {plan && (
        <dl>
          <dt>Goal</dt><dd>{plan.goal}</dd>
          <dt>Beats</dt><dd><ol>{plan.beats.map((b, i) => <li key={i}>{b}</li>)}</ol></dd>
          {plan.arcBeats.length > 0 && <><dt>Arc beats</dt><dd><ul>{plan.arcBeats.map((a, i) => <li key={i}>{name(a.character)}: {a.beat}</li>)}</ul></dd></>}
          {plan.mustReveal.length > 0 && <><dt>Must reveal</dt><dd><ul>{plan.mustReveal.map(f => <li key={f}>{data.facts.find(x => x.id === f)?.statement ?? f}</li>)}</ul></dd></>}
        </dl>
      )}
      {detail?.park && <p className="note">{detail.park}</p>}
      {detail && detail.reviews.length > 0 && (
        <section aria-labelledby="scene-reviews"><h4 id="scene-reviews">Reviews <span className="muted">round {round}</span></h4>
          <Wells verdicts={detail.reviews} />
          {notes.length > 0 && <ul className="notes">{notes.map(r => <li key={r.reviewer}><strong>{reviewerName(crew, r.reviewer)}: {r.verdict.toLowerCase()}</strong>{r.body && <p className="prose">{r.body}</p>}</li>)}</ul>}
        </section>
      )}
      {detail?.manuscript && <details><summary>Accepted text</summary><p className="prose">{detail.manuscript}</p></details>}
      {!detail?.manuscript && detail?.draft && <details><summary>Current draft</summary><p className="prose">{detail.draft}</p></details>}
    </aside>
  )
}

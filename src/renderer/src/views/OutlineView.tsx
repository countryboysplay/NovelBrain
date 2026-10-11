import { useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { ViewProps } from '../views'
import { actColumns, pigments, type CardStatus } from '../lib/selectors'
import { useStoryEvents, withTransition } from '../lib/motion'
import { SceneCard } from './SceneCard'
import { SceneDialog } from './SceneDialog'

const STATUSES: (CardStatus | 'all')[] = ['all', 'planned', 'drafting', 'review', 'accepted', 'needs-you']

export function OutlineView({ state, data }: ViewProps) {
  const cols = useMemo(() => (data ? actColumns(data, state.run) : []), [data, state.run])
  const events = useStoryEvents(useMemo(() => cols.flatMap(c => c.cards), [cols]))
  const [pov, setPov] = useState('all')
  const [status, setStatus] = useState<CardStatus | 'all'>('all')
  const [open, setOpen] = useState<string | null>(null)
  const [growing, setGrowing] = useState<string | null>(null)
  const opener = useRef<HTMLElement | null>(null)
  const pig = data ? pigments(data) : {}
  const povs = data ? data.characters.filter(c => Object.values(data.scenes).some(s => s.plan?.pov === c.id)) : []

  // The card grows into the dialog: the transition name sits on the card, then on the dialog, never on both.
  const show = (id: string) => {
    opener.current = document.activeElement as HTMLElement | null
    flushSync(() => setGrowing(id))
    withTransition(() => { setGrowing(null); setOpen(id) })
  }
  const hide = () => {
    withTransition(() => setOpen(null))
    opener.current?.focus() // the opener sits outside the panel, so focus can go back before the panel leaves
  }

  return (
    <section className="view outline" aria-labelledby="view-title">
      <div className="head">
        <h2 id="view-title">Outline</h2>
        <label className="chip">POV <select value={pov} onChange={e => setPov(e.target.value)}><option value="all">Everyone</option>{povs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="chip">Status <select value={status} onChange={e => setStatus(e.target.value as CardStatus | 'all')}>{STATUSES.map(s => <option key={s} value={s}>{s === 'all' ? 'All' : s.replace('-', ' ')}</option>)}</select></label>
        <ul className="legend" aria-label="Pigment for each point of view">{povs.map(c => <li key={c.id} style={{ ['--c' as string]: `var(--${pig[c.id]})` }}><i aria-hidden="true" />{c.name}</li>)}</ul>
      </div>
      {!data || cols.length === 0
        ? <p className="empty">The outline is empty. Ask Claude in the terminal to plan the book; the story architect writes the outline and scene plans.</p>
        : (
          <div className={`board${open ? ' with-panel' : ''}`}>
          <div className="acts">
            {cols.map((a, i) => (
              <section key={a.id} className={`act${a.checked ? ' checked' : ''}`} aria-labelledby={`act-${a.id}`} style={{ ['--act' as string]: `var(--act-${(i % 3) + 1})` }}>
                <h3 id={`act-${a.id}`} className="marker">Act {i + 1}: {a.title}<small>{a.summary}</small></h3>
                <ul className="stack">
                  {a.cards.filter(c => (pov === 'all' || c.pov === pov) && (status === 'all' || c.status === status)).map(c => (
                    <li key={c.id}><SceneCard card={c} events={events.get(c.id)} growing={growing === c.id} onOpen={() => show(c.id)} /></li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          {open && data && <SceneDialog id={open} data={data} onClose={hide} />}
          </div>
        )}
    </section>
  )
}

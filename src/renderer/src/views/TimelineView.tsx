import { useState } from 'react'
import type { ViewProps } from '../views'
import { jitter, pigments, timelineRows, whoKnows } from '../lib/selectors'

export function TimelineView({ data }: ViewProps) {
  const [order, setOrder] = useState<'story' | 'file'>('story')
  const [table, setTable] = useState(false)
  if (!data) return <section className="view"><h2 id="view-title">Timeline</h2></section>
  const name = (id: string) => data.characters.find(c => c.id === id)?.name ?? id
  const place = (id: string) => data.places.find(p => p.id === id)?.name ?? id
  const pig = pigments(data)
  const rows = timelineRows(data.events, order)
  return (
    <section className="view timeline" aria-labelledby="view-title">
      <div className="head">
        <h2 id="view-title">Timeline</h2>
        <fieldset className="chip"><legend className="sr-only">Order</legend>
          <label><input type="radio" name="order" checked={order === 'story'} onChange={() => setOrder('story')} /> Story order</label>
          <label><input type="radio" name="order" checked={order === 'file'} onChange={() => setOrder('file')} /> File order</label>
        </fieldset>
        <label className="chip"><input type="checkbox" checked={table} onChange={e => setTable(e.target.checked)} /> Show as table</label>
      </div>
      {rows.length === 0 ? <p className="empty">No events in canon yet. Each accepted scene adds its events.</p> : table ? (
        <table className="paper" aria-label="Events">
          <thead><tr><th scope="col">Story time</th><th scope="col">What</th><th scope="col">Where</th><th scope="col">Who</th><th scope="col">Source</th></tr></thead>
          <tbody>{rows.map(e => <tr key={e.id}><th scope="row">{e.storyTime}</th><td>{e.what}</td><td>{place(e.place)}</td><td>{e.who.map(name).join(', ')}</td><td>{e.source}</td></tr>)}</tbody>
        </table>
      ) : (
        /* Event cards hung along a string in story order; the tack takes the first character's pigment. */
        <ol className="string" aria-label="Events">
          {rows.map(e => (
            <li key={e.id} className="card paper event" style={{ ['--r' as string]: `${jitter(e.id, -1.5, 1.5).toFixed(2)}deg`, ['--c' as string]: `var(--${pig[e.who[0]] ?? 'grey'})` }}>
              <span className="tack" aria-hidden="true" />
              <h4 className="when">{e.storyTime}</h4>
              <p className="what">{e.what}</p>
              <p className="meta"><span>{place(e.place)}</span><span>{e.who.map(name).join(', ')}</span><span>{e.source}</span></p>
            </li>
          ))}
        </ol>
      )}
      <h3>Who knows what</h3>
      {data.facts.length === 0 ? <p className="empty">No facts in canon yet.</p> : (
        <table className="paper" aria-label="Who knows what">
          <thead><tr><th scope="col">Fact</th>{data.characters.map(c => <th key={c.id} scope="col">{c.name}</th>)}</tr></thead>
          <tbody>{whoKnows(data).map(r => (
            <tr key={r.fact.id} className={r.fact.status === 'superseded' ? 'superseded' : undefined}>
              <th scope="row">{r.fact.statement}{r.fact.status === 'superseded' && <span className="muted"> (superseded)</span>}</th>
              {data.characters.map(c => { const k = r.knowers.find(x => x.character === c.id); return <td key={c.id}>{k ? `${k.learnedIn}: ${k.how}` : ''}</td> })}
            </tr>
          ))}</tbody>
        </table>
      )}
      {data.questions.length > 0 && (
        <><h3>Open questions</h3><ul>{data.questions.map(q => <li key={q.id}>{q.question} (raised in {q.raised}{q.answered ? `, answered in ${q.answered}` : q.answerBy ? `, answer by ${q.answerBy}` : ''})</li>)}</ul></>
      )}
    </section>
  )
}

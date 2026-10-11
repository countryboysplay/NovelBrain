import { useState } from 'react'
import type { ViewProps } from '../views'
import { jitter, pigments } from '../lib/selectors'
import { Tape } from '../paint'
import { dropTitle, excerpt } from '../lib/format'

export function BibleView({ data }: ViewProps) {
  const [picked, setPicked] = useState<string | null>(null)
  if (!data) return <section className="view"><h2 id="view-title">Bible</h2></section>
  const pig = pigments(data)
  const n = data.characters.length
  const who = data.characters.find(c => c.id === picked)
  const povIn = (id: string) => Object.values(data.scenes).filter(s => s.plan?.pov === id).length
  const setIn = (id: string) => Object.values(data.scenes).filter(s => s.plan?.location === id).length
  return (
    <section className="view bible" aria-labelledby="view-title">
      <h2 id="view-title">Bible</h2>
      <p className="muted">The bible is intent: Claude edits it from the terminal; nothing here changes canon.</p>
      <h3 className="marker" style={{ ['--act' as string]: 'var(--act-1)' }}>Characters</h3>
      {n === 0 ? <p className="empty">No characters yet. Ask Claude to add one with /new-character.</p> : (
        <ul className="hand" aria-label="Characters">
          {data.characters.map((c, i) => {
            const fan = n > 1 ? ((i / (n - 1)) * 2 - 1) * 3 : 0 // -3 to 3 degrees across the hand
            return (
              <li key={c.id} style={{ ['--fan' as string]: `${fan}deg`, ['--drop' as string]: `${Math.abs(fan) * 2}px`, ['--c' as string]: `var(--ink-${pig[c.id] ?? 'grey'})` }}>
                <button className="card paper char" aria-pressed={picked === c.id} onClick={() => setPicked(picked === c.id ? null : c.id)}>
                  <span className="pov">{c.name}</span>
                  <span className="meta">{c.role} · POV in {povIn(c.id)} scene{povIn(c.id) === 1 ? '' : 's'}</span>
                  {c.body && <span className="taste">{excerpt(c.body)}</span>}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {who && (
        <section className="paper sheet" aria-label={who.name}>
          <h4>{who.name}</h4>
          <p className="meta">{who.role} · POV in {povIn(who.id)} scene{povIn(who.id) === 1 ? '' : 's'}</p>
          {who.voice && <p><strong>Voice:</strong> {who.voice}</p>}
          <p><strong>Arc beats:</strong></p><ol>{who.arcBeats.map((b, i) => <li key={i}>{b}</li>)}</ol>
          {who.body && <p className="prose">{who.body}</p>}
        </section>
      )}
      <section aria-label="Places">
        <h3 className="marker" style={{ ['--act' as string]: 'var(--act-2)' }}>Places</h3>
        <ul className="grid">{data.places.map(p => <li key={p.id} className="card paper pinned" style={{ ['--r' as string]: `${jitter(p.id, -1.4, 1.4).toFixed(2)}deg` }}><Tape at={jitter(p.id, 30, 64)} /><h4>{p.name}</h4><p className="meta">{p.id} · {setIn(p.id)} scene{setIn(p.id) === 1 ? '' : 's'}</p>{p.body && <p className="prose">{p.body}</p>}</li>)}</ul>
      </section>
      <section aria-label="World">
        <h3 className="marker" style={{ ['--act' as string]: 'var(--act-3)' }}>World</h3>
        <ul className="grid">{data.world.map(w => <li key={w.file} className="card paper pinned" style={{ ['--r' as string]: `${jitter(w.file, -1.4, 1.4).toFixed(2)}deg` }}><Tape at={jitter(w.file, 30, 64)} /><h4>{w.title}</h4><p className="prose">{dropTitle(w.body, w.title)}</p></li>)}</ul>
      </section>
    </section>
  )
}

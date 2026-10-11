import type { Card } from '../lib/selectors'
import { jitter } from '../lib/selectors'
import { cardLabel, wordsLong } from '../lib/format'
import { Circle, Tape, Underline, Wells } from '../paint'

export function SceneCard({ card, events, onOpen, growing }: { card: Card; events?: Set<string>; onOpen?: () => void; growing?: boolean }) {
  const ev = [...(events ?? [])].filter(e => !e.startsWith('verdict:')).map(e => ` ev-${e}`).join('')
  const ink = card.pigment ? `var(--ink-${card.pigment})` : 'var(--ink-grey)'
  const round = Math.max(0, ...card.verdicts.map(v => v.round))
  return (
    <article className={`card paper status-${card.status}${card.live ? ' live' : ''}${ev}${growing ? ' vt-scene' : ''}`} aria-label={card.title}
      style={{ ['--r' as string]: `${card.status === 'needs-you' ? 2.2 : jitter(card.id, -1.2, 1.2).toFixed(2)}deg`, ['--c' as string]: ink }}>
      {card.status === 'needs-you' && !card.live && <Circle />}
      {card.status === 'accepted' && <Tape at={jitter(card.id, 30, 64)} />}
      {card.live && <div className="wet-sheen" aria-hidden="true" />}
      <span className="status">{cardLabel(card)}</span>
      <h4>
        {onOpen ? <button className="card-open" onClick={onOpen}>{card.title}</button> : card.title}
        {card.live && <Underline color="var(--ultra)" />}
      </h4>
      <p className="meta">
        {card.povName && <span className="pov">{card.povName}</span>}
        <span>{card.id}</span>
        {card.words > 0 && <span>{wordsLong(card.words)} words</span>}
        {card.beat && <span>beat: {card.beat}</span>}
        {card.redrafted && <span>redrafted</span>}
      </p>
      {/* An accepted card is seven passes by definition; the tape says so, the pills would only repeat it. */}
      {card.verdicts.length > 0 && !(card.status === 'accepted' && card.verdicts.every(v => v.verdict === 'PASS')) && (
        <Wells verdicts={card.verdicts} fresh={events} />
      )}
      {card.note && <p className="note">{card.note}</p>}
      {events?.has('redraft') && <div className="back" aria-hidden="true">Redraft, round {round}</div>}
    </article>
  )
}

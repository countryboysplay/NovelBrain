import { useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { ViewProps } from '../views'
import { STOP_AT } from '../../../shared/schemas'
import type { RunStateT } from '../../../shared/types'
import { nextCheckpoint, sceneCard, upNext } from '../lib/selectors'
import { runLabel, usd } from '../lib/format'
import { SceneCard } from './SceneCard'
import { SceneDialog } from './SceneDialog'
import { Tape } from '../paint'
import { useStoryEvents, withTransition } from '../lib/motion'

// The marker word on the run sheet, like a card's status.
const WORD: Record<RunStateT['status'], string> = { running: 'running', idle: 'ready', paused: 'paused', checkpoint: 'your turn', 'needs-you': 'needs you', 'usage-limit': 'waiting', done: 'done', error: 'stopped' }
const QUEUE = 6 // ponytail: a fixed short column; the Outline holds the rest
const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
// A log line starts with the step's ISO time; show it as a clock and keep the rest as written.
const Line = ({ text }: { text: string }) => {
  const sp = text.indexOf(' '), at = sp > 0 ? text.slice(0, sp) : ''
  return Number.isNaN(Date.parse(at)) ? <li>{text}</li> : <li><time dateTime={at}>{clock.format(new Date(at))}</time>{text.slice(sp + 1)}</li>
}

export function RunView({ state, data, log, go }: ViewProps) {
  const run = state.run
  const [stopAt, setStopAt] = useState<(typeof STOP_AT)[number]>(run?.stopAt ?? 'act')
  const [pauseAtActs, setPauseAtActs] = useState(run?.pauseAtActs ?? true)
  const [error, setError] = useState('')
  // The controls follow the saved run state until the writer changes them.
  const touched = useRef(false)
  useEffect(() => {
    if (run && !touched.current) { setStopAt(run.stopAt); setPauseAtActs(run.pauseAtActs) }
  }, [run?.stopAt, run?.pauseAtActs])
  const live = run?.status === 'running' && run.current?.kind === 'scene' && data ? sceneCard(data, run.current.id, run) : null
  const events = useStoryEvents(live ? [live] : [])
  const { cards: queue, blocked } = useMemo(() => (data ? upNext(data, run) : { cards: [], blocked: null }), [data, run])
  // A queued card opens the scene's sheet as on Outline: the card grows into the sheet, focus comes back to the card on close
  // (or to the queue's heading, if the poll took the card away meanwhile).
  const [open, setOpen] = useState<string | null>(null)
  const [growing, setGrowing] = useState<string | null>(null)
  const opener = useRef<HTMLElement | null>(null)
  const show = (id: string) => { opener.current = document.activeElement as HTMLElement | null; flushSync(() => setGrowing(id)); withTransition(() => { setGrowing(null); setOpen(id) }) }
  const hide = () => { withTransition(() => setOpen(null)); (opener.current?.isConnected ? opener.current : document.getElementById('queue-title'))?.focus() }
  // Newest at the bottom: the strip follows the run as lines land, unless the writer has scrolled up to read.
  const strip = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const last = log[log.length - 1]?.n ?? -1
  useEffect(() => { const el = strip.current; if (el && atBottom.current) el.scrollTop = el.scrollHeight }, [last])
  const shown = log.slice(-80)
  if (!state.book) return <section className="view"><h2 id="view-title">Run</h2><p className="empty">Open a book to run it.</p></section>
  if (!run) return <section className="view"><h2 id="view-title">Run</h2><p className="empty">This book is archived, so it cannot run.</p></section>
  const running = run.status === 'running'
  const act = async (p: Promise<{ ok: boolean; error?: string }>) => setError((await p).error ?? '')
  const cp = data ? nextCheckpoint(data) : null
  // With nothing being written and a scene parked, the sheet names the scene and points at Needs you.
  const parked = !running && run.status === 'needs-you' ? state.parked : []
  const first = parked[0] ? `${parked[0].scene} ${data?.scenes[parked[0].scene]?.plan?.title ?? ''}`.trim() : ''
  const label = parked.length === 0 ? runLabel(run) : parked.length === 1 ? `${first} is parked` : `${first} and ${parked.length - 1} more are parked`
  return (
    <section className={`view run-view${open ? ' with-panel' : ''}`} aria-labelledby="view-title">
      <h2 id="view-title">Run</h2>
      <div className="run-side">
        {/* Start and Pause are paint dabs; whichever can be pressed carries the pigment. */}
        <div className="dabs">
          <button className="go dab" disabled={running} onClick={() => void act(window.api.runStart({ stopAt, pauseAtActs }))}>Start</button>
          <button className="dab" disabled={!running} onClick={() => void window.api.runPause()}>Pause</button>
        </div>
        <div className="controls">
          <label className="chip">Stop at <select value={stopAt} onChange={e => { touched.current = true; setStopAt(e.target.value as typeof stopAt) }}>{STOP_AT.map(s => <option key={s} value={s}>{s}</option>)}</select></label>
          <label className="chip"><input type="checkbox" checked={pauseAtActs} onChange={e => { touched.current = true; setPauseAtActs(e.target.checked) }} /> Pause at act checkpoints</label>
        </div>
        {error && <p role="alert">{error}</p>}
        {/* The easel: the live scene pinned at wall scale with the run's paint landing on it; the run sheet under it, or alone when nothing is being written. */}
        <div className="easel">
          {live && <SceneCard card={live} events={events.get(live.id)} />}
          <article className={`run-facts card paper status-${run.status}${live ? '' : ' focal'}`} aria-label="Run state" style={{ ['--r' as string]: live ? '0.7deg' : '-0.8deg' }}>
            <Tape at={live ? 62 : 40} />
            <span className="status">{WORD[run.status]}</span>
            <p className="run-label">{label}</p>
            {parked.length > 0 && <p><button className="link" onClick={() => go('needs-you')}>Open Needs you</button> to read the reviews and release it.</p>}
            {run.current && <p>Step: {run.current.kind} {run.current.id}</p>}
            <p>Spent so far: <b>{usd(run.spentUsd)}</b></p>
            {cp && <p>Next act checkpoint: after {cp.after}</p>}
            {run.status === 'usage-limit' && run.resumeAfter && <p>Resumes after: {run.resumeAfter}</p>}
            {run.lastError && <p className="note">Last error: {run.lastError}</p>}
            <p className="muted">Spending is shown, never capped.</p>
          </article>
        </div>
        {/* The queue: what the run takes next, in outline order, pinned under the easel as on the Outline wall. */}
        <section className="queue" aria-labelledby="queue-title">
          {/* A parked scene stops the run before any of these; revisions the reviewers ask for run before any scene. */}
          <h3 id="queue-title" className="marker" tabIndex={-1} style={{ ['--act' as string]: 'var(--act-3)' }}>Up next<small>{
            blocked ? `waiting until you release ${blocked}` : queue.length === 0 ? 'nothing left to take' : `${queue.length} scene${queue.length === 1 ? '' : 's'} left, in outline order; revisions first`
          }</small></h3>
          {queue.length === 0
            ? <p className="empty">{data && Object.keys(data.scenes).length ? 'Every scene is accepted or waiting on you; the run has nothing more to take.' : 'The outline has no scenes yet.'}</p>
            : <ul className="stack">{queue.slice(0, QUEUE).map(c => <li key={c.id}><SceneCard card={c} growing={growing === c.id} onOpen={() => show(c.id)} /></li>)}</ul>}
          {queue.length > QUEUE && <p className="muted more">{queue.length - QUEUE} more after these, on the <button className="link" onClick={() => go('outline')}>Outline</button>.</p>}
        </section>
      </div>
      {open && data && <SceneDialog id={open} data={data} onClose={hide} />}
      <div className="run-log">
        <h3 className="marker" style={{ ['--act' as string]: 'var(--act-2)' }}>Log</h3>
        <div ref={strip} className="log paper" role="log" aria-label="Run log" tabIndex={0} onScroll={e => { const el = e.currentTarget; atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40 }}>
          <ol>{shown.length ? shown.map(l => <Line key={l.n} text={l.text} />) : <li className="muted">Nothing has run since Novel Brain opened. Each step the run takes is listed here.</li>}</ol>
        </div>
      </div>
    </section>
  )
}

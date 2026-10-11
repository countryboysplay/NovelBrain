import { useEffect, useRef, useState } from 'react'
import type { ViewProps } from '../views'
import { localDay, spendSummary } from '../lib/selectors'
import { usd } from '../lib/format'
import { Tape } from '../paint'

export function CostView({ state, data, mem }: ViewProps) {
  const s = spendSummary(data?.spend ?? [], state.run?.spentUsd ?? 0, mem, localDay(new Date()))
  const up = state.services.codeburn === 'up'
  // Focus inside a <webview> matches no :focus selector; the window blurs instead, so draw the ring from that (WCAG 2.4.7).
  const [inside, setInside] = useState(false)
  useEffect(() => {
    const blur = () => setInside(document.activeElement?.tagName === 'WEBVIEW'), focus = () => setInside(false)
    window.addEventListener('blur', blur); window.addEventListener('focus', focus)
    return () => { window.removeEventListener('blur', blur); window.removeEventListener('focus', focus) }
  }, [])
  // The sheet loads, shows, or gives up: a dead port (did-fail-load) or ten quiet seconds falls back to the explained empty state.
  // Restart Codeburn re-arms it (a new attempt, a fresh <webview>) even when the status still reads up on the same port.
  const frame = useRef<HTMLElement>(null)
  const [sheet, setSheet] = useState<'loading' | 'shown' | 'failed'>('loading')
  const [attempt, setAttempt] = useState(0)
  const restart = () => { setSheet('loading'); setAttempt(a => a + 1); void window.api.restartService('codeburn') }
  useEffect(() => {
    setSheet('loading')
    const w = frame.current
    if (!up || !w) return
    const ok = () => setSheet(x => (x === 'loading' ? 'shown' : x))
    const bad = (e: Event) => { if ((e as Event & { errorCode?: number }).errorCode !== -3) setSheet('failed') } // -3 is an aborted load, not a dead service
    w.addEventListener('did-finish-load', ok); w.addEventListener('did-fail-load', bad)
    const t = setTimeout(() => setSheet(x => (x === 'loading' ? 'failed' : x)), 10_000)
    return () => { w.removeEventListener('did-finish-load', ok); w.removeEventListener('did-fail-load', bad); clearTimeout(t) }
  }, [up, state.ports.codeburn, attempt])
  const line = (label: string, value: string, sub = false) => <div className={sub ? 'sub' : undefined}><dt>{label}</dt> <dd>{value}</dd></div>
  return (
    <section className="view cost" aria-labelledby="view-title">
      <h2 id="view-title">Cost</h2>
      <p className="muted">Spending is shown, never capped. A Claude plan usage limit pauses the run until it resets.</p>
      {/* One ledger sheet pinned to the wall: the day's total at the top, the book's run under it, then the lines it is made of. */}
      <div className="ledger paper">
        <Tape at={46} />
        <h3 className="marker" style={{ ['--act' as string]: 'var(--ink-ultra)' }}>Ledger</h3>
        <dl className="lines">
          {line('Today:', usd(s.today))}
          {line('Run today:', usd(s.runToday), true)}
          {line('Memory today:', usd(s.memoryToday), true)}
          {line("This book's run:", usd(s.run))}
          {line('Itemised:', usd(s.itemised), true)}
          {s.earlier > 0.005 && line('Earlier, not itemised:', usd(s.earlier), true)}
          {line('Memory, all books:', usd(s.memory))}
          {mem && line('Memory runs today:', `${mem.runsToday} · ${mem.queued} queued`, true)}
        </dl>
        <div className="sheets">
          <table aria-label="Spending by step kind">
            <thead><tr><th scope="col">Step</th><th scope="col">Spent</th></tr></thead>
            <tbody>{(['scene', 'revise', 'chapter', 'act', 'book'] as const).map(k => <tr key={k}><th scope="row">{k === 'revise' ? 'Revisions' : `${k[0].toUpperCase()}${k.slice(1)} steps`}</th><td>{usd(s.byKind[k])}</td></tr>)}</tbody>
          </table>
          {s.byScene.length > 0 && (
            <table aria-label="Spending by scene">
              <thead><tr><th scope="col">Scene</th><th scope="col">Spent</th></tr></thead>
              <tbody>{s.byScene.slice(0, 30).map(x => <tr key={x.id}><th scope="row">{data?.scenes[x.id]?.plan?.title ?? x.id} ({x.id})</th><td>{usd(x.usd)}</td></tr>)}</tbody>
            </table>
          )}
        </div>
      </div>
      <section className="codeburn-sheet" aria-labelledby="codeburn-title">
        <h3 id="codeburn-title">Codeburn</h3>
        {up && sheet !== 'failed'
          ? (
            <>
              <p className="muted">Cost by model, project and day, from Claude Code's own usage records.</p>
              <div className={`codeburn-frame${sheet === 'loading' ? ' loading' : ''}`}>
                <webview key={attempt} ref={frame} partition="codeburn" className={`codeburn${inside ? ' focused' : ''}`} src={`http://localhost:${state.ports.codeburn}`} title="Codeburn usage dashboard" aria-busy={sheet === 'loading'} />
                {sheet === 'loading' && <p className="codeburn-wait" role="status">Loading Codeburn…</p>}
              </div>
            </>
          )
          : (
            <p className="empty">
              {up ? `The Codeburn dashboard did not answer on port ${state.ports.codeburn}, so it is not shown.` : `The Codeburn dashboard is not here: the service is ${state.services.codeburn}.`}
              {' '}It reads Claude Code's usage records and shows cost by model, project and day once it is up.{' '}
              <button onClick={restart}>Restart Codeburn</button>
            </p>
          )}
      </section>
    </section>
  )
}

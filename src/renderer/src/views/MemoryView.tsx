import { useEffect, useRef, useState } from 'react'
import type { ViewProps } from '../views'
import type { LessonLogEntry, LessonView, MemoryLessons } from '../../../shared/types'
import { usd } from '../lib/format'

// Shows what Plan 4b's memory runner and auditor did; builds no audit logic.
export function MemoryView({ state, mem, setMem }: ViewProps) {
  const [lessons, setLessons] = useState<MemoryLessons>({ lessons: [], log: [] })
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const bookDir = state.book?.dir
  const bookRef = useRef(bookDir)
  bookRef.current = bookDir

  useEffect(() => {
    let cancelled = false // a late reply for the previous book must not overwrite this one
    const load = () => void window.api.memoryLessons().then(l => { if (!cancelled) setLessons(l) })
    load()
    const off = window.api.onMemoryState(load) // every memory push may carry a checkpoint's verdicts
    return () => { cancelled = true; off() }
  }, [bookDir])

  const live = lessons.lessons.filter(l => l.status === 'live')
  const probation = lessons.lessons.length - live.length
  // One group per checkpoint run, newest first.
  const groups: { key: string; head: string; entries: LessonLogEntry[] }[] = []
  for (const e of lessons.log) {
    const key = `${e.at} ${e.checkpoint}`
    const g = groups.find(x => x.key === key)
    if (g) g.entries.push(e)
    else groups.push({ key, head: `${e.checkpoint} · ${e.by} · ${e.at.slice(0, 10)}`, entries: [e] })
  }
  groups.reverse()

  const remove = async (l: LessonView) => {
    setBusy(true)
    try {
      const r = await window.api.memoryDeleteLesson(l.file)
      setNote(r.ok ? `${l.name} deleted.` : `${l.name} was not deleted: ${r.error}`)
      setMem(await window.api.memoryStatus())
      const fresh = await window.api.memoryLessons()
      if (bookRef.current === bookDir) setLessons(fresh) // the book may have changed meanwhile
    } finally { setBusy(false) }
  }

  return (
    <section className="view memory" aria-labelledby="view-title">
      <h2 id="view-title">Memory</h2>
      {mem && <p aria-live="polite">Memory: {mem.queued} lessons queued · {probation} on probation · {mem.runsToday} runs today · {usd(mem.spentToday)} today · {usd(mem.spentUsd)} in all</p>}
      <button onClick={() => void window.api.memoryOpen()}>Open memory folder</button>
      {mem && mem.log.length > 0 && <p className="muted">{mem.log[mem.log.length - 1]}</p>}
      {note && <p role="alert">{note}</p>}
      <section className="paper needs" aria-labelledby="lessons-title">
        <h3 id="lessons-title">Lessons</h3>
        {!live.length ? <p className="empty">No lessons yet. Memory learns from your sessions at each chapter and act checkpoint.</p> : (
          <ul aria-label="Lessons">
            {live.map(l => (
              <li key={l.file}>
                <strong>{l.name}</strong> ({l.scope} {l.type}): {l.summary}{' '}
                <button disabled={busy} title={busy ? 'Wait for the current decision to finish.' : undefined} aria-label={`Delete lesson ${l.name}`} onClick={() => void remove(l)}>Delete</button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="paper needs" aria-labelledby="audit-title">
        <h3 id="audit-title">Checkpoint log</h3>
        {!groups.length ? <p className="empty">No checkpoint has run yet. Each chapter and act checkpoint lists the lessons it added, rewrote, retired or deleted, with the auditor's reasons.</p> : (
          <ol aria-label="Lesson audit log">
            {groups.map((g, i) => (
              <li key={g.key}>
                <details open={i === 0}>
                  <summary>{g.head}</summary>
                  <ul>{g.entries.map((e, j) => <li key={j}><strong>{e.lesson}</strong> {e.action}: {e.reason}</li>)}</ul>
                </details>
              </li>
            ))}
          </ol>
        )}
      </section>
    </section>
  )
}

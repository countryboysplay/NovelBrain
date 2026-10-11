import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { SeriesBook } from '../../../shared/studio'
import { AUDIENCES, GENRES } from '../../../shared/schemas'
import type { ViewProps } from '../views'
import { titleCase } from '../lib/format'
import { jitter, pigments } from '../lib/selectors'
import { Tape } from '../paint'

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { ref.current?.showModal() }, [])
  return <dialog ref={ref} className="paper" aria-label={title} onClose={onClose}><h3>{title}</h3>{children}</dialog>
}

export function SeriesView({ state, data }: ViewProps) {
  const [books, setBooks] = useState<SeriesBook[]>([])
  const [mode, setMode] = useState<'archive' | 'sequel' | null>(null)
  const [confirm, setConfirm] = useState('')
  const [form, setForm] = useState({ title: '', audience: 'adult' as (typeof AUDIENCES)[number], genre: 'literary' as (typeof GENRES)[number] })
  const [error, setError] = useState('')
  const [table, setTable] = useState(false)
  useEffect(() => { void window.api.studioSeries().then(setBooks) }, [state.book?.dir, state.book?.status])
  const [seriesName, setSeriesName] = useState('')
  const [seriesMsg, setSeriesMsg] = useState('')
  const [savingSeries, setSavingSeries] = useState(false)
  useEffect(() => { setSeriesName(data?.book?.series ?? '') }, [data?.book?.series, state.book?.dir])
  const b = state.book
  if (!b) return <section className="view"><h2 id="view-title">Series</h2><p className="empty">Open a book to see its series.</p></section>
  const chars = [...new Set(books.flatMap(x => x.characters))]
  const pig = data ? pigments(data) : {}
  const pigment = (n: string) => pig[data?.characters.find(c => c.name === n)?.id ?? ''] ?? 'grey' // the open book's cast has its pigments; a sibling's is grey
  const done = (r: { ok: boolean; error?: string }) => { setError(r.error ?? ''); if (r.ok) setMode(null) }
  return (
    <section className="view series" aria-labelledby="view-title">
      <h2 id="view-title">Series</h2>
      <ol className="shelf" aria-label="Books in this series">
        {books.map(x => (
          <li key={x.dir} className={`card paper spine${x.current ? ' current' : ''}`} style={{ ['--r' as string]: `${jitter(x.id, -1.4, 1.4).toFixed(2)}deg` }}>
            <Tape at={jitter(x.id, 30, 64)} />
            <h4>{x.title}</h4>
            <p className="meta">{x.status === 'archived' ? 'Archived' : 'Active'}{x.current ? ' · open now' : ''}{x.predecessor ? ` · follows ${books.find(p => p.id === x.predecessor)?.title ?? x.predecessor}` : ''}</p>
            {x.characters.length > 0 && <ul className="cast" aria-label={`Cast of ${x.title}`}>{x.characters.map(c => <li key={c} style={{ ['--c' as string]: `var(--${pigment(c)})` }}><i aria-hidden="true" />{c}</li>)}</ul>}
            {!x.current && <button onClick={() => void window.api.openBook(x.dir)}>Open {x.title}</button>}
          </li>
        ))}
      </ol>
      <div className="actions">
        {b.status === 'active' && (
          <form className="series-name" onSubmit={e => { e.preventDefault(); setSavingSeries(true); void window.api.setSeries(seriesName.trim() || null).then(r => setSeriesMsg(r.ok ? 'Saved.' : r.error ?? 'Not saved.')).finally(() => setSavingSeries(false)) }}>
            <label>Part of a series <input value={seriesName} onChange={e => { setSeriesName(e.target.value); setSeriesMsg('') }} placeholder="wild-hearts" aria-describedby="series-memory" /></label>
            <button type="submit" disabled={savingSeries}>{savingSeries ? 'Saving…' : 'Save series'}</button>
            <p className="muted" id="series-memory">Changing the series starts this book's series memory under the new name. Lessons kept under the old name stay there.</p>
            <p role="status" aria-label="Series result">{seriesMsg}</p>
          </form>
        )}
        {b.status === 'active' && <button onClick={() => { setConfirm(''); setMode('archive') }}>Archive this book…</button>}
        {b.status === 'archived' && <button className="go" onClick={() => setMode('sequel')}>Start a sequel…</button>}
      </div>
      <p className="muted">A sequel is a new book beside this one. It copies the bible, reads this book's canon as reference, and shares series memory. Series promotion into one shared repository is not in this version yet.</p>
      {chars.length > 0 && <label className="chip"><input type="checkbox" checked={table} onChange={e => setTable(e.target.checked)} /> Show as table</label>}
      {chars.length > 0 && table && (
        <table className="paper" aria-label="Characters by book">
          <thead><tr><th scope="col">Character</th>{books.map(x => <th key={x.dir} scope="col">{x.title}</th>)}</tr></thead>
          <tbody>{chars.map(c => <tr key={c}><th scope="row">{c}</th>{books.map(x => <td key={x.dir}>{x.characters.includes(c) ? 'yes' : ''}</td>)}</tr>)}</tbody>
        </table>
      )}
      {mode === 'archive' && (
        <Modal title={`Archive ${b.title}`} onClose={() => setMode(null)}>
          <p>Archiving stops any run and makes this book read-only for Claude. There is no un-archive. A sequel needs the previous book archived.</p>
          <label>Type the title to confirm <input value={confirm} onChange={e => setConfirm(e.target.value)} /></label>
          <div className="actions"><button onClick={() => setMode(null)}>Cancel</button><button className="go" disabled={confirm !== b.title} onClick={() => void window.api.archiveBook().then(done)}>Archive</button></div>
          {error && <p role="alert">{error}</p>}
        </Modal>
      )}
      {mode === 'sequel' && (
        <Modal title="Start a sequel" onClose={() => setMode(null)}>
          <form onSubmit={e => { e.preventDefault(); void window.api.sequelBook({ title: form.title, audience: form.audience, genres: [form.genre], wordTarget: 80000 }).then(done) }}>
            <label>Title <input value={form.title} required onChange={e => setForm({ ...form, title: e.target.value })} /></label>
            <label>Audience <select value={form.audience} onChange={e => setForm({ ...form, audience: e.target.value as typeof form.audience })}>{AUDIENCES.map(a => <option key={a} value={a}>{titleCase(a)}</option>)}</select></label>
            <label>Genre <select value={form.genre} onChange={e => setForm({ ...form, genre: e.target.value as typeof form.genre })}>{GENRES.map(g => <option key={g} value={g}>{titleCase(g)}</option>)}</select></label>
            <div className="actions"><button type="button" onClick={() => setMode(null)}>Cancel</button><button className="go" type="submit">Create</button></div>
            {error && <p role="alert">{error}</p>}
          </form>
        </Modal>
      )}
    </section>
  )
}

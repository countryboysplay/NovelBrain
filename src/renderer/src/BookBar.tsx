import { useState } from 'react'
import { Logo } from './Logo'
import type { AppState } from '../../shared/types'

const AUDIENCES = ['early-chapter', 'middle-grade', 'young-adult', 'new-adult', 'adult'] as const
const GENRES = ['literary', 'mystery', 'thriller', 'romance', 'fantasy', 'science-fiction', 'horror', 'historical'] as const

export function BookBar({ state }: { state: AppState }) {
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [audience, setAudience] = useState<(typeof AUDIENCES)[number]>('adult')
  const [genre, setGenre] = useState<(typeof GENRES)[number]>('literary')
  const [error, setError] = useState('')

  const create = async () => {
    const r = await window.api.newBook({ title, audience, genres: [genre], wordTarget: 80000 })
    if (r.ok) setCreating(false)
    else if (r.error !== 'cancelled') setError(r.error)
  }

  return (
    <header className="bookbar" aria-label="Novel Brain">
      <Logo />
      <h1>{state.book ? state.book.title : 'No book open'}</h1>
      {state.book?.status === 'archived' && <span className="badge">Archived</span>}
      <button onClick={() => void window.api.pickBook()}>Open book…</button>
      <button onClick={() => setCreating(true)}>New book…</button>
      {creating && (
        <form className="newbook" onSubmit={e => { e.preventDefault(); void create() }}>
          <label>Title <input value={title} onChange={e => setTitle(e.target.value)} required /></label>
          <label>Audience <select value={audience} onChange={e => setAudience(e.target.value as typeof audience)}>{AUDIENCES.map(a => <option key={a}>{a}</option>)}</select></label>
          <label>Genre <select value={genre} onChange={e => setGenre(e.target.value as typeof genre)}>{GENRES.map(g => <option key={g}>{g}</option>)}</select></label>
          <button type="submit">Create</button>
          <button type="button" onClick={() => setCreating(false)}>Cancel</button>
          {error && <p role="alert">{error}</p>}
        </form>
      )}
      {state.errors.length > 0 && (
        <details className="errors" open>
          <summary>{state.errors.length} problem{state.errors.length === 1 ? '' : 's'} in this book</summary>
          <ul>{state.errors.map((e, i) => <li key={i}><code>{e.file}</code> {e.message}</li>)}</ul>
        </details>
      )}
    </header>
  )
}

import { useEffect, useRef, useState } from 'react'
import { AUDIENCES, GENRES } from '../../../shared/schemas'
import { titleCase } from '../lib/format'

export function NewBookForm({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [title, setTitle] = useState('')
  const [audience, setAudience] = useState<(typeof AUDIENCES)[number]>('adult')
  const [genre, setGenre] = useState<(typeof GENRES)[number]>('literary')
  const [error, setError] = useState('')
  useEffect(() => { ref.current?.showModal() }, [])
  const create = async () => {
    const r = await window.api.newBook({ title, audience, genres: [genre], wordTarget: 80000 })
    if (r.ok) onClose()
    else if (r.error !== 'cancelled') setError(r.error)
  }
  return (
    <dialog ref={ref} className="paper" aria-labelledby="newbook-title" onClose={onClose}>
      <form onSubmit={e => { e.preventDefault(); void create() }}>
        <h2 id="newbook-title">New book</h2>
        <label>Title <input value={title} onChange={e => setTitle(e.target.value)} required autoFocus /></label>
        <label>Audience <select value={audience} onChange={e => setAudience(e.target.value as typeof audience)}>{AUDIENCES.map(a => <option key={a} value={a}>{titleCase(a)}</option>)}</select></label>
        <label>Genre <select value={genre} onChange={e => setGenre(e.target.value as typeof genre)}>{GENRES.map(g => <option key={g} value={g}>{titleCase(g)}</option>)}</select></label>
        <div className="actions"><button type="button" onClick={() => ref.current?.close()}>Cancel</button><button className="go" type="submit">Create</button></div>
        {error && <p role="alert">{error}</p>}
      </form>
    </dialog>
  )
}

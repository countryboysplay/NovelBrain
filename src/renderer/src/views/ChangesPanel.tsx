import { useEffect, useRef, useState } from 'react'
import type { AppState, ChangePreview, ChangeSummary } from '../../../shared/types'

// Author changes Claude wrote to notes/changes/; only the app applies them, after the writer approves.
export function ChangesPanel({ state }: { state: AppState }) {
  const [changes, setChanges] = useState<ChangeSummary[]>(state.changes)
  const [open, setOpen] = useState<string | null>(null)
  const [preview, setPreview] = useState<(ChangePreview & { id: string }) | null>(null)
  const [result, setResult] = useState('')
  const [busy, setBusy] = useState(false)
  const wanted = useRef<string | null>(null) // the latest preview asked for; older replies are dropped

  useEffect(() => setChanges(state.changes), [state.changes])
  // Claude writes change files from the terminal; poll so new ones show up.
  useEffect(() => {
    if (!state.book) return
    const t = setInterval(() => void window.api.changeList().then(setChanges), 3000)
    return () => clearInterval(t)
  }, [state.book])

  if (!state.book || changes.length === 0) return result ? <p aria-live="polite" className="changes-result">{result}</p> : null
  const running = state.run?.status === 'running'

  const show = async (id: string) => {
    setOpen(id)
    setPreview(null)
    wanted.current = id
    const p = await window.api.changePreview(id)
    if (wanted.current === id) setPreview({ ...p, id })
  }
  // Approve sends the token of the preview the writer saw; the app refuses if anything changed since.
  const token = (id: string) => (open === id && preview?.id === id && preview.ok ? preview.token : null)
  const decide = async (id: string, approve: boolean) => {
    const t = token(id)
    if (approve && !t) return
    setBusy(true)
    try {
      const r = await (approve && t ? window.api.changeApply(id, t) : window.api.changeReject(id))
      setResult(r.ok ? `${id} ${approve ? 'applied' : 'rejected'} (commit ${r.commit}).` : `${id} was not ${approve ? 'applied' : 'rejected'}: ${r.reasons.join('; ')}`)
      setOpen(null)
      setPreview(null)
      setChanges(await window.api.changeList())
    } finally { setBusy(false) }
  }

  return (
    <section className="needs paper" aria-label="Author changes">
      <h3>Changes waiting for you</h3>
      <ul>
        {changes.map(c => (
          <li key={c.id}>
            <strong>{c.id}</strong>: {c.summary}{c.files.length > 0 && <span> ({c.files.join(', ')})</span>}{' '}
            <button aria-expanded={open === c.id} aria-label={`Preview ${c.id}`} onClick={() => void (open === c.id ? (setOpen(null), setPreview(null)) : show(c.id))}>Preview</button>
            <button disabled={busy || running || !token(c.id)} title={busy ? 'Wait for the current decision to finish.' : running ? 'Pause the run to approve or reject a change.' : token(c.id) ? undefined : 'Preview the change first'} aria-label={`Approve ${c.id}`} onClick={() => void decide(c.id, true)}>Approve</button>
            <button disabled={busy || running} title={busy ? 'Wait for the current decision to finish.' : running ? 'Pause the run to approve or reject a change.' : undefined} aria-label={`Reject ${c.id}`} onClick={() => void decide(c.id, false)}>Reject</button>
            {open === c.id && (
              preview?.id !== c.id ? <p>Loading preview…</p>
                : !preview.ok ? <p role="alert">{preview.error}</p>
                  : preview.files.map(f => (
                    <div key={f.file} className="diff" role="group" aria-label={f.file}>
                      <h4>{f.file}</h4>
                      <div className="diff-cols">
                        <pre tabIndex={0} aria-label={`${f.file} before`}>{f.before || '(new file)'}</pre>
                        <pre tabIndex={0} aria-label={`${f.file} after`}>{f.after}</pre>
                      </div>
                    </div>
                  ))
            )}
          </li>
        ))}
      </ul>
      {running && <p>Pause the run to approve or reject a change.</p>}
      {result && <p aria-live="polite" className="changes-result">{result}</p>}
    </section>
  )
}

import { useState } from 'react'
import type { MemoryStatus } from '../../../shared/types'

// What the memory distiller proposes; a skill reaches a book only after the writer approves it.
export function SkillProposals({ mem, running, setMem }: { mem: MemoryStatus; running: boolean; setMem: (m: MemoryStatus) => void }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('')
  if (!mem.proposals.length && !result) return null
  const why = busy ? 'Wait for the current decision to finish.' : running ? 'Pause the run before approving skills.' : undefined
  const decide = async (name: string, approve: boolean) => {
    setBusy(true)
    try {
      const r = await (approve ? window.api.memoryApprove(name) : window.api.memoryReject(name))
      setResult(r.ok ? `${name} ${approve ? 'approved' : 'rejected'}.` : `${name} was not ${approve ? 'approved' : 'rejected'}: ${r.error}`)
      setMem(await window.api.memoryStatus())
    } finally { setBusy(false) }
  }
  return (
    <section className="needs paper" aria-labelledby="skills-title">
      <h3 id="skills-title">Proposed skills</h3>
      <ul>
        {mem.proposals.map(p => (
          <li key={p.name}>
            <strong>{p.name}</strong>: {p.description}{' '}
            <button disabled={busy || running} title={why} aria-label={`Approve skill ${p.name}`} onClick={() => void decide(p.name, true)}>Approve</button>
            <button disabled={busy || running} title={why} aria-label={`Reject skill ${p.name}`} onClick={() => void decide(p.name, false)}>Reject</button>
            <details><summary>Show the skill</summary><pre tabIndex={0}>{p.text}</pre></details>
          </li>
        ))}
      </ul>
      {result && <p aria-live="polite">{result}</p>}
    </section>
  )
}

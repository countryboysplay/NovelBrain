import { useEffect, useState } from 'react'
import type { ManuscriptScene } from '../../../shared/studio'
import type { ViewProps } from '../views'

const FONTS = { atkinson: 'var(--font-ui)', serif: "Georgia, Cambria, 'Times New Roman', serif", dyslexic: "'OpenDyslexic', var(--font-ui)" } as const

export function ManuscriptView({ state, data, settings, save, go }: ViewProps) {
  const [scenes, setScenes] = useState<ManuscriptScene[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [result, setResult] = useState('')
  const accepted = data ? Object.values(data.scenes).filter(s => s.accepted).length : 0
  useEffect(() => { void window.api.studioManuscript().then(setScenes) }, [state.book?.dir, accepted])
  const r = settings.ui.reader
  const [exp, setExp] = useState({ busy: false, text: '' })
  const exportCopy = async () => {
    setExp({ busy: true, text: 'Exporting…' })
    const res = await window.api.exportReadingCopy()
    setExp({ busy: false, text: res.ok ? 'Saved PDF and EPUB in exports.' : `Not exported: ${res.error}` })
  }
  const propose = async (id: string) => {
    const res = await window.api.changePropose(id, draft)
    setResult(res.ok ? `Saved as ${res.id}. Preview and approve it in Needs you.` : `Not saved: ${res.error}`)
    if (res.ok) setEditing(null)
  }
  return (
    <section className="view manuscript" aria-labelledby="view-title">
      <h2 id="view-title">Manuscript</h2>
      <div className="reader-tools" role="group" aria-label="Reading settings">
        <fieldset><legend>Font</legend>
          {([['atkinson', 'Atkinson Hyperlegible'], ['serif', 'Serif'], ['dyslexic', 'OpenDyslexic (dyslexia-friendly)']] as const).map(([v, label]) => (
            <label key={v}><input type="radio" name="reader-font" checked={r.font === v} onChange={() => void save({ ui: { reader: { font: v } } })} /> {label}</label>
          ))}
        </fieldset>
        <label>Text size <input type="range" min={14} max={32} step={1} value={r.size} onChange={e => void save({ ui: { reader: { size: Number(e.target.value) } } })} /> <output>{r.size}px</output></label>
        <label>Line spacing <input type="range" min={1.2} max={2.4} step={0.1} value={r.spacing} onChange={e => void save({ ui: { reader: { spacing: Number(e.target.value) } } })} /> <output>{r.spacing.toFixed(1)}</output></label>
      </div>
<div className="actions" role="group" aria-label="Export">        <button onClick={() => void exportCopy()} disabled={exp.busy || scenes.length === 0} aria-busy={exp.busy}>Export reading copy</button>        {exp.text.startsWith('Saved') && <button className="link" onClick={() => void window.api.exportOpenFolder()}>Open folder</button>}        <p role="status" aria-label="Export result">{exp.text}</p>      </div>
      <p role="status" aria-label="Edit result">{result}</p>
      {result.startsWith('Saved') && <button className="link" onClick={() => go('needs-you')}>Go to Needs you</button>}
      {scenes.length === 0 ? <p className="empty">No scene is accepted yet. Accepted scenes appear here in outline order.</p> : (
        <div className="reader paper" style={{ fontFamily: FONTS[r.font], fontSize: `${r.size}px`, lineHeight: r.spacing }}>
          {scenes.map((s, i) => (
            <article key={s.id} aria-labelledby={`ms-${s.id}`}>
              {(i === 0 || scenes[i - 1].chapter !== s.chapter) && <h3 className="chapter">{s.chapterTitle}</h3>}
              <h4 id={`ms-${s.id}`} className="scene-title">{s.title} <span className="muted">{s.id}</span></h4>
              {editing === s.id ? (
                <>
                  <textarea aria-label={`Text of ${s.id}`} value={draft} onChange={e => setDraft(e.target.value)} rows={Math.max(8, draft.split('\n').length + 2)} />
                  <div className="actions">
                    <button onClick={() => setEditing(null)}>Cancel</button>
                    <button className="go" disabled={draft === s.text || state.book?.status !== 'active'} onClick={() => void propose(s.id)}>Propose this edit</button>
                  </div>
                  <p className="muted">Your edit is saved as an author change. It changes the manuscript only after you preview and approve it in Needs you.</p>
                </>
              ) : (
                <>
                  <p className="prose">{s.text}</p>
                  {state.book?.status === 'active' && <button className="link" aria-label={`Edit ${s.id}`} onClick={() => { setEditing(s.id); setDraft(s.text); setResult('') }}>Edit</button>}
                </>
              )}
              {i < scenes.length - 1 && scenes[i + 1].chapter === s.chapter && <hr aria-hidden="true" />}
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

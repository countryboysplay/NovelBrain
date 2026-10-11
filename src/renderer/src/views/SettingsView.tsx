import { useEffect, useState } from 'react'
import type { ViewProps } from '../views'
import { shownName, useCrew } from '../lib/crew'
import { usd } from '../lib/format'
import { Avatar } from '../Avatar'

export function SettingsView({ settings, save, state }: ViewProps) {
  const [models, setModels] = useState({
    showrunner: settings.models.showrunner, model: settings.memory.model, deepModel: settings.memory.deepModel,
    auditModel: settings.memory.auditModel, deepAuditModel: settings.memory.deepAuditModel,
    indexCap: String(settings.memory.indexCap), stopAt: String(settings.usage.stopAt)
  })
  // Read fresh: the App's copy is loaded once, and the runner records the version at every step.
  const [claude, setClaude] = useState<string | null>(settings.claudeVersion)
  useEffect(() => { void window.api.settingsGet().then(s => setClaude(s.claudeVersion)) }, [])
  const commit = () => void save({
    models: { showrunner: models.showrunner },
    memory: { model: models.model, deepModel: models.deepModel, auditModel: models.auditModel, deepAuditModel: models.deepAuditModel, indexCap: Number(models.indexCap) },
    usage: { stopAt: Number(models.stopAt) }
  })
  const radio = (group: string, value: string, current: string, label: string, apply: () => void) =>
    <label><input type="radio" name={group} checked={current === value} onChange={apply} /> {label}</label>
  const model = (key: 'showrunner' | 'model' | 'deepModel' | 'auditModel' | 'deepAuditModel', label: string) =>
    <label>{label} <input list="models" autoComplete="off" spellCheck={false} pattern="[A-Za-z0-9._:-]+" value={models[key]} onChange={e => setModels({ ...models, [key]: e.target.value })} onBlur={commit} /></label>
  return (
    <section className="view settings" aria-labelledby="view-title">
      <h2 id="view-title">Settings</h2>
      <fieldset className="paper"><legend>Theme</legend>
        {radio('theme', 'system', settings.ui.theme, 'Follow Windows', () => void save({ ui: { theme: 'system' } }))}
        {radio('theme', 'night', settings.ui.theme, 'Night studio', () => void save({ ui: { theme: 'night' } }))}
        {radio('theme', 'day', settings.ui.theme, 'Daylight studio', () => void save({ ui: { theme: 'day' } }))}
      </fieldset>
      <fieldset className="paper"><legend>Motion</legend>
        {radio('motion', 'system', settings.ui.motion, 'Follow Windows', () => void save({ ui: { motion: 'system' } }))}
        {radio('motion', 'reduced', settings.ui.motion, 'Reduced', () => void save({ ui: { motion: 'reduced' } }))}
      </fieldset>
      <fieldset className="paper"><legend>Plan usage</legend>
        <label>Usage stop point (%) <input type="number" min={1} max={100} value={models.stopAt} onChange={e => setModels({ ...models, stopAt: e.target.value })} onBlur={commit} /></label>
        <p className="muted">Before each step, the run stops when either plan usage window is at or over this percent.</p>
      </fieldset>
      <fieldset className="paper"><legend>Headroom</legend>
        <label><input type="checkbox" checked={settings.headroom} disabled={state.installed.headroom === false} onChange={e => void save({ headroom: e.target.checked })} /> Route Claude through Headroom</label>
        <p className="muted">Takes effect when Claude restarts.</p>
      </fieldset>
      <fieldset className="paper"><legend>Models</legend>
        <datalist id="models"><option value="opus" /><option value="sonnet" /><option value="haiku" /></datalist>
        {model('showrunner', 'Showrunner model')}
        {model('model', 'Distiller model')}
        {model('deepModel', 'Deep pass model')}
        {model('auditModel', 'Auditor model')}
        {model('deepAuditModel', 'Deep auditor model')}
        <label>Index lines <input type="number" min={1} max={1000} value={models.indexCap} onChange={e => setModels({ ...models, indexCap: e.target.value })} onBlur={commit} /></label>
        <p className="muted">Reviewer and author models follow the book kit's defaults. A model name that is not valid is ignored and the previous one kept. If the two auditor models are the same, both go back to their defaults. Memory is always on; its status and lessons are in the Memory view.</p>
      </fieldset>
      <fieldset className="paper"><legend>Claude Code</legend>
        <p>{claude ? `Claude Code ${claude}, checked at the last step.` : 'No step has run yet, so the Claude Code version is not known.'}</p>
        <p className="muted">Every step checks that Claude Code loaded this book's hooks and kit. If it did not, the run stops before anything is written.</p>
      </fieldset>
      <CrewSection />
    </section>
  )
}

// Names, about lines and portraits are the agents' own and display only: prompts, review files and acceptance keep role ids.
function CrewSection() {
  const c = useCrew()
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null) // the role redrawing itself: a paid call of up to 2 minutes
  if (!c) return null
  const forget = (role: string) => setDraft(d => { const { [role]: _, ...rest } = d; return rest })
  const act = async (role: string, p: Promise<{ ok: true } | { ok: false; error: string }>, done: string) => {
    const r = await p
    setMsg(r.ok ? done : r.error)
    if (r.ok) forget(role)
  }
  const redraw = async (role: string, label: string) => {
    setBusy(role)
    setMsg(`The ${label} is drawing itself again…`)
    try { await act(role, window.api.crewRedraw(role), `The ${label} drew itself again.`) } finally { setBusy(null) }
  }
  return (
    <fieldset className="paper crew"><legend>Crew</legend>
      <p className="muted">Each agent chose its own name, drew its own portrait and wrote its own line. You can rename one or ask it to draw itself again; the drawing and the line stay its own. {c.making ? 'Drawing now. ' : ''}Portraits so far: <span className="num">{usd(c.spentUsd)}</span>.</p>
      <ul className="crew-list">
        {c.members.map(m => (
          <li key={m.role}>
            <Avatar member={m} role={m.role} size={48} />
            <div>
              <p className="who"><strong>{shownName(m, m.role)}</strong>{!m.clash && <> <span className="muted">{m.label}</span></>}</p>
              {m.clash === 'name' && <p className="warn">This name is also a character or place in this book. Please rename it.</p>}
              {m.clash === 'about' && <p className="warn">This member's line names a character or place in this book. Redraw to get a new one.</p>}
              {m.about && <p className="about">{m.about}</p>}
              <div className="crew-edit">
                <label><span className="sr-only">{m.label} </span>Name <input value={draft[m.role] ?? m.name ?? ''} maxLength={20} disabled={!m.name} onChange={e => setDraft({ ...draft, [m.role]: e.target.value })} /></label>
                <button type="button" aria-label={`Rename ${m.label}`} disabled={!m.name || c.making || !!busy} onClick={() => void act(m.role, window.api.crewRename(m.role, draft[m.role] ?? m.name ?? ''), `Renamed the ${m.label.toLowerCase()}.`)}>Rename</button>
                <button type="button" aria-label={`Redraw ${m.label}`} disabled={c.making || !!busy} onClick={() => void redraw(m.role, m.label.toLowerCase())}>Redraw</button>
              </div>
            </div>
          </li>
        ))}
      </ul>
      <p role="status">{msg ?? ''}</p>
    </fieldset>
  )
}

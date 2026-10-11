import { useEffect, useRef, useState } from 'react'
import { EXPORT_FONTS, EXPORT_TRIMS, type ExportSettingsT, type KdpExport, type PublishState } from '../../../shared/export'
import type { ViewProps } from '../views'

const FONT_NAMES: Record<(typeof EXPORT_FONTS)[number], string> = { 'eb-garamond': 'EB Garamond', 'crimson-pro': 'Crimson Pro', 'libre-baskerville': 'Libre Baskerville' }
const trimName = (t: string) => `${t.replace('x', ' x ')} in`
const PAGES: [keyof ExportSettingsT, string][] = [['dedication', 'Dedication'], ['epigraph', 'Epigraph'], ['acknowledgements', 'Acknowledgements'], ['aboutAuthor', 'About the author']]

export function PublishView({ state, data, go }: ViewProps) {
  const [ps, setPs] = useState<PublishState | null>(null)
  const [form, setForm] = useState<ExportSettingsT | null>(null)
  const [alsoBy, setAlsoBy] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [result, setResult] = useState<KdpExport | null>(null)
  const dir = state.book?.dir
  const dirRef = useRef(dir)
  dirRef.current = dir
  const accepted = data ? Object.values(data.scenes).filter(s => s.accepted).length : 0
  const load = async () => {
    const r = await window.api.publishRead()
    setPs(r)
    if (r) { setForm(r.settings); setAlsoBy(r.settings.alsoBy.join('\n')) }
  }
  useEffect(() => { void load() }, [state.book?.dir, state.book?.status, accepted])
  if (!ps || !form) return <section className="view publish" aria-labelledby="view-title"><h2 id="view-title">Publish</h2><p className="empty">Open a book to publish it.</p></section>
  const set = <K extends keyof ExportSettingsT>(k: K, v: ExportSettingsT[K]) => setForm({ ...form, [k]: v })
  const ro = !ps.editable
  const save = async () => {
    setBusy(true)
    const r = await window.api.publishSet({ ...form, alsoBy: alsoBy.split('\n').map(t => t.trim()).filter(Boolean) })
    if (dirRef.current !== dir) { setBusy(false); setMsg(''); return }
    setBusy(false)
    setMsg(r.ok ? 'Saved.' : `Not saved: ${r.error}`)
    if (r.ok) await load()
  }
  const exportNow = async () => {
    setBusy(true); setMsg('Laying out the book. This can take a minute…')
    const r = await window.api.publishExport()
    if (dirRef.current !== dir) { setBusy(false); setMsg(''); return }
    setBusy(false); setResult(r)
    setMsg(r.ok ? 'Exported the KDP interior PDF and the EPUB to exports.' : `Not exported: ${r.error ?? 'preflight found problems'}`)
    await load()
  }
  const checks = result && !result.ok && result.checks.length ? result.checks : ps.checks
  const blocked = ps.checks.some(c => !c.ok) || !!ps.error
  return (
    <section className="view publish" aria-labelledby="view-title">
      <h2 id="view-title">Publish</h2>
      {ps.why && <p className="muted">{ps.why}</p>}
      {ps.error && <p role="alert">{ps.error}. The defaults are shown; Save replaces the block.</p>}
      <div className="publish-cols">
        <form className="paper" aria-label="Publish settings" onSubmit={e => { e.preventDefault(); void save() }}>
          <fieldset disabled={ro}><legend>Print</legend>
            <label>Trim size <select value={form.trim} onChange={e => set('trim', e.target.value as ExportSettingsT['trim'])}>{EXPORT_TRIMS.map(t => <option key={t} value={t}>{trimName(t)}</option>)}</select></label>
            <label>Paper <select value={form.paper} onChange={e => set('paper', e.target.value as ExportSettingsT['paper'])}><option value="cream">Cream</option><option value="white">White</option></select></label>
            <label>Font <select value={form.font} onChange={e => set('font', e.target.value as ExportSettingsT['font'])}>{EXPORT_FONTS.map(f => <option key={f} value={f}>{FONT_NAMES[f]}</option>)}</select></label>
            <label>Font size <select value={form.fontSize} onChange={e => set('fontSize', Number(e.target.value))}>{[10, 10.5, 11, 11.5, 12].map(n => <option key={n} value={n}>{n} pt</option>)}</select></label>
            <fieldset><legend>Chapters start</legend>
              <label><input type="radio" name="chapter-start" checked={form.chapterStart === 'next-page'} onChange={() => set('chapterStart', 'next-page')} /> On the next page</label>
              <label><input type="radio" name="chapter-start" checked={form.chapterStart === 'recto'} onChange={() => set('chapterStart', 'recto')} /> On a right-hand page</label>
            </fieldset>
          </fieldset>
          <fieldset disabled={ro}><legend>Pages</legend>
            <label>Author <input value={form.author} onChange={e => set('author', e.target.value)} /></label>
            <label>Copyright line <input value={form.copyright} placeholder={`© ${new Date().getFullYear()} ${form.author || 'Author'}. All rights reserved.`} onChange={e => set('copyright', e.target.value)} /></label>
            <label>ISBN (optional) <input value={form.isbn} inputMode="numeric" onChange={e => set('isbn', e.target.value)} /></label>
            {PAGES.map(([k, label]) => (
              <label key={k}>{label} <textarea rows={3} value={form[k] as string} onChange={e => set(k, e.target.value as never)} /></label>
            ))}
            <label>Also by (one title per line) <textarea rows={3} value={alsoBy} onChange={e => setAlsoBy(e.target.value)} /></label>
            <p className="muted">A page you leave empty is left out of the book.</p>
          </fieldset>
          <div className="actions"><button type="submit" disabled={ro || busy}>Save publish settings</button></div>
        </form>
        <div>
          <section className="paper" aria-labelledby="preflight-title">
            <h3 id="preflight-title">Preflight</h3>
            <ul className="checks">
              {checks.map(c => (
                <li key={c.id}>
                  <span>{c.ok ? 'Pass: ' : 'Fix: '}</span>{c.message}
                  {c.link && <> <button className="link" onClick={() => go(c.link!.view)}>Open {c.link.scene} in {c.link.view === 'outline' ? 'Outline' : 'Manuscript'}</button></>}
                </li>
              ))}
            </ul>
            <p className="muted">Page count, margins and blank pages are checked when you export.</p>
            <div className="actions">
              <button className="go" onClick={() => void exportNow()} disabled={busy || blocked} aria-busy={busy}>Export for KDP</button>
              {ps.last && <button className="link" onClick={() => void window.api.exportOpenFolder()}>Open folder</button>}
            </div>
            <p role="status" aria-label="Publish result">{msg}</p>
          </section>
          {ps.last && (
            <section className="paper" aria-labelledby="last-title">
              <h3 id="last-title">Last export</h3>
              <p>{ps.last.pages} pages, {trimName(ps.last.trim)}, {ps.last.paper} paper, gutter {ps.last.gutter} in, spine {ps.last.spineWidth} in.</p>
              <p className="muted">The cover arrives in a later version; it will use this page count and spine width.</p>
            </section>
          )}
        </div>
      </div>
    </section>
  )
}

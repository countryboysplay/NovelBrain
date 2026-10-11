import { useEffect, useRef, useState, type PointerEvent } from 'react'
import type { AppState, InitResult, MemoryStatus, PublicSettings, SettingsPatch } from '../../shared/types'
import { Setup } from './Setup'
import { PaintDefs, Splats } from './paint'
import { TopBar } from './shell/TopBar'
import { Rail } from './shell/Rail'
import { TerminalStrip } from './shell/TerminalStrip'
import { StatusBar } from './shell/StatusBar'
import { useStudio } from './lib/useStudio'
import { reducedMotion } from './lib/motion'
import { appendLog, type LogLine } from './lib/selectors'
import { isViewId, type ViewId, type ViewProps } from './views'
import { BibleView } from './views/BibleView'
import { TimelineView } from './views/TimelineView'
import { ManuscriptView } from './views/ManuscriptView'
import { SeriesView } from './views/SeriesView'
import { OutlineView } from './views/OutlineView'
import { CostView } from './views/CostView'
import { MemoryView } from './views/MemoryView'
import { StoryMapView } from './views/StoryMapView'
import { SettingsView } from './views/SettingsView'
import { RunView } from './views/RunView'
import { NeedsYouView } from './views/NeedsYouView'
import { PublishView } from './views/PublishView'
import { RoomView } from './views/RoomView'

const VIEWS: Record<ViewId, (p: ViewProps) => JSX.Element> = {
  bible: BibleView, outline: OutlineView, timeline: TimelineView, series: SeriesView, manuscript: ManuscriptView,
  run: RunView, room: RoomView, 'needs-you': NeedsYouView, publish: PublishView, cost: CostView, memory: MemoryView, 'story-map': StoryMapView, settings: SettingsView
}
const merge = (s: PublicSettings, p: SettingsPatch): PublicSettings => ({
  ...s, ...p, ui: { ...s.ui, ...p.ui, reader: { ...s.ui.reader, ...p.ui?.reader }, roomSeen: { ...s.ui.roomSeen, ...p.ui?.roomSeen } },
  models: { ...s.models, ...p.models }, memory: { ...s.memory, ...p.memory }, usage: { ...s.usage, ...p.usage }
})
// Under 1300px the terminal folds on its own (the saved setting stands); Ctrl+` and the tab then open it for a look.
const narrowQuery = window.matchMedia('(max-width: 1300px)')
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(narrowQuery.matches)
  useEffect(() => { const on = () => setNarrow(narrowQuery.matches); narrowQuery.addEventListener('change', on); return () => narrowQuery.removeEventListener('change', on) }, [])
  return narrow
}
// #view is a Tab stop so a view with nothing focusable (Cost, Story map) still scrolls by keyboard (axe scrollable-region-focusable).
const REGIONS = ['.term-body', '.rail', '#view']

export function App() {
  const [init, setInit] = useState<InitResult | null>(null)
  const [state, setState] = useState<AppState | null>(null)
  const [settings, setSettings] = useState<PublicSettings | null>(null)
  const [mem, setMem] = useState<MemoryStatus | null>(null)
  const [log, setLog] = useState<LogLine[]>([])
  const narrow = useNarrow()
  const [peek, setPeek] = useState(false) // the terminal on a narrow window: opened for a look, never saved
  const data = useStudio(state)
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  useEffect(() => {
    void window.api.init().then(r => { setInit(r); if (r.mode === 'studio') setState(r.state) })
    void window.api.settingsGet().then(setSettings)
    void window.api.memoryStatus().then(setMem)
    const offs = [
      window.api.onState(setState),
      window.api.onMemoryState(setMem),
      window.api.onRunLog(l => setLog(x => appendLog(x, l))),
      window.api.onMenu(() => void window.api.setupCheck().then(steps => { setState(null); setInit({ mode: 'setup', steps }) }))
    ]
    return () => offs.forEach(off => off())
  }, [])

  // The patch shows at once (a checked radio flips on the click, not after the round-trip); main's validated copy then replaces it, or the old one comes back.
  // Only the latest save's reply lands (an older one would undo a newer patch); a refused one reloads main's copy.
  const seq = useRef(0)
  const save = async (patch: SettingsPatch) => {
    const n = ++seq.current
    const before = settingsRef.current
    if (before) setSettings(merge(before, patch))
    const r = await window.api.settingsSet(patch)
    if (n !== seq.current) return
    const next = r.ok ? r.settings : await window.api.settingsGet()
    if (n === seq.current) setSettings(next)
  }
  const go = (v: ViewId) => void save({ tab: v })

  useEffect(() => { document.documentElement.dataset.motion = settings?.ui.motion === 'reduced' ? 'reduced' : '' }, [settings?.ui.motion])

  // F6 / Shift+F6 cycle terminal, rail and view (the terminal's keyboard escape, WCAG 2.1.2); Ctrl+` folds the terminal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F6') {
        e.preventDefault(); e.stopPropagation()
        const targets = [document.querySelector<HTMLElement>('.term-body:not([hidden]) .xterm-helper-textarea'), document.querySelector<HTMLElement>('.rail [aria-current="page"]'), document.getElementById('view')]
        const at = REGIONS.findIndex(sel => document.activeElement?.closest(sel))
        for (let i = 1; i <= 3; i++) {
          const t = targets[(at + (e.shiftKey ? -i : i) + 3) % 3]
          if (t) { t.focus(); return }
        }
      }
      if (e.ctrlKey && e.code === 'Backquote') {
        e.preventDefault(); e.stopPropagation()
        const s = settingsRef.current
        if (narrowQuery.matches) setPeek(p => !p); else if (s) void save({ ui: { terminalOpen: !s.ui.terminalOpen } })
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  if (!init) return null
  if (init.mode === 'setup' && !state) return <Setup initial={init.steps} onDone={s => setState(s)} />
  if (!state || !settings) return null
  const view: ViewId = isViewId(settings.tab) ? settings.tab : 'outline'
  const View = VIEWS[view]
  const lamp = (e: PointerEvent<HTMLElement>) => {
    if (view === 'manuscript' || reducedMotion()) return
    const r = e.currentTarget.getBoundingClientRect()
    e.currentTarget.style.setProperty('--lx', `${((e.clientX - r.left) / r.width) * 100}%`)
    e.currentTarget.style.setProperty('--ly', `${((e.clientY - r.top) / r.height) * 100}%`)
  }
  return (
    <div className="studio" data-view={view}>
      <PaintDefs />
      <a className="skip" href="#view">Skip to the view</a>
      <TopBar state={state} data={data} mem={mem} go={go} />
      <div className="main">
        <TerminalStrip open={narrow ? peek : settings.ui.terminalOpen} width={settings.ui.terminalWidth} onToggle={() => { if (narrow) setPeek(!peek); else void save({ ui: { terminalOpen: !settings.ui.terminalOpen } }) }}
          onWidth={px => void save({ ui: { terminalWidth: px } })} project={state.book?.dir ?? null} />
        <Rail view={view} go={go} state={state} data={data} mem={mem} />
        <main id="view" className="wall" tabIndex={0} aria-labelledby="view-title" onPointerMove={lamp}>
          <View key={state.book?.dir ?? 'none'} state={state} data={data} mem={mem} setMem={setMem} settings={settings} save={save} go={go} log={log} />
          <Splats seed={view} />
        </main>
      </div>
      <StatusBar state={state} data={data} />
    </div>
  )
}

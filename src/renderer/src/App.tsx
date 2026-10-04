import { useEffect, useState } from 'react'
import type { AppState, InitResult } from '../../shared/types'
import { Setup } from './Setup'
import { Terminal } from './Terminal'
import { BookBar } from './BookBar'
import { RunBar } from './RunBar'
import { ChangesPanel } from './ChangesPanel'

export function App() {
  const [init, setInit] = useState<InitResult | null>(null)
  const [state, setState] = useState<AppState | null>(null)

  useEffect(() => {
    void window.api.init().then(r => {
      setInit(r)
      if (r.mode === 'studio') setState(r.state)
    })
    const offs = [
      window.api.onState(setState),
      window.api.onMenu(() => {
        void window.api.setupCheck().then(steps => {
          setState(null)
          setInit({ mode: 'setup', steps })
        })
      })
    ]
    return () => offs.forEach(off => off())
  }, [])

  if (!init) return null
  if (init.mode === 'setup' && !state)
    return <Setup initial={init.steps} onDone={s => setState(s)} />
  if (!state) return null
  return (
    <div className="studio">
      <BookBar state={state} />
      <RunBar state={state} />
      <ChangesPanel state={state} />
      <div className="term-pane"><Terminal project={state.book?.dir ?? null} /></div>
    </div>
  )
}

import type { AppState } from '../../../shared/types'
import type { StudioData } from '../../../shared/studio'
import { nextCheckpoint, wordStats } from '../lib/selectors'
import { wordsLong } from '../lib/format'
import { useTween } from '../lib/motion'

export function StatusBar({ state, data }: { state: AppState; data: StudioData | null }) {
  const w = data ? wordStats(data) : null
  const shown = useTween(w?.words ?? 0)
  const cp = data ? nextCheckpoint(data) : null
  return (
    <footer className="foot">
      {(['codeburn', 'headroom'] as const).map(s => <span key={s} className={`svc svc-${state.services[s]}`}><span className="dot-mark" aria-hidden="true" />{s === 'codeburn' ? 'Codeburn' : 'Headroom'}: {state.services[s]}</span>)}
      {data && <span>git · {data.git.commits} commits · {data.git.clean ? 'clean' : 'uncommitted changes'}</span>}
      <span className="sp" />
      {w && <><span>{wordsLong(shown)} of {wordsLong(w.target)} words</span><meter className="meter" min={0} max={1} value={w.ratio} aria-label="Words written of the target" /></>}
      {cp && <span className="cp">Act checkpoint after {cp.after}</span>}
    </footer>
  )
}

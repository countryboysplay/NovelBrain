import type { AppState, MemoryStatus } from '../../../shared/types'
import type { StudioData } from '../../../shared/studio'
import type { ViewId } from '../views'
import { needsYou, wordStats } from '../lib/selectors'
import { wordsShort } from '../lib/format'

type Item = { id: ViewId | 'art'; label: string; pigment: string }
const SECTIONS: { title: string; items: Item[] }[] = [
  { title: 'Story', items: [{ id: 'bible', label: 'Bible', pigment: 'phthalo' }, { id: 'outline', label: 'Outline', pigment: 'yellow' }, { id: 'timeline', label: 'Timeline', pigment: 'sienna' }, { id: 'series', label: 'Series', pigment: 'magenta' }] },
  { title: 'Write', items: [{ id: 'manuscript', label: 'Manuscript', pigment: 'ultra' }, { id: 'run', label: 'Run', pigment: 'red' }, { id: 'room', label: "Writers' room", pigment: 'magenta' }, { id: 'needs-you', label: 'Needs you', pigment: 'red' }] },
  { title: 'Publish', items: [{ id: 'art', label: 'Art & Cover', pigment: 'magenta' }, { id: 'publish', label: 'Publish', pigment: 'phthalo' }] },
  { title: 'Studio', items: [{ id: 'cost', label: 'Cost', pigment: 'grey' }, { id: 'memory', label: 'Memory', pigment: 'grey' }, { id: 'story-map', label: 'Story map', pigment: 'grey' }, { id: 'settings', label: 'Settings', pigment: 'grey' }] }
]

export function Rail({ view, go, state, data, mem }: { view: ViewId; go: (v: ViewId) => void; state: AppState; data: StudioData | null; mem: MemoryStatus | null }) {
  const count: Partial<Record<Item['id'], string>> = data ? {
    bible: String(data.characters.length + data.places.length + data.world.length),
    outline: String(Object.keys(data.scenes).length),
    timeline: String(data.events.length),
    manuscript: wordsShort(wordStats(data).words)
  } : {}
  const need = needsYou(state, mem?.proposals.length ?? 0)
  if (need) count['needs-you'] = String(need)
  return (
    <nav className="rail" aria-label="Studio">
      {SECTIONS.map(s => (
        <div key={s.title} role="group" aria-labelledby={`rail-${s.title}`}>
          <p id={`rail-${s.title}`} className="rail-title">{s.title}</p>
          <ul>
            {s.items.map(it => {
              const placeholder = it.id === 'art'
              const on = it.id === view
              return (
                <li key={it.id}>
                  <button className={on ? 'on' : undefined} style={{ ['--c' as string]: `var(--${it.pigment})` }}
                    aria-current={on ? 'page' : undefined} aria-disabled={placeholder || undefined} aria-describedby={placeholder ? 'rail-later' : undefined}
                    onClick={() => { if (!placeholder) go(it.id as ViewId) }}>
                    <span className="dot" aria-hidden="true" />{it.label}{count[it.id] && <b> {count[it.id]}{it.id === 'manuscript' && <span className="sr-only"> words</span>}</b>}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
      <p id="rail-later" hidden>Not in this version yet</p>
    </nav>
  )
}

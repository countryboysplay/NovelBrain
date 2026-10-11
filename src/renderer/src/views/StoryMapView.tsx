import type { ViewProps } from '../views'
import { pigments, storyGraph } from '../lib/selectors'

const W = 1000, H = 700
export function StoryMapView({ data }: ViewProps) {
  if (!data) return <section className="view"><h2 id="view-title">Story map</h2></section>
  const g = storyGraph(data)
  const pig = pigments(data)
  const at = new Map(g.nodes.map(n => [n.id, n]))
  const label = (id: string) => at.get(id)?.label ?? id
  const summary = `Story map: ${data.characters.length} characters, ${data.places.length} places, ${g.edges.length} connections`
  return (
    <section className="view story-map" aria-labelledby="view-title">
      <h2 id="view-title">Story map</h2>
      <p className="muted">Drawn from the bible, the scene plans and the timeline: who shares scenes, and where.</p>
      <svg className="map" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary}>
        <g filter="url(#brush)">
          {g.edges.map(e => { const a = at.get(e.a)!, b = at.get(e.b)!; return <line key={`${e.a}${e.b}`} x1={a.x * W} y1={a.y * H} x2={b.x * W} y2={b.y * H} stroke="var(--line)" strokeWidth={2 + e.scenes.length * 2} strokeLinecap="round" /> })}
        </g>
        {g.nodes.map(n => (
          <g key={n.id} transform={`translate(${n.x * W} ${n.y * H})`}>
            <circle r={14 + n.links * 3} fill={n.kind === 'character' ? `var(--${pig[n.id] ?? 'grey'})` : 'var(--sienna)'} filter="url(#rough)" />
            <text y={30 + n.links * 3} textAnchor="middle" className="map-label">{n.label}</text>
          </g>
        ))}
      </svg>
      <table className="paper" aria-label="Connections">
        <thead><tr><th scope="col">Between</th><th scope="col">Scenes and events</th></tr></thead>
        <tbody>{g.edges.map(e => <tr key={`${e.a}${e.b}`}><th scope="row">{label(e.a)} and {label(e.b)}</th><td>{e.scenes.join(', ')}</td></tr>)}</tbody>
      </table>
    </section>
  )
}

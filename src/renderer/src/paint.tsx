import type { Verdict } from '../../shared/studio'
import { reviewerName, useCrew } from './lib/crew'

// Painted marks are decoration: aria-hidden, and the text beside each one carries the meaning.
export function PaintDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
      <defs>
        <filter id="rough"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves={2} seed={4} /><feDisplacementMap in="SourceGraphic" scale={3.2} /></filter>
        <filter id="pencil"><feTurbulence type="fractalNoise" baseFrequency=".016" numOctaves={2} seed={3} /><feDisplacementMap in="SourceGraphic" scale={12} /></filter>
        <filter id="brush"><feTurbulence type="fractalNoise" baseFrequency=".035 .6" numOctaves={3} seed={9} /><feDisplacementMap in="SourceGraphic" scale={7} /></filter>
      </defs>
    </svg>
  )
}
export const Tape = ({ at }: { at: number }) => <span className="tape" style={{ left: `${at}%` }} aria-hidden="true" />
export const Underline = ({ color }: { color: string }) => (
  <svg className="underline" viewBox="0 0 200 12" preserveAspectRatio="none" aria-hidden="true" focusable="false">
    <path className="draw" style={{ ['--len' as string]: 220 }} d="M2 7 C50 2 110 11 198 5" stroke={color} strokeWidth={5} strokeLinecap="round" fill="none" filter="url(#rough)" />
  </svg>
)
// A loop drawn round the card from outside: a rounded rectangle in CSS pixels (sized in views.css), roughened by the filter.
export const Circle = () => (
  <svg className="circle" aria-hidden="true" focusable="false">
    <g fill="none" stroke="var(--red)" strokeLinecap="round" filter="url(#pencil)">
      <rect pathLength={100} strokeWidth={4.5} />
      <rect className="again" pathLength={100} strokeWidth={2.5} strokeDasharray="34 66" strokeDashoffset={-8} />
    </g>
  </svg>
)
// A well per reviewer: dry (no verdict yet), filled with the verdict's pigment, a stroke over flag and fail so colour is never the only sign.
// The reviewer and verdict are the item's name (screen readers) and its tooltip; the verdict pills were text, these are paint.
export function Wells({ verdicts, fresh }: { verdicts: Pick<Verdict, 'reviewer' | 'verdict'>[]; fresh?: Set<string> }) {
  const crew = useCrew()
  return (
    <ul className="wells" aria-label="Reviewer verdicts">
      {verdicts.map(v => (
        <li key={v.reviewer} className={`well v-${v.verdict.toLowerCase()}${fresh?.has(`verdict:${v.reviewer}`) ? ' fresh' : ''}`} title={`${reviewerName(crew, v.reviewer)}: ${v.verdict.toLowerCase()}`}>
          <i aria-hidden="true" />
          {v.verdict !== 'PASS' && (
            <svg className="mark" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
              {v.verdict === 'FAIL' ? <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" /> : <path d="M4 11.5c2.5-4 4.5 3.5 7 0s4.5-3 5 0" />}
            </svg>
          )}
          <span className="sr-only">{reviewerName(crew, v.reviewer)}: {v.verdict.toLowerCase()}</span>
        </li>
      ))}
    </ul>
  )
}
// Paint that missed the canvas: a band after the view's content, so it only ever lands on empty wall.
const SPLAT = ['magenta', 'sienna', 'ultra', 'phthalo', 'yellow', 'red'] as const
export const Splats = ({ seed }: { seed: string }) => {
  let h = 0
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) | 0
  const a = SPLAT[(h >>> 0) % SPLAT.length], b = SPLAT[((h >>> 4) + 2) % SPLAT.length]
  return (
  <div className="splats" aria-hidden="true" style={{ ['--sa' as string]: `var(--${a})`, ['--sb' as string]: `var(--${b})`, ['--flip' as string]: (h >>> 8) % 2 ? -1 : 1 }}>
    <svg viewBox="0 0 120 90" focusable="false">
      <g filter="url(#rough)"><circle cx="40" cy="40" r="14" fill="var(--sa)" opacity=".35" /><circle cx="70" cy="66" r="4" fill="var(--sa)" opacity=".35" /></g>
    </svg>
    <svg viewBox="0 0 320 90" focusable="false">
      <g filter="url(#rough)">
        <circle cx="300" cy="14" r="7" fill="var(--sb)" opacity=".4" /><circle cx="284" cy="6" r="2.5" fill="var(--sb)" opacity=".4" />
        <path d="M10 80 C70 50 150 80 300 30" stroke="var(--phthalo)" strokeWidth="10" fill="none" opacity=".22" strokeLinecap="round" />
      </g>
    </svg>
  </div>
  )
}

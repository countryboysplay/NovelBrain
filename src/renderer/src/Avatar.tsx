import type { CrewMember } from '../../shared/crew'
import { pigmentOf } from '../../shared/crew'
import { shownName } from './lib/crew'

const initials = (s: string) => s.split(/[\s-]+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('')
/** A self-portrait only ever as an <img> (no script runs in one), else initials. Decorative: the name is text beside it. */
export function Avatar({ member, role, size = 32 }: { member?: CrewMember; role: string; size?: number }) {
  const style = { width: size, height: size, ['--c' as string]: `var(--${pigmentOf(role)})` }
  return member?.avatar?.startsWith('data:image/svg+xml;base64,') // never any other source
    ? <img className="avatar" src={member.avatar} alt="" width={size} height={size} style={style} />
    : <span className="avatar initials" aria-hidden="true" style={style}>{initials(shownName(member, role))}</span>
}

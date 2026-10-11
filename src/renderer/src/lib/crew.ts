import { useEffect, useState } from 'react'
import { CREW_ROLES, REVIEWER_ROLE, type CrewMember, type CrewState } from '../../../shared/crew'

let latest: CrewState | null = null
let started = false
const subs = new Set<(c: CrewState) => void>()
const publish = (c: CrewState) => { latest = c; for (const s of subs) s(c) }

/** The crew, loaded once and kept current from crew:state pushes. */
export function useCrew(): CrewState | null {
  const [c, setC] = useState(latest)
  useEffect(() => {
    subs.add(setC)
    if (!started) { started = true; void window.api.crewGet().then(publish, () => { started = false }); window.api.onCrewState(publish) }
    return () => { subs.delete(setC) }
  }, [])
  return c
}
export const roleLabel = (role: string): string => (role === 'app' ? 'Novel Brain' : CREW_ROLES.find(r => r.role === role)?.label ?? role)
export const memberOf = (c: CrewState | null, role: string): CrewMember | undefined => c?.members.find(m => m.role === role)
/** A member's own name, unless it is missing or clashes with this book's bible: then the role label. */
export const shownName = (m: CrewMember | undefined, role: string): string => (m?.name && !m.clash ? m.name : roleLabel(role))
/** Display only: "Name (reviewer)". Review files, verdicts and acceptance keep the reviewer id. */
export const reviewerName = (c: CrewState | null, reviewer: string): string => {
  const role = (REVIEWER_ROLE as Record<string, string>)[reviewer] ?? reviewer
  return `${shownName(memberOf(c, role), role)} (${reviewer})`
}

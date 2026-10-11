import type { REVIEWERS } from './schemas'

// The writers' room: the 13 kit agents and the showrunner. Pigments are the studio's own (tokens.css).
export const CREW_ROLES = [
  { role: 'showrunner', label: 'Showrunner', pigment: 'red' },
  { role: 'story-architect', label: 'Story architect', pigment: 'sienna' },
  { role: 'author', label: 'Author', pigment: 'ultra' },
  { role: 'canon-keeper', label: 'Canon keeper', pigment: 'phthalo' },
  { role: 'canon-auditor', label: 'Canon auditor', pigment: 'phthalo' },
  { role: 'continuity-reviewer', label: 'Continuity reviewer', pigment: 'sienna' },
  { role: 'character-reviewer', label: 'Character reviewer', pigment: 'magenta' },
  { role: 'developmental-editor', label: 'Developmental editor', pigment: 'yellow' },
  { role: 'line-editor', label: 'Line editor', pigment: 'ultra' },
  { role: 'audience-reviewer', label: 'Audience reviewer', pigment: 'magenta' },
  { role: 'reader', label: 'Reader', pigment: 'yellow' },
  { role: 'arc-auditor', label: 'Arc auditor', pigment: 'red' },
  { role: 'flow-reader', label: 'Flow reader', pigment: 'phthalo' },
  { role: 'gate-checker', label: 'Gate checker', pigment: 'grey' }
] as const

/** The agent that writes each review file (`reviewer:` value to role). */
export const REVIEWER_ROLE: Record<(typeof REVIEWERS)[number], string> = {
  continuity: 'continuity-reviewer', character: 'character-reviewer', developmental: 'developmental-editor', line: 'line-editor',
  audience: 'audience-reviewer', reader: 'reader', 'canon-auditor': 'canon-auditor', gate: 'gate-checker', arc: 'arc-auditor', flow: 'flow-reader'
}
export const pigmentOf = (role: string): string => CREW_ROLES.find(r => r.role === role)?.pigment ?? 'grey'

export interface CrewMember { role: string; label: string; name: string | null; about: string | null; avatar: string | null; clash: 'name' | 'about' | false; renamed: boolean }
export interface CrewState { members: CrewMember[]; spentUsd: number; making: boolean }

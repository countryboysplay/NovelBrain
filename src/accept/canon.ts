import type { z } from 'zod'
import type { Facts, Timeline, Knowledge, Proposal } from '../shared/schemas'

type FactRow = z.infer<typeof Facts>['facts'][number]
type EventRow = z.infer<typeof Timeline>['events'][number]
type KnowledgeRow = z.infer<typeof Knowledge>['entries'][number]
type ProposalT = z.infer<typeof Proposal>
export interface Canon { facts: FactRow[]; events: EventRow[]; entries: KnowledgeRow[] }

const next = (ids: string[], prefix: string) => {
  const max = ids.reduce((m, id) => Math.max(m, Number(id.slice(prefix.length + 1)) || 0), 0)
  return `${prefix}-${String(max + 1).padStart(3, '0')}`
}
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

export function applyProposals(canon: Canon, proposals: ProposalT[], scene: string, known: { chars: Set<string>; places: Set<string> }):
  { ok: true; canon: Canon; added: { facts: string[]; events: string[] } } | { ok: false; errors: string[] } {
  const facts = canon.facts.map(f => ({ ...f }))
  const events = canon.events.map(e => ({ ...e, who: [...e.who] }))
  const entries = canon.entries.map(e => ({ ...e }))
  const added = { facts: [] as string[], events: [] as string[] }
  const errors: string[] = []

  for (const p of proposals) {
    if (p.scene !== scene) { errors.push(`${p.id} is for ${p.scene}, not ${scene}`); continue }
    p.changes.forEach((c, i) => {
      const where = `${p.id} change ${i + 1}`
      const d = c.data
      if (c.target === 'facts' && c.op === 'add') {
        const statement = str(d.statement)
        if (!statement) return errors.push(`${where}: facts/add needs a statement`)
        const id = next(facts.map(f => f.id), 'FACT')
        facts.push({ id, statement, status: 'established', source: scene, supersedes: null })
        added.facts.push(id)
      } else if (c.target === 'facts' && c.op === 'retcon') {
        const statement = str(d.statement)
        const old = facts.find(f => f.id === d.supersedes && f.status === 'established')
        if (!statement || !old) return errors.push(`${where}: retcon needs a statement and an established fact to supersede`)
        old.status = 'superseded'
        const id = next(facts.map(f => f.id), 'FACT')
        facts.push({ id, statement, status: 'established', source: scene, supersedes: old.id })
        added.facts.push(id)
      } else if (c.target === 'facts') {
        errors.push(`${where}: facts are never edited; use retcon`)
      } else if (c.target === 'timeline' && c.op === 'add') {
        const storyTime = str(d.storyTime), what = str(d.what), place = str(d.place)
        const who = Array.isArray(d.who) ? d.who.filter((w): w is string => typeof w === 'string') : []
        if (!storyTime || !what || !place || !known.places.has(place) || who.some(w => !known.chars.has(w)))
          return errors.push(`${where}: timeline/add needs storyTime, what, a known place and known characters`)
        const id = next(events.map(e => e.id), 'TL')
        events.push({ id, storyTime, place, who, what, source: scene })
        added.events.push(id)
      } else if (c.target === 'knowledge' && c.op === 'add') {
        const character = str(d.character), how = str(d.how)
        let fact = str(d.fact)
        const m = fact?.match(/^NEW-(\d+)$/)
        if (m) fact = added.facts[Number(m[1]) - 1] ?? null
        if (!character || !how || !fact || !known.chars.has(character) || !facts.some(f => f.id === fact))
          return errors.push(`${where}: knowledge/add needs a known character, an existing fact and how they learned it`)
        if (!entries.some(e => e.character === character && e.fact === fact)) entries.push({ character, fact, learnedIn: scene, how })
      } else {
        errors.push(`${where}: ${c.target}/${c.op} is not supported`)
      }
    })
  }
  return errors.length ? { ok: false, errors } : { ok: true, canon: { facts, events, entries }, added }
}

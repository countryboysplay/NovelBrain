import type { AppState, RunStateT } from '../../../shared/types'
import type { EventT, FactT, SpendEntry, StudioData, Verdict } from '../../../shared/studio'

export const PIGMENTS = ['phthalo', 'ultra', 'magenta', 'sienna', 'red', 'yellow'] as const
export type Pigment = (typeof PIGMENTS)[number]

/** POV characters own a pigment each, in bible order, then everyone else; pigments repeat after six. */
export function pigments(d: Pick<StudioData, 'characters' | 'scenes'>): Record<string, Pigment> {
  const povs = new Set(Object.values(d.scenes).flatMap(s => (s.plan ? [s.plan.pov] : [])))
  const order = [...d.characters.filter(c => povs.has(c.id)), ...d.characters.filter(c => !povs.has(c.id))]
  return Object.fromEntries(order.map((c, i) => [c.id, PIGMENTS[i % PIGMENTS.length]]))
}

export type CardStatus = 'planned' | 'drafting' | 'review' | 'accepted' | 'needs-you'
export interface Card { id: string; title: string; pov: string | null; povName: string | null; pigment: Pigment | null; status: CardStatus; live: boolean; words: number; verdicts: Verdict[]; note: string | null; redrafted: boolean; beat: string | null }
export interface ActColumn { id: string; title: string; cards: Card[]; summary: string; checked: boolean }

const liveScene = (run: RunStateT | null) => (run?.status === 'running' && run.current?.kind === 'scene' ? run.current.id : null)

// Accepted means the manuscript file exists (only acceptance writes it), whatever the plan says.
export function sceneCard(d: StudioData, id: string, run: RunStateT | null, pig = pigments(d)): Card {
  const s = d.scenes[id]
  const plan = s?.plan ?? null
  const status: CardStatus = s?.accepted ? 'accepted'
    : s?.park || plan?.status === 'needs-you' ? 'needs-you'
    : plan?.status === 'review' || plan?.status === 'drafting' ? plan.status : 'planned'
  return {
    id, title: plan?.title ?? id, pov: plan?.pov ?? null,
    povName: plan ? d.characters.find(c => c.id === plan.pov)?.name ?? plan.pov : null,
    pigment: plan ? pig[plan.pov] ?? null : null,
    status, live: liveScene(run) === id && status !== 'accepted',
    words: s?.words ?? 0, verdicts: s?.verdicts ?? [], note: s?.park ?? null,
    redrafted: (s?.verdicts ?? []).some(v => v.round > 1),
    beat: plan?.arcBeats.find(a => a.character === plan.pov)?.beat ?? null
  }
}

export function actColumns(d: StudioData, run: RunStateT | null): ActColumn[] {
  const pig = pigments(d)
  const live = liveScene(run)
  return d.outline.acts.map(a => {
    const cards = a.chapters.flatMap(c => c.scenes).map(id => sceneCard(d, id, run, pig))
    const need = cards.filter(c => c.status === 'needs-you').length
    const done = cards.filter(c => c.status === 'accepted').length
    const state = need ? `${need} need${need === 1 ? 's' : ''} you`
      : cards.length && done === cards.length ? 'wrapped'
      : cards.some(c => c.id === live) ? 'running' : `${done} accepted`
    return { id: a.id, title: a.title, cards, summary: `${cards.length} scene${cards.length === 1 ? '' : 's'} · ${state}`, checked: !!run?.checkedActs.includes(a.id) }
  })
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })
export const timelineRows = (events: EventT[], order: 'story' | 'file' = 'story'): EventT[] =>
  order === 'file' ? events : [...events].sort((a, b) => collator.compare(a.storyTime, b.storyTime))

export interface KnowRow { fact: FactT; knowers: { character: string; name: string; learnedIn: string; how: string }[] }
export function whoKnows(d: Pick<StudioData, 'facts' | 'knowledge' | 'characters'>): KnowRow[] {
  const name = (id: string) => d.characters.find(c => c.id === id)?.name ?? id
  return d.facts.map(fact => ({ fact, knowers: d.knowledge.filter(k => k.fact === fact.id).map(k => ({ character: k.character, name: name(k.character), learnedIn: k.learnedIn, how: k.how })) }))
}

export interface GraphNode { id: string; label: string; kind: 'character' | 'place'; x: number; y: number; links: number }
export interface GraphEdge { a: string; b: string; scenes: string[] }
export function storyGraph(d: Pick<StudioData, 'characters' | 'places' | 'scenes' | 'events'>): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const known = new Set([...d.characters.map(c => c.id), ...d.places.map(p => p.id)])
  const edges = new Map<string, GraphEdge>()
  const link = (a: string, b: string, src: string) => {
    if (a === b || !known.has(a) || !known.has(b)) return
    const [x, y] = a < b ? [a, b] : [b, a]
    const e = edges.get(`${x} ${y}`) ?? { a: x, b: y, scenes: [] }
    if (!e.scenes.includes(src)) e.scenes.push(src)
    edges.set(`${x} ${y}`, e)
  }
  for (const [id, s] of Object.entries(d.scenes)) {
    if (!s.plan) continue
    link(s.plan.pov, s.plan.location, id)
    for (const a of s.plan.arcBeats) link(s.plan.pov, a.character, id)
  }
  for (const e of d.events) for (const w of e.who) { link(w, e.place, e.source); for (const v of e.who) link(w, v, e.source) }
  const all = [...edges.values()]
  const ring = (items: { id: string; name: string }[], r: number, kind: GraphNode['kind']): GraphNode[] => items.map((it, i) => {
    const t = (2 * Math.PI * i) / Math.max(items.length, 1) - Math.PI / 2
    return { id: it.id, label: it.name, kind, x: 0.5 + r * Math.cos(t), y: 0.5 + r * Math.sin(t), links: all.filter(e => e.a === it.id || e.b === it.id).length }
  })
  return { nodes: [...ring(d.characters, 0.22, 'character'), ...ring(d.places, 0.42, 'place')], edges: all }
}

export function wordStats(d: Pick<StudioData, 'scenes' | 'book'>): { words: number; target: number; ratio: number } {
  const words = Object.values(d.scenes).reduce((n, s) => n + s.words, 0)
  const target = d.book?.wordTarget ?? 0
  return { words, target, ratio: target ? Math.min(words / target, 1) : 0 }
}

/** The next act checkpoint: the first act that still has a scene not accepted. */
export function nextCheckpoint(d: Pick<StudioData, 'outline' | 'scenes'>): { act: string; after: string } | null {
  for (const a of d.outline.acts) {
    const ids = a.chapters.flatMap(c => c.scenes)
    if (ids.some(id => !d.scenes[id]?.accepted)) return { act: a.id, after: ids[ids.length - 1] }
  }
  return null
}

/**
 * The scenes the run will take next, in outline order: not accepted, not parked, and not the one on the easel now.
 * `blocked` names the first parked scene: the run takes nothing until it is released (nextStep's first rule).
 * Revisions the reviewers ask for run before any scene; they are not in StudioData, so the queue cannot show them.
 */
export function upNext(d: StudioData, run: RunStateT | null): { cards: Card[]; blocked: string | null } {
  const pig = pigments(d)
  const live = liveScene(run)
  const all = d.outline.acts.flatMap(a => a.chapters.flatMap(c => c.scenes)).filter(id => id !== live).map(id => sceneCard(d, id, run, pig))
  return { cards: all.filter(c => c.status !== 'accepted' && c.status !== 'needs-you'), blocked: all.find(c => c.status === 'needs-you')?.id ?? null }
}

export interface LogLine { n: number; text: string }
/** The run log keeps its last 200 lines; each line's number keeps counting, so a row's key never shifts once the cap is reached. */
export const appendLog = (log: LogLine[], text: string, keep = 200): LogLine[] => [...log.slice(1 - keep), { n: (log[log.length - 1]?.n ?? -1) + 1, text }]

export const localDay = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export interface SpendSummary { run: number; itemised: number; earlier: number; runToday: number; memory: number; memoryToday: number; today: number; byKind: Record<SpendEntry['kind'], number>; byScene: { id: string; usd: number }[] }
// Rounded to the cent so float noise never shows up as $0.30000000004.
const cents = (n: number) => Math.round(n * 100) / 100
export function spendSummary(spend: SpendEntry[], runTotal: number, memory: { spentUsd: number; spentToday: number } | null, today: string): SpendSummary {
  const sum = (es: SpendEntry[]) => es.reduce((n, e) => n + e.usd, 0)
  const byKind = { scene: 0, revise: 0, chapter: 0, act: 0, book: 0 }
  const scenes = new Map<string, number>()
  for (const e of spend) {
    byKind[e.kind] = cents(byKind[e.kind] + e.usd)
    if (e.kind === 'scene' || e.kind === 'revise') scenes.set(e.id, cents((scenes.get(e.id) ?? 0) + e.usd))
  }
  const itemised = sum(spend)
  const runToday = sum(spend.filter(e => localDay(new Date(e.at)) === today))
  const memoryToday = memory?.spentToday ?? 0
  return {
    run: Math.max(runTotal, itemised), itemised, earlier: Math.max(0, runTotal - itemised), runToday, // the ledger is evidence: the book's run is at least what its steps cost
    memory: memory?.spentUsd ?? 0, memoryToday, today: runToday + memoryToday, byKind,
    byScene: [...scenes].map(([id, usd]) => ({ id, usd })).sort((a, b) => b.usd - a.usd || a.id.localeCompare(b.id))
  }
}

export type StoryEvent = { kind: 'accepted' | 'parked' | 'drafting' | 'redraft'; id: string } | { kind: 'verdict'; id: string; reviewer: string }
const topRound = (c: Card) => Math.max(0, ...c.verdicts.map(v => v.round))
/** What changed on the board between two refreshes. The first render has no events, so motion plays only on story events (R13). */
export function storyEvents(prev: Card[] | null, next: Card[]): StoryEvent[] {
  if (!prev) return []
  const before = new Map(prev.map(c => [c.id, c]))
  const out: StoryEvent[] = []
  for (const c of next) {
    const p = before.get(c.id)
    if (!p) continue
    if (c.status === 'accepted' && p.status !== 'accepted') out.push({ kind: 'accepted', id: c.id })
    if (c.status === 'needs-you' && p.status !== 'needs-you') out.push({ kind: 'parked', id: c.id })
    if (c.live && !p.live) out.push({ kind: 'drafting', id: c.id })
    if (topRound(p) > 0 && topRound(c) > topRound(p)) out.push({ kind: 'redraft', id: c.id })
    for (const v of c.verdicts) {
      const was = p.verdicts.find(x => x.reviewer === v.reviewer)
      if (!was || was.round !== v.round || was.verdict !== v.verdict) out.push({ kind: 'verdict', id: c.id, reviewer: v.reviewer })
    }
  }
  return out
}

export const needsYou = (s: Pick<AppState, 'parked' | 'changes'>, proposals: number): number => s.parked.length + s.changes.length + proposals

/** A stable pseudo-random value per id: card tilt and tape position never jump between refreshes. */
export const jitter = (id: string, lo: number, hi: number): number => {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) | 0
  return lo + (((h >>> 0) % 1000) / 1000) * (hi - lo)
}

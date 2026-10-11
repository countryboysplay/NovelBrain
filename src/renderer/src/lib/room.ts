import type { RoomEntry } from '../../../shared/types'
import { roomChannels, type RoomChannel } from '../../../shared/room'

export interface RoomGroup { step: string; entries: RoomEntry[] }
/** Consecutive entries of one step form a group; a step that comes back later (a revision) starts a new one. */
export function roomGroups(entries: RoomEntry[]): RoomGroup[] {
  const out: RoomGroup[] = []
  for (const e of entries) {
    const last = out.at(-1)
    if (last && last.step === e.step) last.entries.push(e)
    else out.push({ step: e.step, entries: [e] })
  }
  return out
}
/** Who is typing in the running step: the agent dispatched last and not yet answered, else the showrunner; null when no step runs. */
export function typing(entries: RoomEntry[], current: string | null): string | null {
  if (!current) return null
  const group = roomGroups(entries).at(-1)
  if (!group || group.step !== current) return 'showrunner'
  const open: string[] = []
  for (const e of group.entries) {
    if (e.kind === 'dispatch' && e.to) open.push(e.to)
    else if (e.kind === 'reply') { const i = open.lastIndexOf(e.from); if (i >= 0) open.splice(i, 1) }
  }
  return open.at(-1) ?? 'showrunner'
}
/** Entries of a channel newer than the time the writer last viewed it (ISO strings compare as times). */
export const unread = (entries: RoomEntry[], channel: RoomChannel, seen: string | undefined): number =>
  entries.filter(e => (!seen || e.at > seen) && roomChannels(e).includes(channel)).length

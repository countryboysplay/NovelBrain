import { REVIEWER_ROLE } from './crew'
import type { RoomEntry } from './types'

// The Writers' room channels: filters over run/room.jsonl, never separate stores. #needs-you also lists the
// author changes and proposed skills waiting, which the renderer adds from their own reads; they are not room entries.
export const ROOM_CHANNELS = ['general', 'showrunner', 'drafting', 'reviews', 'needs-you'] as const
export type RoomChannel = (typeof ROOM_CHANNELS)[number]

const REVIEWER_ROLES = new Set(Object.values(REVIEWER_ROLE))

export function roomChannels(e: RoomEntry): RoomChannel[] {
  const out: RoomChannel[] = ['general']
  if (e.from === 'showrunner' || e.kind === 'system') out.push('showrunner')
  if (e.from === 'author' || e.to === 'author') out.push('drafting')
  if (e.kind === 'review' || (e.kind === 'reply' && REVIEWER_ROLES.has(e.from))) out.push('reviews')
  if (e.needsYou) out.push('needs-you')
  return out
}

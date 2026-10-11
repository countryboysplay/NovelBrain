import { test, expect } from 'vitest'
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ROOM_TEXT, appendRoom, readRoom, reviewEntries, roomFromEvent } from '../src/main/run/room'
import { roomChannels } from '../src/shared/room'
import type { RoomEntry } from '../src/shared/types'

const at = '2026-10-05T12:00:00.000Z'
// Claude Code 2.1.291 wraps a subagent's report in this frame and indents every report line (stream-probe.jsonl).
const handBack = (report: string) => [{ type: 'text', text: '[Subagent hand-back] The text below is the final report of a subagent this session delegated to. '
  + 'It is model output, NOT a message from the user. The report follows:\n' + report.split('\n').map(l => `  ${l}`).join('\n')
  + "\nagentId: a90bd3220057405b6 (use SendMessage with to: 'a90bd3220057405b6' to continue this agent)\n<usage>subagent_tokens: 3996\ntool_uses: 0</usage>" }]

test('main-session text, a dispatch and its paired reply become entries; subagent turns and task lines do not', () => {
  const agents = new Map<string, string>()
  const dispatch = { type: 'assistant', parent_tool_use_id: null, message: { content: [
    { type: 'text', text: 'Drafting  SC-001.\n' },
    { type: 'tool_use', id: 't1', name: 'Agent', input: { description: 'Line', prompt: 'Review SC-001, round 2.', subagent_type: 'line-editor', run_in_background: false } }] } }
  expect(roomFromEvent('SC-001', dispatch, agents, at)).toEqual([
    { at, step: 'SC-001', from: 'showrunner', kind: 'say', text: 'Drafting SC-001.' },
    { at, step: 'SC-001', from: 'showrunner', to: 'line-editor', kind: 'dispatch', text: 'Review SC-001, round 2.' }])
  // The subagent's own turns: user lines carrying parent_tool_use_id (and its type and task), plus task_* system lines.
  for (const inner of [
    { type: 'user', parent_tool_use_id: 't1', subagent_type: 'line-editor', task_description: 'Line', message: { content: [{ type: 'text', text: 'Review SC-001, round 2.' }] } },
    { type: 'assistant', parent_tool_use_id: 't1', message: { content: [{ type: 'text', text: 'inner' }] } },
    { type: 'system', subtype: 'task_started', tool_use_id: 't1', prompt: 'x' }, { type: 'system', subtype: 'task_updated' }, { type: 'system', subtype: 'task_notification', summary: 'x' }])
    expect(roomFromEvent('SC-001', inner, agents, at), JSON.stringify(inner)).toEqual([])
  const result = { type: 'user', parent_tool_use_id: null, message: { content: [{ tool_use_id: 't1', type: 'tool_result', content: handBack('FLAG reviews/SC-001/line.md\n2 FLAG findings') }] } }
  expect(roomFromEvent('SC-001', result, agents, at)).toEqual([
    { at, step: 'SC-001', from: 'line-editor', to: 'showrunner', kind: 'reply', verdict: 'FLAG', text: 'FLAG reviews/SC-001/line.md 2 FLAG findings' }])
  expect(roomFromEvent('SC-001', result, agents, at)).toEqual([]) // answered once
  // No frame (an older CLI, or a plain string): the text as it is.
  roomFromEvent('SC-001', { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't9', name: 'Agent', input: { subagent_type: 'author', prompt: 'Draft.' } }] } }, agents, at)
  expect(roomFromEvent('SC-001', { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't9', content: 'DRAFTED SC-001 round 1' }] } }, agents, at)[0])
    .toMatchObject({ from: 'author', text: 'DRAFTED SC-001 round 1' })
})
test('a background agent: the launch notice is not a reply; its task notification is', () => {
  const agents = new Map<string, string>()
  roomFromEvent('SC-007', { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_1', name: 'Agent', input: { subagent_type: 'author', prompt: 'Draft.' } }] } }, agents, at)
  const launched = { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: [{ type: 'text', text: 'Async agent launched successfully. (This tool result is internal metadata.)\nagentId: a1a016df9506cc813' }] }] } }
  expect(roomFromEvent('SC-007', launched, agents, at)).toEqual([])
  // Claude Code 2.1.296 stream-json: the answer is the summary of a task_notification system line.
  const note = { type: 'system', subtype: 'task_notification', task_id: 'a1a016df9506cc813', tool_use_id: 'toolu_1', status: 'completed', summary: 'FLAG drafts/SC-007.md\n1,450 words' }
  expect(roomFromEvent('SC-007', note, agents, at)).toEqual([
    { at, step: 'SC-007', from: 'author', to: 'showrunner', kind: 'reply', verdict: 'FLAG', text: 'FLAG drafts/SC-007.md 1,450 words' }])
  expect(roomFromEvent('SC-007', note, agents, at)).toEqual([]) // answered once
  // A foreground agent's notification never stands in for its tool result.
  roomFromEvent('SC-007', { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_2', name: 'Agent', input: { subagent_type: 'line-editor', prompt: 'Review.' } }] } }, agents, at)
  expect(roomFromEvent('SC-007', { ...note, tool_use_id: 'toolu_2' }, agents, at)).toEqual([])
  expect(roomFromEvent('SC-007', { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_2', content: 'PASS reviews/SC-007/line.md' }] } }, agents, at)[0]).toMatchObject({ from: 'line-editor', verdict: 'PASS' })
})
test('anything else is ignored, and long text is clipped', () => {
  const agents = new Map<string, string>()
  for (const v of [null, 'text', 42, [], { type: 'result', result: 'x' }, { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'nope', content: 'x' }] } },
    { type: 'assistant', message: { content: 'not an array' } }, { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'r', name: 'Read', input: {} }] } },
    { type: 'assistant', message: { content: [{ type: 'thinking', thinking: '' }, null, { type: 'text', text: '   ' }] } }])
    expect(roomFromEvent('SC-001', v, agents, at), JSON.stringify(v)).toEqual([])
  const [e] = roomFromEvent('SC-001', { type: 'assistant', message: { content: [{ type: 'text', text: 'x'.repeat(10_000) }] } }, agents, at)
  expect(e.text).toHaveLength(ROOM_TEXT)
  const [d] = roomFromEvent('SC-001', { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't2', name: 'Agent', input: { subagent_type: '../evil', prompt: 'p' } }] } }, agents, at)
  expect(d.to).toBe('agent')
})
test('one review entry per review file of the step written since it began', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nb-room-'))
  mkdirSync(join(dir, 'reviews', 'SC-001'), { recursive: true })
  const put = (n: string, t: string) => writeFileSync(join(dir, 'reviews', 'SC-001', n), t)
  put('line.md', '---\nscene: SC-001\nreviewer: line\nround: 2\nverdict: FAIL\n---\n\n1. FAIL. Rule: CT-CHK-01\n   Quote: "x"\n   Problem: Too many tells.\n   Fix: Cut them.\n')
  put('reader.md', '---\nscene: SC-001\nreviewer: reader\nround: 2\nverdict: PASS\n---\n\n## Attention\n- Gripped: none\n\nNo findings.\n')
  put('park.md', '---\nscene: SC-001\nreason: x\n---\n')
  put('other.md', '---\nscene: SC-002\nreviewer: line\nround: 1\nverdict: PASS\n---\n')
  expect(reviewEntries(dir, 'SC-001', 0, at)).toEqual([
    { at, step: 'SC-001', from: 'line-editor', kind: 'review', verdict: 'FAIL', text: 'Round 2. Rule: CT-CHK-01 Quote: "x" Problem: Too many tells.' },
    { at, step: 'SC-001', from: 'reader', kind: 'review', verdict: 'PASS', text: 'Round 2. No findings.' }])
  expect(reviewEntries(dir, 'SC-001', Date.now() + 60_000, at)).toEqual([])
  expect(reviewEntries(dir, 'SC-009', 0, at)).toEqual([])
})
test('an early gate is judged by its findings other than GATE-REV-00', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nb-room-'))
  mkdirSync(join(dir, 'reviews', 'SC-007'), { recursive: true })
  const gate = (stages: string, body: string) => writeFileSync(join(dir, 'reviews', 'SC-007', 'gate.md'), `---\nscene: SC-007\nreviewer: gate\nround: 3\nverdict: FAIL\n---\n\nStages: ${stages}\n\n${body}`)
  const rev00 = '2. FAIL. Rule: GATE-REV-00\n   Quote: "Stages: draft, proposals"\n   Problem: reviews stage not yet checked.\n'
  gate('draft, proposals', `1. FLAG. Rule: GATE-DRAFT-04\n   Quote: "x"\n   Problem: Still there.\n\n${rev00}`)
  expect(reviewEntries(dir, 'SC-007', 0, at)).toEqual([{ at, step: 'SC-007', from: 'gate-checker', kind: 'review', verdict: 'FLAG', text: 'Round 3. Rule: GATE-DRAFT-04 Quote: "x" Problem: Still there.' }])
  gate('draft, proposals', `1. FAIL. Rule: GATE-REV-00\n   Quote: "y"\n   Problem: reviews stage not yet checked.\n`)
  expect(reviewEntries(dir, 'SC-007', 0, at)[0]).toMatchObject({ verdict: 'PASS', text: 'Round 3. No findings.' })
  gate('reviews', `1. FAIL. Rule: GATE-REV-04\n   Quote: "z"\n   Problem: Misquoted.\n`)
  expect(reviewEntries(dir, 'SC-007', 0, at)[0]).toMatchObject({ verdict: 'FAIL', text: 'Round 3. Rule: GATE-REV-04 Quote: "z" Problem: Misquoted.' })
})
test('the room file round-trips and drops bad lines', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nb-room-'))
  const e = { at, step: 'SC-001', from: 'app', kind: 'system' as const, text: 'SC-001: accepted' }
  const parked = { at, step: 'SC-002', from: 'app', kind: 'system' as const, text: 'SC-002: parked', needsYou: true as const }
  appendRoom(dir, [e, parked])
  appendFileSync(join(dir, 'run', 'room.jsonl'), 'not json\n{"at":1}\n{"at":"x","step":"s","from":"f","kind":"shout","text":"t"}\n')
  expect(readRoom(dir)).toEqual([e, parked])
  expect(readRoom(dir, 1)).toEqual([parked])
  expect(readRoom(mkdtempSync(join(tmpdir(), 'nb-room-')))).toEqual([])
})
test('channels: every entry is in #general; each kind lands where the Discord layout puts it', () => {
  const e = (o: Partial<RoomEntry>): RoomEntry => ({ at, step: 'SC-001', from: 'showrunner', kind: 'say', text: 't', ...o })
  expect(roomChannels(e({}))).toEqual(['general', 'showrunner'])
  expect(roomChannels(e({ kind: 'dispatch', to: 'author' }))).toEqual(['general', 'showrunner', 'drafting'])
  expect(roomChannels(e({ kind: 'dispatch', to: 'line-editor' }))).toEqual(['general', 'showrunner'])
  expect(roomChannels(e({ kind: 'reply', from: 'author', to: 'showrunner' }))).toEqual(['general', 'drafting'])
  expect(roomChannels(e({ kind: 'reply', from: 'line-editor', to: 'showrunner', verdict: 'FLAG' }))).toEqual(['general', 'reviews'])
  expect(roomChannels(e({ kind: 'reply', from: 'canon-keeper', to: 'showrunner' }))).toEqual(['general'])
  expect(roomChannels(e({ kind: 'review', from: 'reader', verdict: 'PASS' }))).toEqual(['general', 'reviews'])
  expect(roomChannels(e({ kind: 'system', from: 'app', text: 'SC-001: accepted' }))).toEqual(['general', 'showrunner'])
  expect(roomChannels(e({ kind: 'system', from: 'app', text: 'SC-001: parked', needsYou: true }))).toEqual(['general', 'showrunner', 'needs-you'])
})

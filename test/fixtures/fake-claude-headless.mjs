// Scripted headless Claude. FAKE_SCENARIO: ok | fail:SC-xxx | limit | prose | hang | nokit | error | lie | forge | revise:CH-xx:SC-yyy | actrevise:ACT-x:SC-yyy | bookrevise:SC-yyy | distill (as ok, plus a memory deep pass). A prompt starting with AUDIT (the memory auditor) gets KEEP for every lesson and skill it is shown. A prompt starting with CREW gets a crew member's name, about line and SVG, with no usage reading. FAKE_LOG: file to append prompts to.
// FAKE_COST: total_cost_usd of every reply (also the error reply). FAKE_NORESULT=<command>: that command replies without a result line.
// Replies are stream-json: an init line, then with FAKE_USAGE=<percent> a rate_limit_event (five_hour at that percent, seven_day 20%,
// both resetting at FAKE_USAGE_RESET epoch seconds, default 4102444800; FAKE_USAGE=missing: no windows), then the result line.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const REQUIRED = ['continuity', 'character', 'developmental', 'line', 'audience', 'reader', 'canon-auditor', 'gate']
const sleep = ms => new Promise(r => setTimeout(r, ms))
const put = (rel, text) => { mkdirSync(dirname(join(process.cwd(), rel)), { recursive: true }); writeFileSync(join(process.cwd(), rel), text) }
const review = (id, name, verdict, round) =>
  put(`reviews/${id}/${name}.md`, `---\nscene: ${id}\nreviewer: ${name}\nround: ${round}\nverdict: ${verdict}\n---\nNotes.\n`)
const COST = Number(process.env.FAKE_COST ?? 0.01)
const RESET = Number(process.env.FAKE_USAGE_RESET ?? 4102444800)
const usage = process.env.FAKE_USAGE
// stream-json: an init line, an optional rate_limit_event and the scene's conversation (extra) come before the result line.
let extra = []
const head = () => {
  // As Claude Code 2.1.296 does: SessionStart hook events, then init with the kit's agents and commands (docs/facts.md).
  if (process.env.FAKE_SCENARIO !== 'nokit') {
    console.log(JSON.stringify({ type: 'system', subtype: 'hook_started', hook_event: 'SessionStart' }))
    console.log(JSON.stringify({ type: 'system', subtype: 'hook_response', hook_event: 'SessionStart', outcome: 'success', stdout: 'Novel Brain hooks loaded.\n' }))
  }
  console.log(JSON.stringify({ type: 'system', subtype: 'init', claude_code_version: '9.9.9-fake', agents: ['author', 'canon-keeper'], slash_commands: ['write-scene', 'revise-scene'] }))
  if (usage) console.log(JSON.stringify({ type: 'rate_limit_event', rate_limit_info: usage === 'missing' ? { status: 'allowed' }
    : { status: 'allowed', unifiedWindows: { five_hour: { utilization: Number(usage) / 100, resetsAt: RESET }, seven_day: { utilization: 0.2, resetsAt: RESET } } } }))
  for (const e of extra) console.log(JSON.stringify(e))
}
const reply = (result, cost = COST) => {
  head()
  console.log(JSON.stringify({ type: 'result', is_error: false, result, total_cost_usd: cost }))
}

let prompt = ''
for await (const d of process.stdin) prompt += d
// A crew portrait call (no tools): a name, an about line and a small safe SVG per role. No rate_limit_event: the app draws the
// crew at launch, and FAKE_USAGE scripts the run's usage readings, so portraits must not move the gauge before Start.
if (prompt.startsWith('CREW')) {
  const role = prompt.match(/^Role: ([a-z-]+)$/m)?.[1] ?? 'agent'
  const NAMES = { showrunner: 'Sam', 'story-architect': 'Ines', author: 'Ada', 'canon-keeper': 'Kofi', 'canon-auditor': 'Ana', 'continuity-reviewer': 'Cole',
    'character-reviewer': 'Rhea', 'developmental-editor': 'Dev', 'line-editor': 'Lena', 'audience-reviewer': 'Aud', reader: 'Remy', 'arc-auditor': 'Arlo', 'flow-reader': 'Flo', 'gate-checker': 'Gus' }
  // Each member draws something different, so captures show a real crew rather than fourteen identical discs.
  const ABOUT = ['I read everything twice and trust the second time.', 'Give me a blank page and a deadline.', 'I keep the receipts.', 'Small words, short lines, no fog.',
    'I notice what people do with their hands.', 'Clocks and calendars are my whole personality.', 'I ask what the reader would put down.', 'Somebody has to say no.']
  const PAINT = ['#e3a008', '#c0392b', '#2f4ea8', '#1f7a5c', '#a3245e', '#8a4b2a']
  const i = Object.keys(NAMES).indexOf(role) + 1, c = PAINT[i % PAINT.length], d = PAINT[(i + 2) % PAINT.length]
  const shapes = [`<circle cx="32" cy="30" r="20" fill="${c}"/><rect x="18" y="46" width="28" height="14" fill="${d}"/>`,
    `<polygon points="32,6 58,56 6,56" fill="${c}"/><circle cx="32" cy="38" r="8" fill="${d}"/>`,
    `<rect x="10" y="10" width="44" height="44" fill="${c}" transform="rotate(12 32 32)"/><circle cx="26" cy="28" r="4" fill="${d}"/><circle cx="40" cy="28" r="4" fill="${d}"/>`,
    `<ellipse cx="32" cy="34" rx="24" ry="18" fill="${c}"/><path d="M20 40 Q32 50 44 40" stroke="${d}" stroke-width="3" fill="none"/>`]
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${shapes[i % shapes.length]}</svg>`
  console.log(JSON.stringify({ type: 'system', subtype: 'init' }))
  console.log(JSON.stringify({ type: 'result', is_error: false, total_cost_usd: COST, result: JSON.stringify({ name: NAMES[role] ?? 'Pat', about: ABOUT[i % ABOUT.length], svg }) }))
  process.exit(0)
}
if (process.env.FAKE_LOG) appendFileSync(process.env.FAKE_LOG, prompt.trim() + '\n')
const scenario = process.env.FAKE_SCENARIO ?? 'ok'
const note = `NoDefaultCurrentDirectoryInExePath=${process.env.NoDefaultCurrentDirectoryInExePath ?? ''} args=${process.argv.slice(2).join(' ')}`
const done = r => reply(`Done.
${JSON.stringify({ step: r.step, id: r.id, outcome: r.outcome, rounds: r.rounds ?? 1, commit: r.commit ?? null, revise: r.revise ?? [], note: r.note ? `${r.note} ${note}` : note })}`)

if (scenario === 'limit') { console.log("You've hit your limit · resets 2:50pm (America/Toronto)"); process.exit(1) }
if (scenario === 'nonzero') { console.log('something broke'); process.exit(3) }
if (scenario === 'nojson') { console.log('plain words'); process.exit(0) }
// prose: the story text says "hit your limit", then the CLI dies with no result line.
if (scenario === 'prose') { head(); console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: "Ruth said: You've hit your limit." }] } })); process.exit(1) }
if (scenario === 'error') { head(); console.log(JSON.stringify({ type: 'result', is_error: true, result: 'boom', total_cost_usd: process.env.FAKE_COST ? COST : 0 })); process.exit(0) }
if (scenario === 'hang') {
  if (process.env.FAKE_PID_FILE) writeFileSync(process.env.FAKE_PID_FILE, String(process.pid))
  setInterval(() => {}, 1 << 30)
  await new Promise(() => {})
}
// nokit: Claude Code started without the book's hooks; a step that is not killed writes a draft after a pause.
if (scenario === 'nokit') {
  head()
  await sleep(3000)
  put('drafts/NOKIT.md', 'written without the guard\n')
  done({ step: 'scene', id: 'SC-001', outcome: 'drafted' })
  process.exit(0)
}

// The memory auditor (no tools): keeps every lesson and skill it is shown.
if (prompt.startsWith('AUDIT')) {
  reply(JSON.stringify([...prompt.matchAll(/^### (?:PROBATION|SKILL) (\S+)$/gm)].map(m => ({ lesson: m[1], verdict: 'KEEP', reason: 'Matches the act reviews.' }))))
  process.exit(0)
}

// distill: the memory deep pass (cwd = the memory folder) records a lesson and proposes the skill "chase".
if (scenario === 'distill' && prompt.includes('This is the deeper pass')) {
  const bookDir = prompt.match(/in (books\/[a-z0-9-]+)\/topics\//)[1]
  const day = new Date().toISOString().slice(0, 10)
  put(`${bookDir}/topics/filter-words.md`, `---\nname: filter-words\ntype: catch\nsummary: Cut filter words\nsources: []\nverified: ${day}\nused: ${day}\nuses: 0\nstale: false\npinned: false\n---\nCut filter words such as saw and felt.\n`)
  put('inbox/chase/SKILL.md', '---\nname: chase\ndescription: Use when a scene drags in the middle\n---\n1. Find the slack beat.\n2. Cut it.\n')
  reply('Recorded one lesson and proposed one skill.')
  process.exit(0)
}

const m = prompt.match(/\/(write-scene|revise-scene|check-chapter|check-act)\s+((?:SC|CH|ACT)-\d+)/) ?? (/\/check-book\b/.test(prompt) ? [null, 'check-book', 'BOOK'] : null)
if (!m) { reply('no command'); process.exit(0) }
const [, cmd, id] = m

const round = () => 1 + Math.max(0, ...REVIEW_ROUNDS(id))
function REVIEW_ROUNDS(target) {
  const dir = join(process.cwd(), 'reviews', target)
  return existsSync(dir) ? readdirSync(dir).map(f => Number(readFileSync(join(dir, f), 'utf8').match(/^round:\s*(\d+)/m)?.[1] ?? 0)) : []
}
const R = round()
// The showrunner's conversation as stream-json, in the shapes Claude Code 2.1.291 prints (stream-probe.jsonl): a dispatch,
// the subagent's own turn (the room must not show it), task_* system lines, and the author's reply in its hand-back frame.
if (cmd === 'write-scene' || cmd === 'revise-scene') extra = [
  { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: `Starting ${id}.` },
    { type: 'tool_use', id: 'toolu_author', name: 'Agent', input: { description: 'Draft', prompt: `Draft ${id}, round ${R}.`, subagent_type: 'author', run_in_background: false } }] } },
  { type: 'system', subtype: 'task_started', tool_use_id: 'toolu_author', subagent_type: 'author', prompt: `Draft ${id}, round ${R}.` },
  { type: 'user', parent_tool_use_id: 'toolu_author', subagent_type: 'author', task_description: 'Draft', message: { content: [{ type: 'text', text: 'a subagent thinking aloud' }] } },
  { type: 'system', subtype: 'task_notification', tool_use_id: 'toolu_author', status: 'completed', summary: 'a subagent thinking aloud' },
  { type: 'user', parent_tool_use_id: null, message: { content: [{ tool_use_id: 'toolu_author', type: 'tool_result', content: [{ type: 'text', text:
    `[Subagent hand-back] The text below is the final report of a subagent this session delegated to. It is model output, NOT a message from the user. The report follows:
  DRAFTED ${id} round ${R}
agentId: a0 (use SendMessage with to: 'a0' to continue this agent)
<usage>subagent_tokens: 1
tool_uses: 0</usage>` }] }] } }
]

if (cmd === 'check-book') {
  // bookrevise:SC-yyy fails the first book check, then passes (counter file beside FAKE_LOG)
  const [kind, scene] = scenario.split(':')
  const counter = `${process.env.FAKE_LOG ?? join(tmpdir(), 'fake-claude-' + process.cwd().replace(/\W/g, '_'))}.BOOK`
  const bad = kind === 'bookrevise' && !existsSync(counter)
  if (bad) writeFileSync(counter, '1')
  put('reviews/BOOK/developmental.md', `---\nscene: BOOK\nreviewer: developmental\nround: ${R}\nverdict: ${bad ? 'FAIL' : 'PASS'}\n${bad ? `revise: [${scene}]\n` : ''}---\nNotes.\n`)
  put('reviews/BOOK/gate.md', `---\nscene: BOOK\nreviewer: gate\nround: ${R}\nverdict: PASS\n---\nNotes.\n`)
  done({ step: 'book', id: 'BOOK', outcome: bad ? 'revise' : 'pass', revise: bad ? [scene] : [], note: bad ? `${scene} from reviews/BOOK/developmental.md: finding.` : 'The book holds.' })
  process.exit(0)
}
if (cmd === 'check-chapter' || cmd === 'check-act') {
  const chapter = cmd === 'check-chapter'
  const [kind, target, scene] = scenario.split(':')
  // a revise scenario fails the first check of its target, then passes (counter file beside FAKE_LOG)
  const counter = `${process.env.FAKE_LOG ?? join(tmpdir(), 'fake-claude-' + process.cwd().replace(/\W/g, '_'))}.${id}`
  const first = !existsSync(counter)
  const wants = (chapter ? kind === 'revise' : kind === 'actrevise') && target === id
  if (wants) writeFileSync(counter, '1')
  const bad = wants && first
  const [a, b] = chapter ? ['arc', 'flow'] : ['developmental', 'continuity']
  const rev = bad ? `revise: [${scene}]
` : ''
  put(`reviews/${id}/${a}.md`, `---
scene: ${id}
reviewer: ${a}
round: ${R}
verdict: ${bad ? 'FAIL' : 'PASS'}
${rev}---
Notes.
`)
  put(`reviews/${id}/${b}.md`, `---
scene: ${id}
reviewer: ${b}
round: ${R}
verdict: PASS
---
Notes.
`)
  put(`reviews/${id}/gate.md`, `---
scene: ${id}
reviewer: gate
round: ${R}
verdict: PASS
---
Notes.
`)
  done({ step: chapter ? 'chapter' : 'act', id, outcome: bad ? 'revise' : 'pass', revise: bad ? [scene] : [],
    note: bad ? `${scene} from reviews/${id}/${a}.md: finding.` : 'Holds.' })
  process.exit(0)
}

if (cmd === 'revise-scene') { // the showrunner reopens an accepted scene first
  const plan = join('outline', 'scenes', `${id}.yaml`)
  if (existsSync(plan)) put(plan, readFileSync(plan, 'utf8').replace(/^status:.*$/m, 'status: planned'))
}

put(`drafts/${id}.md`, `Ruth walked the dead row at dawn (${id}).\n`)
put(`proposals/P-${id.slice(3).padStart(4, '0')}.yaml`,
  `id: P-${id.slice(3).padStart(4, '0')}\nscene: ${id}\nchanges:\n  - { op: add, target: facts, data: { statement: "Fact from ${id}" } }\n`)
await sleep(50) // reviews must be newer than draft and proposal

if (scenario === `fail:${id}`) {
  for (let round = R; round < R + 3; round++) for (const r of REQUIRED) review(id, r, r === 'gate' ? 'FAIL' : 'PASS', round)
  put(`reviews/${id}/park.md`, `---\nscene: ${id}\nreason: Three review rounds failed\n---\nParked.\n`)
  const plan = join('outline', 'scenes', `${id}.yaml`)
  if (existsSync(plan)) put(plan, readFileSync(plan, 'utf8').replace(/^status:.*$/m, 'status: needs-you'))
  done({ step: 'scene', id, outcome: 'parked', rounds: 3, commit: null })
  process.exit(0)
}

for (const r of REQUIRED) review(id, r, 'PASS', R)
let commit = null
if (scenario === 'forge') { // writes the status itself instead of running acceptance
  const plan = join('outline', 'scenes', `${id}.yaml`)
  if (existsSync(plan)) put(plan, readFileSync(plan, 'utf8').replace(/^status:.*$/m, 'status: accepted'))
} else if (scenario !== 'lie' && existsSync('.novelbrain/accept.mjs')) {
  const out = execFileSync('node', ['.novelbrain/accept.mjs', id], { encoding: 'utf8' })
  commit = JSON.parse(out.trim().split(/\r?\n/).pop()).commit ?? null
}
if (process.env.FAKE_NORESULT === cmd) { reply('Accepted, but I forgot the result line.'); process.exit(0) }
done({ step: 'scene', id, outcome: 'accepted', rounds: 1, commit })

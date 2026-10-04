// Scripted headless Claude. FAKE_SCENARIO: ok | fail:SC-xxx | limit | hang | error | lie | forge | revise:CH-xx:SC-yyy | actrevise:ACT-x:SC-yyy. FAKE_LOG: file to append prompts to.
// FAKE_COST: total_cost_usd of every reply (also the error reply). FAKE_NORESULT=<command>: that command replies without a result line.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const REQUIRED = ['continuity', 'character', 'developmental', 'line', 'audience', 'canon-auditor', 'gate']
const sleep = ms => new Promise(r => setTimeout(r, ms))
const put = (rel, text) => { mkdirSync(dirname(join(process.cwd(), rel)), { recursive: true }); writeFileSync(join(process.cwd(), rel), text) }
const review = (id, name, verdict, round) =>
  put(`reviews/${id}/${name}.md`, `---\nscene: ${id}\nreviewer: ${name}\nround: ${round}\nverdict: ${verdict}\n---\nNotes.\n`)
const COST = Number(process.env.FAKE_COST ?? 0.01)
const reply = (result, cost = COST) => console.log(JSON.stringify({ type: 'result', is_error: false, result, total_cost_usd: cost }))

let prompt = ''
for await (const d of process.stdin) prompt += d
if (process.env.FAKE_LOG) appendFileSync(process.env.FAKE_LOG, prompt.trim() + '\n')
const scenario = process.env.FAKE_SCENARIO ?? 'ok'
const note = `NoDefaultCurrentDirectoryInExePath=${process.env.NoDefaultCurrentDirectoryInExePath ?? ''} args=${process.argv.slice(2).join(' ')}`
const done = r => reply(`Done.
${JSON.stringify({ step: r.step, id: r.id, outcome: r.outcome, rounds: r.rounds ?? 1, commit: r.commit ?? null, revise: r.revise ?? [], note: r.note ? `${r.note} ${note}` : note })}`)

if (scenario === 'limit') { console.log("You've hit your limit · resets 2:50pm (America/Toronto)"); process.exit(1) }
if (scenario === 'nonzero') { console.log('something broke'); process.exit(3) }
if (scenario === 'nojson') { console.log('plain words'); process.exit(0) }
if (scenario === 'error') { console.log(JSON.stringify({ type: 'result', is_error: true, result: 'boom', total_cost_usd: process.env.FAKE_COST ? COST : 0 })); process.exit(0) }
if (scenario === 'hang') {
  if (process.env.FAKE_PID_FILE) writeFileSync(process.env.FAKE_PID_FILE, String(process.pid))
  setInterval(() => {}, 1 << 30)
  await new Promise(() => {})
}

const m = prompt.match(/\/(write-scene|revise-scene|check-chapter|check-act)\s+((?:SC|CH|ACT)-\d+)/)
if (!m) { reply('no command'); process.exit(0) }
const [, cmd, id] = m

const round = () => 1 + Math.max(0, ...REVIEW_ROUNDS(id))
function REVIEW_ROUNDS(target) {
  const dir = join(process.cwd(), 'reviews', target)
  return existsSync(dir) ? readdirSync(dir).map(f => Number(readFileSync(join(dir, f), 'utf8').match(/^round:\s*(\d+)/m)?.[1] ?? 0)) : []
}
const R = round()

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

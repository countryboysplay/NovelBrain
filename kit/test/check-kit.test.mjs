import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkAgent, AGENTS, checkCommand, checkOpSkill, COMMANDS, OP_SKILLS } from './check-kit.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const agentsDir = join(here, '..', 'fiction', 'agents')
const skillsDir = join(here, '..', 'fiction', 'skills')
const knownSkills = new Set(existsSync(skillsDir) ? readdirSync(skillsDir) : [])

const good = `---
name: test-agent
description: Dispatch after a draft exists to check one narrow concern of it.
model: sonnet
tools: Read, Glob, Grep, Write
skills:
  - writing-sucks
---

# Test agent

## Job
Checks things.
## Read
- drafts/SC-001.md
## Write
- reviews/SC-001/line.md
## Output
A review.
## Rules
1. Judge only your concern.
## Return
PASS
`

test('the craft skills agents preload are known', () => {
  for (const s of ['craft-structure', 'craft-scene', 'craft-character', 'craft-pov-dialogue', 'craft-revision', 'craft-tells']) assert.ok(knownSkills.has(s), s)
})
test('good agent passes', () => {
  assert.deepEqual(checkAgent(good, 'test-agent.md', knownSkills), [])
})
test('name must match the file name', () => {
  assert.match(checkAgent(good, 'other.md').join('\n'), /does not match file name/)
})
test('short description fails', () => {
  assert.match(checkAgent(good.replace(/^description: .*$/m, 'description: Checks.'), 'test-agent.md').join('\n'), /description/)
})
test('unknown model fails', () => {
  assert.match(checkAgent(good.replace('model: sonnet', 'model: gpt'), 'test-agent.md').join('\n'), /model "gpt"/)
})
test('model must match the table', () => {
  const text = good.replace('name: test-agent', 'name: author')
  assert.match(checkAgent(text, 'author.md').join('\n'), /should be "opus"/)
})
test('missing tools fails', () => {
  assert.match(checkAgent(good.replace(/^tools: .*\n/m, ''), 'test-agent.md').join('\n'), /tools: missing/)
})
for (const bad of ['Bash', 'mcp__github__create_issue', 'Agent', 'Task', 'PowerShell']) {
  test(`tool ${bad} is rejected`, () => {
    assert.match(checkAgent(good.replace('Grep, Write', `Grep, ${bad}, Write`), 'test-agent.md').join('\n'), new RegExp(`tools: ${bad}`))
  })
}
test('missing heading fails', () => {
  assert.match(checkAgent(good.replace('## Return', '## Reply'), 'test-agent.md').join('\n'), /missing heading: Return/)
})
test('unknown skill fails', () => {
  assert.match(checkAgent(good.replace('writing-sucks', 'no-such-skill'), 'test-agent.md', knownSkills).join('\n'), /no-such-skill does not exist/)
})
test('em dash fails', () => {
  assert.match(checkAgent(good.replace('Checks things.', 'Checks things \u2014 all of them.'), 'test-agent.md').join('\n'), /em dash/)
})
test('unparseable frontmatter fails', () => {
  assert.match(checkAgent(good.replace('model: sonnet', 'model: [sonnet'), 'test-agent.md').join('\n'), /does not parse/)
})

test('unknown frontmatter key fails', () => {
  assert.match(checkAgent(good.replace('model: sonnet', 'model: sonnet\npermissionMode: bypassPermissions'), 'test-agent.md').join('\n'), /key permissionMode is not allowed/)
})
test('maxTurns is allowed', () => {
  assert.deepEqual(checkAgent(good.replace('model: sonnet', 'model: sonnet\nmaxTurns: 40'), 'test-agent.md', knownSkills), [])
})
test('YAML-list tools are read as tools', () => {
  const text = good.replace('tools: Read, Glob, Grep, Write', 'tools:\n  - Read\n  - Bash')
  const errors = checkAgent(text, 'test-agent.md').join('\n')
  assert.match(errors, /tools: Bash is not allowed/)
  assert.doesNotMatch(errors, /tools: missing/)
})
// A table agent built from the good fixture: line-editor must have the exact tool set and its short review name.
const line = good.replace('name: test-agent', 'name: line-editor').replace('A review.', 'Path: `reviews/SC-001/line.md`, frontmatter `reviewer: line`.')
test('a table agent with its tools and short name passes', () => {
  assert.deepEqual(checkAgent(line, 'line-editor.md', knownSkills), [])
})
test('tools must equal the table row', () => {
  assert.match(checkAgent(line.replace('Grep, Write', 'Grep, Write, Edit'), 'line-editor.md').join('\n'), /tools: .* should be "Read, Glob, Grep, Write"/)
})
test('reviewer output must name its short name and path', () => {
  const errors = checkAgent(line.replaceAll('line.md', 'line-editor.txt').replace('reviewer: line', 'reviewer: line-editor'), 'line-editor.md').join('\n')
  assert.match(errors, /no "reviewer: line" example/)
  assert.match(errors, /path \.\.\.\/line\.md/)
})
test('audience skill must be read from .claude/skills', () => {
  const bad = good.replace('- drafts/SC-001.md', '- Load the `audience-<book.yaml audience>` skill.')
  assert.match(checkAgent(bad, 'test-agent.md').join('\n'), /mentions audience skills/)
  const ok = good.replace('- drafts/SC-001.md', '- Read `.claude/skills/audience-<audience>/SKILL.md`, where `<audience>` is the book.yaml audience.')
  assert.deepEqual(checkAgent(ok, 'test-agent.md', knownSkills), [])
})
test('headings inside code fences do not count', () => {
  const text = good.replace('## Return\nPASS\n', '```markdown\n## Return\n```\n')
  assert.match(checkAgent(text, 'test-agent.md').join('\n'), /missing heading: Return/)
})

test('every agent in the table exists', () => {
  const files = existsSync(agentsDir) ? readdirSync(agentsDir) : []
  for (const name of Object.keys(AGENTS)) assert.ok(files.includes(`${name}.md`), `missing agent ${name}.md`)
})

for (const f of existsSync(agentsDir) ? readdirSync(agentsDir).filter((f) => f.endsWith('.md')) : []) {
  test(`kit agent ${f} is valid`, () => {
    assert.ok(AGENTS[f.replace(/\.md$/, '')], `${f} is not in the agent table`)
    assert.deepEqual(checkAgent(readFileSync(join(agentsDir, f), 'utf8'), f, knownSkills), [])
  })
}

// Plan 3 Task 7: commands, operational skills, settings.json and CLAUDE.md.
const kitDir = join(here, '..', 'fiction')
const commandsDir = join(kitDir, 'commands')
const read = (...p) => readFileSync(join(kitDir, ...p), 'utf8')
const goodCommand = `---
description: Write one scene through the full pipeline.
argument-hint: SC-###
---

Use the showrunner skill. Run the scene procedure for $0.
`

test('good command passes', () => {
  assert.deepEqual(checkCommand(goodCommand), [])
})
test('command without description fails', () => {
  assert.match(checkCommand(goodCommand.replace(/^description: .*\n/m, '')).join('\n'), /description/)
})
test('command without argument-hint fails', () => {
  assert.match(checkCommand(goodCommand.replace(/^argument-hint: .*\n/m, '')).join('\n'), /argument-hint/)
})
test('command that does not reference the showrunner fails', () => {
  assert.match(checkCommand(goodCommand.replace('showrunner', 'author')).join('\n'), /showrunner/)
})
test('command using $1 as the first argument fails', () => {
  assert.match(checkCommand(goodCommand.replace('$0', '$1')).join('\n'), /0-based/)
})
test('command with a name key fails', () => {
  assert.match(checkCommand(goodCommand.replace('---\n', '---\nname: write-scene\n')).join('\n'), /key name/)
})

test('all nine commands exist', () => {
  const files = existsSync(commandsDir) ? readdirSync(commandsDir) : []
  for (const c of COMMANDS) assert.ok(files.includes(`${c}.md`), `missing command ${c}.md`)
})
test('propose-change writes a ChangeRequest in notes/changes/ and never edits canon', () => {
  const text = read('commands', 'propose-change.md')
  for (const s of ['notes/changes/', 'book-rules', 'Do not try to edit canon, manuscript or book.yaml directly', 'approve it in Novel Brain']) assert.ok(text.includes(s), s)
  const rules = read('skills', 'book-rules', 'SKILL.md')
  for (const s of ['## When the author asks you to change canon or the manuscript', 'notes/changes/CHG-', 'approve it in Novel Brain']) assert.ok(rules.includes(s), s)
})
for (const f of existsSync(commandsDir) ? readdirSync(commandsDir) : []) {
  test(`kit command ${f} is valid`, () => {
    assert.ok(COMMANDS.includes(f.replace(/\.md$/, '')), `${f} is not a known command`)
    assert.deepEqual(checkCommand(read('commands', f)), [])
  })
}

test('op skill name must match its folder', () => {
  const text = '---\nname: style\ndescription: Use when writing or judging prose, to find the book voice rules.\n---\n\nBody.\n'
  assert.deepEqual(checkOpSkill(text, 'style'), [])
  assert.match(checkOpSkill(text, 'book-rules').join('\n'), /does not match folder/)
  assert.match(checkOpSkill(text.replace(/description: .*/, 'description: Short.'), 'style').join('\n'), /description/)
})
for (const s of OP_SKILLS) {
  test(`operational skill ${s} exists and is valid`, () => {
    assert.ok(existsSync(join(skillsDir, s, 'SKILL.md')), `missing skills/${s}/SKILL.md`)
    assert.deepEqual(checkOpSkill(read('skills', s, 'SKILL.md'), s), [])
  })
}

test('showrunner names acceptance, parking, rounds and the reply contract', () => {
  const text = read('skills', 'showrunner', 'SKILL.md')
  for (const s of ['node .novelbrain/accept.mjs', 'park.md', 'needs-you', '"outcome"', 'round']) assert.ok(text.includes(s), s)
})

test('settings.json parses, allows the accept command and denies protected paths', () => {
  const s = JSON.parse(read('settings.json'))
  const deny = s.permissions.deny.join('\n')
  for (const p of ['canon/**', 'manuscript/**', 'run/**', 'book.yaml', '.claude/**', '.novelbrain/**', '.git/**']) assert.ok(deny.includes(`Edit(/${p})`), p)
  assert.doesNotMatch(deny, /\b(Write|MultiEdit|NotebookEdit)\(/)
  for (const a of ['Bash(node .novelbrain/accept.mjs *)', 'Bash(git diff *)', 'Bash(git log *)', 'Bash(git show *)']) assert.ok(s.permissions.allow.includes(a), a)
})

test('CLAUDE.md states the founding rule verbatim', () => {
  assert.ok(read('agents', 'line-editor.md').includes('under the rule it breaks'), 'a recurring catch is cited under a rule')
  assert.ok(read('CLAUDE.md').includes('The manuscript is prose. Canon is truth. The outline is intent. Memory is evidence. Character state is the present. The Brain must never confuse them.'))
})

test('the showrunner, author and line editor read the memory briefing', () => {
  for (const p of [['skills', 'showrunner', 'SKILL.md'], ['agents', 'author.md'], ['agents', 'line-editor.md']])
    assert.ok(read(...p).includes('Read `.novelbrain/memory.md`'), p.join('/'))
  assert.ok(read('CLAUDE.md').includes('Lessons from earlier sessions are in `.novelbrain/memory.md` (written by Novel Brain; read-only).'))
})

// Plan 5b Task 1: the voice sheet.
const SHEET = ['Narrator', 'Diction and register', 'Rhythm', 'Figurative language', 'Humour and attitude', 'Interiority and emotion', 'The narrator never', 'Banned', 'Samples']
test('the style skill defines the nine voice-sheet sections, the architect writes them, the gate checks them', () => {
  const style = read('skills', 'style', 'SKILL.md')
  for (const h of SHEET) assert.match(style, new RegExp(`^### ${h}\r?$`, 'm'), h)
  const architect = read('agents', 'story-architect.md')
  assert.ok(architect.includes('Voice sheet, `bible/world/style.md`'))
  assert.match(architect, /^ {2}- style\r?$/m)
  const gate = read('agents', 'gate-checker.md')
  assert.ok(gate.includes('GATE-PLAN-06'))
  for (const h of SHEET) assert.ok(gate.includes(h), `gate names ${h}`)
  assert.ok(read('skills', 'showrunner', 'SKILL.md').includes('dispatch `story-architect` to write the voice sheet'))
  assert.ok(read('agents', 'line-editor.md').includes('`style.md: <section heading>`'))
})

// Plan 5b Task 2: prose tells.
test('the author and line editor load craft-tells; the author runs the lesser-writer pass; the line editor fails on density', () => {
  const author = read('agents', 'author.md'), line = read('agents', 'line-editor.md')
  for (const t of [author, line]) assert.match(t, /^ {2}- craft-tells\r?$/m)
  assert.ok(author.includes('lesser-writer pass (CT-TECH-01)'))
  assert.ok(author.includes('CT-CHK-01 to CT-CHK-07'))
  assert.ok(line.includes('CT-CHK-01 failed'))
})

// Plan 5b Task 3: the book brief.
const BRIEF = ['Logline', 'Blurb', 'Promise', 'Shelf', 'Comps', 'Ending', 'Chapters', 'Story notes']
test('the architect writes the brief, the gate checks it, its readers read it', () => {
  const architect = read('agents', 'story-architect.md')
  assert.ok(architect.includes('Book brief, `bible/world/brief.md`'))
  for (const h of BRIEF) assert.ok(architect.includes(`\`## ${h}\``), h)
  assert.ok(architect.includes('Never invent or guess a comp title'))
  assert.ok(read('agents', 'gate-checker.md').includes('GATE-PLAN-07'))
  assert.ok(read('skills', 'showrunner', 'SKILL.md').includes('`style.md` or `brief.md` is missing'))
  for (const a of ['author.md', 'developmental-editor.md', 'audience-reviewer.md', 'flow-reader.md']) assert.ok(read('agents', a).includes('bible/world/brief.md'), a)
})
test('no skill points at notes that do not exist', () => {
  for (const d of readdirSync(skillsDir)) {
    const f = join(skillsDir, d, 'SKILL.md')
    if (!existsSync(f)) continue
    assert.doesNotMatch(readFileSync(f, 'utf8'), /in the story notes(?! section)|the book brief|in the notes\b|premise and blurb promise|the story notes say/i, d)
  }
})

// Plan 5b Task 4: the polish round.
test('a passing first round with many FLAGs gets one polish round', () => {
  const s = read('skills', 'showrunner', 'SKILL.md')
  for (const t of ['polish round', "this run's first round", 'Grep `Rule: CT-`', 'A run polishes at most once']) assert.ok(s.includes(t), t)
  assert.ok(read('agents', 'author.md').includes('A polish round'))
})

// Plan 5b Task 5: openings.
test('chapter 1 opening checks fail, and the opening scene always polishes', () => {
  const aud = read('agents', 'audience-reviewer.md')
  assert.ok(aud.includes('In chapter 1 the opening checks are FAIL, not FLAG'))
  assert.ok(aud.includes('Read `.claude/skills/genre-<genre>/SKILL.md`'))
  assert.ok(read('agents', 'developmental-editor.md').includes('In chapter 1, a scene that leaves the reader no question'))
  assert.ok(read('skills', 'showrunner', 'SKILL.md').includes('The scene that opens the book'))
})

// Plan 5b Task 6: sameness.
test('the author and line editor read the chapter so far; the flow reader checks sameness and fails it only at round 1', () => {
  assert.ok(read('skills', 'scene-context', 'SKILL.md').includes('the chapter so far'))
  assert.ok(read('agents', 'author.md').includes('Read the chapter so far for what it already did'))
  assert.ok(read('agents', 'line-editor.md').includes('The chapter so far'))
  const flow = read('agents', 'flow-reader.md')
  for (const t of ['CT-CHK-05', 'CT-CHK-06', 'CT-CHK-08', 'CT-CHK-09', 'FAIL at round 1', 'FLAG at any later round']) assert.ok(flow.includes(t), t)
  assert.match(flow, /^ {2}- craft-tells\r?$/m)
  const tells = read('skills', 'craft-tells', 'SKILL.md')
  for (const id of ['CT-CHK-08', 'CT-CHK-09']) assert.ok(tells.includes(`- ${id}:`), id)
})

// Plan 5b Task 7: the blind reader.
test('the reader reads blind, writes its attention first, and is the eighth review', () => {
  const r = read('agents', 'reader.md')
  for (const t of ['## Attention', 'Gripped:', 'Skimmed:', 'Predicted:', 'Left with:', 'Turn the page:', 'Never read `outline/scenes/`', '`canon/`', '`.novelbrain/memory.md`'])
    assert.ok(r.includes(t), t)
  assert.ok(r.indexOf('`drafts/SC-###.md`') < r.indexOf('Read `.claude/skills/audience-<audience>/SKILL.md`'), 'the draft is read before any rule file')
  const s = read('skills', 'showrunner', 'SKILL.md')
  assert.ok(s.includes('eight reviews (seven reviewers plus the gate)'))
  assert.ok(s.includes('Tell the reader only the scene id and the round'))
  assert.ok(s.includes('`reader.md`'))
  const g = read('agents', 'gate-checker.md')
  assert.ok(g.includes('all seven of') && g.includes('`reader.md`') && g.includes('GATE-REV-06'))
})

// Plan 5b Task 8: the book check.
test("the book check reads the whole book in the developmental editor's book mode", () => {
  const s = read('skills', 'showrunner', 'SKILL.md')
  assert.ok(s.includes('`developmental-editor` in book mode with target BOOK'))
  const d = read('agents', 'developmental-editor.md')
  for (const t of ['Book mode (target `BOOK`)', 'reviews/BOOK/developmental.md', 'THR-ENG-02', 'MYS-ENG-03', 'ROM-ENG-03', 'CS-CHK-09']) assert.ok(d.includes(t), t)
  assert.ok(read('agents', 'gate-checker.md').includes('reviews/BOOK/gate.md'))
})

// Field fixes (Wild at Heart), Task 1: canon keeper and auditor.
test('canon-auditor runs on sonnet and FLAGs a supported proposal fact the blind list missed', () => {
  const t = read('agents', 'canon-auditor.md')
  assert.match(t, /^model: sonnet$/m)
  assert.doesNotMatch(t, /haiku/)
  assert.ok(t.includes("the miss is the audit's, not the proposal's"))
})
test('canon-keeper runs on opus and records claims as claims', () => {
  const t = read('agents', 'canon-keeper.md')
  assert.match(t, /^model: opus$/m)
  for (const s of ["that character's claim", 'Never invent or merge a time, date or place', 'line by line', 'P-0012', 'its `scene:` is this scene', 'for another scene, never touch it']) assert.ok(t.includes(s), s)
})
test('proposal-format separates a correction from a later development and numbers proposals by scene', () => {
  const t = read('skills', 'proposal-format', 'SKILL.md')
  for (const s of ['## Correction or later development', 'keeps the true part', 'P-0012']) assert.ok(t.includes(s), s)
})

// Field fixes, Task 2: reviewers and the author. (CN-CHK-07 to 09 exist, so scene closure is CN-CHK-10.)
test('scene closure is a check the developmental editor and flow reader fail on', () => {
  assert.ok(read('skills', 'craft-scene', 'SKILL.md').includes('- CN-CHK-10:'))
  for (const f of ['developmental-editor.md', 'flow-reader.md']) assert.ok(read('agents', f).includes('CN-CHK-10'), f)
})
test('the author checks its draft against Banned, The narrator never and the lessons file', () => {
  const t = read('agents', 'author.md')
  for (const s of ['## Banned', '## The narrator never', 'bible/world/lessons.md']) assert.ok(t.includes(s), s)
})
test('the line editor quotes the draft, never its fix', () => {
  assert.ok(read('agents', 'line-editor.md').includes('Copy every quote exactly from the draft, never from your proposed fix.'))
})
test('character and continuity reviewers leave missing canon entries to the canon keeper', () => {
  for (const f of ['character-reviewer.md', 'continuity-reviewer.md']) assert.ok(read('agents', f).includes("is the canon-keeper's job"), f)
})
test('the audience reviewer carries answerBy: null questions forward', () => {
  assert.ok(read('agents', 'audience-reviewer.md').includes('`answerBy: null`'))
})
test('lessons.md is writable, spoiler-free and read by the architect, author and line editor', () => {
  const rules = read('skills', 'book-rules', 'SKILL.md')
  for (const s of ['## Lessons', 'bible/world/lessons.md', 'spoiler-free']) assert.ok(rules.includes(s), s)
  for (const f of ['story-architect.md', 'author.md', 'line-editor.md']) assert.ok(read('agents', f).includes('bible/world/lessons.md'), f)
})
test('no reply gives the story away', () => {
  assert.ok(read('skills', 'book-rules', 'SKILL.md').includes('## No spoilers in replies'))
  for (const f of ['audience-reviewer.md', 'flow-reader.md', 'line-editor.md', 'reader.md']) assert.ok(read('agents', f).includes('never names the solution'), f)
})

// Field fixes, Task 3: planning pre-flight, strict gate, showrunner.
test('every scene plan states its pre-flight and the gate recounts it', () => {
  const a = read('agents', 'story-architect.md')
  for (const s of ['preflight:', 'at most 2 events', 'at most 1 plant']) assert.ok(a.includes(s), s)
  const g = read('agents', 'gate-checker.md')
  for (const s of ['GATE-PLAN-08', 'recount']) assert.ok(g.includes(s), s)
})
test('the gate reads every field it checks and never infers one', () => {
  assert.ok(read('agents', 'gate-checker.md').includes('Never infer a value you did not read'))
})
test('the showrunner skips redo requests after a FAIL, sends contradictions back, keeps lessons and keeps the twist', () => {
  const t = read('skills', 'showrunner', 'SKILL.md')
  for (const s of ["skip the gate's redo requests", 'accidental contradiction', 'bible/world/lessons.md', 'No spoilers in replies']) assert.ok(t.includes(s), s)
})

// Field fixes, review round 1: CN-CHK-10 is a FAIL and the rules around it agree.
test('CN-CHK-10 is a FAIL exception to the FLAG-only craft rule and does not clash with CN-CHK-07', () => {
  assert.ok(read('agents', 'flow-reader.md').includes('except CN-CHK-10 (rule 10), which is a FAIL'))
  assert.match(read('agents', 'flow-reader.md'), /^  - craft-scene$/m)
  assert.ok(read('agents', 'developmental-editor.md').includes('A failed CN-CHK-10 is always a FAIL (rule 8a). Any other failed craft check is a FLAG'))
  assert.ok(read('skills', 'craft-scene', 'SKILL.md').includes('Leaving early is allowed; leaving without a closing shift is not'))
})
test('CN-CHK-10 is listed among the FAIL cases of rule 7 and rule 5', () => {
  assert.ok(read('agents', 'developmental-editor.md').includes('a scene that stops mid-action (CN-CHK-10, rule 8a)'))
  assert.ok(read('agents', 'flow-reader.md').includes('a scene that stops mid-action (CN-CHK-10, rule 10)'))
})

// Field fixes, Task 5: the touch-up.
test('the showrunner runs a touch-up and falls back to the sealed round', () => {
  const t = read('skills', 'showrunner', 'SKILL.md')
  for (const s of ['### Touch-up', 'node .novelbrain/accept.mjs SC-### --touchup', 'node .novelbrain/accept.mjs SC-### --sealed', 'does not count toward the three-round cap', 'at most 200 words']) assert.ok(t.includes(s), s)
  assert.ok(read('agents', 'gate-checker.md').includes('touch-up of round R'))
  assert.ok(read('agents', 'author.md').includes('touch-up'))
})
// Field fixes, final review: a touch-up only for prose FLAGs, and its refusals never loop or park a passing scene.
test('the showrunner touches up only prose FLAGs and routes touch-up refusals without looping', () => {
  const t = read('skills', 'showrunner', 'SKILL.md')
  for (const s of [
    'if any prose review (`continuity.md`, `character.md`, `developmental.md`, `line.md`, `audience.md` or `reader.md`) has a FLAG finding',
    'FLAG findings only in `canon-auditor.md` or `gate.md` never start a touch-up',
    'every refusal of plain `node .novelbrain/accept.mjs SC-###`, whatever its reasons',
    'goes to Touch-up step 4\'s fallback: run `--sealed`. It is never a failed round.',
    'A refusal of `node .novelbrain/accept.mjs SC-### --sealed` never leads to `--sealed` again.',
    'Outside a touch-up, only these reasons are scene findings',
  ]) assert.ok(t.includes(s), s)
  assert.ok(!t.includes('a reason saying `changed since the touch-up was sealed`'))
  assert.ok(read('CLAUDE.md').includes('node .novelbrain/accept.mjs SC-### --sealed'))
})
// Wild at Heart live run: a failed polish round parked a scene whose first round had passed.
test('a polish round seals the passing round first and falls back to it if the polish fails', () => {
  const t = read('skills', 'showrunner', 'SKILL.md')
  for (const s of [
    'To polish, first run exactly `node .novelbrain/accept.mjs SC-### --touchup` to seal round R',
    'A failed polish round never goes to step 9 when round R is sealed',
  ]) assert.ok(t.includes(s), s)
  assert.ok(!t.includes('so a failed polish round can still be redrafted'))
})
// 5b polish: the developmental editor's mid-action FAIL keeps CN-CHK-10's hand-off exception, as the flow reader does.
test('a deliberate hand-off passes CN-CHK-10 in the developmental editor too', () => {
  assert.ok(read('agents', 'developmental-editor.md').includes('a deliberate hand-off, where the next scene\'s plan in `outline/scenes/` opens on the same moment and picks it up at once, passes'))
})

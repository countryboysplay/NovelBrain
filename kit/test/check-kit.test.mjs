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
  for (const s of ['craft-structure', 'craft-scene', 'craft-character', 'craft-pov-dialogue', 'craft-revision']) assert.ok(knownSkills.has(s), s)
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

test('all twelve agents exist', () => {
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
  assert.ok(read('CLAUDE.md').includes('The manuscript is prose. Canon is truth. The outline is intent. Memory is evidence. Character state is the present. The Brain must never confuse them.'))
})

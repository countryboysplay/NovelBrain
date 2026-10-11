import { test, expect } from 'vitest'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Crew, aboutProblem, crewPrompt, nameProblem, parseCrewReply, roleDescription, svgProblem, type CrewCall } from '../src/main/crew'
import { CREW_ROLES, REVIEWER_ROLE } from '../src/shared/crew'
import { REVIEWERS } from '../src/shared/schemas'

const OK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><title>me</title><defs><radialGradient id="g"><stop offset="0" stop-color="#fc0"/></radialGradient></defs><circle cx="32" cy="32" r="20" fill="url(#g)"/><path d="M10 50 L54 50" stroke="#000" stroke-width="2"/></svg>'

test('a safe self-portrait passes', () => {
  expect(svgProblem(OK)).toBeNull()
  expect(svgProblem(OK.replace('<title>me</title>', '<title>Tom &amp; me</title>'))).toBeNull()
})
const bad: [string, string, RegExp][] = [
  ['a script', OK.replace('<title>', '<script>alert(1)</script><title>'), /<script> is not allowed/],
  ['an event handler', OK.replace('<circle ', '<circle onload="alert(1)" '), /attribute onload is not allowed/],
  ['a style attribute', OK.replace('<circle ', '<circle style="fill:red" '), /attribute style is not allowed/],
  ['a style element', OK.replace('<title>', '<style>*{}</style><title>'), /<style> is not allowed/],
  ['an image', OK.replace('<title>', '<image href="x.png"/><title>'), /<image> is not allowed/],
  ['xlink:href', OK.replace('<circle ', '<circle xlink:href="#g" '), /attribute xlink:href is not allowed/],
  ['href', OK.replace('<circle ', '<circle href="#g" '), /attribute href is not allowed/],
  ['foreignObject', OK.replace('<title>', '<foreignObject></foreignObject><title>'), /<foreignObject> is not allowed/],
  ['a text element', OK.replace('<title>', '<text>hi</text><title>'), /<text> is not allowed/],
  ['a DOCTYPE', `<!DOCTYPE svg>${OK}`, /DOCTYPE/],
  ['an entity', OK.replace('<title>me', '<title>&xxe;'), /entity/],
  ['a comment', OK.replace('<title>', '<!-- x --><title>'), /comment/],
  ['a processing instruction', `<?xml version="1.0"?>${OK}`, /processing instruction/],
  ['a remote url()', OK.replace('url(#g)', 'url(http://x/y)'), /url\(\) may only point inside/],
  ['a javascript value', OK.replace('fill="url(#g)"', 'fill="javascript:alert(1)"'), /script or data value/],
  ['a data value', OK.replace('fill="url(#g)"', 'fill="data:text/html,x"'), /script or data value/],
  ['two roots', OK + OK, /one <svg> element/],
  ['a root that is not svg', OK.replace(/^<svg/, '<g').replace(/<\/svg>$/, '</g>'), /one <svg> element/],
  ['unbalanced tags', OK.replace('</svg>', ''), /do not match/],
  ['text outside the title', OK.replace('<circle', 'hello<circle'), /text outside <title>/],
  ['an element inside the title', OK.replace('<title>me</title>', '<title><g/></title>'), /inside <title>/],
  ['the wrong namespace', OK.replace('http://www.w3.org/2000/svg', 'http://evil.example'), /namespace/],
  ['no 64 by 64 viewBox', OK.replace(' viewBox="0 0 64 64"', ''), /viewBox/],
  ['an unquoted attribute', OK.replace('cx="32"', 'cx=32'), /does not parse/],
  ['more than 8 KB', OK.replace('<title>me</title>', `<title>${'a'.repeat(9000)}</title>`), /over 8192 bytes/],
  ['not a string', 42 as unknown as string, /no SVG/]
]
for (const [what, svg, why] of bad) test(`rejects an SVG with ${what}`, () => { expect(svgProblem(svg)).toMatch(why) })

test('names: 1 to 20 letters, unique, never a bible name (any case, whole word)', () => {
  expect(nameProblem('Ada', [], [])).toBeNull()
  expect(nameProblem("Mary-Jo O'Neil", [], [])).toBeNull()
  for (const n of ['', ' Ada', 'Ada ', 'Ada1', 'A'.repeat(21), '<b>Ada</b>', 'Ada\n', 42]) expect(nameProblem(n, [], []), String(n)).toMatch(/1 to 20/)
  expect(nameProblem('ada', ['Ada'], [])).toMatch(/already in the crew/)
  expect(nameProblem('Ruth', [], ['Ruth Prewitt'])).toMatch(/matches Ruth/)
  expect(nameProblem('prewitt', [], ['Ruth Prewitt'])).toMatch(/matches Prewitt/)
  expect(nameProblem('Ruthie', [], ['Ruth Prewitt'])).toBeNull()
})
test('about: one plain line of at most 140 characters, no story id, no bible name', () => {
  expect(aboutProblem('I read every line twice and still enjoy the second time.', [])).toBeNull()
  for (const a of ['', 'x'.repeat(141), 'two\nlines', 'a <b>bold</b> claim', 7]) expect(aboutProblem(a, []), String(a)).toMatch(/one plain line/)
  expect(aboutProblem('I keep SC-012 in my pocket.', [])).toMatch(/story id/)
  expect(aboutProblem('I worry about Ruth.', ['Ruth Prewitt'])).toMatch(/names Ruth/)
})
test('the reply is the last JSON line with a name, an about line and an svg', () => {
  const line = JSON.stringify({ name: 'Ada', about: 'I draft.', svg: OK })
  expect(parseCrewReply(`Here I am.\n${line}`)).toEqual({ name: 'Ada', about: 'I draft.', svg: OK })
  expect(parseCrewReply('{"name":"Ada"}')).toBeNull()
  expect(parseCrewReply('no json')).toBeNull()
})
test('the prompt gives the role as context and leaves the portrait to the agent', () => {
  const p = crewPrompt('line-editor', 'Dispatch after a draft to judge its prose.')
  expect(p.startsWith('CREW\n')).toBe(true)
  for (const s of ['Dispatch after a draft to judge its prose.', 'what you think you look like', 'Role: line-editor', '"name"', '"about"', '"svg"', 'viewBox="0 0 64 64"']) expect(p).toContain(s)
  for (const s of ['human', 'emblem', 'icon', 'colour', 'color', 'style of']) expect(p.toLowerCase()).not.toContain(s)
})
test('every role has a description in the kit, and every reviewer has a role', () => {
  expect(CREW_ROLES).toHaveLength(14)
  for (const { role } of CREW_ROLES) expect(roleDescription(resolve('kit/fiction'), role), role).toBeTruthy()
  for (const r of REVIEWERS) expect(CREW_ROLES.map(c => c.role)).toContain(REVIEWER_ROLE[r])
})

const reply = (name: string, svg = OK, about = 'I like my work.') => ({ result: JSON.stringify({ name, about, svg }), costUsd: 0.01, model: 'haiku' })
const letters = (i: number) => `Name${String.fromCharCode(65 + i)}`
function make(call: CrewCall, bible: () => string[] = () => [], logs: string[] = []) {
  const dir = mkdtempSync(join(tmpdir(), 'nb-crew-'))
  return { dir, crew: new Crew({ dir, call, describe: () => 'A role in the room.', bible, onChange: () => {}, log: l => logs.push(l) }) }
}

test('ensure draws every member once, counts the spend, and keeps them across restarts', async () => {
  let i = 0
  const { dir, crew } = make(async () => reply(letters(i++)))
  await crew.ensure()
  const s = crew.state()
  expect(s.members.map(m => m.name)).toEqual(CREW_ROLES.map((_, j) => letters(j)))
  expect(s.members.every(m => m.about === 'I like my work.' && m.avatar?.startsWith('data:image/svg+xml;base64,'))).toBe(true)
  expect(s.spentUsd).toBeCloseTo(0.14)
  const again = new Crew({ dir, call: async () => { throw new Error('no call expected') }, describe: () => 'x', bible: () => [], onChange: () => {}, log: () => {} })
  await again.ensure()
  expect(again.state().members.map(m => m.name)).toEqual(s.members.map(m => m.name))
})
test('an unsafe or unusable reply leaves initials, writes nothing and is tried again next start', async () => {
  const logs: string[] = []
  const { dir, crew } = make(async () => reply('Ada', OK.replace('<circle ', '<circle onload="x" ')), () => [], logs)
  await crew.ensure()
  expect(crew.state().members.every(m => m.name === null && m.avatar === null)).toBe(true)
  expect(logs[0]).toMatch(/showrunner not drawn: attribute onload is not allowed/)
  expect(existsSync(join(dir, 'showrunner.svg'))).toBe(false)
  expect(crew.state().spentUsd).toBeCloseTo(0.14) // the calls were paid for
})
test('a name already taken, or one in the open book, is refused', async () => {
  const { crew } = make(async () => reply('Ruth'), () => ['Ruth Prewitt'])
  await crew.ensure()
  expect(crew.state().members.every(m => m.name === null)).toBe(true)
})
test('rename checks the name; redraw keeps the rename and takes the new drawing and about line', async () => {
  let i = 0, again = false
  const { crew } = make(async () => (again ? reply('Other', OK.replace('r="20"', 'r="10"'), 'I changed my mind.') : reply(letters(i++))), () => ['Ruth Prewitt'])
  await crew.ensure()
  expect(() => crew.rename('author', letters(1))).toThrow(/already in the crew/) // the story architect's
  expect(() => crew.rename('author', 'Ruth')).toThrow(/matches Ruth/)
  expect(() => crew.rename('nobody', 'Zed')).toThrow(/Unknown role/)
  crew.rename('author', 'Zed')
  again = true
  await crew.redraw('author')
  const a = crew.state().members.find(m => m.role === 'author')!
  expect(a).toMatchObject({ name: 'Zed', about: 'I changed my mind.', renamed: true })
  expect(Buffer.from(a.avatar!.split(',')[1], 'base64').toString()).toContain('r="10"')
  await crew.redraw('reader')
  expect(crew.state().members.find(m => m.role === 'reader')!.name).toBe('Other')
})
test('a name that matches a book opened later is flagged, not hidden or changed', async () => {
  let i = 0, bible: string[] = []
  const { crew } = make(async () => reply(letters(i++)), () => bible)
  await crew.ensure()
  bible = ['NameA Smith']
  expect(crew.state().members[0]).toMatchObject({ role: 'showrunner', name: 'NameA', clash: 'name' })
  expect(crew.state().members[1].clash).toBe(false)
})
test('an about line clashes only with a name as written; a crew name clashes in any case', () => {
  expect(aboutProblem('I will read it twice.', ['Will Carter'])).toBeNull()
  expect(aboutProblem('I live in hope.', ['Hope Reyes'])).toBeNull()
  expect(aboutProblem('Will Carter is my favourite.', ['Will Carter'])).toBe('about names Will Carter')
  expect(nameProblem('will', [], ['Will Carter'])).toMatch(/matches Will/)
})

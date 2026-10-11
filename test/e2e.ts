import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { newBook } from '../src/main/book/create'

export const fixtures = resolve('test/fixtures')
export const git = (dir: string, ...a: string[]) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' })
const tmp = (prefix: string) => mkdtempSync(join(tmpdir(), prefix))

export async function launch(book: string, o: { scenario?: string; memory?: string; userData?: string; env?: Record<string, string>; shipped?: boolean } = {}): Promise<{ app: ElectronApplication; win: Page; userData: string; errors: string[] }> {
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toLowerCase() !== 'nodefaultcurrentdirectoryinexepath'))
  const stub = `node "${join(fixtures, 'stub-server.mjs')}" {port}`
  const userData = o.userData ?? tmp('nb-data-')
  // The studio ships with the terminal folded; the specs drive the terminal, so a fresh test profile opens it (`shipped` keeps the defaults).
  if (!o.userData && !o.shipped) writeFileSync(join(userData, 'settings.json'), JSON.stringify({ ui: { terminalOpen: true } }))
  const app = await electron.launch({
    args: ['.'],
    env: {
      ...base, NB_DISPLAY: process.env.NB_DISPLAY ?? '2', // test windows open on display 2, as in smoke.spec.ts
      NB_MEMORY_DIR: o.memory ?? tmp('nb-mem-'), NB_CLAUDE_PROJECTS: tmp('nb-projects-'), NB_SKIP_SETUP: '1', NB_USER_DATA: userData, NB_BOOK: book,
      NB_CMD_CLAUDE: join(fixtures, 'fake-claude.cmd'), NB_CMD_CLAUDE_HEADLESS: join(fixtures, 'fake-claude-headless.cmd'), NB_CMD_CODEBURN: stub, NB_CMD_HEADROOM: stub,
      FAKE_SCENARIO: o.scenario ?? 'ok', FAKE_LOG: join(tmp('nb-fakelog-'), 'prompts.log'), ...o.env
    }
  })
  const win = await app.firstWindow()
  const errors: string[] = []
  win.on('pageerror', e => errors.push(e.message))
  return { app, win, userData, errors }
}

/** Running animations outside xterm (its cursor blink is not studio motion). */
export const animations = (win: Page) => win.evaluate(() => document.getAnimations().filter(a => {
  const el = (a.effect as KeyframeEffect | null)?.target
  return el instanceof Element && !el.closest('.xterm')
}).length)

export const nav = (win: Page, name: string) =>
  win.getByRole('navigation', { name: 'Studio' }).getByRole('button', { name: new RegExp(`^${name}`) }).click()

/** Two acts, three POV characters, one accepted scene, one parked scene, canon, a saved run state and a spend line. */
export async function studioBook(title = 'Studio Book'): Promise<string> {
  const dir = await newBook(tmp('nb studio '), { title, audience: 'adult', genres: ['literary'], wordTarget: 60000 }, resolve('kit/fiction'), resolve('resources/hooks'), resolve('resources/accept/accept.mjs'))
  const put = (rel: string, text: string) => { mkdirSync(join(dir, rel, '..'), { recursive: true }); writeFileSync(join(dir, rel), text) }
  const char = (id: string, name: string, beats: string) => put(`bible/characters/${id}.md`, `---\nid: ${id}\nname: ${name}\nrole: lead\narcBeats: [${beats}]\n---\n${name} works the farm.\n`)
  char('CHAR-RUTH', 'Ruth Prewitt', 'denial, acceptance'); char('CHAR-TOM', 'Tom Prewitt', 'debt, atonement'); char('CHAR-MARI', 'Marisol Vega', 'secrecy, truth')
  put('bible/places/LOC-FIELD.md', '---\nid: LOC-FIELD\nname: The north field\n---\nCorn.\n')
  put('bible/places/LOC-BARN.md', '---\nid: LOC-BARN\nname: The hog barn\n---\nTin roof.\n')
  put('bible/world/style.md', '# Style guide\nShort declarative lines.\n')
  put('outline/outline.yaml', 'acts:\n  - id: ACT-1\n    title: The Planting\n    chapters:\n      - { id: CH-01, title: One, scenes: [SC-001, SC-002] }\n  - id: ACT-2\n    title: The Vials\n    chapters:\n      - { id: CH-02, title: Two, scenes: [SC-003] }\n')
  const plan = (id: string, t: string, pov: string, loc: string, time: string, status: string) =>
    put(`outline/scenes/${id}.yaml`, `id: ${id}\ntitle: ${t}\ngoal: ${t} turns the story\npov: ${pov}\nlocation: ${loc}\nstoryTime: "${time}"\nbeats: [Something turns]\narcBeats: [{ character: ${pov}, beat: denial }]\nmustReveal: []\nstatus: ${status}\n`)
  plan('SC-001', 'The Field', 'CHAR-RUTH', 'LOC-FIELD', 'Day 1', 'accepted')
  plan('SC-002', 'Midnight', 'CHAR-TOM', 'LOC-BARN', 'Day 2', 'needs-you')
  plan('SC-003', 'Six Sealed Vials', 'CHAR-MARI', 'LOC-BARN', 'Day 10', 'planned')
  put('manuscript/SC-001.md', 'Ruth walked the dead row at dawn and counted the stalks that had not come up.\n')
  for (const r of ['continuity', 'character', 'developmental', 'line', 'audience', 'reader', 'canon-auditor', 'gate'])
    put(`reviews/SC-001/${r}.md`, `---\nscene: SC-001\nreviewer: ${r}\nround: 1\nverdict: PASS\n---\nHolds.\n`)
  put('drafts/SC-002.md', 'Tom stood in the barn at midnight.\n')
  put('reviews/SC-002/continuity.md', '---\nscene: SC-002\nreviewer: continuity\nround: 3\nverdict: FAIL\n---\nThe plan says 8 pm; the draft says midnight.\n')
  put('reviews/SC-002/park.md', '---\nscene: SC-002\nreason: Plan says 8 pm. Draft says midnight. Which is true?\n---\nParked.\n')
  put('canon/facts.yaml', 'facts:\n  - { id: FACT-001, statement: The seed is not from the co-op, status: established, source: SC-001, supersedes: null }\n  - { id: FACT-002, statement: Tom owes the bank, status: established, source: bible, supersedes: null }\n')
  put('canon/timeline.yaml', 'events:\n  - { id: TL-002, storyTime: "Day 10", place: LOC-BARN, who: [CHAR-MARI], what: Marisol seals the vials, source: bible }\n  - { id: TL-001, storyTime: "Day 1", place: LOC-FIELD, who: [CHAR-RUTH, CHAR-TOM], what: Ruth finds the dead row, source: SC-001 }\n')
  put('canon/knowledge.yaml', 'entries:\n  - { character: CHAR-RUTH, fact: FACT-001, learnedIn: SC-001, how: She read the seed tag }\n')
  put('run/state.yaml', 'status: needs-you\nstopAt: chapter\npauseAtActs: false\nspentUsd: 0.42\ncurrent: null\ncompleted: [SC-001]\nparked: [SC-002]\ncheckedChapters: []\ncheckedActs: []\nresumeAfter: null\nlastError: null\n')
  put('run/spend.jsonl', `${JSON.stringify({ at: '2026-10-01T12:00:00.000Z', kind: 'scene', id: 'SC-001', usd: 0.4 })}\n`)
  put('run/room.jsonl', [ // every kind of room line, so axe sees each verdict's colours
    { at: '2026-10-01T11:00:00.000Z', step: 'SC-002', from: 'showrunner', kind: 'say', text: 'Starting SC-002.' },
    { at: '2026-10-01T11:01:00.000Z', step: 'SC-002', from: 'showrunner', to: 'author', kind: 'dispatch', text: 'Draft SC-002, round 3.' },
    { at: '2026-10-01T11:05:00.000Z', step: 'SC-002', from: 'author', to: 'showrunner', kind: 'reply', text: 'DRAFTED SC-002 round 3' },
    { at: '2026-10-01T11:06:00.000Z', step: 'SC-002', from: 'continuity-reviewer', kind: 'review', verdict: 'FAIL', text: 'Round 3. The plan says 8 pm.' },
    { at: '2026-10-01T11:06:00.000Z', step: 'SC-002', from: 'character-reviewer', kind: 'review', verdict: 'FLAG', text: 'Round 3. Tom confesses too easily.' },
    { at: '2026-10-01T11:06:00.000Z', step: 'SC-002', from: 'line-editor', kind: 'review', verdict: 'PASS', text: 'Round 3. No findings.' },
    { at: '2026-10-01T11:07:00.000Z', step: 'SC-002', from: 'app', kind: 'system', text: 'SC-002: parked', needsYou: true }
  ].map(e => JSON.stringify(e)).join('\n') + '\n')
  git(dir, 'add', '-A'); git(dir, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'Studio fixture')
  return dir
}

/** A book the size of a real one, for the capture spec: three acts, fourteen scenes, four POV characters, nine accepted scenes with prose, one parked, mixed reviews, ten events, a spend ledger. */
export async function captureBook(): Promise<string> {
  const dir = await newBook(tmp('nb capture '), { title: 'The Long Green', audience: 'adult', genres: ['literary'], wordTarget: 80000 }, resolve('kit/fiction'), resolve('resources/hooks'), resolve('resources/accept/accept.mjs'))
  const put = (rel: string, text: string) => { mkdirSync(join(dir, rel, '..'), { recursive: true }); writeFileSync(join(dir, rel), text) }
  const char = (id: string, name: string, role: string, voice: string, beats: string, body: string) =>
    put(`bible/characters/${id}.md`, `---\nid: ${id}\nname: ${name}\nrole: ${role}\nvoice: ${voice}\narcBeats: [${beats}]\n---\n# ${name}\n\n${body}\n`)
  char('CHAR-RUTH', 'Ruth Prewitt', 'lead', 'Short sentences. She notices soil before sky.', 'denial, first doubt, counting, acceptance',
    'Ruth has run the Prewitt place since her father stopped being able to climb the combine. She keeps the ledgers in pencil and the seed tags in a coffee can, and she can tell a bad row from the porch. She does not say what she thinks until she has walked it twice.\n\nWhat she wants is one clean season. What she fears is that Tom has already sold it.')
  char('CHAR-TOM', 'Tom Prewitt', 'lead', 'Jokes first, then the truth, if pressed.', 'debt, the lie, atonement',
    "Ruth's younger brother, back from Des Moines with a truck he cannot afford and a loan he has not mentioned. Tom is good with people and bad with paper. He signed for the seed because the man from the co-op was kind to him, and he has been avoiding the north field ever since.\n\nHe loves the farm the way you love a house you grew up in and left.")
  char('CHAR-MARI', 'Marisol Vega', 'secondary', 'Precise, technical, warm when nobody is watching.', 'secrecy, the vials, truth',
    'County extension agronomist, three years in Ansel County and still the new one. Marisol tests soil for a living and keeps her own samples in sealed vials in the truck. She knows what the seed is before anyone else does and says nothing, because the last agent who said something was moved to Cedar Rapids.')
  char('CHAR-HALE', 'Deacon Hale', 'antagonist', 'Soft-spoken, scripture and seed prices in the same breath.', 'charm, pressure, the ropes',
    "Manager of the Ansel County co-op and a deacon at First Methodist. Hale has never once raised his voice. He sold the Prewitts the seed, holds Tom's note, and will be the first to offer help when the rows come up dead.")
  char('CHAR-NELL', 'Nell Prewitt', 'child', 'Questions, mostly.', 'watching, understanding',
    "Ruth's daughter, nine. She rides the fender, names the barn cats, and hears every conversation the adults think she is not in the room for.")
  const place = (id: string, name: string, body: string) => put(`bible/places/${id}.md`, `---\nid: ${id}\nname: ${name}\n---\n${body}\n`)
  place('LOC-FIELD', 'The north field', 'Eighty acres of corn ground above the creek, the first the Prewitts ever bought. Drains badly on the west end.')
  place('LOC-BARN', 'The hog barn', 'Tin roof, no hogs since 2009. Tom keeps the truck in it and the paperwork in the truck.')
  place('LOC-COOP', 'The Ansel County co-op', "Grain elevator, seed office and a lunch counter that closes at two. Hale's office is behind the counter.")
  place('LOC-KITCHEN', 'The Prewitt kitchen', 'Yellow linoleum, a table built for eight, the radio always on for the markets.')
  place('LOC-TRUCK', "Marisol's county truck", 'A white Silverado with the county seal and a cooler of soil samples behind the seat.')
  put('bible/world/style.md', '# Style guide\n\nShort declarative lines. Weather is never a metaphor, it is weather. Nobody explains the farm to the reader; the reader keeps up. Dialogue carries the subtext; narration carries the dirt.\n')
  put('bible/world/ansel-county.md', '# Ansel County\n\nWestern Iowa, two towns and a river. Everyone banks at the same bank and buys seed from the same co-op, which is the point. Harvest starts the third week of September; planting is late April if the ground is dry.\n')
  put('bible/world/the-seed.md', '# The seed\n\nThe co-op sold a treated hybrid that failed germination in cold, wet ground. The treatment, not the seed, is the problem. Six growers were affected; the Prewitts planted the most of it.\n')
  put('outline/outline.yaml', ['acts:',
    '  - id: ACT-1', '    title: The Planting', '    chapters:', '      - { id: CH-01, title: Dead rows, scenes: [SC-001, SC-002, SC-003] }', '      - { id: CH-02, title: Receipts, scenes: [SC-004, SC-005] }',
    '  - id: ACT-2', '    title: The Vials', '    chapters:', '      - { id: CH-03, title: What the seed was, scenes: [SC-006, SC-007, SC-008] }', '      - { id: CH-04, title: Midnight, scenes: [SC-009, SC-010] }',
    '  - id: ACT-3', '    title: The Ropes', '    chapters:', '      - { id: CH-05, title: The sack, scenes: [SC-011, SC-012, SC-013] }', '      - { id: CH-06, title: All four, scenes: [SC-014] }', ''].join('\n'))
  type Scene = [id: string, title: string, pov: string, loc: string, time: string, beat: string, status: string, words: number]
  const scenes: Scene[] = [
    ['SC-001', 'The Field', 'CHAR-RUTH', 'LOC-FIELD', 'May 2, dawn', 'denial', 'accepted', 1812],
    ['SC-002', 'Receipts', 'CHAR-TOM', 'LOC-BARN', 'May 2, noon', 'debt', 'accepted', 1640],
    ['SC-003', 'Behind the Hog House', 'CHAR-RUTH', 'LOC-BARN', 'May 2, dusk', 'first doubt', 'accepted', 1795],
    ['SC-004', 'What the Seed Was', 'CHAR-MARI', 'LOC-TRUCK', 'May 3', 'secrecy', 'accepted', 1903],
    ['SC-005', 'The Same Pocket', 'CHAR-TOM', 'LOC-COOP', 'May 4', 'the lie', 'accepted', 1688],
    ['SC-006', 'Six Sealed Vials', 'CHAR-MARI', 'LOC-TRUCK', 'May 6', 'the vials', 'accepted', 1710],
    ['SC-007', 'Eleven Years', 'CHAR-RUTH', 'LOC-KITCHEN', 'May 6, night', 'counting', 'accepted', 1820],
    ['SC-008', 'A Kind Man', 'CHAR-HALE', 'LOC-COOP', 'May 8', 'charm', 'accepted', 1544],
    ['SC-009', 'The Sack', 'CHAR-TOM', 'LOC-BARN', 'May 9', 'atonement', 'accepted', 1652],
    ['SC-010', 'Midnight', 'CHAR-TOM', 'LOC-BARN', 'May 9, 8 pm', 'the lie', 'needs-you', 0],
    ['SC-011', 'The Ropes', 'CHAR-HALE', 'LOC-COOP', 'May 12', 'pressure', 'review', 0],
    ['SC-012', 'What Nell Heard', 'CHAR-RUTH', 'LOC-KITCHEN', 'May 12, night', 'acceptance', 'planned', 0],
    ['SC-013', 'Cedar Rapids', 'CHAR-MARI', 'LOC-COOP', 'May 14', 'truth', 'planned', 0],
    ['SC-014', 'All Four on the Ropes', 'CHAR-RUTH', 'LOC-FIELD', 'May 20', 'acceptance', 'planned', 0]
  ]
  const names: Record<string, string> = { 'CHAR-RUTH': 'Ruth', 'CHAR-TOM': 'Tom', 'CHAR-MARI': 'Marisol', 'CHAR-HALE': 'Hale' }
  const lines = [
    '%N walked the dead row at dawn and counted the stalks that had not come up.', "The ground was cold and the ground was wet and neither of those was anybody's fault.",
    'Nobody said the word seed. They said the weather, the drainage, the late frost, the way you say a name you are not ready to say.',
    '"It will come," Tom said. "Give it a week." He did not look at the row when he said it.', 'The radio in the kitchen gave the markets, corn down three, beans flat, and then the weather again.',
    "Marisol kept the vials in the cooler behind the seat, each one labelled in a hand nobody at the county would mistake for anyone else's.",
    'Hale came out from behind the counter the way he always did, wiping his hands on nothing, smiling before he had decided what to say.',
    'The note was in the glove box, folded twice, under the registration. It had been there since April.', 'Nell rode the fender and asked why the rows were brown and nobody answered her, so she asked the cat.',
    '"How much," %N said. It was not a question yet. It would be a question by supper.', 'Rain by Thursday, the radio said, and for once it was right.',
    'There were eleven years of ledgers in the drawer and %N had kept every one of them in pencil so they could be changed and never had.',
    'The sack was what the seed had come in. Fifty pounds, the co-op logo, the lot number worn where a thumb had rubbed it.', 'She did not cry. She walked the row a second time and then she went in and made coffee.',
    '"You signed it," Ruth said. "I know what I signed," Tom said, and then, because that was not true, "I know what I meant to sign."'
  ]
  const prose = (pov: string, words: number) => {
    const out: string[] = []
    let n = 0
    for (let i = 0; n < words; i++) { const l = lines[(i * 7 + pov.length) % lines.length].replace(/%N/g, names[pov]); out.push(l); n += l.split(/\s+/).length; if (i % 4 === 3) out.push('') }
    return `${out.join('\n').replace(/\n\n\n/g, '\n\n').trim()}\n`
  }
  const R = ['continuity', 'character', 'developmental', 'line', 'audience', 'canon-auditor', 'gate']
  const review = (id: string, r: string, round: number, verdict: string, body: string) => put(`reviews/${id}/${r}.md`, `---\nscene: ${id}\nreviewer: ${r}\nround: ${round}\nverdict: ${verdict}\n---\n${body}\n`)
  scenes.forEach(([id, t, pov, loc, time, beat, status, words], i) => {
    put(`outline/scenes/${id}.yaml`, `id: ${id}\ntitle: ${t}\ngoal: ${t} turns the chapter\npov: ${pov}\nlocation: ${loc}\nstoryTime: "${time}"\nbeats: [The scene opens on the ${loc === 'LOC-FIELD' ? 'field' : 'room'}, Something turns, It ends on a held breath]\narcBeats: [{ character: ${pov}, beat: ${beat} }]\nmustReveal: [${i < 6 ? `FACT-00${i + 1}` : ''}]\nstatus: ${status}\n`)
    if (status === 'accepted') {
      put(`manuscript/${id}.md`, prose(pov, words))
      // a few scenes needed a second round: the line and audience reviews flagged the first draft
      const round = i % 3 === 2 ? 2 : 1
      for (const r of R) review(id, r, round, 'PASS', round === 2 && (r === 'line' || r === 'audience') ? 'Holds now; the first draft ran long in the middle.' : 'Holds.')
    }
  })
  put('drafts/SC-010.md', prose('CHAR-TOM', 1744))
  review('SC-010', 'continuity', 3, 'FAIL', 'The plan has Tom in the barn at 8 pm; the draft opens at midnight and Ruth is already asleep. One of them is wrong and the timeline needs to know which.')
  review('SC-010', 'character', 3, 'FLAG', 'Tom confesses too easily for a man who has hidden the note for five weeks.')
  for (const r of R.slice(2)) review('SC-010', r, 3, 'PASS', 'Holds.')
  put('reviews/SC-010/park.md', '---\nscene: SC-010\nreason: Plan says 8 pm. Draft says midnight. Which is true?\n---\nParked after three rounds.\n')
  put('drafts/SC-011.md', prose('CHAR-HALE', 900))
  review('SC-011', 'continuity', 1, 'PASS', 'Holds.'); review('SC-011', 'character', 1, 'PASS', 'Holds.'); review('SC-011', 'developmental', 1, 'FLAG', 'The offer of help lands before the reader knows what it costs.')
  put('canon/facts.yaml', ['facts:',
    '  - { id: FACT-001, statement: The north field was planted with co-op seed lot 4471, status: established, source: SC-001, supersedes: null }',
    '  - { id: FACT-002, statement: Tom signed the seed note alone in April, status: established, source: SC-002, supersedes: null }',
    '  - { id: FACT-003, statement: Ruth suspects the seed before she has proof, status: established, source: SC-003, supersedes: null }',
    '  - { id: FACT-004, statement: The seed treatment fails in cold wet ground, status: established, source: SC-004, supersedes: null }',
    '  - { id: FACT-005, statement: Hale holds the Prewitt note, status: established, source: SC-005, supersedes: null }',
    '  - { id: FACT-006, statement: Marisol has six sealed samples from six farms, status: established, source: SC-006, supersedes: null }',
    '  - { id: FACT-007, statement: Tom owes the bank, status: superseded, source: bible, supersedes: null }',
    '  - { id: FACT-008, statement: Tom owes the co-op and not the bank, status: established, source: SC-005, supersedes: FACT-007 }', ''].join('\n'))
  put('canon/timeline.yaml', ['events:',
    '  - { id: TL-001, storyTime: "April 28", place: LOC-COOP, who: [CHAR-TOM, CHAR-HALE], what: Tom signs the seed note, source: SC-002 }',
    '  - { id: TL-002, storyTime: "May 2, dawn", place: LOC-FIELD, who: [CHAR-RUTH], what: Ruth finds the dead rows, source: SC-001 }',
    '  - { id: TL-003, storyTime: "May 2, noon", place: LOC-BARN, who: [CHAR-TOM], what: Tom hides the note in the glove box, source: SC-002 }',
    '  - { id: TL-004, storyTime: "May 2, dusk", place: LOC-BARN, who: [CHAR-RUTH, CHAR-TOM], what: Ruth asks Tom about the seed and he lies, source: SC-003 }',
    '  - { id: TL-005, storyTime: "May 3", place: LOC-TRUCK, who: [CHAR-MARI], what: Marisol tests the first sample, source: SC-004 }',
    '  - { id: TL-006, storyTime: "May 4", place: LOC-COOP, who: [CHAR-TOM, CHAR-HALE], what: Hale offers Tom more time, source: SC-005 }',
    '  - { id: TL-007, storyTime: "May 6", place: LOC-TRUCK, who: [CHAR-MARI, CHAR-RUTH], what: Marisol shows Ruth the vials, source: SC-006 }',
    '  - { id: TL-008, storyTime: "May 6, night", place: LOC-KITCHEN, who: [CHAR-RUTH, CHAR-NELL], what: Ruth reads eleven years of ledgers, source: SC-007 }',
    '  - { id: TL-009, storyTime: "May 8", place: LOC-COOP, who: [CHAR-HALE, CHAR-MARI], what: Hale asks Marisol about the samples, source: SC-008 }',
    '  - { id: TL-010, storyTime: "May 9", place: LOC-BARN, who: [CHAR-TOM, CHAR-RUTH], what: Tom finds the seed sack, source: SC-009 }', ''].join('\n'))
  put('canon/knowledge.yaml', ['entries:',
    '  - { character: CHAR-RUTH, fact: FACT-001, learnedIn: SC-001, how: She read the seed tag }',
    '  - { character: CHAR-TOM, fact: FACT-002, learnedIn: SC-002, how: He signed it }',
    '  - { character: CHAR-HALE, fact: FACT-002, learnedIn: SC-002, how: He watched him sign }',
    '  - { character: CHAR-MARI, fact: FACT-004, learnedIn: SC-004, how: The germination test }',
    '  - { character: CHAR-RUTH, fact: FACT-004, learnedIn: SC-006, how: Marisol showed her the vials }',
    '  - { character: CHAR-TOM, fact: FACT-008, learnedIn: SC-005, how: Hale told him }',
    '  - { character: CHAR-MARI, fact: FACT-006, learnedIn: SC-006, how: She sealed them }', ''].join('\n'))
  put('notes/open-questions.yaml', 'questions:\n  - { id: Q-001, question: Does Nell tell Ruth what she heard in the barn?, raised: SC-003, answerBy: CH-05, answered: null }\n  - { id: Q-002, question: Who moved the last agent to Cedar Rapids?, raised: SC-004, answerBy: CH-05, answered: null }\n')
  put('run/state.yaml', 'status: needs-you\nstopAt: act\npauseAtActs: true\nspentUsd: 11.36\ncurrent: null\ncompleted: [SC-001, SC-002, SC-003, SC-004, SC-005, SC-006, SC-007, SC-008, SC-009]\nparked: [SC-010]\ncheckedChapters: [CH-01, CH-02, CH-03]\ncheckedActs: [ACT-1]\nresumeAfter: null\nlastError: null\n')
  const day = (d: number, h: number) => { const t = new Date(); t.setDate(t.getDate() - d); t.setHours(h, 0, 0, 0); return t.toISOString() }
  const spend: [number, number, string, string, number][] = [
    [3, 9, 'scene', 'SC-001', 0.71], [3, 10, 'scene', 'SC-002', 0.64], [3, 11, 'scene', 'SC-003', 0.88], [3, 12, 'revise', 'SC-003', 0.41], [3, 13, 'chapter', 'CH-01', 0.33],
    [2, 9, 'scene', 'SC-004', 0.77], [2, 10, 'scene', 'SC-005', 0.69], [2, 11, 'chapter', 'CH-02', 0.3], [2, 12, 'act', 'ACT-1', 0.52],
    [1, 9, 'scene', 'SC-006', 0.73], [1, 10, 'scene', 'SC-007', 0.81], [1, 11, 'scene', 'SC-008', 0.6], [1, 12, 'chapter', 'CH-03', 0.31],
    [0, 8, 'scene', 'SC-009', 0.74], [0, 9, 'revise', 'SC-009', 0.38], [0, 10, 'scene', 'SC-010', 0.9], [0, 11, 'revise', 'SC-010', 0.47], [0, 12, 'revise', 'SC-010', 0.45], [0, 13, 'scene', 'SC-011', 0.7]
  ]
  put('run/spend.jsonl', `${spend.map(([d, h, kind, id, usd]) => JSON.stringify({ at: day(d, h), kind, id, usd })).join('\n')}\n`)
  // The Writers' room as the runner writes it: SC-009 accepted, SC-010 parked after its third round.
  const room: object[] = []
  const said = (h: number, m: number, step: string, from: string, kind: string, text: string, o: object = {}) => {
    const t = new Date(day(1, h)); t.setMinutes(m); room.push({ at: t.toISOString(), step, from, kind, text, ...o })
  }
  said(8, 0, 'SC-009', 'showrunner', 'say', 'Starting SC-009. Tom finds the seed sack in the barn; the plan wants the lot number to land before he says anything.')
  said(8, 1, 'SC-009', 'showrunner', 'dispatch', 'Draft SC-009, round 1. Keep Tom quiet until the lot number.', { to: 'author' })
  said(8, 9, 'SC-009', 'author', 'reply', 'DRAFTED SC-009 round 1. 1,652 words. Tom reads the lot number twice and does not call Ruth.', { to: 'showrunner' })
  for (const [i, r] of ['continuity-reviewer', 'character-reviewer', 'developmental-editor', 'line-editor', 'audience-reviewer', 'reader', 'canon-auditor'].entries())
    said(8, 12 + i, 'SC-009', r, 'review', 'Round 1. No findings.', { verdict: 'PASS' })
  said(8, 20, 'SC-009', 'gate-checker', 'review', 'Round 1. No findings.', { verdict: 'PASS' })
  said(8, 21, 'SC-009', 'app', 'system', 'SC-009: accepted')
  said(10, 0, 'SC-010', 'showrunner', 'say', 'Starting SC-010. Midnight in the barn.')
  said(10, 1, 'SC-010', 'showrunner', 'dispatch', 'Draft SC-010, round 1.', { to: 'author' })
  said(10, 8, 'SC-010', 'author', 'reply', 'DRAFTED SC-010 round 1. 1,744 words.', { to: 'showrunner' })
  said(10, 12, 'SC-010', 'continuity-reviewer', 'review', 'Round 1. Rule: CONT-TIME-02 Quote: "The barn clock said midnight." Problem: The plan has Tom in the barn at 8 pm.', { verdict: 'FAIL' })
  said(10, 13, 'SC-010', 'character-reviewer', 'review', 'Round 1. Rule: CHAR-VOICE-03 Quote: "I signed it, Ruth." Problem: Tom confesses too easily for a man who has hidden the note for five weeks.', { verdict: 'FLAG' })
  said(12, 40, 'SC-010', 'app', 'system', 'SC-010: parked (Plan says 8 pm. Draft says midnight. Which is true?)', { needsYou: true })
  put('run/room.jsonl', `${room.map(e => JSON.stringify(e)).join('\n')}\n`)
  git(dir, 'add', '-A'); git(dir, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'Capture fixture')
  return dir
}

/** Two planned scenes in one chapter, for the run specs. */
export async function tinyBook(): Promise<string> {
  const dir = await newBook(tmp('nb e2e '), { title: 'Run Book', audience: 'adult', genres: ['literary'], wordTarget: 60000 }, resolve('kit/fiction'), resolve('resources/hooks'), resolve('resources/accept/accept.mjs'))
  const put = (rel: string, text: string) => writeFileSync(join(dir, rel), text)
  put('bible/characters/CHAR-RUTH.md', '---\nid: CHAR-RUTH\nname: Ruth Prewitt\nrole: protagonist\narcBeats: [denial, acceptance]\n---\nA farmer.\n')
  put('bible/places/LOC-FIELD.md', '---\nid: LOC-FIELD\nname: The north field\n---\nCorn.\n')
  put('outline/outline.yaml', 'acts:\n  - id: ACT-1\n    title: Beginning\n    chapters:\n      - { id: CH-01, title: One, scenes: [SC-001, SC-002] }\n')
  mkdirSync(join(dir, 'outline', 'scenes'), { recursive: true })
  for (const id of ['SC-001', 'SC-002'])
    put(`outline/scenes/${id}.yaml`, `id: ${id}\ntitle: Scene ${id}\ngoal: Ruth finds the dead row\npov: CHAR-RUTH\nlocation: LOC-FIELD\nstoryTime: "Day 1"\nbeats: [Ruth walks the rows]\narcBeats: []\nmustReveal: []\nstatus: planned\n`)
  git(dir, 'add', '-A')
  git(dir, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'Outline')
  return dir
}

/** A finished book for export: three chapters of two accepted scenes each, about `words` words in all, with an author set. */
export async function publishBook(o: { words?: number; title?: string } = {}): Promise<string> {
  const dir = await newBook(tmp('nb publish '), { title: o.title ?? 'Publish Book', audience: 'adult', genres: ['literary'], wordTarget: 60000 }, resolve('kit/fiction'), resolve('resources/hooks'), resolve('resources/accept/accept.mjs'))
  const put = (rel: string, text: string) => { mkdirSync(join(dir, rel, '..'), { recursive: true }); writeFileSync(join(dir, rel), text) }
  put('bible/characters/CHAR-RUTH.md', '---\nid: CHAR-RUTH\nname: Ruth Prewitt\nrole: protagonist\narcBeats: [denial, acceptance]\n---\nA farmer.\n')
  put('bible/places/LOC-FIELD.md', '---\nid: LOC-FIELD\nname: The north field\n---\nCorn.\n')
  put('outline/outline.yaml', 'acts:\n  - id: ACT-1\n    title: One\n    chapters:\n      - { id: CH-01, title: The Field, scenes: [SC-001, SC-002] }\n      - { id: CH-02, title: The Barn, scenes: [SC-003, SC-004] }\n      - { id: CH-03, title: The Bank, scenes: [SC-005, SC-006] }\n')
  const para = 'Ruth walked the long row at dawn and counted every stalk that had failed to come up, and she said nothing to Tom about it, not yet, because the counting was hers. '
  const per = Math.max(1, Math.round((o.words ?? 9000) / 6 / 120))
  for (let i = 1; i <= 6; i++) {
    const id = `SC-00${i}`
    put(`outline/scenes/${id}.yaml`, `id: ${id}\ntitle: Scene ${i}\ngoal: Ruth counts\npov: CHAR-RUTH\nlocation: LOC-FIELD\nstoryTime: "Day ${i}"\nbeats: [Ruth counts]\narcBeats: []\nmustReveal: []\nstatus: accepted\n`)
    put(`manuscript/${id}.md`, Array.from({ length: per }, () => para.repeat(4).trim()).join('\n\n') + (i % 2 ? '\n\n* * *\n\nThe light went.' : '') + '\n')
  }
  put('book.yaml', readFileSync(join(dir, 'book.yaml'), 'utf8') + 'export:\n  author: Ruth Writer\n  dedication: For the north field.\n  aboutAuthor: Ruth Writer farms and writes.\n')
  git(dir, 'add', '-A'); git(dir, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'Finished book')
  return dir
}

import { test, expect, _electron as electron } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { newBook } from '../src/main/book/create'

const fixtures = resolve('test/fixtures')
const git = (dir: string, ...a: string[]) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' })

async function tinyBook(): Promise<string> {
  const dir = await newBook(mkdtempSync(join(tmpdir(), 'nb e2e ')), { title: 'Run Book', audience: 'adult', genres: ['literary'], wordTarget: 60000 }, resolve('kit/fiction'), resolve('resources/hooks'), resolve('resources/accept/accept.mjs'))
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

async function launch(book: string, scenario: string) {
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toLowerCase() !== 'nodefaultcurrentdirectoryinexepath'))
  const stub = `node "${join(fixtures, 'stub-server.mjs')}" {port}`
  const app = await electron.launch({
    args: ['.'],
    env: {
      ...base,
      NB_SKIP_SETUP: '1',
      NB_USER_DATA: mkdtempSync(join(tmpdir(), 'nb-data-')),
      NB_BOOK: book,
      NB_CMD_CLAUDE: join(fixtures, 'fake-claude.cmd'),
      NB_CMD_CLAUDE_HEADLESS: join(fixtures, 'fake-claude-headless.cmd'),
      NB_CMD_CODEBURN: stub,
      NB_CMD_HEADROOM: stub,
      FAKE_SCENARIO: scenario,
      FAKE_LOG: join(mkdtempSync(join(tmpdir(), 'nb-fakelog-')), 'prompts.log')
    }
  })
  return { app, win: await app.firstWindow() }
}

test('runs a tiny book to done (one act)', async () => {
  const book = await tinyBook()
  const { app, win } = await launch(book, 'ok')
  await win.getByLabel('Stop at').selectOption('act')
  await win.getByRole('button', { name: 'Start' }).click()
  const status = win.getByRole('status')
  await expect(status).toContainText('Status: done', { timeout: 60_000 })
  await expect(win.locator('.runbar')).toContainText('Spent so far: $0.04')
  expect(git(book, 'log', '--format=%s').split('\n').filter(l => l.startsWith('Accept SC-'))).toHaveLength(2)
  await app.close()
})

test('parks a failing scene, shows its reason, and releases it', async () => {
  const book = await tinyBook()
  const { app, win } = await launch(book, 'fail:SC-002')
  await win.getByRole('button', { name: 'Start' }).click()
  await expect(win.getByRole('status')).toContainText('Status: needs-you', { timeout: 60_000 })
  const parked = win.getByRole('list', { name: 'Parked scenes' })
  await expect(parked).toContainText('SC-002')
  await expect(parked).toContainText('Three review rounds failed')
  await win.getByRole('button', { name: 'Release SC-002' }).click()
  await expect(parked).toHaveCount(0)
  expect(readFileSync(join(book, 'outline/scenes/SC-002.yaml'), 'utf8')).toMatch(/^status: planned$/m)
  expect(git(book, 'status', '--porcelain', '--', 'outline')).toBe('')
  await app.close()
})

test('an author change shows its preview and Approve commits it', async () => {
  const book = await tinyBook()
  mkdirSync(join(book, 'notes', 'changes'), { recursive: true })
  writeFileSync(join(book, 'notes/changes/CHG-0001.yaml'), 'id: CHG-0001\nsummary: Ruth always knew about the seed\ncanon:\n  - { op: add, target: facts, data: { statement: Ruth bought the seed herself } }\n')
  git(book, 'add', '-A')
  git(book, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'Change')
  const { app, win } = await launch(book, 'ok')
  const panel = win.getByRole('region', { name: 'Author changes' })
  await expect(panel).toContainText('CHG-0001')
  await expect(panel).toContainText('Ruth always knew about the seed')
  await expect(win.getByRole('button', { name: 'Approve CHG-0001' })).toBeDisabled()
  await win.getByRole('button', { name: 'Preview CHG-0001' }).click()
  await expect(win.getByLabel('canon/facts.yaml after')).toContainText('Ruth bought the seed herself')
  await win.getByRole('button', { name: 'Approve CHG-0001' }).click()
  await expect(win.getByText(/CHG-0001 applied \(commit/)).toBeVisible()
  expect(git(book, 'log', '--format=%s', '-1').trim()).toBe('Author change CHG-0001: Ruth always knew about the seed')
  expect(readFileSync(join(book, 'canon/facts.yaml'), 'utf8')).toMatch(/source: author/)
  await app.close()
})

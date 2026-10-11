import { test, expect } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { newBook } from '../src/main/book/create'
import type { Api } from '../src/preload'
import { git, launch, nav, tinyBook } from './e2e'

test('runs a tiny book to done (one act)', async () => {
  const book = await tinyBook()
  const { app, win } = await launch(book, { scenario: 'ok' })
  await nav(win, 'Run')
  await win.getByLabel('Stop at').selectOption('act')
  await win.getByRole('button', { name: 'Start' }).click()
  const status = win.getByRole('status', { name: 'Run status' })
  await expect(status).toContainText('Done', { timeout: 60_000 })
  await expect(win.locator('#view')).toContainText('Spent so far: $0.05')
  expect(git(book, 'log', '--format=%s').split('\n').filter(l => l.startsWith('Accept SC-'))).toHaveLength(2)
  await nav(win, 'Settings')
  await expect(win.getByText('Claude Code 9.9.9-fake, checked at the last step.')).toBeVisible()
  await app.close()
})

test('parks a failing scene, shows its reason, and releases it', async () => {
  const book = await tinyBook()
  const { app, win } = await launch(book, { scenario: 'fail:SC-002' })
  await nav(win, 'Run')
  await win.getByRole('button', { name: 'Start' }).click()
  await expect(win.getByRole('status', { name: 'Run status' })).toContainText('Needs you', { timeout: 60_000 })
  await nav(win, 'Needs you')
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
  const { app, win } = await launch(book, { scenario: 'ok' })
  await nav(win, 'Needs you')
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

test('the act check runs a deep memory pass, and approving its skill installs it in the book', async () => {
  const book = await tinyBook()
  const memory = mkdtempSync(join(tmpdir(), 'nb-mem-'))
  const { app, win } = await launch(book, { scenario: 'distill', memory, env: { FAKE_USAGE: '50' } })
  await nav(win, 'Run')
  await win.getByLabel('Stop at').selectOption('act')
  await expect(win.getByText('Usage: 5h unknown · week unknown')).toBeVisible()
  await win.getByRole('button', { name: 'Start' }).click()
  await expect(win.getByRole('status', { name: 'Run status' })).toContainText('Done', { timeout: 60_000 })
  await expect(win.getByText('Usage: 5h 50% · week 20%')).toBeVisible()
  await nav(win, 'Needs you')
  const skills = win.getByRole('region', { name: 'Proposed skills' })
  await expect(skills).toContainText('chase', { timeout: 30_000 })
  await expect(skills).toContainText('Use when a scene drags')
  await nav(win, 'Memory')
  const panel = win.locator('#view')
  expect(git(memory, 'log', '--format=%s')).toMatch(/^Deep pass \S+ ACT-1$/m)
  expect(git(memory, 'log', '--format=%s')).toMatch(/^Audit \S+ ACT-1 by opus$/m)
  const log = panel.getByRole('list', { name: 'Lesson audit log' })
  await expect(log).toContainText('filter-words added: Matches the act reviews.')
  await expect(log).toContainText('skill chase kept: Matches the act reviews.')
  // The IPC contract Plan 5 builds on, called the way the renderer calls it.
  const lessons = await win.evaluate(() => (window as unknown as { api: Api }).api.memoryLessons())
  expect(lessons.lessons).toContainEqual(expect.objectContaining({ file: expect.stringMatching(/^books\/[a-z0-9-]+\/topics\/filter-words\.md$/), scope: 'book', status: 'live', live: expect.any(String) }))
  expect(await win.evaluate(() => (window as unknown as { api: Api }).api.memoryDeleteLesson('topics/..\\..\\x.md'))).toEqual({ ok: false, error: 'Invalid lesson' })
  expect(readFileSync(join(book, '.novelbrain', 'memory.md'), 'utf8')).toContain('Cut filter words')
  await nav(win, 'Needs you')
  await win.getByRole('button', { name: 'Approve skill chase' }).click()
  await expect(skills).toContainText('chase approved')
  expect(readFileSync(join(book, '.claude/skills/learned-chase/SKILL.md'), 'utf8')).toContain('name: chase')
  expect(git(book, 'log', '--format=%s', '-1').trim()).toBe('Learned skills')
  await expect(win.getByRole('checkbox', { name: 'Memory on' })).toHaveCount(0) // memory is always on
  await nav(win, 'Memory')
  await win.getByRole('button', { name: 'Delete lesson filter-words' }).click()
  await expect(panel).toContainText('filter-words deleted.')
  await expect.poll(() => readFileSync(join(book, '.novelbrain', 'memory.md'), 'utf8')).not.toContain('Cut filter words')
  expect(git(memory, 'log', '-1', '--format=%s').trim()).toBe('Delete lesson filter-words (writer)')
  await expect(log).toContainText('filter-words deleted: Deleted by the writer.')
  await app.close()
})

test('the run stops with usage-limit when plan usage is over the stop point, after memory runs', async () => {
  const book = await tinyBook()
  const { app, win } = await launch(book, { scenario: 'ok', env: { FAKE_USAGE: '95', FAKE_USAGE_RESET: '4102444800' } })
  await nav(win, 'Run')
  await win.getByRole('button', { name: 'Start' }).click()
  await expect(win.getByRole('status', { name: 'Run status' })).toContainText('Usage limit', { timeout: 60_000 })
  await expect(win.locator('#view')).toContainText('Resumes after:')
  await expect(win.getByText('Usage: 5h 95% · week 20%')).toBeVisible()
  expect(git(book, 'log', '--format=%s').split('\n').filter(l => l.startsWith('Accept SC-'))).toHaveLength(1)
  await app.close()
})

test("the writers' room shows the run as real messages between named agents", async () => {
  const book = await tinyBook()
  const { app, win } = await launch(book, { scenario: 'ok' })
  await nav(win, 'Run')
  await win.getByLabel('Stop at').selectOption('act')
  await win.getByRole('button', { name: 'Start' }).click()
  await expect(win.getByRole('status', { name: 'Run status' })).toContainText('Done', { timeout: 60_000 })
  await nav(win, "Writers' room")
  const log = win.getByRole('log', { name: "Writers' room messages" })
  await log.getByRole('button', { name: /^SC-001 · Scene SC-001 · \d+ messages$/ }).click() // the scene's thread; the latest (the act check) is open
  await expect(log).toContainText('Draft SC-001, round 1.')        // the showrunner's real dispatch
  await expect(log).toContainText('DRAFTED SC-001 round 1')         // the author's real reply
  await expect(log).toContainText('SC-001: accepted')               // the runner's own outcome line
  await expect(log).not.toContainText('a subagent thinking aloud')  // a subagent's own turns stay out
  await expect(log.locator('.msg.v-pass').first()).toBeVisible()    // a review file's verdict
  await expect(log.locator('.name', { hasText: /^Ada$/ }).first()).toBeVisible() // the author's own name
  expect(await log.locator('script').count()).toBe(0)
  await app.close()
})

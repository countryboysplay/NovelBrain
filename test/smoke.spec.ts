import { test, expect, _electron as electron } from '@playwright/test'
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { newBook } from '../src/main/book/create'

const fixtures = resolve('test/fixtures')
const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }

test('opens a book, runs Claude inside it with the guard registered, and leaves no orphans', async () => {
  const pids = mkdtempSync(join(tmpdir(), 'nb-pids-'))
  const book = await newBook(mkdtempSync(join(tmpdir(), 'nb smoke ')), { title: 'Smoke Book', audience: 'adult', genres: ['mystery'], wordTarget: 50000 }, resolve('kit/fiction'), resolve('resources/hooks'), resolve('resources/accept/accept.mjs'))
  const stub = `node "${join(fixtures, 'stub-server.mjs')}" {port}`
  // Drop the variable so the test proves the app sets it, not the developer's shell.
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toLowerCase() !== 'nodefaultcurrentdirectoryinexepath'))
  const app = await electron.launch({
    args: ['.'],
    env: {
      ...base,
      NB_SKIP_SETUP: '1',
      NB_DISPLAY: process.env.NB_DISPLAY ?? '2',
      NB_USER_DATA: mkdtempSync(join(tmpdir(), 'nb-data-')),
      NB_BOOK: book,
      NB_TEST_PIDS: pids,
      NB_MEMORY_DIR: mkdtempSync(join(tmpdir(), 'nb-mem-')),
      NB_CLAUDE_PROJECTS: mkdtempSync(join(tmpdir(), 'nb-projects-')),
      NB_CMD_CLAUDE: join(fixtures, 'fake-claude.cmd'),
      NB_CMD_CODEBURN: stub,
      NB_CMD_HEADROOM: stub
    }
  })
  const win = await app.firstWindow()
  await expect(win.getByRole('heading', { name: 'Smoke Book' })).toBeVisible({ timeout: 30_000 })
  await win.keyboard.press('Control+Backquote') // the studio ships with the terminal folded
  const term = win.locator('.xterm-accessibility')
  await expect(term).toContainText('FAKE CLAUDE READY', { timeout: 30_000 })
  await expect(term).toContainText(`CWD=${book}`)
  await expect(term).toContainText('NODEFAULTCWD=1')

  const settings = JSON.parse(readFileSync(join(book, '.claude', 'settings.local.json'), 'utf8'))
  const guardCmd: string = settings.hooks.PreToolUse[0].hooks[0].command
  expect(guardCmd).toMatch(/guard\.mjs"$/)
  expect(existsSync(guardCmd.match(/"(.+)"/)![1])).toBe(true)
  await expect(win.getByText(/problem/)).toHaveCount(0)

  const started = readdirSync(pids).map(f => Number(f.split('-')[1]))
  expect(started.length).toBeGreaterThanOrEqual(1)
  await app.close()
  await expect.poll(() => started.filter(alive), { timeout: 15_000 }).toEqual([])
})

import { test, expect, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { launch, nav, studioBook } from './e2e'

const VIEWS = ['Bible', 'Outline', 'Timeline', 'Series', 'Manuscript', 'Run', "Writers' room", 'Needs you', 'Publish', 'Cost', 'Memory', 'Story map', 'Settings']
async function axe(win: Page) {
  if (!(await win.evaluate(() => 'axe' in window))) await win.addScriptTag({ path: resolve('node_modules/axe-core/axe.min.js') })
  return win.evaluate(async () => {
    const r = await (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } })
      .axe.run({ exclude: [['.xterm'], ['webview']] }, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } })
    return r.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)
  })
}

for (const theme of ['Night studio', 'Daylight studio']) {
  test(`every view passes axe (WCAG 2.2 AA) in the ${theme}`, async () => {
    const book = await studioBook()
    const { app, win } = await launch(book)
    await nav(win, 'Settings')
    await win.emulateMedia({ colorScheme: null }) // Playwright pins prefers-color-scheme to light; let the theme setting drive it
    await win.getByRole('radio', { name: theme }).check()
    await expect.poll(() => win.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(theme === 'Night studio')
    for (const v of VIEWS) {
      await nav(win, v)
      await expect(win.getByRole('heading', { level: 2, name: v })).toBeVisible()
      expect(await axe(win), `${v} in ${theme}`).toEqual([])
    }
    await app.close()
  })
}

test('keyboard only: reach a scene, open it, close it, change a setting', async () => {
  const book = await studioBook()
  const { app, win } = await launch(book)
  await expect(win.getByRole('heading', { level: 1, name: 'Studio Book' })).toBeVisible({ timeout: 30_000 })
  await win.locator('.xterm-helper-textarea').focus()
  await win.keyboard.press('F6')                                  // rail
  for (let i = 0; i < 12 && !(await win.getByRole('button', { name: /^Outline/ }).evaluate(el => el === document.activeElement)); i++) await win.keyboard.press('Shift+Tab')
  await win.keyboard.press('Enter')
  await win.keyboard.press('F6')                                  // view
  for (let i = 0; i < 20 && !(await win.getByRole('button', { name: 'The Field' }).evaluate(el => el === document.activeElement)); i++) await win.keyboard.press('Tab')
  await win.keyboard.press('Enter')
  await expect(win.getByRole('dialog', { name: 'The Field' })).toBeVisible()
  await win.keyboard.press('Escape')
  await expect(win.getByRole('button', { name: 'The Field' })).toBeFocused()
  await app.close()
})

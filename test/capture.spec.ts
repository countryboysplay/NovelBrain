import { expect, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { captureBook, launch, nav } from './e2e'

const VIEWS = ['Bible', 'Outline', 'Timeline', 'Series', 'Manuscript', 'Run', "Writers' room", 'Needs you', 'Cost', 'Memory', 'Story map', 'Settings']
const SIZES: [number, number][] = [[2560, 1392], [1920, 1080], [900, 600]]
const slug = (v: string) => v.toLowerCase().replace(/'/g, '').replace(/ /g, '-')

/**
 * Real layout problems only. Decoration (aria-hidden marks, SVG paint, tape, the grease-pencil loop) and the
 * deliberate tilt of pinned cards are left out, and nested boxes contain each other by design.
 * - text-overlap: glyph boxes of two different text runs cross.
 * - overlap: two controls, cards or sheets cross without one containing the other.
 * - cut: a control, card or sheet (tilt and all) runs past an edge no scrolling reaches: an ancestor that hides overflow on that
 *   axis, or the window itself.
 * - tape-over-text: a strip of tape (decoration, but opaque) lands on words.
 * - scrolls / clipped / clipped-y: measured with tilts and loose paint switched off, so what remains is layout.
 */
const probe = () => {
  const studio = document.querySelector('.studio')
  if (!studio) return []
  const modal = document.querySelector('dialog[open]')
  const scope: Element = modal ?? studio // behind a modal everything is inert
  const decorative = (e: Element) => !!e.closest('[aria-hidden="true"], svg, .sr-only, .xterm, [hidden], .splats')
  const shown = (e: Element) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !e.closest('details:not([open]) > :not(summary)') }
  const name = (e: Element) => `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/).join('.') : ''}${(e.textContent ?? '').trim() ? `[${(e.textContent ?? '').trim().slice(0, 24)}]` : ''}`
  const box = (r: DOMRect) => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) })
  const cross = (p: DOMRect, q: DOMRect) => { const w = Math.min(p.right, q.right) - Math.max(p.left, q.left), h = Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top); return w > 2 && h > 2 ? { w: Math.round(w), h: Math.round(h) } : null }
  const out: { kind: string; a: string; b?: string; rect: unknown }[] = []

  // What of a box is really on screen: clipped by every scrolling or clipping ancestor.
  const seen = (el: Element, r: DOMRect): DOMRect | null => {
    let [l, t, rt, b] = [r.left, r.top, r.right, r.bottom]
    for (let p = el.parentElement; p; p = p.parentElement) {
      const s = getComputedStyle(p)
      if (s.overflowX === 'visible' && s.overflowY === 'visible') continue
      const c = p.getBoundingClientRect()
      l = Math.max(l, c.left); t = Math.max(t, c.top); rt = Math.min(rt, c.right); b = Math.min(b, c.bottom)
    }
    return rt - l > 1 && b - t > 1 ? new DOMRect(l, t, rt - l, b - t) : null
  }
  // Controls, cards and sheets.
  const boxes = [...scope.querySelectorAll('button, input, select, textarea, .card, .paper, table, webview, .chip, .run-pill')].filter(e => !decorative(e) && shown(e))
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j]
    if (a.contains(b) || b.contains(a)) continue
    const p = seen(a, a.getBoundingClientRect()), q = seen(b, b.getBoundingClientRect())
    const o = p && q && cross(p, q)
    if (o) out.push({ kind: 'overlap', a: name(a), b: name(b), rect: { a: box(a.getBoundingClientRect()), b: box(b.getBoundingClientRect()), overlap: o } })
  }
  // Past an edge nothing scrolls to: once a scrolling ancestor is found on an axis, the ancestors above it may clip that axis.
  for (const e of boxes) {
    const r = e.getBoundingClientRect(), edges: string[] = []
    let x = true, y = true
    const check = (c: DOMRect, sx: string, sy: string) => {
      if (x && sx !== 'auto' && sx !== 'scroll') { if (r.left < c.left - 2) edges.push('left'); if (r.right > c.right + 2) edges.push('right') }
      if (y && sy !== 'auto' && sy !== 'scroll') { if (r.top < c.top - 2) edges.push('top'); if (r.bottom > c.bottom + 2) edges.push('bottom') }
      if (sx === 'auto' || sx === 'scroll') x = false
      if (sy === 'auto' || sy === 'scroll') y = false
    }
    for (let p = e.parentElement; p; p = p.parentElement) { const s = getComputedStyle(p); if (s.overflowX !== 'visible' || s.overflowY !== 'visible') check(p.getBoundingClientRect(), s.overflowX, s.overflowY) }
    check(new DOMRect(0, 0, innerWidth, innerHeight), 'hidden', 'hidden')
    if (edges.length) out.push({ kind: 'cut', a: name(e), rect: { ...box(r), edges } })
  }
  // Text runs, as laid out now (tilts on), for the tape check; again later with tilts off for text against text.
  const textRuns = () => {
    const runs: { el: Element; r: DOMRect }[] = []
    const walk = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT)
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const el = n.parentElement
      if (!el || !n.textContent?.trim() || decorative(el) || el.closest('option, script, style, textarea') || !shown(el)) continue
      const range = document.createRange(); range.selectNodeContents(n)
      for (const raw of range.getClientRects()) { const r = seen(el, raw); if (r) runs.push({ el, r }) }
    }
    return runs
  }
  for (const t of scope.querySelectorAll('.tape')) {
    const tr = t.getBoundingClientRect()
    for (const run of textRuns()) { const o = cross(tr, run.r); if (o) out.push({ kind: 'tape-over-text', a: name(t.parentElement ?? t), b: name(run.el), rect: { tape: box(tr), text: box(run.r), overlap: o } }) }
  }

  // Layout checks run with tilts and loose paint switched off (important, and no transition: a running transition outranks even !important).
  const undo: (() => void)[] = []
  for (const e of studio.querySelectorAll<HTMLElement | SVGElement>('*')) {
    const s = getComputedStyle(e)
    if (s.transform !== 'none') { e.style.setProperty('transition', 'none', 'important'); e.style.setProperty('transform', 'none', 'important'); undo.push(() => { e.style.removeProperty('transform'); e.style.removeProperty('transition') }) }
    if ((s.position === 'absolute' || s.position === 'fixed') && decorative(e)) { const d = e.style.display; e.style.display = 'none'; undo.push(() => { e.style.display = d }) }
  }
  const runs = textRuns()
  for (let i = 0; i < runs.length; i++) for (let j = i + 1; j < runs.length; j++) {
    if (runs[i].el === runs[j].el) continue
    const o = cross(runs[i].r, runs[j].r)
    if (o) out.push({ kind: 'text-overlap', a: name(runs[i].el), b: name(runs[j].el), rect: { a: box(runs[i].r), b: box(runs[j].r), overlap: o } })
  }

  for (const e of scope.querySelectorAll('*')) {
    if (decorative(e) || !shown(e) || e.clientWidth === 0) continue
    const s = getComputedStyle(e)
    const r = e.getBoundingClientRect()
    if (e.scrollWidth > e.clientWidth + 1) {
      const kind = s.overflowX === 'auto' || s.overflowX === 'scroll' ? 'scrolls' : s.overflowX === 'visible' ? 'overflow' : 'clipped'
      out.push({ kind, a: name(e), rect: { ...box(r), scrollWidth: e.scrollWidth, clientWidth: e.clientWidth } })
    }
    if ((s.overflowY === 'hidden' || s.overflowY === 'clip') && e.scrollHeight > e.clientHeight + 1 && s.webkitLineClamp === 'none' && !(e instanceof HTMLTableElement))
      out.push({ kind: 'clipped-y', a: name(e), rect: { ...box(r), scrollHeight: e.scrollHeight, clientHeight: e.clientHeight } })
  }
  undo.reverse().forEach(f => f())
  return out
}

test('capture the studio for the finish review', async () => {
  test.setTimeout(300_000)
  mkdirSync('.impeccable/review', { recursive: true })
  const book = await captureBook()
  const { app, win } = await launch(book, { scenario: 'hang', shipped: true }) // the shipped defaults (terminal folded); a started run stays on its first scene
  const overlaps: unknown[] = []
  /** Resize the window; returns the size the content area really got (the display may clamp it). */
  const size = async (w: number, h: number) => {
    await app.evaluate(({ BrowserWindow }, s) => { const b = BrowserWindow.getAllWindows()[0]; if (b.isMaximized()) b.unmaximize(); b.setContentSize(s.w, s.h) }, { w, h })
    await win.waitForTimeout(600)
    const [aw, ah] = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getContentSize())
    return `${aw}x${ah}`
  }
  const shot = async (name: string) => { await win.screenshot({ path: `.impeccable/review/${name}.png` }) }
  await win.emulateMedia({ colorScheme: null }) // Playwright pins prefers-color-scheme to light; let the Settings theme drive it
  await nav(win, 'Outline')
  // The brief's shots.
  await size(1440, 900); await shot('desktop')
  await size(900, 600); await shot('mobile') // the app's minimum window; there is no mobile build (R16)
  // Every view at three sizes, with the overlap probe.
  for (const [w, h] of SIZES) {
    const actual = await size(w, h)
    for (const v of VIEWS) {
      await nav(win, v); await win.waitForTimeout(300)
      if (v === 'Cost') { await expect(win.locator('.codeburn-frame')).not.toHaveClass(/loading/); await win.waitForTimeout(1500) } // the sheet answered; its guest paints on its own clock
      await shot(`${slug(v)}-${actual}`)
      if (v === 'Settings' && w === 1920) await shot(`view-${slug(v)}`)
      for (const o of await win.evaluate(probe)) overlaps.push({ view: v, size: actual, requested: `${w}x${h}`, ...o })
    }
  }
  // Dialogs and states at the owner's size.
  const big = await size(2560, 1392)
  // The Codeburn sheet's other two states: the port dead (Electron's did-fail-load), then Restart re-arms it and it loads again.
  await nav(win, 'Cost'); await win.locator('#codeburn-title').scrollIntoViewIfNeeded()
  await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('service:restart'); ipcMain.handle('service:restart', () => undefined) }) // the status stays up; the sheet alone recovers
  await win.evaluate(() => document.querySelector('webview')!.dispatchEvent(new Event('did-fail-load')))
  await expect(win.locator('#view')).toContainText('did not answer on port'); await win.waitForTimeout(300); await shot(`cost-codeburn-failed-${big}`)
  for (const o of await win.evaluate(probe)) overlaps.push({ view: 'Cost (Codeburn failed)', size: big, ...o })
  // Loading: the retry's request is held in the session (the callback never comes), so the state holds still for the shot.
  await app.evaluate(({ session }) => session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://localhost/*'] }, () => {}))
  await win.getByRole('button', { name: 'Restart Codeburn' }).click()
  await expect(win.locator('.codeburn-frame')).toHaveClass(/loading/); await expect(win.locator('.codeburn-wait')).toBeVisible(); await win.waitForTimeout(300); await shot(`cost-codeburn-loading-${big}`)
  for (const o of await win.evaluate(probe)) overlaps.push({ view: 'Cost (Codeburn loading)', size: big, ...o })
  await app.evaluate(({ session }) => session.defaultSession.webRequest.onBeforeRequest(null))
  await nav(win, 'Outline')
  await win.keyboard.press('Control+Backquote')
  // The terminal has fitted the strip: its rows fill the body (within one row), and nothing of xterm's own black shows.
  await expect.poll(() => win.evaluate(() => { const b = document.querySelector('.term-body')!.getBoundingClientRect(), s = document.querySelector('.xterm-screen')!.getBoundingClientRect(); return b.height - s.height })).toBeLessThan(40)
  await win.waitForTimeout(300); await shot(`outline-terminal-open-${big}`)
  for (const o of await win.evaluate(probe)) overlaps.push({ view: 'Outline (terminal open)', size: big, ...o })
  await win.keyboard.press('Control+Backquote'); await win.waitForTimeout(300)
  await win.locator('.card-open').first().click(); await win.waitForTimeout(500); await shot(`outline-scene-dialog-${big}`)
  for (const o of await win.evaluate(probe)) overlaps.push({ view: 'Outline (scene open)', size: big, ...o })
  await win.keyboard.press('Escape'); await win.waitForTimeout(300)
  // The crew: every agent's own name, line and portrait, below the fold in Settings.
  await nav(win, 'Settings'); await expect(win.locator('.crew img.avatar')).toHaveCount(14, { timeout: 30_000 })
  await win.locator('.crew').scrollIntoViewIfNeeded(); await win.waitForTimeout(300); await shot(`settings-crew-${big}`)
  for (const o of await win.evaluate(probe)) overlaps.push({ view: 'Settings (crew)', size: big, ...o })
  await nav(win, 'Manuscript')
  await win.getByRole('button', { name: 'Edit SC-001' }).click(); await win.locator('.reader textarea').scrollIntoViewIfNeeded(); await win.waitForTimeout(500); await shot(`manuscript-editor-${big}`)
  for (const o of await win.evaluate(probe)) overlaps.push({ view: 'Manuscript (editor open)', size: big, ...o })
  await win.getByRole('button', { name: 'New book…' }).click(); await win.waitForTimeout(500); await shot(`new-book-form-${big}`)
  for (const o of await win.evaluate(probe)) overlaps.push({ view: 'New book form', size: big, ...o })
  await win.keyboard.press('Escape'); await win.waitForTimeout(300)
  // Daylight.
  await nav(win, 'Settings'); await win.getByRole('radio', { name: 'Daylight studio' }).check()
  await size(1440, 900); await nav(win, 'Outline'); await shot('desktop-day')
  await size(2560, 1392)
  for (const v of ['Outline', 'Needs you']) { await nav(win, v); await win.waitForTimeout(300); await shot(`${slug(v)}-day-${big}`); for (const o of await win.evaluate(probe)) overlaps.push({ view: `${v} (day)`, size: big, ...o }) }
  await nav(win, 'Settings'); await win.getByRole('radio', { name: 'Night studio' }).check()
  // A live run: the parked scene released, the run started and held on its first scene (wet paint on the board, wells in the run pill).
  await nav(win, 'Needs you'); await win.getByRole('button', { name: 'Release SC-010' }).click()
  await nav(win, 'Run'); await win.getByRole('button', { name: 'Start' }).click()
  await expect(win.getByRole('status', { name: 'Run status' })).toContainText('Running', { timeout: 30_000 })
  await win.waitForTimeout(1500)
  for (const v of ['Run', 'Outline']) { await nav(win, v); await win.waitForTimeout(600); await shot(`${slug(v)}-live-${big}`); for (const o of await win.evaluate(probe)) overlaps.push({ view: `${v} (live)`, size: big, ...o }) }
  // The Writers' room during the live run, at all three sizes: the fixture's history, the showrunner typing, the working member.
  for (const [w, h] of SIZES) {
    const actual = await size(w, h)
    await nav(win, "Writers' room"); await win.waitForTimeout(600); await shot(`writers-room-live-${actual}`)
    for (const o of await win.evaluate(probe)) overlaps.push({ view: "Writers' room (live)", size: actual, ...o })
  }
  await win.getByRole('button', { name: /^channel reviews/ }).click(); await win.waitForTimeout(300); await shot(`writers-room-reviews-${await size(2560, 1392)}`)
  for (const o of await win.evaluate(probe)) overlaps.push({ view: "Writers' room (#reviews)", size: big, ...o })
  await nav(win, 'Run'); await win.getByRole('button', { name: 'Pause' }).click()
  await expect(win.getByRole('status', { name: 'Run status' })).toContainText('Paused', { timeout: 30_000 })
  writeFileSync('.impeccable/review/overlaps.json', JSON.stringify(overlaps, null, 1))
  await app.close()
})

import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme } from 'electron'
import { join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { spawn as spawnPty, type IPty } from '@lydell/node-pty'
import { claudeEnv } from './claudeEnv'
import { refreshPath } from './path'
import { runShell, killTree, killAll } from './run'
import { freePort } from './ports'
import { loadSettings, saveSettings, addRecent, type Settings } from './settings'
import { guardWebviews } from './guard'
import { Service } from './services'
import { STEPS, check, install, blockedBy, needsWizard } from './setup'
import { validateBook, type BookError } from './book/validate'
import { newBook, type NewBookOpts } from './book/create'
import { writeBookSettings } from './book/settings'
import { kitNeedsUpgrade, upgradeKit } from './book/kit'
import { archiveBook, createSequel } from './book/lifecycle'
import { Runner } from './run/runner'
import { isSceneId, startArg, waitIdle } from './run/ipc'
import { parseYamlText } from '../shared/schemas'
import { isAllowedBookPath, isNewBookOpts } from './book/ipc'
import { applyChange, isChangeId, listChanges, previewChange, rejectChange } from './book/changes'
import type { AppState, ChangeResult, InitResult, InstallResult, ServiceName, StepView } from '../shared/types'

const resourcesDir = () => (app.isPackaged ? process.resourcesPath : app.getAppPath())
const hooksDir = () => join(resourcesDir(), app.isPackaged ? 'hooks' : join('resources', 'hooks'))
const acceptBundle = () => join(resourcesDir(), app.isPackaged ? 'accept' : join('resources', 'accept'), 'accept.mjs')
const kitDir = () => join(resourcesDir(), 'kit', 'fiction')
let errors: BookError[] = []
let bookMeta: { title: string; status: 'active' | 'archived' } | null = null

app.setName('NovelBrain')
if (process.env.NB_USER_DATA) app.setPath('userData', process.env.NB_USER_DATA)
const settingsFile = () => join(app.getPath('userData'), 'settings.json')

let settings: Settings
let win: BrowserWindow
let book: string | null = null
let pty: IPty | null = null
let ptyUsesHeadroom = false
let size = { cols: 120, rows: 30 }
let installed: Record<string, boolean> = {}
let services: Record<ServiceName, Service> | null = null
const ports: Record<ServiceName, number> = { codeburn: 4747, headroom: 8787 }
let quitting = false
let runner: Runner | null = null // one per open active book
let runnerDir: string | null = null
let changing = false // an author change is being applied or rejected; run:start waits

const override = (name: string, fallback: string) => process.env[`NB_CMD_${name}`] ?? fallback
const save = () => saveSettings(settingsFile(), settings)
const send = (channel: string, ...args: unknown[]) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
}
function parkedScenes(dir: string, ids: string[]): { scene: string; reason: string }[] {
  return ids.map(scene => {
    let reason = 'Needs you'
    try { reason = readFileSync(join(dir, 'reviews', scene, 'park.md'), 'utf8').match(/^reason:\s*(.+)$/m)?.[1].trim() || reason } catch { /* no park note */ }
    return { scene, reason }
  })
}
function state(): AppState {
  const run = book && runner && runnerDir === book ? runner.status() : null
  return {
    book: book && bookMeta ? { dir: book, ...bookMeta } : null,
    run,
    parked: book && run ? parkedScenes(book, run.parked) : [],
    changes: book ? listChanges(book) : [],
    recentBooks: settings.recentBooks,
    errors,
    services: { codeburn: services?.codeburn.status ?? 'stopped', headroom: services?.headroom.status ?? 'stopped' },
    installed
  }
}
const pushState = () => send('state', state())

// ---- Claude session -------------------------------------------------------

function stopClaude(): void {
  const p = pty
  pty = null
  if (p) killTree(p.pid)
}

function launchClaude(): void {
  if (quitting) return
  stopClaude()
  if (!book) return pushState()
  ptyUsesHeadroom = settings.headroom && installed.headroom !== false
  const env = claudeEnv(process.env as Record<string, string>, { headroomUrl: ptyUsesHeadroom ? `http://127.0.0.1:${ports.headroom}` : undefined })
  try {
    // A string is passed to cmd.exe verbatim; /s keeps the inner quotes intact when paths contain spaces.
    const p = spawnPty(process.env.ComSpec ?? 'cmd.exe', `/s /c ""${override('CLAUDE', 'claude')}""`, {
      name: 'xterm-256color',
      cwd: book,
      env,
      cols: size.cols,
      rows: size.rows
    })
    pty = p
    p.onData(d => send('pty:data', d))
    p.onExit(() => {
      if (pty !== p) return
      pty = null
      send('pty:exit')
    })
  } catch (err) {
    pty = null
    send('pty:data', `\r\nFailed to start Claude Code: ${err instanceof Error ? err.message : String(err)}\r\n`)
    send('pty:exit')
  }
  pushState()
}

async function openBook(dir: string): Promise<boolean> {
  if (!existsSync(join(dir, 'book.yaml'))) {
    settings.recentBooks = settings.recentBooks.filter(d => d !== dir)
    save()
    pushState()
    return false
  }
  let nextErrors: BookError[]
  let nextMeta: { title: string; status: 'active' | 'archived' }
  try {
    nextErrors = validateBook(dir)
    try {
      const y = parseYamlText(readFileSync(join(dir, 'book.yaml'), 'utf8')) as { title?: string; status?: string }
      nextMeta = { title: String(y?.title ?? dir), status: y?.status === 'archived' ? 'archived' : 'active' }
    } catch {
      nextMeta = { title: dir, status: 'active' }
    }
    if (nextMeta.status === 'active' && kitNeedsUpgrade(dir)) await upgradeKit(dir, kitDir(), acceptBundle())
    // Machine-local, git-ignored; also installs the guard that keeps archived books read-only.
    writeBookSettings(dir, hooksDir())
  } catch {
    return false // previous book and its Claude session stay untouched
  }
  if (runner && runnerDir !== dir) {
    runner.pause() // switching books pauses the old run
    runner.removeAllListeners()
    runner = null
    runnerDir = null
  }
  book = dir
  errors = nextErrors
  bookMeta = nextMeta
  if (nextMeta.status === 'active' && !runner) {
    const r = new Runner({
      bookDir: dir,
      command: override('CLAUDE_HEADLESS', override('CLAUDE', 'claude')),
      models: { showrunner: 'opus' },
      stepTimeoutMs: 45 * 60_000,
      headroomUrl: () => (settings.headroom && installed.headroom !== false ? `http://127.0.0.1:${ports.headroom}` : undefined)
    })
    r.on('state', s => { send('run:state', s); pushState() })
    r.on('log', l => send('run:log', l))
    runner = r
    runnerDir = dir
  }
  settings.recentBooks = addRecent(settings.recentBooks, dir)
  save()
  launchClaude()
  return true
}

async function pickBook(): Promise<void> {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
  if (!r.canceled && r.filePaths[0]) await openBook(r.filePaths[0])
}

// ---- Services -------------------------------------------------------------

function syncServices(): void {
  if (quitting || !services) return
  if (installed.codeburn !== false && services.codeburn.status === 'stopped') services.codeburn.start()
  if (settings.headroom && installed.headroom !== false && services.headroom.status === 'stopped') services.headroom.start()
}

let started = false
async function startDashboard(): Promise<void> {
  if (started) return
  started = true
  ports.codeburn = await freePort(4747)
  ports.headroom = await freePort(8787)
  const cmdFor = (name: ServiceName, fallback: string) => override(name.toUpperCase(), fallback).replace('{port}', String(ports[name]))
  services = {
    codeburn: new Service({
      name: 'codeburn',
      command: cmdFor('codeburn', 'codeburn web --no-open --port {port}'),
      healthUrl: `http://localhost:${ports.codeburn}`
    }),
    headroom: new Service({
      name: 'headroom',
      command: cmdFor('headroom', 'headroom proxy --port {port}'),
      healthUrl: `http://127.0.0.1:${ports.headroom}/stats`
    })
  }
  for (const s of Object.values(services)) s.on('status', pushState)
  syncServices()
  const first = process.env.NB_BOOK ?? settings.recentBooks.find(d => existsSync(join(d, 'book.yaml')))
  if (first) await openBook(first)
  else pushState()
}

// ---- Setup ----------------------------------------------------------------

async function checkAll(): Promise<Record<string, boolean>> {
  const results = await Promise.all(STEPS.map(s => check(s, runShell)))
  installed = Object.fromEntries(STEPS.map((s, i) => [s.id, results[i]]))
  return installed
}

function stepViews(r: Record<string, boolean>): StepView[] {
  return STEPS.map(s => ({
    id: s.id,
    label: s.label,
    required: s.required,
    ok: !!r[s.id],
    skipped: settings.skipped.includes(s.id),
    blockedBy: blockedBy(s, r)
  }))
}

// ---- IPC ------------------------------------------------------------------

function registerIpc(): void {
  const svc = (n: unknown) => (services && (n === 'codeburn' || n === 'headroom') ? services[n] : null)

  ipcMain.handle('app:init', async (): Promise<InitResult> => {
    if (process.env.NB_SKIP_SETUP) {
      await startDashboard()
      return { mode: 'studio', state: state() }
    }
    const r = await checkAll()
    if (process.env.NB_FORCE_SETUP || needsWizard(r, settings.skipped)) return { mode: 'setup', steps: stepViews(r) }
    await startDashboard()
    return { mode: 'studio', state: state() }
  })
  ipcMain.handle('book:pick', () => pickBook())
  ipcMain.handle('book:open', (_e, dir: unknown) => isAllowedBookPath(dir, settings.recentBooks) && openBook(dir))
  ipcMain.on('pty:write', (_e, data: unknown) => {
    if (typeof data === 'string') pty?.write(data)
  })
  ipcMain.on('pty:resize', (_e, cols: unknown, rows: unknown) => {
    if (typeof cols !== 'number' || typeof rows !== 'number' || cols < 2 || rows < 2) return
    size = { cols: Math.floor(cols), rows: Math.floor(rows) }
    pty?.resize(size.cols, size.rows)
  })
  ipcMain.handle('claude:restart', () => launchClaude())
  ipcMain.handle('service:restart', (_e, n: unknown) => svc(n)?.restart())
  ipcMain.handle('service:log', (_e, n: unknown) => svc(n)?.log ?? [])
  ipcMain.handle('setup:check', async () => stepViews(await checkAll()))
  ipcMain.handle('setup:install', async (_e, id: unknown): Promise<InstallResult> => {
    const step = STEPS.find(s => s.id === id)
    if (!step) return { ok: false, error: 'Unknown step', steps: stepViews(installed) }
    const r = await install(step, runShell, line => send('setup:log', line))
    refreshPath()
    const results = await checkAll()
    const ok = results[step.id]
    const error = ok
      ? undefined
      : (r.error ?? `${step.label} installed, but "${step.check}" still fails. Restart Novel Brain and try again.`)
    return { ok, error, steps: stepViews(results) }
  })
  ipcMain.handle('setup:skip', (_e, id: unknown) => {
    if (typeof id === 'string' && !settings.skipped.includes(id)) {
      settings.skipped.push(id)
      save()
    }
    return stepViews(installed)
  })
  ipcMain.handle('setup:done', async () => {
    await startDashboard()
    syncServices()
    pushState()
    return state()
  })
  const activeRunner = () => (runner && book && runnerDir === book && bookMeta?.status === 'active' ? runner : null)
  ipcMain.handle('run:start', (_e, o: unknown) => {
    const opts = startArg(o)
    if (!opts) return { ok: false, error: 'Invalid stop point' }
    const r = activeRunner()
    if (!r) return { ok: false, error: 'No active book is open' }
    if (r.isActive()) return { ok: false, error: r.status().status === 'running' ? 'The run is already going' : 'the run is still stopping' }
    if (changing) return { ok: false, error: 'An author change is being applied; try again in a moment.' }
    r.start(opts).catch(err => send('run:log', `run failed to start: ${err instanceof Error ? err.message : String(err)}`))
    return { ok: true }
  })
  ipcMain.handle('run:pause', () => { activeRunner()?.pause() })
  ipcMain.handle('run:state', () => state().run)
  ipcMain.handle('run:release', async (_e, scene: unknown) => {
    if (!isSceneId(scene)) return { ok: false, error: 'Invalid scene id' }
    const r = activeRunner()
    if (!r) return { ok: false, error: 'No active book is open' }
    try {
      await r.release(scene)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Could not release the scene' }
    }
  })
  // The book dir is captured before any await: the writer may switch books while a change applies.
  const changeBook = (id: unknown): string | null => {
    if (!isChangeId(id)) return 'Invalid change id'
    if (!book) return 'No book is open'
    if (activeRunner()?.isActive()) return 'Pause the run before changing the book.'
    if (changing) return 'Another change is being applied.'
    return null
  }
  const changeWith = async (id: unknown, fn: (dir: string, id: string) => Promise<ChangeResult>): Promise<ChangeResult> => {
    const bad = changeBook(id)
    if (bad) return { ok: false, reasons: [bad] }
    const dir = book as string
    changing = true
    try {
      return await fn(dir, id as string)
    } catch (err) {
      return { ok: false, reasons: [err instanceof Error ? err.message : String(err)] }
    } finally {
      changing = false
      if (book === dir) errors = validateBook(dir)
      pushState()
    }
  }
  ipcMain.handle('change:list', () => (book ? listChanges(book) : []))
  ipcMain.handle('change:preview', (_e, id: unknown) => {
    if (!isChangeId(id) || !book) return { ok: false, error: 'Invalid change id' }
    try { return { ok: true, ...previewChange(book, id) } } catch (err) { return { ok: false, error: err instanceof Error ? err.message : String(err) } }
  })
  ipcMain.handle('change:apply', (_e, id: unknown, token: unknown) =>
    typeof token === 'string' && /^[0-9a-f]{64}$/.test(token)
      ? changeWith(id, (dir, i) => applyChange(dir, i, token))
      : { ok: false, reasons: ['Preview the change before approving it.'] })
  ipcMain.handle('change:reject', (_e, id: unknown) =>
    changeWith(id, async (dir, i) => ({ ok: true, commit: await rejectChange(dir, i) })))
  ipcMain.handle('book:archive', async () => {
    if (!book || bookMeta?.status !== 'active') return { ok: false, error: 'No active book is open' }
    try {
      if (runner) {
        runner.pause()
        if (!(await waitIdle(runner, 30_000))) return { ok: false, error: 'The run is still stopping; try archiving again in a moment.' }
      }
      await archiveBook(book)
      await openBook(book)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Could not archive the book' }
    }
  })
  ipcMain.handle('book:sequel', async (_e, opts: unknown) => {
    if (!isNewBookOpts(opts)) return { ok: false, error: 'Invalid book details' }
    if (!book) return { ok: false, error: 'No book is open' }
    try {
      const dir = await createSequel(book, opts, kitDir(), hooksDir(), acceptBundle())
      await openBook(dir)
      return { ok: true, dir }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Could not create the sequel' }
    }
  })
  ipcMain.handle('book:new', async (_e, opts: unknown) => {
    if (!isNewBookOpts(opts)) return { ok: false, error: 'Invalid book details' }
    const r = await dialog.showOpenDialog(win, { title: 'Choose where to create the book', properties: ['openDirectory', 'createDirectory'] })
    if (r.canceled || !r.filePaths[0]) return { ok: false, error: 'cancelled' }
    try {
      const dir = await newBook(r.filePaths[0], opts, kitDir(), hooksDir(), acceptBundle())
      await openBook(dir)
      return { ok: true, dir }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Could not create the book' }
    }
  })
}

// ---- Window, menu, lifecycle ----------------------------------------------

function buildMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'File',
        submenu: [
          { label: 'Open Book…', accelerator: 'CmdOrCtrl+Shift+O', click: () => void pickBook() },
          { type: 'separator' },
          { role: 'quit' }
        ]
      },
      {
        label: 'Tools',
        submenu: [{ label: 'Re-run setup', click: () => send('menu', 'setup') }]
      },
      { role: 'viewMenu' },
    ])
  )
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Novel Brain',
    icon: app.isPackaged
      ? join(process.resourcesPath, 'brand', 'icon.ico')
      : join(app.getAppPath(), 'resources', 'brand', 'icon.ico'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1c1c' : '#f3f3f3',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  })
  guardWebviews(win, () => book)
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })
  app.whenReady().then(() => {
    refreshPath()
    settings = loadSettings(settingsFile())
    registerIpc()
    buildMenu()
    createWindow()
  })
  app.on('before-quit', () => {
    quitting = true
    runner?.pause()
    stopClaude()
    if (services) for (const s of Object.values(services)) s.stop()
    killAll()
  })
  app.on('window-all-closed', () => app.quit())
}

import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, screen, shell } from 'electron'
import { join } from 'node:path'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawn as spawnPty, type IPty } from '@lydell/node-pty'
import { claudeEnv } from './claudeEnv'
import { refreshPath } from './path'
import { runShell, killTree, killAll } from './run'
import { freePort } from './ports'
import { loadSettings, saveSettings, addRecent, patchSettings, type Settings } from './settings'
import { guardWebviews } from './guard'
import { Service } from './services'
import { STEPS, check, install, blockedBy, needsWizard } from './setup'
import { validateBook, type BookError } from './book/validate'
import { readingCopy, esc, exportTarget } from './book/export'
import { newBook, type NewBookOpts } from './book/create'
import { writeBookSettings } from './book/settings'
import { kitNeedsUpgrade, upgradeKit } from './book/kit'
import { archiveBook, createSequel, setExportSettings, setSeries } from './book/lifecycle'
import { publishState } from './export/preflight'
import { exportKdp } from './export/print'
import { Runner } from './run/runner'
import { isSceneId, startArg, waitIdle } from './run/ipc'
import { runClaude } from './run/claude'
import { readRoom } from './run/room'
import { usageFromHeadroom, type Usage } from '../shared/usage'
import { liveRuns, runKey } from './run/state'
import { MemoryRunner } from './memory/runner'
import { claudeProjectsDir, knownBooks, memDir, today } from './memory/files'
import { writeBriefing } from './memory/indexes'
import { approveSkill, listProposals, rejectSkill, syncSkills } from './memory/skills'
import { isSkillName } from './memory/ipc'
import { bibleNames, isLessonFile } from './memory/validate'
import { Crew, roleDescription } from './crew'
import { parseYamlText } from '../shared/schemas'
import { isAllowedBookPath, isNewBookOpts } from './book/ipc'
import { applyChange, isChangeId, listChanges, previewChange, proposeEdit, rejectChange } from './book/changes'
import { readManuscript, readStudio, sceneDetail } from './book/studio'
import { seriesBooks } from './book/series'
import type { AppState, ChangeResult, InitResult, InstallResult, MemoryLessons, MemoryStatus, PublicSettings, ServiceName, StepView } from '../shared/types'

const resourcesDir = () => (app.isPackaged ? process.resourcesPath : app.getAppPath())
const hooksDir = () => join(resourcesDir(), app.isPackaged ? 'hooks' : join('resources', 'hooks'))
const acceptBundle = () => join(resourcesDir(), app.isPackaged ? 'accept' : join('resources', 'accept'), 'accept.mjs')
const exportAssets = () => join(resourcesDir(), app.isPackaged ? 'export' : join('resources', 'export'))
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
let memory: MemoryRunner // one for the app; every book shares the memory folder
let memoryReady: Promise<unknown> = Promise.resolve()
let crew: Crew // app-wide, in <userData>/crew; display only
let drainTimer: NodeJS.Timeout | null = null

const override = (name: string, fallback: string) => process.env[`NB_CMD_${name}`] ?? fallback
const save = () => saveSettings(settingsFile(), settings)
const themeSource = (t: Settings['ui']['theme']) => (t === 'night' ? 'dark' : t === 'day' ? 'light' : 'system')
const publicSettings = (): PublicSettings => ({ ui: settings.ui, models: settings.models, memory: settings.memory, usage: settings.usage, headroom: settings.headroom, tab: settings.tab, claudeVersion: settings.claudeVersion })
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
let usage: Usage | null = null // latest plan usage: our own calls' stream events, else Headroom (ruling A11)
function recordUsage(u: Usage): void {
  if (usage && u.at < usage.at) return
  usage = u
  pushState()
}
// Headroom only when no reading is newer than 10 minutes and its proxy is up; any failure leaves the reading as it was.
async function currentUsage(): Promise<Usage | null> {
  if ((!usage || Date.now() - usage.at > 10 * 60_000) && services?.headroom.status === 'up') {
    try {
      const r = await fetch(`http://127.0.0.1:${ports.headroom}/stats`, { signal: AbortSignal.timeout(3000) })
      const u = usageFromHeadroom(await r.json())
      if (u) recordUsage(u)
    } catch (e) {
      console.warn('usage: Headroom read failed', e) // optional source; no reading, and its token is never read here
    }
  }
  return usage
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
    installed,
    usage,
    ports
  }
}
const pushState = () => send('state', state())

// ---- Memory ---------------------------------------------------------------

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err))
function memoryStatus(): MemoryStatus {
  try {
    return { ...memory.status(), proposals: listProposals(memDir()) }
  } catch (err) {
    return { log: [...memory.log, `Memory status unavailable: ${errText(err)}`], queued: 0, runsToday: 0, spentUsd: 0, spentToday: 0, proposals: [] }
  }
}
const pushMemory = () => send('memory:state', memoryStatus())

function startMemory(): void {
  const root = memDir()
  const command = override('CLAUDE_HEADLESS', override('CLAUDE', 'claude'))
  memory = new MemoryRunner({
    root,
    claudeProjects: claudeProjectsDir(),
    settings: () => settings.memory,
    // No --settings and cwd = the memory folder: the distiller never runs under a book's guard or memory hooks.
    call: (prompt, { model, tools, onSpawn }) => runClaude(prompt, {
      cwd: root,
      command,
      model,
      timeoutMs: 5 * 60_000,
      onSpawn,
      onUsage: recordUsage,
      settings: null,
      allowedTools: tools ? ['Read', 'Write', 'Edit', 'Glob', 'Grep'] : [],
      // Names from the tools reference (docs/facts.md). Not `Task`: Agent's old name, aliased only as `Task(...)` in settings.
      disallowedTools: ['Bash', 'PowerShell', 'WebFetch', 'WebSearch', 'NotebookEdit', 'Agent'],
      env: { NB_DISTILLER: '1', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' }
    })
  })
  const crewDir = join(app.getPath('userData'), 'crew')
  mkdirSync(crewDir, { recursive: true })
  crew = new Crew({
    dir: crewDir,
    // One no-tools call per portrait, outside any book (no --settings, no book hooks), on the distiller's model: ruling R13.
    call: async prompt => {
      const model = settings.memory.model
      const r = await runClaude(prompt, {
        cwd: crewDir, command, model, timeoutMs: 2 * 60_000, onUsage: recordUsage, settings: null, allowedTools: [],
        disallowedTools: ['Bash', 'PowerShell', 'WebFetch', 'WebSearch', 'NotebookEdit', 'Agent', 'Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep'],
        env: { NB_DISTILLER: '1', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' }
      })
      return { ...r, model }
    },
    describe: role => roleDescription(kitDir(), role),
    bible: () => (book ? bibleNames(book) : []),
    onChange: () => send('crew:state', crew.state()),
    log: l => console.warn(l)
  })
  memoryReady = memory.init().finally(pushMemory)
  drainTimer = setInterval(() => { void memory.drain().finally(pushMemory); void currentUsage() }, 60_000)
}

// Learned skills go into a book only while no run of it is going: the sync commits in the book repo.
const syncBook = (dir: string) => (liveRuns.has(runKey(dir)) ? Promise.resolve(false) : syncSkills(memDir(), dir))
const syncLogged = (dir: string) => syncBook(dir).catch(err => { memory.log.push(`Could not sync learned skills into ${dir}: ${errText(err)}`) })

function memoryOpen(dir: string): void {
  void memoryReady
    .then(() => memory.exclusive(() => syncLogged(dir)))
    // exclusive() throws while an update cannot be rolled back: log it and still add the book.
    .catch(err => { memory.log.push(`Could not sync learned skills into ${dir}: ${errText(err)}`) })
    .then(() => memory.addBook(dir))
    .catch(err => { memory.log.push(`Memory could not add ${dir}: ${errText(err)}`) })
    .finally(pushMemory)
}

// Approve and reject hold the memory lock: the memory repo's commit stages everything with -A.
async function decideSkill(name: unknown, approve: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSkillName(name)) return { ok: false, error: 'Invalid skill name' }
  if (runner && runnerDir === book && runner.isActive()) return { ok: false, error: 'Pause the run before approving skills.' }
  const root = memDir()
  try {
    await memory.exclusive(async () => {
      if (!approve) return rejectSkill(root, name)
      await approveSkill(root, name)
      const current = book
      const others = knownBooks(root).map(b => b.path).filter(p => !current || runKey(p) !== runKey(current))
      for (const dir of current ? [current, ...others] : others) if (existsSync(join(dir, 'book.yaml'))) await syncLogged(dir)
      for (const b of knownBooks(root)) {
        try { writeBriefing(root, b.path, settings.memory.indexCap, today()) } catch { /* a book that moved has no briefing to write */ }
      }
    })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: errText(err) }
  } finally {
    pushMemory()
  }
}

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
      // A getter: settings is replaced on every save and the Runner keeps its options.
      models: { get showrunner() { return settings.models.showrunner } },
      stepTimeoutMs: 45 * 60_000,
      headroomUrl: () => (settings.headroom && installed.headroom !== false ? `http://127.0.0.1:${ports.headroom}` : undefined),
      onCheckpoint: (kind, id, o) => memory.flush(dir, kind, id, o).finally(pushMemory),
      // Pause stops the memory pass: its changes are rolled back and its job waits for the next act check or drain.
      onPause: () => memory.cancel(),
      usage: currentUsage,
      onUsage: recordUsage,
      usageStopAt: () => settings.usage.stopAt,
      // Drain the queued memory jobs while allowance is left: this book's, and every job not held by another live run.
      onUsageStop: () => memory.flush(dir, 'chapter').finally(pushMemory),
      onClaudeVersion: v => { if (settings.claudeVersion !== v) { settings = { ...settings, claudeVersion: v }; save() } }
    })
    r.on('state', s => { send('run:state', s); pushState() })
    r.on('log', l => send('run:log', l))
    r.on('room', es => send('run:room', es))
    runner = r
    runnerDir = dir
  }
  settings.recentBooks = addRecent(settings.recentBooks, dir)
  save()
  memoryOpen(dir)
  send('crew:state', crew.state()) // names are re-checked against this book's bible
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
  void crew.ensure() // never awaited: a run never waits for portraits
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
  ipcMain.handle('book:open', (_e, dir: unknown) => isAllowedBookPath(dir, [...settings.recentBooks, ...(book ? seriesBooks(book).map(b => b.dir) : [])]) && openBook(dir))
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
  ipcMain.handle('studio:read', async () => { try { return book ? await readStudio(book) : null } catch { return null } })
  ipcMain.handle('studio:scene', (_e, id: unknown) => (book && isSceneId(id) ? sceneDetail(book, id) : null))
  ipcMain.handle('studio:manuscript', () => (book ? readManuscript(book) : []))
  ipcMain.handle('studio:series', () => (book ? seriesBooks(book) : []))
  ipcMain.handle('room:read', () => (book ? readRoom(book) : []))
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
  ipcMain.handle('settings:get', () => publicSettings())
  ipcMain.handle('settings:set', (_e, patch: unknown) => {
    const next = patchSettings(settings, patch)
    if (!next) return { ok: false, error: 'Invalid settings' }
    const headroomWas = settings.headroom
    settings = next
    save()
    nativeTheme.themeSource = themeSource(settings.ui.theme)
    // Headroom applies to the next Claude session; a live step or terminal may still use the proxy, so it stops at quit.
    if (settings.headroom && !headroomWas) syncServices()
    pushState()
    return { ok: true, settings: publicSettings() }
  })
  ipcMain.handle('change:propose', (_e, scene: unknown, text: unknown) => {
    if (!book || !isSceneId(scene) || typeof text !== 'string') return { ok: false, error: 'Invalid edit' }
    try { const id = proposeEdit(book, scene, text); pushState(); return { ok: true, id } }
    catch (err) { return { ok: false, error: errText(err) } }
  })
  ipcMain.handle('crew:get', () => crew.state())
  ipcMain.handle('crew:rename', (_e, role: unknown, name: unknown) => {
    try {
      if (typeof role !== 'string') throw new Error('Unknown role')
      crew.rename(role, name)
      return { ok: true }
    } catch (e) { return { ok: false, error: errText(e) } }
  })
  ipcMain.handle('crew:redraw', async (_e, role: unknown) => {
    try {
      if (typeof role !== 'string') throw new Error('Unknown role')
      await crew.redraw(role)
      return { ok: true }
    } catch (e) { return { ok: false, error: errText(e) } }
  })
  ipcMain.handle('memory:status', () => memoryStatus())
  ipcMain.handle('memory:approve', (_e, name: unknown) => decideSkill(name, true))
  ipcMain.handle('memory:reject', (_e, name: unknown) => decideSkill(name, false))
  ipcMain.handle('memory:lessons', (): MemoryLessons => {
    try {
      return memory.lessons(book)
    } catch {
      return { lessons: [], log: [] }
    }
  })
  // The path is checked here and again inside deleteLesson, which takes the memory lock.
  ipcMain.handle('memory:deleteLesson', async (_e, file: unknown) => {
    if (!isLessonFile(file)) return { ok: false, error: 'Invalid lesson' }
    try {
      await memory.deleteLesson(file)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: errText(err) }
    } finally {
      pushMemory()
    }
  })
  ipcMain.handle('memory:open', () => {
    mkdirSync(memDir(), { recursive: true })
    return shell.openPath(memDir())
  })
  ipcMain.handle('publish:read', () => { try { return book ? publishState(book) : null } catch { return null } })
  ipcMain.handle('publish:set', async (_e, s: unknown) => {
    if (!book) return { ok: false, error: 'No book is open' }
    try { await setExportSettings(book, s); return { ok: true } } catch (err) { return { ok: false, error: errText(err) } }
  })
  let exporting = false
  ipcMain.handle('publish:export', async () => {
    if (!book) return { ok: false, error: 'No book is open', checks: [] }
    if (exporting) return { ok: false, error: 'An export is already going.', checks: [] }
    exporting = true
    try { return await exportKdp(book, exportAssets()) } catch (err) { return { ok: false, error: errText(err), checks: [] } } finally { exporting = false }
  })
  ipcMain.handle('export:readingCopy', async () => {
    if (!book) return { ok: false, error: 'No book is open' }
    const dir = book
    let pdfWin: BrowserWindow | null = null, html = ''
    try {
      const copy = readingCopy(dir)
      html = exportTarget(dir, '.reading-copy.html')
      writeFileSync(html, copy.html)
      pdfWin = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true } }) // never shown, never focused
      await pdfWin.loadFile(html)
      const small = 'font-family:Garamond,Georgia,serif;font-size:8pt;width:100%;text-align:center;color:#444'
      const pdf = await pdfWin.webContents.printToPDF({
        pageSize: { width: 6, height: 9 }, margins: { top: 0.75, bottom: 0.75, left: 0.7, right: 0.7 },
        displayHeaderFooter: true,
        headerTemplate: `<div style="${small}">${esc(copy.title)}</div>`,
        footerTemplate: `<div style="${small}"><span class="pageNumber"></span></div>`
      })
      const pdfPath = exportTarget(dir, `${copy.id}-reading-copy.pdf`), epubPath = exportTarget(dir, `${copy.id}.epub`)
      writeFileSync(pdfPath, pdf)
      writeFileSync(epubPath, copy.epub)
      return { ok: true, pdf: pdfPath, epub: epubPath }
    } catch (err) {
      return { ok: false, error: errText(err) }
    } finally {
      pdfWin?.destroy()
      if (html) rmSync(html, { force: true })
    }
  })
  ipcMain.handle('export:openFolder', () => {
    if (!book) return 'No book is open'
    const out = join(book, 'exports')
    mkdirSync(out, { recursive: true })
    return shell.openPath(out)
  })
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
  ipcMain.handle('book:setSeries', async (_e, name: unknown) => {
    if (!book) return { ok: false, error: 'No book is open' }
    if (name !== null && typeof name !== 'string') return { ok: false, error: 'Invalid series name' }
    try {
      await setSeries(book, name?.trim() || null)
      await openBook(book)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: errText(err) }
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

// NB_DISPLAY=<n> opens the window centred on display n (1-based); tests use it to keep test windows off the main screen.
function displayBounds(): { x?: number; y?: number } {
  // Display 1 is the primary display, as in Windows settings; the rest follow in Electron's order.
  const primary = screen.getPrimaryDisplay()
  const d = [primary, ...screen.getAllDisplays().filter(s => s.id !== primary.id)][Number(process.env.NB_DISPLAY) - 1]
  if (!d) return {}
  const { x, y, width, height } = d.workArea
  return { x: x + Math.max(0, Math.round((width - 1400) / 2)), y: y + Math.max(0, Math.round((height - 900) / 2)) }
}

function createWindow(): void {
  // Test windows (NB_DISPLAY) are never shown, so they cannot take focus from a game or anything else; NB_SHOW=1 shows them.
  const hidden = !!process.env.NB_DISPLAY && process.env.NB_SHOW !== '1'
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    show: !hidden,
    ...displayBounds(),
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
      webviewTag: true,
      backgroundThrottling: !hidden // a hidden test window still paints, animates and screenshots at full speed
    }
  })
  if (!process.env.NB_DISPLAY) win.maximize() // the writer works full screen; test windows keep a fixed size
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
    if (win.isVisible()) win.focus() // a hidden test window never takes focus
  })
  app.whenReady().then(() => {
    refreshPath()
    settings = loadSettings(settingsFile())
    nativeTheme.themeSource = themeSource(settings.ui.theme)
    startMemory()
    registerIpc()
    buildMenu()
    createWindow()
  })
  app.on('before-quit', () => {
    quitting = true
    runner?.pause()
    if (drainTimer) clearInterval(drainTimer)
    memory?.stop()
    stopClaude()
    if (services) for (const s of Object.values(services)) s.stop()
    killAll()
  })
  app.on('window-all-closed', () => app.quit())
}

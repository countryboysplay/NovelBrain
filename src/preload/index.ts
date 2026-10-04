import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { AppState, ChangePreview, ChangeResult, ChangeSummary, RunStateT, InitResult, InstallResult, StepView } from '../shared/types'
import type { NewBookOpts } from '../main/book/create'

function on<T extends unknown[]>(channel: string) {
  return (cb: (...args: T) => void) => {
    const handler = (_e: IpcRendererEvent, ...args: unknown[]) => cb(...(args as T))
    ipcRenderer.on(channel, handler)
    return () => {
      ipcRenderer.off(channel, handler)
    }
  }
}

const api = {
  init: (): Promise<InitResult> => ipcRenderer.invoke('app:init'),
  pickBook: (): Promise<void> => ipcRenderer.invoke('book:pick'),
  openBook: (dir: string): Promise<boolean> => ipcRenderer.invoke('book:open', dir),
  newBook: (opts: NewBookOpts): Promise<{ ok: true; dir: string } | { ok: false; error: string }> => ipcRenderer.invoke('book:new', opts),
  runStart: (o: { stopAt: 'scene' | 'chapter' | 'act' | 'book'; pauseAtActs: boolean }): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('run:start', o),
  runPause: (): Promise<void> => ipcRenderer.invoke('run:pause'),
  runState: (): Promise<RunStateT | null> => ipcRenderer.invoke('run:state'),
  runRelease: (scene: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('run:release', scene),
  archiveBook: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('book:archive'),
  sequelBook: (opts: NewBookOpts): Promise<{ ok: boolean; dir?: string; error?: string }> => ipcRenderer.invoke('book:sequel', opts),
  changeList: (): Promise<ChangeSummary[]> => ipcRenderer.invoke('change:list'),
  changePreview: (id: string): Promise<ChangePreview> => ipcRenderer.invoke('change:preview', id),
  changeApply: (id: string, token: string): Promise<ChangeResult> => ipcRenderer.invoke('change:apply', id, token),
  changeReject: (id: string): Promise<ChangeResult> => ipcRenderer.invoke('change:reject', id),
  onRunState: on<[RunStateT]>('run:state'),
  onRunLog: on<[string]>('run:log'),
  ptyWrite: (data: string) => ipcRenderer.send('pty:write', data),
  ptyResize: (cols: number, rows: number) => ipcRenderer.send('pty:resize', cols, rows),
  restartClaude: (): Promise<void> => ipcRenderer.invoke('claude:restart'),
  restartService: (name: string): Promise<void> => ipcRenderer.invoke('service:restart', name),
  serviceLog: (name: string): Promise<string[]> => ipcRenderer.invoke('service:log', name),
  setupCheck: (): Promise<StepView[]> => ipcRenderer.invoke('setup:check'),
  setupInstall: (id: string): Promise<InstallResult> => ipcRenderer.invoke('setup:install', id),
  setupSkip: (id: string): Promise<StepView[]> => ipcRenderer.invoke('setup:skip', id),
  setupDone: (): Promise<AppState> => ipcRenderer.invoke('setup:done'),
  onPtyData: on<[string]>('pty:data'),
  onPtyExit: on<[]>('pty:exit'),
  onState: on<[AppState]>('state'),
  onSetupLog: on<[string]>('setup:log'),
  onMenu: on<['setup']>('menu')
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api

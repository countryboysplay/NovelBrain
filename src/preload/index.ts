import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { AppState, ChangePreview, ChangeResult, ChangeSummary, MemoryLessons, MemoryStatus, PublicSettings, RoomEntry, RunStateT, SettingsPatch, InitResult, InstallResult, StepView } from '../shared/types'
import type { NewBookOpts } from '../main/book/create'
import type { ManuscriptScene, SceneDetail, SeriesBook, StudioData } from '../shared/studio'
import type { CrewState } from '../shared/crew'
import type { KdpExport, PublishState } from '../shared/export'

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
  exportReadingCopy: (): Promise<{ ok: true; pdf: string; epub: string } | { ok: false; error: string }> => ipcRenderer.invoke('export:readingCopy'),
  publishRead: (): Promise<PublishState | null> => ipcRenderer.invoke('publish:read'),
  publishSet: (s: unknown): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('publish:set', s),
  publishExport: (): Promise<KdpExport> => ipcRenderer.invoke('publish:export'),
  exportOpenFolder: (): Promise<string> => ipcRenderer.invoke('export:openFolder'),
  archiveBook: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('book:archive'),
  setSeries: (name: string | null): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('book:setSeries', name),
  sequelBook: (opts: NewBookOpts): Promise<{ ok: boolean; dir?: string; error?: string }> => ipcRenderer.invoke('book:sequel', opts),
  studioRead: (): Promise<StudioData | null> => ipcRenderer.invoke('studio:read'),
  studioScene: (id: string): Promise<SceneDetail | null> => ipcRenderer.invoke('studio:scene', id),
  studioManuscript: (): Promise<ManuscriptScene[]> => ipcRenderer.invoke('studio:manuscript'),
  studioSeries: (): Promise<SeriesBook[]> => ipcRenderer.invoke('studio:series'),
  roomRead: (): Promise<RoomEntry[]> => ipcRenderer.invoke('room:read'),
  changeList: (): Promise<ChangeSummary[]> => ipcRenderer.invoke('change:list'),
  changePreview: (id: string): Promise<ChangePreview> => ipcRenderer.invoke('change:preview', id),
  changeApply: (id: string, token: string): Promise<ChangeResult> => ipcRenderer.invoke('change:apply', id, token),
  changePropose: (scene: string, text: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> => ipcRenderer.invoke('change:propose', scene, text),
  changeReject: (id: string): Promise<ChangeResult> => ipcRenderer.invoke('change:reject', id),
  settingsGet: (): Promise<PublicSettings> => ipcRenderer.invoke('settings:get'),
  settingsSet: (patch: SettingsPatch): Promise<{ ok: true; settings: PublicSettings } | { ok: false; error: string }> => ipcRenderer.invoke('settings:set', patch),
  memoryStatus: (): Promise<MemoryStatus> => ipcRenderer.invoke('memory:status'),
  memoryApprove: (name: string): Promise<{ ok: true } | { ok: false; error: string }> => ipcRenderer.invoke('memory:approve', name),
  memoryReject: (name: string): Promise<{ ok: true } | { ok: false; error: string }> => ipcRenderer.invoke('memory:reject', name),
  memoryOpen: (): Promise<string> => ipcRenderer.invoke('memory:open'),
  memoryLessons: (): Promise<MemoryLessons> => ipcRenderer.invoke('memory:lessons'),
  memoryDeleteLesson: (file: string): Promise<{ ok: true } | { ok: false; error: string }> => ipcRenderer.invoke('memory:deleteLesson', file),
  onMemoryState: on<[MemoryStatus]>('memory:state'),
  crewGet: (): Promise<CrewState> => ipcRenderer.invoke('crew:get'),
  crewRename: (role: string, name: string): Promise<{ ok: true } | { ok: false; error: string }> => ipcRenderer.invoke('crew:rename', role, name),
  crewRedraw: (role: string): Promise<{ ok: true } | { ok: false; error: string }> => ipcRenderer.invoke('crew:redraw', role),
  onCrewState: on<[CrewState]>('crew:state'),
  onRunState: on<[RunStateT]>('run:state'),
  onRunLog: on<[string]>('run:log'),
  onRunRoom: on<[RoomEntry[]]>('run:room'),
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

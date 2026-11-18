import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { AgentEvent, FileNode, NewProjectOptions, ProjectInfo, Settings, SettingsUpdate, TerminalEvent } from '@shared/types';

export interface TranscriptItem {
  kind: 'user' | 'assistant' | 'tool';
  text?: string;
  name?: string;
  summary?: string;
  ok?: boolean;
}

function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api = {
  settings: {
    get: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
    update: (u: SettingsUpdate): Promise<Settings> => ipcRenderer.invoke('settings:update', u),
    listModels: (): Promise<string[]> => ipcRenderer.invoke('models:list')
  },
  projects: {
    recent: (): Promise<ProjectInfo[]> => ipcRenderer.invoke('projects:recent'),
    removeRecent: (path: string): Promise<void> => ipcRenderer.invoke('projects:removeRecent', path),
    current: (): Promise<ProjectInfo | null> => ipcRenderer.invoke('projects:current'),
    pickFolder: (title: string): Promise<string | null> => ipcRenderer.invoke('projects:pickFolder', title),
    defaultParent: (): Promise<string> => ipcRenderer.invoke('projects:defaultParent'),
    open: (path: string): Promise<ProjectInfo> => ipcRenderer.invoke('projects:open', path),
    create: (o: NewProjectOptions): Promise<ProjectInfo> => ipcRenderer.invoke('projects:create', o),
    reveal: (): Promise<string> => ipcRenderer.invoke('projects:reveal')
  },
  fs: {
    tree: (): Promise<FileNode[]> => ipcRenderer.invoke('fs:tree'),
    read: (rel: string): Promise<string> => ipcRenderer.invoke('fs:read', rel),
    write: (rel: string, content: string): Promise<void> => ipcRenderer.invoke('fs:write', rel, content),
    delete: (rel: string): Promise<void> => ipcRenderer.invoke('fs:delete', rel),
    reveal: (rel: string): Promise<void> => ipcRenderer.invoke('fs:reveal', rel),
    onChanged: (cb: () => void) => on<void>('fs:changed', cb)
  },
  agent: {
    send: (text: string): Promise<void> => ipcRenderer.invoke('agent:send', text),
    stop: (): Promise<void> => ipcRenderer.invoke('agent:stop'),
    reset: (): Promise<void> => ipcRenderer.invoke('agent:reset'),
    transcript: (): Promise<TranscriptItem[]> => ipcRenderer.invoke('agent:transcript'),
    onEvent: (cb: (e: AgentEvent) => void) => on<AgentEvent>('agent:event', cb)
  },
  run: {
    command: (command: string): Promise<string> => ipcRenderer.invoke('run:command', command),
    kill: (id: string): Promise<void> => ipcRenderer.invoke('run:kill', id),
    openReport: (): Promise<void> => ipcRenderer.invoke('run:openReport'),
    onEvent: (cb: (e: TerminalEvent) => void) => on<TerminalEvent>('terminal:event', cb)
  }
};

export type Api = typeof api;

contextBridge.exposeInMainWorld('api', api);

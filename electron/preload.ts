import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { AgentEvent, CollectionName, CreateProjectInput, DesktopApi, ProviderSettings, ToolInvocation } from '../src/shared/types';

const api: DesktopApi = {
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    create: (input: CreateProjectInput) => ipcRenderer.invoke('projects:create', input),
    get: (id: string) => ipcRenderer.invoke('projects:get', id),
    update: (id: string, patch: Partial<CreateProjectInput>) => ipcRenderer.invoke('projects:update', id, patch),
    remove: (id: string) => ipcRenderer.invoke('projects:remove', id),
  },
  records: {
    save: (collection: CollectionName, record: unknown) => ipcRenderer.invoke('records:save', collection, record),
    remove: (collection: CollectionName, id: string, projectId: string) => ipcRenderer.invoke('records:remove', collection, id, projectId),
  },
  agent: {
    start: (projectId: string) => ipcRenderer.invoke('agent:start', projectId),
    resume: (projectId: string) => ipcRenderer.invoke('agent:resume', projectId),
    pause: (projectId: string) => ipcRenderer.invoke('agent:pause', projectId),
    stop: (projectId: string) => ipcRenderer.invoke('agent:stop', projectId),
    jobs: (projectId?: string) => ipcRenderer.invoke('agent:jobs', projectId),
    onEvent: (callback: (event: AgentEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: AgentEvent) => callback(payload);
      ipcRenderer.on('agent:event', listener);
      return () => ipcRenderer.removeListener('agent:event', listener);
    },
  },
  tools: { run: (invocation: ToolInvocation) => ipcRenderer.invoke('tools:run', invocation) },
  formalBindings: {
    create: (projectId, originalStatement, formalIr, leanSource) => ipcRenderer.invoke('formal-bindings:create', projectId, originalStatement, formalIr, leanSource),
    verify: (projectId, bindingId, leanSource) => ipcRenderer.invoke('formal-bindings:verify', projectId, bindingId, leanSource),
  },
  documents: {
    import: (projectId: string) => ipcRenderer.invoke('documents:import', projectId),
    importPaths: (projectId: string, paths: string[]) => ipcRenderer.invoke('documents:import-paths', projectId, paths),
    importDropped: (projectId: string, files: File[]) => ipcRenderer.invoke('documents:import-paths', projectId, files.map((file) => webUtils.getPathForFile(file))),
    search: (projectId: string, query: string, limit?: number) => ipcRenderer.invoke('documents:search', projectId, query, limit),
  },
  chat: {
    send: (input) => ipcRenderer.invoke('chat:send', input),
    stop: (projectId: string) => ipcRenderer.invoke('chat:stop', projectId),
    regenerate: (projectId: string, messageId: string) => ipcRenderer.invoke('chat:regenerate', projectId, messageId),
    onEvent: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof callback>[0]) => callback(payload);
      ipcRenderer.on('chat:event', listener);
      return () => ipcRenderer.removeListener('chat:event', listener);
    },
  },
  literature: {
    search: (projectId: string, query: string) => ipcRenderer.invoke('literature:search', projectId, query),
  },
  reports: {
    export: (projectId: string, format: 'markdown' | 'latex') => ipcRenderer.invoke('reports:export', projectId, format),
    exportEvidence: (projectId: string) => ipcRenderer.invoke('reports:export-evidence', projectId),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (settings: ProviderSettings) => ipcRenderer.invoke('settings:save', settings),
    credentialStatus: () => ipcRenderer.invoke('settings:credential-status'),
    saveCredential: (apiKey: string) => ipcRenderer.invoke('settings:save-credential', apiKey),
    removeCredential: () => ipcRenderer.invoke('settings:remove-credential'),
    testProvider: () => ipcRenderer.invoke('settings:test-provider'),
  },
  system: {
    appVersion: () => ipcRenderer.invoke('system:app-version'),
    openPath: (path: string) => ipcRenderer.invoke('system:open-path', path),
    openExternal: (url: string) => ipcRenderer.invoke('system:open-external', url),
    runtimeDiagnostics: () => ipcRenderer.invoke('system:runtime-diagnostics'),
  },
};

contextBridge.exposeInMainWorld('research', api);

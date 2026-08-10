import { contextBridge, ipcRenderer } from 'electron';
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
    onEvent: (callback: (event: AgentEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: AgentEvent) => callback(payload);
      ipcRenderer.on('agent:event', listener);
      return () => ipcRenderer.removeListener('agent:event', listener);
    },
  },
  tools: { run: (invocation: ToolInvocation) => ipcRenderer.invoke('tools:run', invocation) },
  documents: { import: (projectId: string) => ipcRenderer.invoke('documents:import', projectId) },
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
    runtimeDiagnostics: () => ipcRenderer.invoke('system:runtime-diagnostics'),
  },
};

contextBridge.exposeInMainWorld('research', api);

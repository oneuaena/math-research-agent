import { create } from 'zustand';
import type { AgentEvent, CollectionName, CreateProjectInput, Project, ProjectSnapshot } from './shared/types';

export type WorkspaceView = 'research' | 'branches' | 'proofs' | 'result' | 'attacks' | 'notebook' | 'tree' | 'conjectures' | 'lemmas' | 'experiments' | 'papers' | 'failures' | 'memory' | 'reports';

interface AppState {
  projects: Project[];
  snapshot: ProjectSnapshot | null;
  view: WorkspaceView;
  selectedNodeId: string | null;
  running: boolean;
  stage: AgentEvent['stage'];
  loading: boolean;
  error: string | null;
  theme: 'dark' | 'light';
  language: 'zh' | 'en';
  loadProjects(): Promise<void>;
  openProject(id: string): Promise<void>;
  closeProject(): void;
  createProject(input: CreateProjectInput): Promise<void>;
  removeProject(id: string): Promise<void>;
  setView(view: WorkspaceView): void;
  selectNode(id: string | null): void;
  saveRecord<T>(collection: CollectionName, record: T): Promise<void>;
  removeRecord(collection: CollectionName, id: string): Promise<void>;
  refresh(): Promise<void>;
  startAgent(): Promise<void>;
  resumeAgent(): Promise<void>;
  pauseAgent(): Promise<void>;
  stopAgent(): Promise<void>;
  handleAgentEvent(event: AgentEvent): void;
  importDocuments(): Promise<void>;
  toggleTheme(): void;
  toggleLanguage(): void;
  clearError(): void;
}

const message = (error: unknown) => error instanceof Error ? error.message : 'The operation could not be completed.';

export const useAppStore = create<AppState>((set, get) => ({
  projects: [],
  snapshot: null,
  view: 'notebook',
  selectedNodeId: null,
  running: false,
  stage: 'IDLE',
  loading: true,
  error: null,
  theme: (localStorage.getItem('mra-theme') === 'light' ? 'light' : 'dark'),
  language: (localStorage.getItem('mra-language') === 'en' ? 'en' : 'zh'),

  async loadProjects() {
    try { set({ projects: await window.research.projects.list(), loading: false }); }
    catch (error) { set({ error: message(error), loading: false }); }
  },
  async openProject(id) {
    set({ loading: true, error: null });
    try { const snapshot = await window.research.projects.get(id); set({ snapshot, view: snapshot.project.mode === 'stress-test' ? 'result' : 'research', selectedNodeId: null, running: snapshot.sessions.at(-1)?.status === 'RUNNING', stage: snapshot.sessions.at(-1)?.currentStage ?? 'IDLE', loading: false }); }
    catch (error) { set({ error: message(error), loading: false }); }
  },
  closeProject() { set({ snapshot: null, selectedNodeId: null, running: false, stage: 'IDLE' }); void get().loadProjects(); },
  async createProject(input) {
    set({ loading: true, error: null });
    try {
      const snapshot = await window.research.projects.create(input);
      set({ snapshot, view: snapshot.project.mode === 'stress-test' ? 'result' : 'research', loading: false });
      void get().loadProjects();
    } catch (error) { set({ error: message(error), loading: false }); }
  },
  async removeProject(id) {
    try { await window.research.projects.remove(id); await get().loadProjects(); }
    catch (error) { set({ error: message(error) }); }
  },
  setView(view) { set({ view }); },
  selectNode(selectedNodeId) { set({ selectedNodeId }); },
  async saveRecord(collection, record) {
    try { set({ snapshot: await window.research.records.save(collection, record), error: null }); }
    catch (error) { set({ error: message(error) }); }
  },
  async removeRecord(collection, id) {
    const projectId = get().snapshot?.project.id;
    if (!projectId) return;
    try { set({ snapshot: await window.research.records.remove(collection, id, projectId), error: null }); }
    catch (error) { set({ error: message(error) }); }
  },
  async refresh() {
    const id = get().snapshot?.project.id;
    if (!id) return;
    try { set({ snapshot: await window.research.projects.get(id) }); }
    catch (error) { set({ error: message(error) }); }
  },
  async startAgent() {
    const id = get().snapshot?.project.id;
    if (!id) return;
    set({ running: true, stage: get().snapshot?.project.mode === 'stress-test' ? 'PARSE' : 'INITIALIZE', error: null });
    try { await window.research.agent.start(id); }
    catch (error) { set({ error: message(error), running: false, stage: 'IDLE' }); }
  },
  async resumeAgent() {
    const id = get().snapshot?.project.id;
    if (!id) return;
    set({ running: true, stage: get().snapshot?.sessions.at(-1)?.nextStage ?? 'INITIALIZE', error: null });
    try { await window.research.agent.resume(id); }
    catch (error) { set({ error: message(error), running: false, stage: 'IDLE' }); }
  },
  async pauseAgent() {
    const id = get().snapshot?.project.id;
    if (!id) return;
    await window.research.agent.pause(id);
    set({ running: false, stage: 'PAUSED' });
    setTimeout(() => { void get().refresh(); }, 250);
  },
  async stopAgent() {
    const id = get().snapshot?.project.id;
    if (!id) return;
    await window.research.agent.stop(id);
    set({ running: false, stage: 'IDLE' });
    void get().refresh();
  },
  handleAgentEvent(event) {
    if (event.projectId !== get().snapshot?.project.id) return;
    set({ running: event.running, stage: event.stage, ...(event.stage === 'COMPLETE' && !event.running && get().snapshot?.project.mode === 'stress-test' ? { view: 'result' as WorkspaceView } : {}) });
    if (event.activity && event.activity.status !== 'running') void get().refresh();
  },
  async importDocuments() {
    const id = get().snapshot?.project.id;
    if (!id) return;
    try {
      const snapshot = await window.research.documents.import(id);
      if (snapshot) set({ snapshot, view: 'papers' });
    } catch (error) { set({ error: message(error) }); }
  },
  toggleTheme() {
    const theme = get().theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('mra-theme', theme);
    set({ theme });
  },
  toggleLanguage() {
    const language = get().language === 'zh' ? 'en' : 'zh';
    localStorage.setItem('mra-language', language);
    set({ language });
  },
  clearError() { set({ error: null }); },
}));

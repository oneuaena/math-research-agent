import { create } from 'zustand';
import type { AgentEvent, ChatEvent, CollectionName, CreateProjectInput, Project, ProjectSnapshot, ResearchJob } from './shared/types';

export type WorkspaceView = 'chat' | 'research' | 'branches' | 'proofs' | 'formal' | 'result' | 'attacks' | 'notebook' | 'tree' | 'conjectures' | 'lemmas' | 'experiments' | 'papers' | 'failures' | 'memory' | 'reports';

interface AppState {
  projects: Project[];
  snapshot: ProjectSnapshot | null;
  researchJob: ResearchJob | null;
  view: WorkspaceView;
  selectedNodeId: string | null;
  running: boolean;
  stage: AgentEvent['stage'];
  loading: boolean;
  chatSending: boolean;
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
  handleChatEvent(event: ChatEvent): void;
  sendChat(content: string, attachmentSourceIds?: string[]): Promise<void>;
  stopChat(): Promise<void>;
  regenerateChat(messageId: string): Promise<void>;
  importDocuments(stayInView?: boolean): Promise<string[]>;
  importDropped(files: File[]): Promise<string[]>;
  toggleTheme(): void;
  toggleLanguage(): void;
  clearError(): void;
}

const message = (error: unknown) => error instanceof Error ? error.message : 'The operation could not be completed.';

export const useAppStore = create<AppState>((set, get) => ({
  projects: [],
  snapshot: null,
  researchJob: null,
  view: 'notebook',
  selectedNodeId: null,
  running: false,
  stage: 'IDLE',
  loading: true,
  chatSending: false,
  error: null,
  theme: (localStorage.getItem('mra-theme') === 'light' ? 'light' : 'dark'),
  language: (localStorage.getItem('mra-language') === 'en' ? 'en' : 'zh'),

  async loadProjects() {
    try { set({ projects: await window.research.projects.list(), loading: false }); }
    catch (error) { set({ error: message(error), loading: false }); }
  },
  async openProject(id) {
    set({ loading: true, error: null });
    try {
      const [snapshot, projectJobs] = await Promise.all([window.research.projects.get(id), window.research.agent.jobs(id)]);
      const researchJob = projectJobs.at(-1) ?? null;
      const running = Boolean(researchJob?.desiredState === 'RUNNING' && ['QUEUED', 'RUNNING', 'RETRY_WAIT'].includes(researchJob.status));
      set({ snapshot, researchJob, view: snapshot.project.mode === 'stress-test' ? 'result' : 'research', selectedNodeId: null, running, stage: snapshot.sessions.at(-1)?.currentStage ?? (running ? 'INITIALIZE' : 'IDLE'), loading: false });
    }
    catch (error) { set({ error: message(error), loading: false }); }
  },
  closeProject() { set({ snapshot: null, researchJob: null, selectedNodeId: null, running: false, stage: 'IDLE' }); void get().loadProjects(); },
  async createProject(input) {
    set({ loading: true, error: null });
    try {
      const snapshot = await window.research.projects.create(input);
      set({ snapshot, researchJob: null, view: snapshot.project.mode === 'stress-test' ? 'result' : 'research', loading: false });
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
    try {
      const [snapshot, projectJobs] = await Promise.all([window.research.projects.get(id), window.research.agent.jobs(id)]);
      const researchJob = projectJobs.at(-1) ?? null;
      const running = Boolean(researchJob?.desiredState === 'RUNNING' && ['QUEUED', 'RUNNING', 'RETRY_WAIT'].includes(researchJob.status));
      set({ snapshot, researchJob, running });
    }
    catch (error) { set({ error: message(error) }); }
  },
  async startAgent() {
    const id = get().snapshot?.project.id;
    if (!id) return;
    set({ running: true, stage: get().snapshot?.project.mode === 'stress-test' ? 'PARSE' : 'INITIALIZE', error: null });
    try { set({ researchJob: await window.research.agent.start(id) }); }
    catch (error) { set({ error: message(error), running: false, stage: 'IDLE' }); }
  },
  async resumeAgent() {
    const id = get().snapshot?.project.id;
    if (!id) return;
    const nextStage = get().snapshot?.sessions.at(-1)?.nextStage;
    set({ running: true, stage: nextStage === 'PAUSED' ? 'EXPLORE' : nextStage ?? 'INITIALIZE', error: null });
    try { set({ researchJob: await window.research.agent.resume(id) }); }
    catch (error) { set({ error: message(error), running: false, stage: 'IDLE' }); }
  },
  async pauseAgent() {
    const id = get().snapshot?.project.id;
    if (!id) return;
    const researchJob = await window.research.agent.pause(id);
    set({ researchJob, running: false, stage: 'PAUSED' });
    setTimeout(() => { void get().refresh(); }, 250);
  },
  async stopAgent() {
    const id = get().snapshot?.project.id;
    if (!id) return;
    const researchJob = await window.research.agent.stop(id);
    set({ researchJob, running: false, stage: 'IDLE' });
    void get().refresh();
  },
  handleAgentEvent(event) {
    if (event.projectId !== get().snapshot?.project.id) return;
    set({ running: event.running, stage: event.stage, ...(event.stage === 'COMPLETE' && !event.running && get().snapshot?.project.mode === 'stress-test' ? { view: 'result' as WorkspaceView } : {}) });
    if (event.activity && event.activity.status !== 'running') void get().refresh();
    if (!event.running) setTimeout(() => { void get().refresh(); }, 400);
  },
  handleChatEvent(event) {
    if (event.projectId !== get().snapshot?.project.id) return;
    const snapshot = get().snapshot!;
    const exists = snapshot.messages.some((message) => message.id === event.message.id);
    const messages = exists ? snapshot.messages.map((message) => message.id === event.message.id ? event.message : message) : [...snapshot.messages, event.message];
    set({ snapshot: { ...snapshot, messages }, chatSending: event.message.status === 'pending' || event.message.status === 'streaming' });
    if (event.message.status === 'pending') void get().refresh();
    if (['completed', 'stopped', 'failed'].includes(event.message.status)) void get().refresh();
  },
  async sendChat(content, attachmentSourceIds = []) {
    const snapshot = get().snapshot;
    if (!snapshot) return;
    set({ chatSending: true, error: null });
    try {
      await window.research.chat.send({ projectId: snapshot.project.id, conversationId: snapshot.conversations.at(-1)?.id, content, attachmentSourceIds });
      await get().refresh();
    } catch (error) { set({ error: message(error) }); }
    finally { set({ chatSending: false }); }
  },
  async stopChat() {
    const projectId = get().snapshot?.project.id;
    if (!projectId) return;
    await window.research.chat.stop(projectId);
    set({ chatSending: false });
  },
  async regenerateChat(messageId) {
    const projectId = get().snapshot?.project.id;
    if (!projectId) return;
    set({ chatSending: true, error: null });
    try { await window.research.chat.regenerate(projectId, messageId); await get().refresh(); }
    catch (error) { set({ error: message(error) }); }
    finally { set({ chatSending: false }); }
  },
  async importDocuments(stayInView = false) {
    const id = get().snapshot?.project.id;
    if (!id) return [];
    const before = new Set(get().snapshot?.sources.map((source) => source.id));
    try {
      const snapshot = await window.research.documents.import(id);
      if (snapshot) {
        set({ snapshot, ...(stayInView ? {} : { view: 'papers' as WorkspaceView }) });
        return snapshot.sources.filter((source) => !before.has(source.id)).map((source) => source.id);
      }
    } catch (error) { set({ error: message(error) }); }
    return [];
  },
  async importDropped(files) {
    const id = get().snapshot?.project.id;
    if (!id || files.length === 0) return [];
    const before = new Set(get().snapshot?.sources.map((source) => source.id));
    try {
      const snapshot = await window.research.documents.importDropped(id, files);
      set({ snapshot });
      return snapshot.sources.filter((source) => !before.has(source.id)).map((source) => source.id);
    } catch (error) { set({ error: message(error) }); return []; }
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

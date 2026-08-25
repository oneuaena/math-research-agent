import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, isAbsolute, join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import type { Activity, ChatSendInput, CollectionName, CreateProjectInput, ProviderSettings, Source, ToolInvocation } from '../src/shared/types';
import { AgentCoordinator } from './agent-coordinator';
import { ChatService } from './chat-service';
import { CredentialStore } from './credentials';
import { ResearchDatabase } from './database';
import { extractDocument, INDEXABLE_DOCUMENT_EXTENSIONS } from './document-extractor';
import { buildDocumentChunks } from './document-indexer';
import { LiteratureSearchService } from './literature-search';
import { FormalBindingService } from './formal-binding';
import { ResponsesProvider } from './provider';
import { buildLatexReport, buildMarkdownReport } from './report';
import { ResearchStateLog } from './research-state-log';
import { ResearchJobManager } from './research-job-manager';
import { ToolRunner } from './tool-runner';
import { DiscoveryEngine } from './discovery-engine';
import { BenchmarkRunner } from './benchmark-runner';

let mainWindow: BrowserWindow | null = null;
let database: ResearchDatabase;
let credentials: CredentialStore;
let tools: ToolRunner;
let agent: AgentCoordinator;
let jobs: ResearchJobManager;
let literature: LiteratureSearchService;
let formalBindings: FormalBindingService;
let chat: ChatService;
let discovery: DiscoveryEngine;
const discoveryControllers = new Map<string, AbortController>();
let loginStartupEnabled: boolean | null = null;

const daemonMode = process.argv.includes('--research-daemon');
const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) app.quit();

if (process.env.MRA_TEST_USER_DATA) app.setPath('userData', process.env.MRA_TEST_USER_DATA);

async function indexExistingImportedDocuments(): Promise<void> {
  for (const project of database.listProjects()) {
    const snapshot = database.getProject(project.id, false);
    for (const source of snapshot.sources) {
      const extension = extname(source.path).toLowerCase();
      if (source.type !== 'user-document' || !INDEXABLE_DOCUMENT_EXTENSIONS.has(extension)) continue;
      if (source.extractionStatus === 'complete' && source.indexStatus === 'indexed' && (source.chunkCount ?? 0) > 0) continue;
      try {
        const extraction = await extractDocument(source.path);
        const chunks = buildDocumentChunks(source, extraction);
        database.replaceDocumentChunks(source.projectId, source.id, chunks);
        database.saveRecord('sources', {
          ...source,
          excerpt: extraction.content.slice(0, 4_000),
          content: undefined,
          contentHash: extraction.contentHash,
          contentCharacters: extraction.contentCharacters,
          extractionStatus: extraction.extractionStatus,
          extractionWarnings: extraction.extractionWarnings,
          indexedAt: extraction.indexedAt,
          documentType: extraction.documentType,
          pageCount: extraction.pageCount,
          chunkCount: chunks.length,
          indexStatus: extraction.extractionStatus === 'complete' ? 'indexed' : 'unsupported',
        });
      } catch (error) {
        database.replaceDocumentChunks(source.projectId, source.id, []);
        database.saveRecord('sources', {
          ...source,
          extractionStatus: 'failed',
          extractionWarnings: [error instanceof Error ? error.message : 'Document text extraction failed.'],
          indexedAt: new Date().toISOString(),
          indexStatus: 'failed',
        });
      }
    }
  }
}

async function importDocumentPaths(projectId: string, paths: string[]): Promise<ReturnType<ResearchDatabase['getProject']>> {
  if (paths.length === 0 || paths.length > 20) throw new Error('Select between 1 and 20 documents.');
  const destination = join(app.getPath('userData'), 'documents', projectId);
  mkdirSync(destination, { recursive: true });
  for (const sourcePath of paths) {
    if (!isAbsolute(sourcePath)) throw new Error('Document path must be absolute.');
    const extension = extname(sourcePath).toLowerCase();
    if (!INDEXABLE_DOCUMENT_EXTENSIONS.has(extension)) throw new Error(`Unsupported document type: ${extension || 'unknown'}.`);
    const size = statSync(sourcePath).size;
    if (size > 50 * 1024 * 1024) throw new Error('Document exceeds the 50 MB import limit.');
    const id = randomUUID();
    const target = join(destination, `${id}${extension}`);
    let extraction;
    try { extraction = await extractDocument(sourcePath); }
    catch (error) { throw new Error(`Could not read ${basename(sourcePath)}: ${error instanceof Error ? error.message : 'document extraction failed.'}`); }
    const source: Source = {
      id, projectId, type: 'user-document', title: basename(sourcePath, extension), authors: '', abstract: '',
      path: target, tags: [], notes: '', excerpt: extraction.content.slice(0, 4_000),
      contentHash: extraction.contentHash, contentCharacters: extraction.contentCharacters,
      extractionStatus: extraction.extractionStatus, extractionWarnings: extraction.extractionWarnings,
      indexedAt: extraction.indexedAt, documentType: extraction.documentType, pageCount: extraction.pageCount,
      chunkCount: 0, indexStatus: 'pending', createdAt: new Date().toISOString(),
    };
    const chunks = buildDocumentChunks(source, extraction);
    copyFileSync(sourcePath, target);
    database.replaceDocumentChunks(projectId, id, chunks);
    database.saveRecord('sources', { ...source, chunkCount: chunks.length, indexStatus: 'indexed' });
  }
  return database.getProject(projectId, false);
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: '#111412',
    titleBarStyle: 'hiddenInset',
    titleBarOverlay: { color: '#111412', symbolColor: '#a8afa9', height: 46 },
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !app.isPackaged,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const devUrl = process.env.VITE_DEV_SERVER_URL ?? (!app.isPackaged && process.argv.includes('--dev') ? 'http://127.0.0.1:5173' : '');
  if (devUrl) void mainWindow.loadURL(devUrl);
  else void mainWindow.loadFile(join(__dirname, '..', '..', 'dist', 'index.html'));
}

function registerIpc(): void {
  ipcMain.handle('projects:list', () => database.listProjects());
  ipcMain.handle('projects:create', (_event, input: CreateProjectInput) => database.createProject(input));
  ipcMain.handle('projects:get', (_event, id: string) => database.getProject(id));
  ipcMain.handle('projects:update', (_event, id: string, patch: Partial<CreateProjectInput>) => database.updateProject(id, patch));
  ipcMain.handle('projects:remove', (_event, id: string) => database.removeProject(id));
  ipcMain.handle('records:save', (_event, collection: CollectionName, record: { id: string; projectId: string }) => {
    if (['formalBindings', 'discoveryRuns', 'discoverySpecifications', 'resourceBudgets', 'formalProofSearchRuns', 'benchmarkRuns'].includes(collection)) throw new Error('MAIN_PROCESS_RECORD_ONLY: use the dedicated main-process service.');
    return database.saveRecord(collection, record);
  });
  ipcMain.handle('records:remove', (_event, collection: CollectionName, id: string, projectId: string) => {
    if (['formalBindings', 'discoveryRuns', 'discoverySpecifications', 'resourceBudgets', 'formalProofSearchRuns', 'benchmarkRuns'].includes(collection)) throw new Error('MAIN_PROCESS_RECORD_ONLY: this record cannot be deleted from the renderer.');
    return database.removeRecord(collection, id, projectId);
  });
  ipcMain.handle('formal-bindings:freeze-user-confirmed', (_event, projectId: string, originalStatement: string, formalIr: string, leanSource: string) => formalBindings.freezeUserConfirmed(projectId, originalStatement, formalIr, leanSource));
  ipcMain.handle('formal-bindings:verify', (_event, projectId: string, bindingId: string, leanSource: string) => formalBindings.verify(projectId, bindingId, leanSource));
  ipcMain.handle('discovery:start', async (_event, projectId: string, input: unknown) => {
    if (discoveryControllers.has(projectId)) throw new Error('A discovery run is already active for this project.');
    const controller = new AbortController(); discoveryControllers.set(projectId, controller);
    try { return await discovery.start(projectId, input, controller.signal); }
    finally { discoveryControllers.delete(projectId); }
  });
  ipcMain.handle('discovery:resume', async (_event, projectId: string, runId: string) => {
    if (discoveryControllers.has(projectId)) throw new Error('A discovery run is already active for this project.');
    const controller = new AbortController(); discoveryControllers.set(projectId, controller);
    try { return await discovery.resume(projectId, runId, controller.signal); }
    finally { discoveryControllers.delete(projectId); }
  });
  ipcMain.handle('discovery:stop', (_event, projectId: string) => {
    const controller = discoveryControllers.get(projectId);
    if (!controller) return null;
    controller.abort();
    return database.getProject(projectId, false).discoveryRuns.find((run) => run.status === 'RUNNING') ?? null;
  });
  ipcMain.handle('benchmarks:run', (event, projectId: string) => new BenchmarkRunner(database).run(projectId, event.sender.isDestroyed() ? undefined : new AbortController().signal));

  ipcMain.handle('agent:start', (_event, projectId: string) => jobs.start(projectId));
  ipcMain.handle('agent:resume', (_event, projectId: string) => jobs.resume(projectId));
  ipcMain.handle('agent:pause', (_event, projectId: string) => jobs.pause(projectId));
  ipcMain.handle('agent:stop', (_event, projectId: string) => jobs.stop(projectId));
  ipcMain.handle('agent:jobs', (_event, projectId?: string) => jobs.list(projectId));
  ipcMain.handle('tools:run', async (_event, invocation: ToolInvocation) => {
    const started = new Date().toISOString();
    const bindingId = invocation.name === 'lean_check' && typeof invocation.input.bindingId === 'string' ? invocation.input.bindingId : '';
    const bindingCheck = invocation.name === 'lean_check'
      ? bindingId ? formalBindings.verify(invocation.projectId, bindingId, String(invocation.input.code ?? '')) : { ok: false, error: 'FORMAL_BINDING_REQUIRED: select a frozen FORMALIZE binding before running Lean.' }
      : { ok: true };
    const result = !bindingCheck.ok
      ? { ok: false, success: false, output: '', stdout: '', stderr: '', error: bindingCheck.error, errorType: 'VALIDATION_ERROR' as const, exitCode: null, durationMs: 0, timeout: false, verificationStatus: 'PROGRAM_FAILURE' as const }
      : await tools.run(invocation);
    if (result.ok && invocation.name === 'lean_check' && bindingId) formalBindings.certify(invocation.projectId, bindingId, String(invocation.input.code ?? ''), result.output || result.stdout);
    const activity: Activity = {
      id: randomUUID(), projectId: invocation.projectId, stage: 'EXPERIMENT', kind: 'tool',
      title: invocation.name, detail: result.ok ? result.output.slice(0, 1200) : result.error ?? 'Tool failed.',
      status: result.ok ? 'succeeded' : 'failed', durationMs: result.durationMs, createdAt: started,
    };
    database.addActivity(activity);
    mainWindow?.webContents.send('agent:event', { projectId: invocation.projectId, running: false, stage: 'EXPERIMENT', activity });
    return result;
  });

  ipcMain.handle('documents:import', async (_event, projectId: string) => {
    const selection = await dialog.showOpenDialog(mainWindow!, {
      title: 'Import research document',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Research documents', extensions: ['docx', 'pdf', 'txt', 'md', 'markdown', 'tex'] },
      ],
    });
    if (selection.canceled || selection.filePaths.length === 0) return null;
    return importDocumentPaths(projectId, selection.filePaths);
  });
  ipcMain.handle('documents:import-paths', (_event, projectId: string, paths: string[]) => importDocumentPaths(projectId, paths));
  ipcMain.handle('documents:search', (_event, projectId: string, query: string, limit?: number) => database.searchDocumentChunks(projectId, query, limit));
  ipcMain.handle('chat:send', (_event, input: ChatSendInput) => chat.send(input));
  ipcMain.handle('chat:stop', (_event, projectId: string) => chat.stop(projectId));
  ipcMain.handle('chat:regenerate', (_event, projectId: string, messageId: string) => chat.regenerate(projectId, messageId));
  ipcMain.handle('literature:search', (_event, projectId: string, query: string) => literature.search(projectId, query));

  ipcMain.handle('reports:export', async (_event, projectId: string, format: 'markdown' | 'latex') => {
    const snapshot = database.getProject(projectId, false);
    const extension = format === 'markdown' ? 'md' : 'tex';
    const selection = await dialog.showSaveDialog(mainWindow!, {
      title: 'Export research report', defaultPath: `${snapshot.project.name.replace(/[<>:"/\\|?*]/g, '-')}.${extension}`,
      filters: [{ name: format === 'markdown' ? 'Markdown' : 'LaTeX', extensions: [extension] }],
    });
    if (selection.canceled || !selection.filePath) return null;
    const content = format === 'markdown' ? buildMarkdownReport(snapshot) : buildLatexReport(snapshot);
    writeFileSync(selection.filePath, content, 'utf8');
    return selection.filePath;
  });
  ipcMain.handle('reports:export-evidence', async (_event, projectId: string) => {
    const snapshot = database.getProject(projectId, false);
    const result = snapshot.stressResults.at(-1);
    if (!result?.counterexample) throw new Error('No verified counterexample is available.');
    const selection = await dialog.showSaveDialog(mainWindow!, {
      title: 'Export counterexample evidence',
      defaultPath: `${snapshot.project.name.replace(/[<>:"/\\|?*]/g, '-')}-counterexample.json`,
      filters: [{ name: 'JSON evidence', extensions: ['json'] }],
    });
    if (selection.canceled || !selection.filePath) return null;
    writeFileSync(selection.filePath, JSON.stringify({ project: snapshot.project.name, conjecture: snapshot.project.question, evidence: result.counterexample }, null, 2), 'utf8');
    return selection.filePath;
  });

  ipcMain.handle('settings:get', () => database.getSettings());
  ipcMain.handle('settings:save', (_event, settings: ProviderSettings) => database.saveSettings(settings));
  ipcMain.handle('settings:credential-status', () => credentials.status());
  ipcMain.handle('settings:save-credential', (_event, key: string) => credentials.save(key));
  ipcMain.handle('settings:remove-credential', () => credentials.remove());
  ipcMain.handle('settings:test-provider', async () => {
    const settings = database.getSettings();
    if (settings.provider === 'local') return { ok: true, httpStatus: null, errorType: null, endpoint: 'local://coordinator', elapsedMs: 0, message: 'Local coordinator ready.', model: 'local-coordinator', response: 'OK' };
    return new ResponsesProvider(settings, credentials).testConnection();
  });
  ipcMain.handle('system:app-version', () => app.getVersion());
  ipcMain.handle('system:open-path', (_event, path: string) => shell.openPath(path));
  ipcMain.handle('system:open-external', (_event, url: string) => {
    const target = new URL(url);
    if (target.protocol !== 'https:' && target.protocol !== 'http:') throw new Error('Only HTTP(S) links can be opened.');
    return shell.openExternal(target.toString());
  });
  ipcMain.handle('system:runtime-diagnostics', () => tools.diagnostics());
}

app.whenReady().then(async () => {
  if (!singleInstanceLock) return;
  database = new ResearchDatabase(join(app.getPath('userData'), 'research.sqlite3'));
  database.recoverInterruptedSessions();
  await indexExistingImportedDocuments();
  credentials = new CredentialStore(database);
  tools = new ToolRunner(app.getPath('userData'), () => database.getSettings());
  formalBindings = new FormalBindingService(database);
  discovery = new DiscoveryEngine(database);
  discovery.recoverInterruptedRuns();
  literature = new LiteratureSearchService(database, undefined, join(app.getPath('userData'), 'literature-full-text'));
  const researchStateLog = new ResearchStateLog(join(app.getPath('userData'), 'logs', 'research-state.jsonl'));
  agent = new AgentCoordinator(
    database,
    credentials,
    tools,
    (event) => mainWindow?.webContents.send('agent:event', event),
    (entry) => researchStateLog.write(entry),
    literature,
  );
  jobs = new ResearchJobManager(database, agent, (busy) => {
    if (app.isPackaged && !process.env.MRA_TEST_USER_DATA && loginStartupEnabled !== busy) {
      app.setLoginItemSettings({ openAtLogin: busy, path: process.execPath, args: ['--research-daemon'] });
      loginStartupEnabled = busy;
    }
    if (!busy) setTimeout(() => {
      if (BrowserWindow.getAllWindows().length === 0 && !jobs.isBusy()) app.quit();
    }, 100);
  });
  chat = new ChatService(database, credentials, agent, literature, (event) => mainWindow?.webContents.send('chat:event', event));
  registerIpc();
  jobs.initialize();
  if (!daemonMode) createWindow();
});

app.on('second-instance', () => {
  if (!app.isReady()) return;
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  else { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); }
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin' && !jobs?.isBusy()) app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on('before-quit', () => jobs?.shutdown());

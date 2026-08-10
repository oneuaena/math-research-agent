import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import type { Activity, CollectionName, CreateProjectInput, ProviderSettings, Source, ToolInvocation } from '../src/shared/types';
import { AgentCoordinator } from './agent-coordinator';
import { CredentialStore } from './credentials';
import { ResearchDatabase } from './database';
import { ResponsesProvider } from './provider';
import { buildLatexReport, buildMarkdownReport } from './report';
import { ToolRunner } from './tool-runner';

let mainWindow: BrowserWindow | null = null;
let database: ResearchDatabase;
let credentials: CredentialStore;
let tools: ToolRunner;
let agent: AgentCoordinator;

if (process.env.MRA_TEST_USER_DATA) app.setPath('userData', process.env.MRA_TEST_USER_DATA);

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
  ipcMain.handle('records:save', (_event, collection: CollectionName, record: { id: string; projectId: string }) => database.saveRecord(collection, record));
  ipcMain.handle('records:remove', (_event, collection: CollectionName, id: string, projectId: string) => database.removeRecord(collection, id, projectId));

  ipcMain.handle('agent:start', (_event, projectId: string) => agent.start(projectId));
  ipcMain.handle('agent:resume', (_event, projectId: string) => agent.resume(projectId));
  ipcMain.handle('agent:pause', (_event, projectId: string) => agent.pause(projectId));
  ipcMain.handle('agent:stop', (_event, projectId: string) => { tools.stop(projectId); agent.stop(projectId); });
  ipcMain.handle('tools:run', async (_event, invocation: ToolInvocation) => {
    const started = new Date().toISOString();
    const result = await tools.run(invocation);
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
        { name: 'Research documents', extensions: ['pdf', 'txt', 'md', 'markdown', 'tex'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    if (selection.canceled || selection.filePaths.length === 0) return null;
    const destination = join(app.getPath('userData'), 'documents', projectId);
    mkdirSync(destination, { recursive: true });
    for (const sourcePath of selection.filePaths) {
      const size = statSync(sourcePath).size;
      if (size > 50 * 1024 * 1024) throw new Error('Document exceeds the 50 MB import limit.');
      const id = randomUUID();
      const extension = extname(sourcePath).toLowerCase();
      const target = join(destination, `${id}${extension}`);
      copyFileSync(sourcePath, target);
      const isText = ['.txt', '.md', '.markdown', '.tex'].includes(extension);
      const excerpt = isText ? readFileSync(sourcePath, 'utf8').slice(0, 100_000) : '';
      const record: Source = {
        id, projectId, type: 'user-document', title: basename(sourcePath, extension), authors: '', abstract: '',
        path: target, tags: [], notes: '', excerpt, createdAt: new Date().toISOString(),
      };
      database.saveRecord('sources', record);
    }
    return database.getProject(projectId, false);
  });

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
  ipcMain.handle('system:runtime-diagnostics', () => tools.diagnostics());
}

app.whenReady().then(() => {
  database = new ResearchDatabase(join(app.getPath('userData'), 'research.sqlite3'));
  database.recoverInterruptedSessions();
  credentials = new CredentialStore(database);
  tools = new ToolRunner(app.getPath('userData'), () => database.getSettings());
  agent = new AgentCoordinator(database, credentials, tools, (event) => mainWindow?.webContents.send('agent:event', event));
  registerIpc();
  createWindow();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

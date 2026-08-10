import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  Activity,
  CollectionName,
  CreateProjectInput,
  Project,
  ProjectSnapshot,
  ProviderSettings,
  ResearchSession,
} from '../src/shared/types';

const COLLECTIONS: CollectionName[] = [
  'blocks', 'nodes', 'propositions', 'experiments', 'memories', 'failedAttempts', 'sources', 'attacks', 'stressResults',
  'specifications', 'sessions', 'researchSteps', 'branches', 'evidence', 'graphEdges', 'proofs',
];

const DEFAULT_SETTINGS: ProviderSettings = {
  provider: 'local',
  model: 'gpt-5.2',
  baseUrl: 'https://api.openai.com/v1',
  pythonPath: 'python',
  maxIterations: 40,
  maxToolSeconds: 20,
  providerTimeoutSeconds: 180,
  maxResearchMinutes: 60,
  checkpointEvery: 5,
  maxBranches: 4,
};

type ProjectRow = {
  id: string;
  name: string;
  question: string;
  goal: string;
  background: string;
  known_results: string;
  constraints_text: string;
  mode: Project['mode'];
  created_at: string;
  updated_at: string;
  last_opened_at: string;
  variables: string;
  domain_text: string;
  assumptions_text: string;
  notes_text: string;
  demo_case_id: Project['demoCaseId'];
};

export class ResearchDatabase {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);
    const current = Number((this.db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get() as { version: number }).version);
    if (current < 1) {
      this.db.exec(`
        BEGIN;
        CREATE TABLE projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          question TEXT NOT NULL,
          goal TEXT NOT NULL DEFAULT '',
          background TEXT NOT NULL DEFAULT '',
          known_results TEXT NOT NULL DEFAULT '',
          constraints_text TEXT NOT NULL DEFAULT '',
          mode TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          last_opened_at TEXT NOT NULL
        );
        CREATE TABLE records (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          collection TEXT NOT NULL,
          payload TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX records_project_collection ON records(project_id, collection, updated_at);
        CREATE TABLE activities (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          payload TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX activities_project_created ON activities(project_id, created_at DESC);
        CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        INSERT INTO schema_migrations(version, applied_at) VALUES (1, datetime('now'));
        COMMIT;
      `);
    }
    if (current < 2) {
      this.db.exec(`
        BEGIN;
        ALTER TABLE projects ADD COLUMN variables TEXT NOT NULL DEFAULT '';
        ALTER TABLE projects ADD COLUMN domain_text TEXT NOT NULL DEFAULT '';
        ALTER TABLE projects ADD COLUMN assumptions_text TEXT NOT NULL DEFAULT '';
        ALTER TABLE projects ADD COLUMN notes_text TEXT NOT NULL DEFAULT '';
        ALTER TABLE projects ADD COLUMN demo_case_id TEXT;
        INSERT INTO schema_migrations(version, applied_at) VALUES (2, datetime('now'));
        COMMIT;
      `);
    }
    if (current < 3) {
      this.db.exec(`
        BEGIN;
        CREATE INDEX IF NOT EXISTS records_project_updated ON records(project_id, updated_at DESC);
        INSERT INTO schema_migrations(version, applied_at) VALUES (3, datetime('now'));
        COMMIT;
      `);
    }
  }

  private rowToProject(row: ProjectRow): Project {
    return {
      id: row.id,
      name: row.name,
      question: row.question,
      goal: row.goal,
      background: row.background,
      knownResults: row.known_results,
      constraints: row.constraints_text,
      mode: row.mode,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastOpenedAt: row.last_opened_at,
      variables: row.variables,
      domain: row.domain_text,
      assumptions: row.assumptions_text,
      notes: row.notes_text,
      demoCaseId: row.demo_case_id,
    };
  }

  listProjects(): Project[] {
    const rows = this.db.prepare('SELECT * FROM projects ORDER BY last_opened_at DESC').all() as unknown as ProjectRow[];
    return rows.map((row) => this.rowToProject(row));
  }

  createProject(input: CreateProjectInput): ProjectSnapshot {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO projects(id, name, question, goal, background, known_results, constraints_text, mode, created_at, updated_at, last_opened_at, variables, domain_text, assumptions_text, notes_text, demo_case_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.name.trim(), input.question.trim(), input.goal.trim(), input.background.trim(), input.knownResults.trim(), input.constraints.trim(), input.mode, now, now, now, input.variables?.trim() ?? '', input.domain?.trim() ?? '', input.assumptions?.trim() ?? '', input.notes?.trim() ?? '', input.demoCaseId ?? null);

    this.saveRecord('blocks', {
      id: randomUUID(), projectId: id, kind: 'text', title: 'Research Question', content: input.question.trim(),
      position: 0, createdAt: now, updatedAt: now,
    });
    this.saveRecord('nodes', {
      id: randomUUID(), projectId: id, parentId: null, kind: input.mode === 'stress-test' ? 'Conjecture' : 'CONJECTURE', title: input.name.trim(), content: input.question.trim(),
      status: input.mode === 'stress-test' ? 'open' : 'ACTIVE', dependencies: [], sources: [], tools: [], summary: '', x: 80, y: 160, createdAt: now, updatedAt: now,
    });
    return this.getProject(id, false);
  }

  getProject(id: string, touch = true): ProjectSnapshot {
    if (touch) this.db.prepare('UPDATE projects SET last_opened_at = ? WHERE id = ?').run(new Date().toISOString(), id);
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;
    if (!row) throw new Error('Project not found.');
    return {
      project: this.rowToProject(row),
      blocks: this.getRecords(id, 'blocks'),
      nodes: this.getRecords(id, 'nodes'),
      propositions: this.getRecords(id, 'propositions'),
      experiments: this.getRecords(id, 'experiments'),
      memories: this.getRecords(id, 'memories'),
      failedAttempts: this.getRecords(id, 'failedAttempts'),
      sources: this.getRecords(id, 'sources'),
      attacks: this.getRecords(id, 'attacks'),
      stressResults: this.getRecords(id, 'stressResults'),
      specifications: this.getRecords(id, 'specifications'),
      sessions: this.getRecords(id, 'sessions'),
      researchSteps: this.getRecords(id, 'researchSteps'),
      branches: this.getRecords(id, 'branches'),
      evidence: this.getRecords(id, 'evidence'),
      graphEdges: this.getRecords(id, 'graphEdges'),
      proofs: this.getRecords(id, 'proofs'),
      activities: this.listActivities(id),
    };
  }

  updateProject(id: string, patch: Partial<CreateProjectInput>): ProjectSnapshot {
    const existing = this.getProject(id, false).project;
    const next = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    this.db.prepare(`
      UPDATE projects SET name = ?, question = ?, goal = ?, background = ?, known_results = ?, constraints_text = ?, mode = ?, variables = ?, domain_text = ?, assumptions_text = ?, notes_text = ?, demo_case_id = ?, updated_at = ?
      WHERE id = ?
    `).run(next.name.trim(), next.question.trim(), next.goal.trim(), next.background.trim(), next.knownResults.trim(), next.constraints.trim(), next.mode, next.variables.trim(), next.domain.trim(), next.assumptions.trim(), next.notes.trim(), next.demoCaseId, next.updatedAt, id);
    return this.getProject(id, false);
  }

  removeProject(id: string): void {
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  }

  recoverInterruptedSessions(): number {
    let recovered = 0;
    for (const project of this.listProjects()) {
      for (const session of this.getRecords<ResearchSession>(project.id, 'sessions').filter((item) => item.status === 'RUNNING')) {
        this.saveRecord('sessions', { ...session, status: 'PAUSED', currentStage: 'PAUSED', pauseReason: 'The application restarted. Resume continues from the persisted next stage.', updatedAt: new Date().toISOString() });
        recovered += 1;
      }
    }
    return recovered;
  }

  saveRecord<T extends { id: string; projectId: string }>(collection: CollectionName, record: T): ProjectSnapshot {
    if (!COLLECTIONS.includes(collection)) throw new Error('Unsupported record collection.');
    if (!record.id || !record.projectId) throw new Error('Record identity is required.');
    const now = new Date().toISOString();
    const payload = JSON.stringify(record);
    this.db.prepare(`
      INSERT INTO records(id, project_id, collection, payload, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
    `).run(record.id, record.projectId, collection, payload, now, now);
    this.db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now, record.projectId);
    return this.getProject(record.projectId, false);
  }

  removeRecord(collection: CollectionName, id: string, projectId: string): ProjectSnapshot {
    if (!COLLECTIONS.includes(collection)) throw new Error('Unsupported record collection.');
    this.db.prepare('DELETE FROM records WHERE id = ? AND project_id = ? AND collection = ?').run(id, projectId, collection);
    return this.getProject(projectId, false);
  }

  private getRecords<T>(projectId: string, collection: CollectionName): T[] {
    const rows = this.db.prepare('SELECT payload FROM records WHERE project_id = ? AND collection = ? ORDER BY created_at ASC').all(projectId, collection) as unknown as { payload: string }[];
    return rows.map((row) => JSON.parse(row.payload) as T);
  }

  addActivity(activity: Activity): void {
    this.db.prepare('INSERT OR REPLACE INTO activities(id, project_id, payload, created_at) VALUES (?, ?, ?, ?)')
      .run(activity.id, activity.projectId, JSON.stringify(activity), activity.createdAt);
  }

  listActivities(projectId: string): Activity[] {
    const rows = this.db.prepare('SELECT payload FROM activities WHERE project_id = ? ORDER BY created_at DESC LIMIT 200').all(projectId) as unknown as { payload: string }[];
    return rows.map((row) => JSON.parse(row.payload) as Activity);
  }

  getSettings(): ProviderSettings {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = 'provider'").get() as { value: string } | undefined;
    if (!row) return DEFAULT_SETTINGS;
    try { return { ...DEFAULT_SETTINGS, ...JSON.parse(row.value) as Partial<ProviderSettings> }; }
    catch { return DEFAULT_SETTINGS; }
  }

  saveSettings(settings: ProviderSettings): ProviderSettings {
    const clean: ProviderSettings = {
      provider: settings.provider,
      model: settings.model.trim() || DEFAULT_SETTINGS.model,
      baseUrl: settings.baseUrl.trim().replace(/\/$/, '') || DEFAULT_SETTINGS.baseUrl,
      pythonPath: settings.pythonPath.trim() || DEFAULT_SETTINGS.pythonPath,
      maxIterations: Math.min(500, Math.max(1, Math.round(settings.maxIterations))),
      maxToolSeconds: Math.min(120, Math.max(2, Math.round(settings.maxToolSeconds))),
      providerTimeoutSeconds: Math.min(600, Math.max(120, Math.round(settings.providerTimeoutSeconds || DEFAULT_SETTINGS.providerTimeoutSeconds))),
      maxResearchMinutes: Math.min(720, Math.max(1, Math.round(settings.maxResearchMinutes))),
      checkpointEvery: Math.min(100, Math.max(1, Math.round(settings.checkpointEvery))),
      maxBranches: Math.min(12, Math.max(1, Math.round(settings.maxBranches))),
    };
    this.db.prepare("INSERT INTO settings(key, value) VALUES ('provider', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(clean));
    return clean;
  }

  getSecret(): string | null {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = 'provider_secret'").get() as { value: string } | undefined;
    return row?.value ?? null;
  }

  setSecret(value: string): void {
    this.db.prepare("INSERT INTO settings(key, value) VALUES ('provider_secret', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(value);
  }

  removeSecret(): void { this.db.prepare("DELETE FROM settings WHERE key = 'provider_secret'").run(); }
}

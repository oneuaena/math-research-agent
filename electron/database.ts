import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  Activity,
  CollectionName,
  CreateProjectInput,
  DocumentChunk,
  DocumentSearchResult,
  Project,
  ProjectSnapshot,
  ProviderSettings,
  ResearchJob,
  ResearchSession,
} from '../src/shared/types';
import { cosineSimilarity, embedText, lexicalSimilarity, retrievalTerms } from '../src/shared/retrieval';

const COLLECTIONS: CollectionName[] = [
  'blocks', 'nodes', 'propositions', 'experiments', 'memories', 'failedAttempts', 'sources', 'attacks', 'stressResults',
  'specifications', 'sessions', 'researchSteps', 'branches', 'evidence', 'graphEdges', 'proofs',
  'conversations', 'messages', 'literature', 'noveltyChecks', 'formalBindings', 'discoveryRuns',
  'discoverySpecifications', 'resourceBudgets', 'knowledgeRecords', 'formalProofSearchRuns', 'benchmarkRuns',
  'steeringInstructions', 'steeringAudit', 'claimVersions',
];

const DEFAULT_SETTINGS: ProviderSettings = {
  provider: 'local',
  model: 'gpt-5.2',
  baseUrl: 'https://api.openai.com/v1',
  pythonPath: 'python',
  leanPath: '',
  maxIterations: 40,
  maxToolSeconds: 20,
  providerTimeoutSeconds: 180,
  maxResearchMinutes: 60,
  maxAutonomousHours: 168,
  maxTotalTokens: 2_000_000,
  checkpointEvery: 5,
  maxBranches: 4,
  literatureSearchMode: 'auto',
  literatureProviders: { arxiv: true, crossref: true, openalex: true, 'semantic-scholar': true, web: false },
  searchDomesticSources: true,
  searchInternationalSources: true,
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
    if (current < 4) {
      this.db.exec(`
        BEGIN;
        CREATE TABLE document_chunks (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          source_id TEXT NOT NULL,
          filename TEXT NOT NULL,
          document_type TEXT NOT NULL,
          page_number INTEGER,
          section_text TEXT NOT NULL DEFAULT '',
          kind TEXT NOT NULL,
          chunk_index INTEGER NOT NULL,
          character_start INTEGER NOT NULL,
          character_end INTEGER NOT NULL,
          text_content TEXT NOT NULL,
          embedding_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX document_chunks_project_source ON document_chunks(project_id, source_id, chunk_index);
        CREATE INDEX document_chunks_project_page ON document_chunks(project_id, page_number);
        CREATE VIRTUAL TABLE document_chunks_fts USING fts5(filename, section_text, text_content, content='document_chunks', content_rowid='rowid');
        CREATE TRIGGER document_chunks_ai AFTER INSERT ON document_chunks BEGIN
          INSERT INTO document_chunks_fts(rowid, filename, section_text, text_content) VALUES (new.rowid, new.filename, new.section_text, new.text_content);
        END;
        CREATE TRIGGER document_chunks_ad AFTER DELETE ON document_chunks BEGIN
          INSERT INTO document_chunks_fts(document_chunks_fts, rowid, filename, section_text, text_content) VALUES ('delete', old.rowid, old.filename, old.section_text, old.text_content);
        END;
        CREATE TRIGGER document_chunks_au AFTER UPDATE ON document_chunks BEGIN
          INSERT INTO document_chunks_fts(document_chunks_fts, rowid, filename, section_text, text_content) VALUES ('delete', old.rowid, old.filename, old.section_text, old.text_content);
          INSERT INTO document_chunks_fts(rowid, filename, section_text, text_content) VALUES (new.rowid, new.filename, new.section_text, new.text_content);
        END;
        INSERT INTO schema_migrations(version, applied_at) VALUES (4, datetime('now'));
        COMMIT;
      `);
    }
    if (current < 5) {
      this.db.exec(`
        BEGIN;
        CREATE TABLE research_jobs (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
          status TEXT NOT NULL,
          desired_state TEXT NOT NULL,
          resume_requested INTEGER NOT NULL DEFAULT 0,
          attempt_count INTEGER NOT NULL DEFAULT 0,
          max_attempts INTEGER NOT NULL DEFAULT 5,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          started_at TEXT,
          heartbeat_at TEXT,
          next_run_at TEXT,
          completed_at TEXT,
          last_error TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX research_jobs_status_next_run ON research_jobs(status, next_run_at);
        INSERT INTO schema_migrations(version, applied_at) VALUES (5, datetime('now'));
        COMMIT;
      `);
    }
    if (current < 6) {
      this.db.exec(`
        BEGIN;
        CREATE INDEX IF NOT EXISTS records_collection_project_updated ON records(collection, project_id, updated_at DESC);
        INSERT INTO schema_migrations(version, applied_at) VALUES (6, datetime('now'));
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
      discoveryRuns: this.getRecords(id, 'discoveryRuns'),
      discoverySpecifications: this.getRecords(id, 'discoverySpecifications'),
      resourceBudgets: this.getRecords(id, 'resourceBudgets'),
      knowledgeRecords: this.getRecords(id, 'knowledgeRecords'),
      formalProofSearchRuns: this.getRecords(id, 'formalProofSearchRuns'),
      steeringInstructions: this.getRecords(id, 'steeringInstructions'),
      steeringAudit: this.getRecords(id, 'steeringAudit'),
      claimVersions: this.getRecords(id, 'claimVersions'),
      specifications: this.getRecords(id, 'specifications'),
      formalBindings: this.getRecords(id, 'formalBindings'),
      sessions: this.getRecords(id, 'sessions'),
      researchSteps: this.getRecords(id, 'researchSteps'),
      branches: this.getRecords(id, 'branches'),
      evidence: this.getRecords(id, 'evidence'),
      graphEdges: this.getRecords(id, 'graphEdges'),
      proofs: this.getRecords(id, 'proofs'),
      conversations: this.getRecords(id, 'conversations'),
      messages: this.getRecords(id, 'messages'),
      literature: this.getRecords(id, 'literature'),
      noveltyChecks: this.getRecords(id, 'noveltyChecks'),
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

  saveResearchJob(job: ResearchJob): ResearchJob {
    this.db.prepare(`
      INSERT INTO research_jobs(
        id, project_id, status, desired_state, resume_requested, attempt_count, max_attempts,
        created_at, updated_at, started_at, heartbeat_at, next_run_at, completed_at, last_error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET
        id = excluded.id,
        status = excluded.status,
        desired_state = excluded.desired_state,
        resume_requested = excluded.resume_requested,
        attempt_count = excluded.attempt_count,
        max_attempts = excluded.max_attempts,
        updated_at = excluded.updated_at,
        started_at = excluded.started_at,
        heartbeat_at = excluded.heartbeat_at,
        next_run_at = excluded.next_run_at,
        completed_at = excluded.completed_at,
        last_error = excluded.last_error
    `).run(
      job.id, job.projectId, job.status, job.desiredState, job.resumeRequested ? 1 : 0,
      job.attemptCount, job.maxAttempts, job.createdAt, job.updatedAt, job.startedAt,
      job.heartbeatAt, job.nextRunAt, job.completedAt, job.lastError,
    );
    return this.getResearchJob(job.projectId)!;
  }

  getResearchJob(projectId: string): ResearchJob | null {
    const row = this.db.prepare('SELECT * FROM research_jobs WHERE project_id = ?').get(projectId) as ResearchJobRow | undefined;
    return row ? rowToResearchJob(row) : null;
  }

  listResearchJobs(projectId?: string): ResearchJob[] {
    const rows = (projectId
      ? this.db.prepare('SELECT * FROM research_jobs WHERE project_id = ? ORDER BY created_at').all(projectId)
      : this.db.prepare('SELECT * FROM research_jobs ORDER BY created_at').all()) as unknown as ResearchJobRow[];
    return rows.map(rowToResearchJob);
  }

  recoverInterruptedJobs(): number {
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      UPDATE research_jobs
      SET status = 'QUEUED', resume_requested = 1, updated_at = ?, heartbeat_at = NULL,
          next_run_at = NULL, last_error = CASE WHEN last_error = '' THEN 'Application restarted while research was active.' ELSE last_error END
      WHERE desired_state = 'RUNNING' AND status IN ('RUNNING', 'QUEUED', 'RETRY_WAIT')
    `).run(now);
    return Number(result.changes);
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
    if (collection === 'sources') this.db.prepare('DELETE FROM document_chunks WHERE source_id = ? AND project_id = ?').run(id, projectId);
    return this.getProject(projectId, false);
  }

  replaceDocumentChunks(projectId: string, sourceId: string, chunks: DocumentChunk[]): void {
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      this.db.prepare('DELETE FROM document_chunks WHERE project_id = ? AND source_id = ?').run(projectId, sourceId);
      const insert = this.db.prepare(`
        INSERT INTO document_chunks(id, project_id, source_id, filename, document_type, page_number, section_text, kind, chunk_index, character_start, character_end, text_content, embedding_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const chunk of chunks) {
        insert.run(chunk.id, chunk.projectId, chunk.sourceId, chunk.filename, chunk.documentType, chunk.page, chunk.section, chunk.kind, chunk.chunkIndex, chunk.characterStart, chunk.characterEnd, chunk.text, JSON.stringify(chunk.embedding), chunk.createdAt);
      }
      this.db.exec('COMMIT;');
    } catch (error) {
      this.db.exec('ROLLBACK;');
      throw error;
    }
  }

  getDocumentChunks(projectId: string, sourceId?: string): DocumentChunk[] {
    const rows = (sourceId
      ? this.db.prepare('SELECT * FROM document_chunks WHERE project_id = ? AND source_id = ? ORDER BY chunk_index').all(projectId, sourceId)
      : this.db.prepare('SELECT * FROM document_chunks WHERE project_id = ? ORDER BY source_id, chunk_index').all(projectId)) as unknown as DocumentChunkRow[];
    return rows.map(rowToDocumentChunk);
  }

  searchDocumentChunks(projectId: string, query: string, limit = 8): DocumentSearchResult[] {
    const requestedPage = pageFromQuery(query);
    const allRows = this.db.prepare('SELECT * FROM document_chunks WHERE project_id = ? ORDER BY source_id, chunk_index LIMIT 5000').all(projectId) as unknown as DocumentChunkRow[];
    const ftsScores = new Map<string, number>();
    const match = retrievalTerms(query).filter((term) => /^[a-z0-9_]+$/.test(term)).slice(0, 12).map((term) => `"${term.replace(/"/g, '""')}"`).join(' OR ');
    if (match) {
      try {
        const matches = this.db.prepare(`SELECT c.id, bm25(document_chunks_fts) AS rank FROM document_chunks_fts JOIN document_chunks c ON c.rowid = document_chunks_fts.rowid WHERE document_chunks_fts MATCH ? AND c.project_id = ? LIMIT 100`).all(match, projectId) as unknown as Array<{ id: string; rank: number }>;
        for (const item of matches) ftsScores.set(item.id, 1 / (1 + Math.abs(item.rank)));
      } catch {
        // Keyword and local embedding scoring remain available when FTS cannot parse a query.
      }
    }
    const queryEmbedding = embedText(query);
    return allRows.map((row) => {
      const chunk = rowToDocumentChunk(row);
      const pageMatch = requestedPage === null || chunk.page === requestedPage;
      const semantic = (cosineSimilarity(queryEmbedding, chunk.embedding) + 1) / 2;
      const lexical = lexicalSimilarity(`${chunk.filename}\n${chunk.section}\n${chunk.text}`, query);
      const score = (pageMatch ? 0.35 : requestedPage === null ? 0 : -1) + semantic * 0.3 + lexical * 0.25 + (ftsScores.get(chunk.id) ?? 0) * 0.1;
      return { ...chunk, score };
    }).filter((item) => requestedPage === null || item.page === requestedPage).sort((a, b) => b.score - a.score || a.chunkIndex - b.chunkIndex).slice(0, Math.max(1, Math.min(50, limit)));
  }

  private getRecords<T>(projectId: string, collection: CollectionName): T[] {
    const rows = this.db.prepare('SELECT payload FROM records WHERE project_id = ? AND collection = ? ORDER BY created_at ASC').all(projectId, collection) as unknown as { payload: string }[];
    return rows.map((row) => JSON.parse(row.payload) as T);
  }

  /** Read-only typed access for cross-cutting services without exposing SQLite. */
  listRecords<T>(projectId: string, collection: CollectionName): T[] {
    return this.getRecords<T>(projectId, collection);
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
    try {
      const saved = JSON.parse(row.value) as Partial<ProviderSettings>;
      return { ...DEFAULT_SETTINGS, ...saved, literatureProviders: { ...DEFAULT_SETTINGS.literatureProviders, ...saved.literatureProviders } };
    }
    catch { return DEFAULT_SETTINGS; }
  }

  saveSettings(settings: ProviderSettings): ProviderSettings {
    const clean: ProviderSettings = {
      provider: settings.provider,
      model: settings.model.trim() || DEFAULT_SETTINGS.model,
      baseUrl: settings.baseUrl.trim().replace(/\/$/, '') || DEFAULT_SETTINGS.baseUrl,
      pythonPath: settings.pythonPath.trim() || DEFAULT_SETTINGS.pythonPath,
      leanPath: settings.leanPath?.trim() ?? DEFAULT_SETTINGS.leanPath,
      maxIterations: Math.min(500, Math.max(1, Math.round(settings.maxIterations))),
      maxToolSeconds: Math.min(120, Math.max(2, Math.round(settings.maxToolSeconds))),
      providerTimeoutSeconds: Math.min(600, Math.max(120, Math.round(settings.providerTimeoutSeconds || DEFAULT_SETTINGS.providerTimeoutSeconds))),
      maxResearchMinutes: Math.min(720, Math.max(1, Math.round(settings.maxResearchMinutes))),
      maxAutonomousHours: Math.min(720, Math.max(1, Math.round(settings.maxAutonomousHours || DEFAULT_SETTINGS.maxAutonomousHours))),
      maxTotalTokens: Math.min(100_000_000, Math.max(10_000, Math.round(settings.maxTotalTokens || DEFAULT_SETTINGS.maxTotalTokens))),
      checkpointEvery: Math.min(100, Math.max(1, Math.round(settings.checkpointEvery))),
      maxBranches: Math.min(12, Math.max(1, Math.round(settings.maxBranches))),
      literatureSearchMode: ['auto', 'manual', 'off'].includes(settings.literatureSearchMode) ? settings.literatureSearchMode : DEFAULT_SETTINGS.literatureSearchMode,
      literatureProviders: { ...DEFAULT_SETTINGS.literatureProviders, ...settings.literatureProviders },
      searchDomesticSources: settings.searchDomesticSources !== false,
      searchInternationalSources: settings.searchInternationalSources !== false,
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

  close(): void { this.db.close(); }
}

type DocumentChunkRow = {
  id: string; project_id: string; source_id: string; filename: string; document_type: string; page_number: number | null;
  section_text: string; kind: DocumentChunk['kind']; chunk_index: number; character_start: number; character_end: number;
  text_content: string; embedding_json: string; created_at: string;
};

type ResearchJobRow = {
  id: string; project_id: string; status: ResearchJob['status']; desired_state: ResearchJob['desiredState'];
  resume_requested: number; attempt_count: number; max_attempts: number; created_at: string; updated_at: string;
  started_at: string | null; heartbeat_at: string | null; next_run_at: string | null; completed_at: string | null; last_error: string;
};

function rowToResearchJob(row: ResearchJobRow): ResearchJob {
  return {
    id: row.id, projectId: row.project_id, status: row.status, desiredState: row.desired_state,
    resumeRequested: row.resume_requested === 1, attemptCount: row.attempt_count, maxAttempts: row.max_attempts,
    createdAt: row.created_at, updatedAt: row.updated_at, startedAt: row.started_at, heartbeatAt: row.heartbeat_at,
    nextRunAt: row.next_run_at, completedAt: row.completed_at, lastError: row.last_error,
  };
}

function rowToDocumentChunk(row: DocumentChunkRow): DocumentChunk {
  let embedding: number[] = [];
  try { embedding = JSON.parse(row.embedding_json) as number[]; } catch { embedding = embedText(row.text_content); }
  return {
    id: row.id, projectId: row.project_id, sourceId: row.source_id, filename: row.filename, documentType: row.document_type,
    page: row.page_number, section: row.section_text, kind: row.kind, chunkIndex: row.chunk_index,
    characterStart: row.character_start, characterEnd: row.character_end, text: row.text_content, embedding, createdAt: row.created_at,
  };
}

function pageFromQuery(query: string): number | null {
  const match = query.match(/\bpage\s*[:#]?\s*(\d{1,5})\b/i) ?? query.match(/第\s*(\d{1,5})\s*页/);
  const value = match ? Number(match[1]) : NaN;
  return Number.isInteger(value) && value > 0 ? value : null;
}

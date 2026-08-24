import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ResearchJob, ResearchSession } from '../src/shared/types';
import { ResearchDatabase } from './database';
import { ResearchJobManager, type ResearchRunner } from './research-job-manager';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function createDatabase(): { database: ResearchDatabase; projectId: string } {
  const directory = mkdtempSync(join(tmpdir(), 'mra-job-db-'));
  temporaryDirectories.push(directory);
  const database = new ResearchDatabase(join(directory, 'research.sqlite3'));
  const projectId = database.createProject({
    name: 'Persistent research', question: 'Does the process resume?', goal: '', background: '', knownResults: '', constraints: '', mode: 'explore',
  }).project.id;
  return { database, projectId };
}

function session(projectId: string, status: ResearchSession['status'], iteration: number): ResearchSession {
  const timestamp = new Date().toISOString();
  return {
    id: 'session', projectId, cycleId: `cycle-${iteration}`, cycleIndex: iteration, cycleCheckpointStart: 0,
    status, currentStage: status === 'COMPLETE' ? 'COMPLETE' : 'PAUSED', nextStage: status === 'COMPLETE' ? 'COMPLETE' : 'PAUSED',
    iteration, actionCount: iteration, checkpointCount: iteration, activeBranchId: null, branchCursor: 0,
    startedAt: timestamp, updatedAt: timestamp, lastCheckpointAt: timestamp,
    completedAt: status === 'COMPLETE' ? timestamp : null, pauseReason: status === 'PAUSED' ? 'Checkpoint saved.' : '',
    failure: '', totalTokenUsage: 0, totalElapsedMs: 0, conclusion: status === 'COMPLETE' ? 'partial-result' : null,
  };
}

async function waitForJob(database: ResearchDatabase, projectId: string, predicate: (job: ResearchJob) => boolean): Promise<ResearchJob> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const job = database.getResearchJob(projectId);
    if (job && predicate(job)) return job;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for research job: ${JSON.stringify(database.getResearchJob(projectId))}`);
}

describe('persistent research job manager', () => {
  it('automatically continues a checkpointed session until completion', async () => {
    const { database, projectId } = createDatabase();
    let runs = 0;
    const resumeFlags: boolean[] = [];
    const runner: ResearchRunner = {
      async startAndWait(id, resumeRequested) {
        runs += 1;
        resumeFlags.push(resumeRequested);
        database.saveRecord('sessions', session(id, runs === 1 ? 'PAUSED' : 'COMPLETE', runs));
      },
      pause() {},
      stop() {},
    };
    const manager = new ResearchJobManager(database, runner);
    try {
      manager.start(projectId);
      const job = await waitForJob(database, projectId, (candidate) => candidate.status === 'COMPLETED');
      expect(job.desiredState).toBe('PAUSED');
      expect(runs).toBe(2);
      expect(resumeFlags).toEqual([false, true]);
    } finally {
      manager.shutdown();
      database.close();
    }
  });

  it('recovers an interrupted running job as resumable queued work', () => {
    const { database, projectId } = createDatabase();
    const timestamp = new Date().toISOString();
    database.saveResearchJob({
      id: 'job', projectId, status: 'RUNNING', desiredState: 'RUNNING', resumeRequested: false,
      attemptCount: 0, maxAttempts: 5, createdAt: timestamp, updatedAt: timestamp, startedAt: timestamp,
      heartbeatAt: timestamp, nextRunAt: null, completedAt: null, lastError: '',
    });
    try {
      expect(database.recoverInterruptedJobs()).toBe(1);
      expect(database.getResearchJob(projectId)).toMatchObject({
        status: 'QUEUED', desiredState: 'RUNNING', resumeRequested: true, heartbeatAt: null,
      });
    } finally {
      database.close();
    }
  });

  it('backs off after a runner failure and then completes without user intervention', async () => {
    const { database, projectId } = createDatabase();
    let runs = 0;
    const runner: ResearchRunner = {
      async startAndWait(id) {
        runs += 1;
        if (runs === 1) throw new Error('Injected transient provider failure.');
        database.saveRecord('sessions', session(id, 'COMPLETE', runs));
      },
      pause() {},
      stop() {},
    };
    const manager = new ResearchJobManager(database, runner, () => undefined, { retryBaseMs: 100, maxRetryDelayMs: 200 });
    try {
      manager.start(projectId);
      const retry = await waitForJob(database, projectId, (candidate) => candidate.status === 'RETRY_WAIT');
      expect(retry.lastError).toContain('Injected transient provider failure');
      const completed = await waitForJob(database, projectId, (candidate) => candidate.status === 'COMPLETED');
      expect(completed.attemptCount).toBe(1);
      expect(runs).toBe(2);
    } finally {
      manager.shutdown();
      database.close();
    }
  });
});

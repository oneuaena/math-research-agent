import { randomUUID } from 'node:crypto';
import type { ResearchJob, ResearchSession } from '../src/shared/types';
import type { AgentCoordinator } from './agent-coordinator';
import type { ResearchDatabase } from './database';

const HEARTBEAT_MS = 5_000;
const CONTINUE_DELAY_MS = 250;
const MAX_RETRY_DELAY_MS = 5 * 60_000;

export interface ResearchJobManagerTiming {
  heartbeatMs?: number;
  continueDelayMs?: number;
  retryBaseMs?: number;
  maxRetryDelayMs?: number;
}

export interface ResearchRunner {
  startAndWait(projectId: string, resumeRequested: boolean): Promise<void>;
  pause(projectId: string): void;
  stop(projectId: string): void;
}

export class ResearchJobManager {
  private pumping = false;
  private stopped = false;
  private wakeTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly db: ResearchDatabase,
    private readonly runner: ResearchRunner | AgentCoordinator,
    private readonly onBusyChanged: (busy: boolean) => void = () => undefined,
    private readonly timing: ResearchJobManagerTiming = {},
  ) {}

  initialize(): number {
    const recovered = this.db.recoverInterruptedJobs();
    this.notifyBusy();
    this.schedulePump(0);
    return recovered;
  }

  start(projectId: string): ResearchJob {
    return this.enqueue(projectId, false);
  }

  resume(projectId: string): ResearchJob {
    return this.enqueue(projectId, true);
  }

  pause(projectId: string): ResearchJob | null {
    const existing = this.db.getResearchJob(projectId);
    if (!existing) return null;
    const timestamp = new Date().toISOString();
    const job = this.db.saveResearchJob({
      ...existing, status: 'PAUSED', desiredState: 'PAUSED', updatedAt: timestamp,
      heartbeatAt: null, nextRunAt: null, lastError: '',
    });
    this.runner.pause(projectId);
    this.notifyBusy();
    return job;
  }

  stop(projectId: string): ResearchJob | null {
    const existing = this.db.getResearchJob(projectId);
    if (!existing) return null;
    const timestamp = new Date().toISOString();
    const job = this.db.saveResearchJob({
      ...existing, status: 'CANCELLED', desiredState: 'CANCELLED', updatedAt: timestamp,
      heartbeatAt: null, nextRunAt: null, completedAt: timestamp,
    });
    this.runner.stop(projectId);
    this.notifyBusy();
    return job;
  }

  list(projectId?: string): ResearchJob[] {
    return this.db.listResearchJobs(projectId);
  }

  isBusy(): boolean {
    return this.db.listResearchJobs().some((job) => job.desiredState === 'RUNNING'
      && ['QUEUED', 'RUNNING', 'RETRY_WAIT'].includes(job.status));
  }

  shutdown(): void {
    this.stopped = true;
    if (this.wakeTimer) clearTimeout(this.wakeTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.wakeTimer = null;
    this.heartbeatTimer = null;
  }

  private enqueue(projectId: string, resumeRequested: boolean): ResearchJob {
    this.db.getProject(projectId, false);
    const timestamp = new Date().toISOString();
    const existing = this.db.getResearchJob(projectId);
    if (existing?.desiredState === 'RUNNING' && ['QUEUED', 'RUNNING', 'RETRY_WAIT'].includes(existing.status)) return existing;
    const job = this.db.saveResearchJob({
      id: existing?.id ?? randomUUID(), projectId, status: 'QUEUED', desiredState: 'RUNNING',
      resumeRequested, attemptCount: 0, maxAttempts: existing?.maxAttempts ?? 5,
      createdAt: existing?.createdAt ?? timestamp, updatedAt: timestamp, startedAt: null,
      heartbeatAt: null, nextRunAt: null, completedAt: null, lastError: '',
    });
    this.notifyBusy();
    this.schedulePump(0);
    return job;
  }

  private schedulePump(delayMs: number): void {
    if (this.stopped || this.wakeTimer) return;
    this.wakeTimer = setTimeout(() => {
      this.wakeTimer = null;
      void this.pump();
    }, delayMs);
  }

  private async pump(): Promise<void> {
    if (this.stopped || this.pumping) return;
    const timestamp = Date.now();
    const eligible = this.db.listResearchJobs().filter((job) => job.desiredState === 'RUNNING'
      && (job.status === 'QUEUED' || (job.status === 'RETRY_WAIT' && (!job.nextRunAt || Date.parse(job.nextRunAt) <= timestamp))));
    const next = eligible[0];
    if (!next) {
      const future = this.db.listResearchJobs().filter((job) => job.desiredState === 'RUNNING' && job.status === 'RETRY_WAIT' && job.nextRunAt)
        .map((job) => Date.parse(job.nextRunAt!)).filter(Number.isFinite).sort((a, b) => a - b)[0];
      if (future) this.schedulePump(Math.max(10, future - timestamp));
      this.notifyBusy();
      return;
    }
    this.pumping = true;
    try {
      await this.runJob(next);
    } finally {
      this.pumping = false;
      this.schedulePump(0);
    }
  }

  private async runJob(job: ResearchJob): Promise<void> {
    const startedAt = new Date().toISOString();
    this.db.saveResearchJob({
      ...job, status: 'RUNNING', updatedAt: startedAt, startedAt: job.startedAt ?? startedAt,
      heartbeatAt: startedAt, nextRunAt: null,
    });
    this.notifyBusy();
    this.heartbeatTimer = setInterval(() => {
      const current = this.db.getResearchJob(job.projectId);
      if (!current || current.status !== 'RUNNING') return;
      const heartbeatAt = new Date().toISOString();
      this.db.saveResearchJob({ ...current, heartbeatAt, updatedAt: heartbeatAt });
    }, this.timing.heartbeatMs ?? HEARTBEAT_MS);

    try {
      await this.runner.startAndWait(job.projectId, job.resumeRequested);
      const current = this.db.getResearchJob(job.projectId);
      if (!current || current.desiredState !== 'RUNNING') return;
      const snapshot = this.db.getProject(job.projectId, false);
      const session = snapshot.sessions.at(-1) as ResearchSession | undefined;
      if (snapshot.project.mode === 'stress-test' || session?.status === 'COMPLETE') {
        const completedAt = new Date().toISOString();
        this.db.saveResearchJob({ ...current, status: 'COMPLETED', desiredState: 'PAUSED', updatedAt: completedAt, completedAt, heartbeatAt: null, nextRunAt: null, lastError: '' });
      } else if (session?.status === 'FAILED') {
        this.retryOrFail(current, session.failure || 'Research session failed.');
      } else if (session?.status === 'PAUSED') {
        if (session.pauseReason.startsWith('AUTONOMY_BUDGET_REACHED')) {
          this.db.saveResearchJob({ ...current, status: 'PAUSED', desiredState: 'PAUSED', updatedAt: new Date().toISOString(), heartbeatAt: null, nextRunAt: null, lastError: session.pauseReason });
          return;
        }
        const nextRunAt = new Date(Date.now() + (this.timing.continueDelayMs ?? CONTINUE_DELAY_MS)).toISOString();
        this.db.saveResearchJob({ ...current, status: 'RETRY_WAIT', resumeRequested: true, attemptCount: 0, updatedAt: new Date().toISOString(), heartbeatAt: null, nextRunAt, lastError: '' });
      } else {
        this.retryOrFail(current, 'Research runner stopped without a terminal or checkpointed session.');
      }
    } catch (error) {
      const current = this.db.getResearchJob(job.projectId);
      if (current?.desiredState === 'RUNNING') this.retryOrFail(current, error instanceof Error ? error.message : 'Research runner failed.');
    } finally {
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
      this.notifyBusy();
    }
  }

  private retryOrFail(job: ResearchJob, message: string): void {
    const attemptCount = job.attemptCount + 1;
    const updatedAt = new Date().toISOString();
    if (attemptCount >= job.maxAttempts) {
      this.db.saveResearchJob({
        ...job, status: 'FAILED', desiredState: 'PAUSED', attemptCount, updatedAt,
        heartbeatAt: null, nextRunAt: null, completedAt: updatedAt, lastError: message,
      });
      return;
    }
    const delayMs = Math.min(this.timing.maxRetryDelayMs ?? MAX_RETRY_DELAY_MS, (this.timing.retryBaseMs ?? 1_000) * (2 ** (attemptCount - 1)));
    this.db.saveResearchJob({
      ...job, status: 'RETRY_WAIT', resumeRequested: true, attemptCount, updatedAt,
      heartbeatAt: null, nextRunAt: new Date(Date.now() + delayMs).toISOString(), lastError: message,
    });
  }

  private notifyBusy(): void {
    this.onBusyChanged(this.isBusy());
  }
}

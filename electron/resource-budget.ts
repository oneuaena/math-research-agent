import { randomUUID } from 'node:crypto';
import type { ResourceBudgetRecord } from '../src/shared/types';
import type { ResearchDatabase } from './database';

// A fresh pinned Mathlib workspace may take several minutes to download and
// populate. This is environment preparation, but its elapsed time is still
// recorded in the project's durable tool ledger. Do not retroactively turn a
// successful first formal check into RESOURCE_BUDGET_EXCEEDED merely because
// the ordinary interactive tool limit is shorter than that bootstrap.
const INITIAL_FORMAL_TOOL_BUDGET_SECONDS = 900;

/** Project-level, persisted quota ledger shared by discovery/proof/tool work. */
export class ResourceBudgetService {
  constructor(private readonly db: ResearchDatabase) {}
  current(projectId: string): ResourceBudgetRecord {
    const current = this.db.listRecords<ResourceBudgetRecord>(projectId, 'resourceBudgets').at(-1); if (current) return current;
    const settings = this.db.getSettings(); const now = new Date().toISOString();
    const created: ResourceBudgetRecord = { id: randomUUID(), projectId, status: 'ACTIVE', limits: { maxEvaluations: 1_000_000, maxWorkers: 32, maxProofAttempts: 128, maxToolSeconds: Math.max(settings.maxToolSeconds, INITIAL_FORMAL_TOOL_BUDGET_SECONDS) }, used: { evaluations: 0, proofAttempts: 0, toolSeconds: 0 }, createdAt: now, updatedAt: now };
    this.db.saveRecord('resourceBudgets', created); return created;
  }
  consume(projectId: string, kind: 'evaluations' | 'proofAttempts' | 'toolSeconds', amount: number): ResourceBudgetRecord {
    const current = this.current(projectId); if (current.status !== 'ACTIVE') throw new Error(`RESOURCE_BUDGET_EXCEEDED: budget is ${current.status}.`);
    const used = { ...current.used, [kind]: current.used[kind] + Math.max(0, amount) };
    const limit = kind === 'evaluations' ? current.limits.maxEvaluations : kind === 'proofAttempts' ? current.limits.maxProofAttempts : current.limits.maxToolSeconds;
    const next: ResourceBudgetRecord = { ...current, used, status: used[kind] > limit ? 'EXHAUSTED' : 'ACTIVE', updatedAt: new Date().toISOString() };
    this.db.saveRecord('resourceBudgets', next); if (next.status === 'EXHAUSTED') throw new Error(`RESOURCE_BUDGET_EXCEEDED: ${kind} limit ${limit} reached.`); return next;
  }
  cancel(projectId: string): void { const current = this.current(projectId); this.db.saveRecord('resourceBudgets', { ...current, status: 'CANCELLED', updatedAt: new Date().toISOString() }); }
}

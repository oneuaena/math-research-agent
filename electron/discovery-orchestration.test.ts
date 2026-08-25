import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { formalizationSchema, roleActionSchema } from '../src/shared/research';
import { ResearchDatabase } from './database';
import type { ModelProvider } from './provider';
import { ResearchOrchestrator } from './research-orchestrator';
import type { ToolRunner } from './tool-runner';

describe('discovery is an orchestrated research stage', () => {
  it('moves validated discovery output into evidence and subsequent lemma/proof stages', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'mra-discovery-loop-')); const db = new ResearchDatabase(join(directory, 'research.sqlite3'));
    try {
      db.saveSettings({ ...db.getSettings(), maxIterations: 100, maxResearchMinutes: 2, maxBranches: 2, checkpointEvery: 100 });
      const project = db.createProject({ name: 'loop', question: 'find a finite set', goal: '', background: '', knownResults: '', constraints: '', mode: 'autonomous' });
      const provider: ModelProvider = {
        async respondChat() { return ''; }, async runStage() { return { title: '', summary: '', status: 'unverified' as const }; },
        async formalize() { return formalizationSchema.parse({ quantifiers: [], variables: [], domains: {}, assumptions: [], target: { relation: 'exists', left: 'S', right: '', description: 'finite set' }, equivalentForms: [], searchParameters: {}, validationRules: [], executable: null, discoverySpecification: { representation: { kind: 'SET', dimensions: { universeSize: 12, length: 4 }, schemaVersion: 1 }, evaluator: { version: 1, constraints: [{ kind: 'forbidden-tuples', arity: 2, tuples: [[0, 1]] }, { kind: 'cardinality', target: 4 }], objectives: [{ name: 'violations', direction: 'minimize', metric: 'violations' }], aggregation: 'pareto' }, semanticScope: 'finite construction' }, symbolicExpressions: [], leanStatement: null, naturalLanguageOnly: false, uncertainty: [], confidence: .5 }); },
        async runRole(request) { return roleActionSchema.parse({ title: request.stage, summary: 'conservative action', rationaleSummary: 'test fixture', evidence: [], proposedNodes: [], branches: request.stage === 'PLAN' ? [{ title: 'route', objective: 'search', method: 'bounded', priority: 90 }] : [], proofSteps: [], proofReviews: [], formalTactics: [], toolCalls: [], nextStage: 'REFLECT', failures: [], tokenUsage: { input: 0, output: 0, total: 0 } }); },
      };
      await new ResearchOrchestrator(db, { run: vi.fn() } as unknown as ToolRunner, provider, () => undefined).run(project.project.id, new AbortController().signal);
      const snapshot = db.getProject(project.project.id, false);
      expect(snapshot.discoveryRuns.some((run) => run.status === 'COMPLETED' && run.totalEvaluated > 0)).toBe(true);
      expect(snapshot.evidence.some((evidence) => evidence.type === 'discovery-search' && evidence.reproducible)).toBe(true);
      expect(snapshot.researchSteps.some((step) => step.stage === 'DISCOVERY_ANALYZE')).toBe(true);
      expect(db.listRecords(project.project.id, 'knowledgeRecords').length).toBeGreaterThan(0);
    } finally { db.close(); rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); }
  }, 30_000);
});

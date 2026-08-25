import { randomUUID } from 'node:crypto';
import type { DiscoveryConfig } from '../src/shared/types';
import type { ResearchDatabase } from './database';
import { makeDiscoverySpecification } from './discovery-core';
import { DiscoveryEngine } from './discovery-engine';

export interface BenchmarkRun { id: string; projectId: string; version: '2.0.0'; startedAt: string; completedAt: string; cases: Array<{ id: string; level: 1 | 2 | 3 | 4; status: 'PASSED' | 'FAILED' | 'INCONCLUSIVE'; evaluatorHash: string; evaluations: number; detail: string }>; metrics: { solvedRate: number; formalProofRate: number; counterexampleRate: number; falseVerifiedRate: number; evaluationCalls: number; wallClockMs: number }; }

/** Fixed, versioned regression benchmark. Level 4 validates an open-problem representation but never calls it solved. */
export class BenchmarkRunner {
  constructor(private readonly db: ResearchDatabase) {}
  async run(projectId: string, signal?: AbortSignal): Promise<BenchmarkRun> {
    const started = Date.now(); const cases: BenchmarkRun['cases'] = [];
    const config: DiscoveryConfig = { populationSize: 8, generations: 2, workerCount: 2, seed: 71, mutationRate: .2, archiveLimit: 16, evaluationBudget: 16 };
    const inputs = [
      { id: 'L1-finite-subset', level: 1 as const, input: { representation: { kind: 'SET', dimensions: { universeSize: 8, length: 3 }, schemaVersion: 1 }, evaluator: { version: 1, constraints: [{ kind: 'cardinality', target: 3 }], objectives: [{ name: 'violations', direction: 'minimize', metric: 'violations' }], aggregation: 'pareto' }, semanticScope: 'textbook finite feasibility' } },
      { id: 'L2-forbidden-pairs', level: 2 as const, input: { representation: { kind: 'SET', dimensions: { universeSize: 12, length: 4 }, schemaVersion: 1 }, evaluator: { version: 1, constraints: [{ kind: 'forbidden-tuples', arity: 2, tuples: [[0, 1], [2, 3], [4, 5]] }, { kind: 'cardinality', target: 4 }], objectives: [{ name: 'violations', direction: 'minimize', metric: 'violations' }], aggregation: 'pareto' }, semanticScope: 'known finite construction' } },
      { id: 'L3-grid-small-case', level: 3 as const, input: { representation: { kind: 'SET', dimensions: { universeSize: 49, length: 7 }, schemaVersion: 1 }, evaluator: { version: 1, constraints: [{ kind: 'grid-no-three-in-line', boardSize: 7 }, { kind: 'cardinality', target: 7 }], objectives: [{ name: 'violations', direction: 'minimize', metric: 'violations' }], aggregation: 'pareto' }, semanticScope: 'solved small grid instance' } },
    ];
    for (const item of inputs) {
      const specification = makeDiscoverySpecification(projectId, item.input, 'USER_PROVIDED');
      try { const run = await new DiscoveryEngine(this.db).startSpecification(projectId, specification, config, signal); const feasible = run.status === 'COMPLETED' && run.archive.some((candidate) => candidate.violations === 0); cases.push({ id: item.id, level: item.level, status: feasible ? 'PASSED' : 'FAILED', evaluatorHash: specification.evaluatorHash, evaluations: run.totalEvaluated, detail: feasible ? 'A bounded evaluator found a feasible candidate; this is benchmark evidence, not a general theorem.' : run.error || 'No feasible candidate within the fixed budget.' }); }
      catch (error) { cases.push({ id: item.id, level: item.level, status: 'FAILED', evaluatorHash: specification.evaluatorHash, evaluations: 0, detail: error instanceof Error ? error.message : 'Benchmark execution failed.' }); }
    }
    const level4 = makeDiscoverySpecification(projectId, { representation: { kind: 'SET', dimensions: { universeSize: 71 * 71, length: 142 }, schemaVersion: 1 }, evaluator: { version: 1, constraints: [{ kind: 'grid-no-three-in-line', boardSize: 71 }, { kind: 'cardinality', target: 142 }], objectives: [{ name: 'violations', direction: 'minimize', metric: 'violations' }], aggregation: 'pareto' }, semanticScope: 'Open N71 construction representation only.' }, 'USER_PROVIDED');
    cases.push({ id: 'L4-n71-representation', level: 4, status: level4.validation.errors.length ? 'FAILED' : 'INCONCLUSIVE', evaluatorHash: level4.evaluatorHash, evaluations: 0, detail: 'Schema/evaluator validation only. It does not assert a solution to the open problem.' });
    const passed = cases.filter((item) => item.status === 'PASSED').length; const metrics = { solvedRate: passed / 3, formalProofRate: 0, counterexampleRate: 0, falseVerifiedRate: 0, evaluationCalls: cases.reduce((sum, item) => sum + item.evaluations, 0), wallClockMs: Date.now() - started };
    const run: BenchmarkRun = { id: randomUUID(), projectId, version: '2.0.0', startedAt: new Date(started).toISOString(), completedAt: new Date().toISOString(), cases, metrics }; this.db.saveRecord('benchmarkRuns', run); return run;
  }
}

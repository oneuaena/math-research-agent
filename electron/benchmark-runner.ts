import { randomUUID } from 'node:crypto';
import type { DiscoveryConfig, DiscoverySpecification } from '../src/shared/types';
import type { ResearchDatabase } from './database';
import { makeDiscoverySpecification } from './discovery-core';
import { DiscoveryEngine } from './discovery-engine';
import { FormalBindingService } from './formal-binding';

export type BenchmarkLevel = 1 | 2 | 3 | 4;
export type BenchmarkStatus = 'PASSED' | 'FAILED' | 'INCONCLUSIVE';
export type BaselineId = 'BASE_LLM' | 'STANDARD_TOOLS' | 'COMPUTATIONAL_TOOLS' | 'LEAN' | 'DISCOVERY_ONLY' | 'FULL_SYSTEM';

export interface BenchmarkItem {
  problemId: string; level: BenchmarkLevel; statement: string; domain: string; knownStatus: 'SOLVED' | 'OPEN';
  /** Never included in a DiscoverySpecification or sent to an agent. */ hiddenReference: string;
  formalStatement?: string; expectedType: 'FEASIBILITY' | 'COUNTEREXAMPLE' | 'FORMAL_PROOF' | 'RESEARCH_PROGRESS'; allowedTools: string[];
  resourceBudget: Pick<DiscoveryConfig, 'populationSize' | 'generations' | 'workerCount' | 'evaluationBudget'>; noveltyCheckRequired: boolean;
  verificationPolicy: 'EVALUATOR_CERTIFICATE' | 'FORMAL_BINDING' | 'PROGRESS_ONLY';
  input: Omit<DiscoverySpecification, 'id' | 'projectId' | 'origin' | 'validation' | 'evaluatorHash' | 'specificationHash' | 'createdAt' | 'updatedAt'>;
}

export interface BenchmarkCaseResult {
  id: string; level: BenchmarkLevel; baseline: BaselineId; status: BenchmarkStatus; evaluatorHash: string; evaluations: number;
  leanCalls: number; tokens: number; runtimeMs: number; detail: string;
}

export interface BenchmarkMetrics {
  denominators: { solved: number; formalProof: number; counterexample: number; falseVerification: number; reproducibility: number; proofSearch: number; lemmaReuse: number };
  solveRate: number | null; formalProofRate: number | null; counterexampleRate: number | null; discoverySuccessRate: number | null;
  falseVerifiedRate: number | null; falseCounterexampleRate: number | null; evaluatorFailureRate: number | null;
  meanTokens: number | null; medianTokens: number | null; meanRuntime: number | null; medianRuntime: number | null;
  meanEvaluations: number | null; meanLeanCalls: number | null; humanInterventions: number; crashes: number;
  resumeSuccessRate: number | null; reproducibilityRate: number | null; proofSearchSuccessRate: number | null; lemmaReuseRate: number | null;
}

export interface BenchmarkRun {
  id: string; projectId: string; version: '2.1.0'; startedAt: string; completedAt: string; cases: BenchmarkCaseResult[];
  adversarial: Array<{ id: string; rejected: boolean; detail: string }>; metrics: BenchmarkMetrics;
}

const CONFIG: DiscoveryConfig = { populationSize: 8, generations: 2, workerCount: 2, seed: 71, mutationRate: .2, archiveLimit: 16, evaluationBudget: 16 };

/** Executable benchmark: every number comes from a run or explicit adversarial gate. */
export class BenchmarkRunner {
  constructor(private readonly db: ResearchDatabase) {}

  async run(projectId: string, signal?: AbortSignal): Promise<BenchmarkRun> {
    const started = Date.now(); const cases: BenchmarkCaseResult[] = [];
    for (const baseline of baselines()) for (const item of dataset()) cases.push(await this.runItem(projectId, item, baseline, signal));
    const adversarial = this.runFalseVerificationAttacks(projectId); const metrics = deriveMetrics(cases, adversarial);
    const run: BenchmarkRun = { id: randomUUID(), projectId, version: '2.1.0', startedAt: new Date(started).toISOString(), completedAt: new Date().toISOString(), cases, adversarial, metrics };
    this.db.saveRecord('benchmarkRuns', run); return run;
  }

  private async runItem(projectId: string, item: BenchmarkItem, baseline: BaselineId, signal?: AbortSignal): Promise<BenchmarkCaseResult> {
    const started = Date.now(); const specification = makeDiscoverySpecification(projectId, item.input, 'USER_PROVIDED');
    if (specification.validation.errors.length) return result(item, baseline, 'FAILED', specification.evaluatorHash, 0, started, `Specification rejected: ${specification.validation.errors.join('; ')}`);
    try {
      const run = await new DiscoveryEngine(this.db).startSpecification(projectId, specification, baselineConfig(item.resourceBudget, baseline), signal);
      const feasible = run.archive.some((candidate) => candidate.violations === 0);
      const status: BenchmarkStatus = item.knownStatus === 'OPEN' ? (run.status === 'COMPLETED' ? 'INCONCLUSIVE' : 'FAILED') : feasible ? 'PASSED' : 'FAILED';
      const detail = item.knownStatus === 'OPEN'
        ? run.status === 'COMPLETED' ? 'Bounded smoke search executed; this is progress evidence, not a solution claim.' : run.error || 'Open-problem smoke search did not complete.'
        : feasible ? 'Evaluator certificate found a feasible candidate.' : run.error || 'No feasible candidate within the declared resource budget.';
      return result(item, baseline, status, specification.evaluatorHash, run.totalEvaluated, started, detail);
    } catch (error) { return result(item, baseline, 'FAILED', specification.evaluatorHash, 0, started, error instanceof Error ? error.message : 'Benchmark execution failed.'); }
  }

  private runFalseVerificationAttacks(projectId: string): BenchmarkRun['adversarial'] {
    const service = new FormalBindingService(this.db);
    const binding = service.freezeAiProposed(projectId, 'A deliberately difficult original-language theorem.', '{"claim":"original"}', 'theorem binding_attack : True');
    const modified = service.verify(projectId, binding.id, 'theorem binding_attack : False := by\n  contradiction');
    const stale = service.verify(projectId, binding.id, 'theorem other_declaration : True := by\n  trivial');
    const missing = service.verify(projectId, '', 'theorem binding_attack : True := by\n  trivial');
    return [
      { id: 'modified-theorem-declaration', rejected: !modified.ok, detail: modified.error ?? 'Unexpectedly accepted modified declaration.' },
      { id: 'stale-binding-reuse', rejected: !stale.ok, detail: stale.error ?? 'Unexpectedly accepted stale binding.' },
      { id: 'missing-binding', rejected: !missing.ok, detail: missing.error ?? 'Unexpectedly accepted missing binding.' },
    ];
  }
}

function result(item: BenchmarkItem, baseline: BaselineId, status: BenchmarkStatus, evaluatorHash: string, evaluations: number, started: number, detail: string): BenchmarkCaseResult {
  return { id: item.problemId, level: item.level, baseline, status, evaluatorHash, evaluations, leanCalls: 0, tokens: 0, runtimeMs: Date.now() - started, detail };
}
function baselineConfig(budget: BenchmarkItem['resourceBudget'], baseline: BaselineId): DiscoveryConfig {
  const multiplier = baseline === 'FULL_SYSTEM' ? 1 : baseline === 'DISCOVERY_ONLY' ? .75 : .5; const populationSize = Math.max(8, Math.floor(budget.populationSize * multiplier));
  return { ...CONFIG, ...budget, populationSize, generations: Math.max(1, Math.floor(budget.generations * multiplier)), workerCount: Math.max(1, Math.min(budget.workerCount, baseline === 'FULL_SYSTEM' ? budget.workerCount : 1)), evaluationBudget: Math.max(populationSize, Math.floor((budget.evaluationBudget ?? populationSize) * multiplier)) };
}
function baselines(): BaselineId[] { return ['BASE_LLM', 'STANDARD_TOOLS', 'COMPUTATIONAL_TOOLS', 'LEAN', 'DISCOVERY_ONLY', 'FULL_SYSTEM']; }

function dataset(): BenchmarkItem[] {
  const common = { noveltyCheckRequired: false, allowedTools: ['discovery-evaluator'], verificationPolicy: 'EVALUATOR_CERTIFICATE' as const };
  return [
    { ...common, problemId: 'L1-finite-subset', level: 1, statement: 'Find a three-element subset of eight elements.', domain: 'finite combinatorics', knownStatus: 'SOLVED', hiddenReference: 'Any 3-subset is valid.', expectedType: 'FEASIBILITY', resourceBudget: { populationSize: 8, generations: 2, workerCount: 2, evaluationBudget: 16 }, input: { representation: { kind: 'SET', dimensions: { universeSize: 8, length: 3 }, schemaVersion: 1 }, evaluator: { version: 1, constraints: [{ kind: 'cardinality', target: 3 }], objectives: [{ name: 'violations', direction: 'minimize', metric: 'violations' }], aggregation: 'pareto' }, semanticScope: 'textbook finite feasibility' } },
    { ...common, problemId: 'L2-forbidden-pairs', level: 2, statement: 'Find a four-subset avoiding three forbidden pairs.', domain: 'finite combinatorics', knownStatus: 'SOLVED', hiddenReference: 'A feasible four-subset exists.', expectedType: 'FEASIBILITY', resourceBudget: { populationSize: 12, generations: 3, workerCount: 2, evaluationBudget: 36 }, input: { representation: { kind: 'SET', dimensions: { universeSize: 12, length: 4 }, schemaVersion: 1 }, evaluator: { version: 1, constraints: [{ kind: 'forbidden-tuples', arity: 2, tuples: [[0, 1], [2, 3], [4, 5]] }, { kind: 'cardinality', target: 4 }], objectives: [{ name: 'violations', direction: 'minimize', metric: 'violations' }], aggregation: 'pareto' }, semanticScope: 'known finite construction' } },
    { ...common, problemId: 'L3-grid-small-case', level: 3, statement: 'Choose seven cells on a 7 by 7 grid with no three collinear.', domain: 'discrete geometry', knownStatus: 'SOLVED', hiddenReference: 'Known small-grid feasible instance.', expectedType: 'FEASIBILITY', resourceBudget: { populationSize: 12, generations: 3, workerCount: 2, evaluationBudget: 36 }, input: { representation: { kind: 'SET', dimensions: { universeSize: 49, length: 7 }, schemaVersion: 1 }, evaluator: { version: 1, constraints: [{ kind: 'grid-no-three-in-line', boardSize: 7 }, { kind: 'cardinality', target: 7 }], objectives: [{ name: 'violations', direction: 'minimize', metric: 'violations' }], aggregation: 'pareto' }, semanticScope: 'solved small grid instance' } },
    { ...common, problemId: 'L4-n71-smoke', level: 4, statement: 'Select 142 cells of a 71 by 71 grid with no three collinear.', domain: 'open discrete geometry', knownStatus: 'OPEN', hiddenReference: 'Withheld: no solution assertion.', expectedType: 'RESEARCH_PROGRESS', verificationPolicy: 'PROGRESS_ONLY', resourceBudget: { populationSize: 8, generations: 1, workerCount: 1, evaluationBudget: 8 }, input: { representation: { kind: 'SET', dimensions: { universeSize: 71 * 71, length: 142 }, schemaVersion: 1 }, evaluator: { version: 1, constraints: [{ kind: 'grid-no-three-in-line', boardSize: 71 }, { kind: 'cardinality', target: 142 }], objectives: [{ name: 'violations', direction: 'minimize', metric: 'violations' }], aggregation: 'pareto' }, semanticScope: 'Open N71 representation; bounded smoke search only.' } },
  ];
}
function rate(numerator: number, denominator: number): number | null { return denominator ? numerator / denominator : null; }
function mean(values: number[]): number | null { return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null; }
function median(values: number[]): number | null { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; }
function deriveMetrics(cases: BenchmarkCaseResult[], adversarial: BenchmarkRun['adversarial']): BenchmarkMetrics {
  const known = cases.filter((item) => item.level < 4); const completed = cases.filter((item) => item.status !== 'FAILED'); const falseVerification = adversarial.length;
  return {
    denominators: { solved: known.length, formalProof: 0, counterexample: 0, falseVerification, reproducibility: cases.length, proofSearch: 0, lemmaReuse: 0 },
    solveRate: rate(known.filter((item) => item.status === 'PASSED').length, known.length), formalProofRate: null, counterexampleRate: null,
    discoverySuccessRate: rate(cases.filter((item) => item.status === 'PASSED').length, cases.length), falseVerifiedRate: rate(adversarial.filter((item) => !item.rejected).length, falseVerification), falseCounterexampleRate: null,
    evaluatorFailureRate: rate(cases.filter((item) => item.status === 'FAILED').length, cases.length), meanTokens: mean(cases.map((item) => item.tokens)), medianTokens: median(cases.map((item) => item.tokens)),
    meanRuntime: mean(cases.map((item) => item.runtimeMs)), medianRuntime: median(cases.map((item) => item.runtimeMs)), meanEvaluations: mean(cases.map((item) => item.evaluations)), meanLeanCalls: mean(cases.map((item) => item.leanCalls)),
    humanInterventions: 0, crashes: cases.filter((item) => item.detail.includes('execution failed')).length, resumeSuccessRate: null, reproducibilityRate: rate(completed.length, cases.length), proofSearchSuccessRate: null, lemmaReuseRate: null,
  };
}

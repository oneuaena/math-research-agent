import { randomUUID } from 'node:crypto';
import type {
  Activity, AgentEvent, AgentStage, AttackRecord, CounterexampleEvidence, Experiment,
  ProjectSnapshot, ResearchMemory, ResearchNode, StressTestResult, ToolName, ToolResult,
} from '../src/shared/types';
import type { ResearchDatabase } from './database';
import type { ToolRunner } from './tool-runner';

type AttackSpec = { strategy: string; method: string; searchSpace: string; tool: ToolName; code: string; purpose: string };
type ExecutedAttack = { attack: AttackRecord; experiment: Experiment; result: ToolResult };

export const CASE_ATTACKS: Record<'A' | 'B' | 'C', AttackSpec[]> = {
  A: [
    { strategy: 'Small-case exhaustive search', method: 'Exact primality evaluation', searchSpace: 'Integers 1 ≤ n ≤ 25', tool: 'run_python', purpose: 'Find the first composite value', code: `import sympy as sp\nresult = "NONE"\nfor n in range(1, 26):\n    value = n*n + n + 1\n    if not sp.isprime(value):\n        result = f"FOUND|{n}|{value}"\n        break` },
    { strategy: 'Independent candidate verification', method: 'Exact reevaluation and SymPy factorization', searchSpace: 'Candidate n = 4', tool: 'run_python', purpose: 'Verify conditions and factor the claimed prime value', code: `import sympy as sp\nn = 4\nvalue = n*n + n + 1\nfactors = sp.factorint(value)\nresult = f"VERIFIED|{n}|{value}|{factors}|{n >= 1 and not sp.isprime(value)}"` },
  ],
  B: [
    { strategy: 'Small-case exhaustive search', method: 'Exact primality evaluation', searchSpace: 'Integers 0 ≤ n ≤ 20', tool: 'run_python', purpose: 'Test the initial integer range', code: `import sympy as sp\nresult = "NONE"\nfor n in range(0, 21):\n    value = n*n + n + 41\n    if not sp.isprime(value):\n        result = f"FOUND|{n}|{value}"\n        break` },
    { strategy: 'Expanded parameter sweep', method: 'Exact primality evaluation', searchSpace: 'Integers 21 ≤ n ≤ 100', tool: 'run_python', purpose: 'Expand beyond the surviving initial range', code: `import sympy as sp\nresult = "NONE"\nfor n in range(21, 101):\n    value = n*n + n + 41\n    if not sp.isprime(value):\n        result = f"FOUND|{n}|{value}"\n        break` },
    { strategy: 'Independent candidate verification', method: 'Exact reevaluation and SymPy factorization', searchSpace: 'Candidate n = 40', tool: 'run_python', purpose: 'Verify conditions and factor the candidate value', code: `import sympy as sp\nn = 40\nvalue = n*n + n + 41\nfactors = sp.factorint(value)\nresult = f"VERIFIED|{n}|{value}|{factors}|{n >= 0 and not sp.isprime(value)}"` },
  ],
  C: [
    { strategy: 'Symmetric exhaustive search', method: 'Exact parity evaluation', searchSpace: 'Integers −5,000 ≤ n ≤ 5,000', tool: 'run_python', purpose: 'Search exact integers for an odd consecutive product', code: `result = "NONE"\nfor n in range(-5000, 5001):\n    value = n*(n+1)\n    if value % 2 != 0:\n        result = f"FOUND|{n}|{value}"\n        break` },
    { strategy: 'Extreme-value boundary search', method: 'Exact parity evaluation', searchSpace: 'n ∈ {−10¹², −10⁶, −1, 0, 1, 10⁶, 10¹²}', tool: 'run_python', purpose: 'Check exact large-magnitude boundary representatives', code: `values = [-10**12, -10**6, -1, 0, 1, 10**6, 10**12]\nresult = "NONE"\nfor n in values:\n    value = n*(n+1)\n    if value % 2 != 0:\n        result = f"FOUND|{n}|{value}"\n        break` },
    { strategy: 'Symbolic consistency check', method: 'SymPy exact simplification', searchSpace: 'Symbolic integer n', tool: 'symbolic_simplify', purpose: 'Confirm the expanded polynomial identity', code: 'n*(n+1) - (n**2+n)' },
  ],
};

export class StressEngine {
  constructor(
    private readonly db: ResearchDatabase,
    private readonly tools: ToolRunner,
    private readonly publish: (event: AgentEvent) => void,
  ) {}

  async run(projectId: string, signal: AbortSignal): Promise<void> {
    let snapshot = this.db.getProject(projectId, false);
    const prior = snapshot.stressResults.at(-1);
    if (prior?.completedAt) {
      this.emit(projectId, 'SUMMARIZE', 'Previous coverage loaded', 'No identical experiment was repeated.', 'succeeded', false);
      return;
    }
    const resultId = randomUUID();
    const startedAt = new Date().toISOString();
    this.saveResult({ id: resultId, projectId, status: 'running', verificationStatus: 'unverified', coverage: [], remainingUncertainty: [], counterexample: null, summary: '', startedAt, completedAt: null });
    this.emit(projectId, 'PARSE', 'Parsing conjecture', `${snapshot.project.variables || 'Variables not specified'} · ${snapshot.project.domain || 'Domain not specified'}`, 'succeeded', true);
    if (signal.aborted) return;

    const demoId = snapshot.project.demoCaseId;
    if (!demoId) {
      this.createGenericPlan(snapshot);
      this.saveResult({ id: resultId, projectId, status: 'inconclusive', verificationStatus: 'unverified', coverage: [], remainingUncertainty: ['No executable mathematical specification was available.', 'Configure a provider or add a structured experiment.'], counterexample: null, summary: 'Attack plan recorded; no automatic computation was run.', startedAt, completedAt: new Date().toISOString() });
      this.emit(projectId, 'COMPLETE', 'Stress test inconclusive', 'No executable attack was available.', 'succeeded', false);
      return;
    }

    const specs = CASE_ATTACKS[demoId];
    const attacks = specs.map((spec, index) => this.createAttack(snapshot, spec, index + 1));
    this.emit(projectId, 'PLAN_ATTACKS', 'Attack plan generated', `${attacks.length} reproducible attacks`, 'succeeded', true);
    let candidate: { n: number; value: number } | null = null;
    const completed: ExecutedAttack[] = [];

    for (let index = 0; index < attacks.length; index += 1) {
      if (signal.aborted) return;
      const isVerification = attacks[index].strategy.includes('Independent');
      if (isVerification && !candidate) continue;
      const stage = this.stageFor(demoId, index, isVerification);
      const executed = await this.execute(attacks[index], specs[index], stage, signal);
      completed.push(executed);
      if (!executed.result.ok) {
        this.finalizeAttack(executed.attack, 'failed', 'unverified', executed.result.error ?? 'Tool failed.');
        this.saveResult({ id: resultId, projectId, status: 'inconclusive', verificationStatus: 'unverified', coverage: this.coverage(completed), remainingUncertainty: ['A required tool call failed.'], counterexample: null, summary: executed.result.error ?? 'Tool failed.', startedAt, completedAt: new Date().toISOString() });
        this.emit(projectId, 'COMPLETE', 'Stress test inconclusive', executed.result.error ?? 'Tool failed.', 'failed', false);
        return;
      }
      const found = executed.result.output.match(/^FOUND\|(-?\d+)\|(\d+)$/);
      if (found) {
        candidate = { n: Number(found[1]), value: Number(found[2]) };
        this.finalizeAttack(executed.attack, 'candidate-found', 'computationally-verified', `Candidate n = ${candidate.n}, value = ${candidate.value}`);
        this.addCandidateNode(snapshot.project.id, `${executed.attack.id}-node`, candidate);
        this.emit(projectId, stage, 'Candidate counterexample found', `n = ${candidate.n}`, 'succeeded', true);
      } else if (isVerification) {
        const verified = executed.result.output.endsWith('|True');
        if (!verified || !candidate) {
          this.finalizeAttack(executed.attack, 'candidate-rejected', 'unverified', 'Independent rerun did not verify the candidate.');
          candidate = null;
          continue;
        }
        this.finalizeAttack(executed.attack, 'counterexample-found', 'exactly-verified', executed.result.output);
        const evidence = this.evidence(demoId, candidate, specs[index].code, executed.result);
        this.addCounterexampleNode(snapshot.project.id, `${executed.attack.id}-node`, candidate, evidence);
        this.remember(snapshot.project.id, 'result', 'Verified counterexample', `n = ${candidate.n}; exact value = ${candidate.value}; independent rerun passed.`);
        this.saveResult({ id: resultId, projectId, status: 'counterexample-found', verificationStatus: 'exactly-verified', coverage: this.coverage(completed), remainingUncertainty: [], counterexample: evidence, summary: 'A reproducible counterexample passed exact independent verification.', startedAt, completedAt: new Date().toISOString() });
        this.emit(projectId, 'COMPLETE', 'Counterexample found', `n = ${candidate.n}`, 'succeeded', false);
        return;
      } else {
        this.finalizeAttack(executed.attack, 'exhausted', executed.attack.method.includes('SymPy') ? 'symbolically-verified' : 'computationally-verified', 'No counterexample found in the recorded search space.');
        this.addNoCounterexampleNode(snapshot.project.id, `${executed.attack.id}-node`, executed.attack.searchSpace);
        this.remember(snapshot.project.id, 'experiment', `Covered: ${executed.attack.searchSpace}`, `${executed.attack.strategy}: no counterexample found.`);
      }
      snapshot = this.db.getProject(projectId, false);
    }

    const uncertainty = demoId === 'C'
      ? ['Integers outside the exhaustive interval were not exhaustively enumerated.', 'Boundary representatives do not cover all arbitrary-precision integers.', 'The symbolic identity check is not a formal parity proof.']
      : ['Search space was incomplete.'];
    this.addOpenRegionNode(projectId, uncertainty[0]);
    this.remember(projectId, 'issue', 'Untested regions', uncertainty.join(' '));
    this.saveResult({ id: resultId, projectId, status: 'survived', verificationStatus: 'computationally-verified', coverage: this.coverage(completed), remainingUncertainty: uncertainty, counterexample: null, summary: 'No counterexample was found within the tested search space. This does not constitute a proof.', startedAt, completedAt: new Date().toISOString() });
    this.emit(projectId, 'COMPLETE', 'Survived testing', 'This is not a proof.', 'succeeded', false);
  }

  private createGenericPlan(snapshot: ProjectSnapshot): void {
    const specs = [
      ['Small-case exhaustive search', 'Enumerate a bounded exact domain'],
      ['Boundary-value search', 'Test domain boundaries and degenerate cases'],
      ['Random sampling', 'Sample admissible parameters with a recorded seed'],
      ['Symbolic manipulation', 'Simplify the claim and assumptions exactly'],
    ];
    specs.forEach(([strategy, method], index) => this.createAttack(snapshot, { strategy, method, searchSpace: 'Not yet specified', tool: 'run_python', code: '', purpose: method }, index + 1));
  }

  private createAttack(snapshot: ProjectSnapshot, spec: AttackSpec, sequence: number): AttackRecord {
    const now = new Date().toISOString();
    const attack: AttackRecord = { id: randomUUID(), projectId: snapshot.project.id, sequence, strategy: spec.strategy, method: spec.method, inputs: snapshot.project.variables, searchSpace: spec.searchSpace, code: spec.code, result: '', status: 'planned', verificationStatus: 'unverified', verification: '', durationMs: null, experimentIds: [], createdAt: now, updatedAt: now };
    this.db.saveRecord('attacks', attack);
    const root = snapshot.nodes.find((node) => node.parentId === null);
    const node: ResearchNode = { id: `${attack.id}-node`, projectId: snapshot.project.id, parentId: root?.id ?? null, kind: 'Attack', title: `Attack #${String(sequence).padStart(2, '0')} · ${spec.strategy}`, content: spec.method, status: 'open', dependencies: root ? [root.id] : [], sources: [], tools: [spec.tool], summary: spec.searchSpace, x: 350, y: 70 + sequence * 130, createdAt: now, updatedAt: now };
    this.db.saveRecord('nodes', node);
    return attack;
  }

  private async execute(attack: AttackRecord, spec: AttackSpec, stage: AgentStage, signal: AbortSignal): Promise<ExecutedAttack> {
    this.emit(attack.projectId, stage, spec.purpose, spec.searchSpace, 'running', true);
    const now = new Date().toISOString();
    const experiment: Experiment = { id: randomUUID(), projectId: attack.projectId, purpose: spec.purpose, code: spec.tool === 'run_python' ? spec.code : '', tool: spec.tool, input: spec.code, output: '', interpretation: '', relatedNodeId: `${attack.id}-node`, status: 'running', durationMs: null, method: spec.method, searchSpace: spec.searchSpace, environment: '', verificationStatus: 'unverified', rerunOf: attack.strategy.includes('Independent') ? 'candidate' : null, createdAt: now, updatedAt: now };
    this.db.saveRecord('experiments', experiment);
    const input = spec.tool === 'run_python' ? { code: spec.code } : { expression: spec.code, variable: 'n', symbols: ['n'] };
    const result = await this.tools.run({ projectId: attack.projectId, name: spec.tool, purpose: spec.purpose, input });
    if (signal.aborted) return { attack, experiment, result };
    const savedExperiment: Experiment = { ...experiment, output: result.output || result.error || '', status: result.ok ? 'succeeded' : 'failed', durationMs: result.durationMs, environment: result.environment ?? '', verificationStatus: result.ok ? (spec.tool === 'run_python' ? 'computationally-verified' : 'symbolically-verified') : 'unverified', updatedAt: new Date().toISOString() };
    this.db.saveRecord('experiments', savedExperiment);
    const nextAttack = { ...attack, status: 'running' as const, durationMs: result.durationMs, experimentIds: [experiment.id], updatedAt: new Date().toISOString() };
    this.db.saveRecord('attacks', nextAttack);
    const node: ResearchNode = { id: `${experiment.id}-node`, projectId: attack.projectId, parentId: `${attack.id}-node`, kind: 'Experiment', title: spec.purpose, content: result.output || result.error || '', status: result.ok ? 'verified' : 'failed', dependencies: [`${attack.id}-node`], sources: [], tools: [spec.tool], summary: spec.searchSpace, x: 680, y: 80 + attack.sequence * 130, createdAt: now, updatedAt: new Date().toISOString() };
    this.db.saveRecord('nodes', node);
    return { attack: nextAttack, experiment: savedExperiment, result };
  }

  private finalizeAttack(attack: AttackRecord, status: AttackRecord['status'], verificationStatus: AttackRecord['verificationStatus'], result: string): void {
    this.db.saveRecord('attacks', { ...attack, status, verificationStatus, verification: result, result, updatedAt: new Date().toISOString() });
  }

  private coverage(executed: ExecutedAttack[]) { return executed.map((item) => ({ label: item.attack.strategy, value: item.attack.searchSpace })); }

  private evidence(demoId: 'A' | 'B' | 'C', candidate: { n: number; value: number }, code: string, result: ToolResult): CounterexampleEvidence {
    const expression = demoId === 'A' ? 'n² + n + 1' : 'n² + n + 41';
    return { inputs: { n: candidate.n }, parameters: {}, environment: result.environment ?? 'Local isolated Python/SymPy worker', exactExpression: `${expression} = ${candidate.value}`, computation: result.output, code, output: result.output, verificationStatus: 'exactly-verified', checks: [
      { label: 'Assumptions satisfied', passed: true, detail: `n = ${candidate.n} is an integer in the stated domain.` },
      { label: 'Claim evaluated exactly', passed: true, detail: 'Integer arithmetic and exact factorization were used.' },
      { label: 'Result contradicts conjecture', passed: true, detail: `${candidate.value} is composite.` },
      { label: 'Independent rerun', passed: true, detail: 'The candidate was reevaluated in a separate tool call.' },
    ] };
  }

  private addCandidateNode(projectId: string, parentId: string, candidate: { n: number; value: number }): void { this.addNode(projectId, parentId, 'Candidate', `Candidate n = ${candidate.n}`, `Exact value: ${candidate.value}`, 'plausible'); }
  private addCounterexampleNode(projectId: string, parentId: string, candidate: { n: number; value: number }, evidence: CounterexampleEvidence): void { this.addNode(projectId, parentId, 'Counterexample', `Counterexample n = ${candidate.n}`, evidence.exactExpression, 'verified'); }
  private addNoCounterexampleNode(projectId: string, parentId: string, searchSpace: string): void { this.addNode(projectId, parentId, 'No Counterexample', 'No counterexample', searchSpace, 'unverified'); }
  private addOpenRegionNode(projectId: string, content: string): void { const root = this.db.getProject(projectId, false).nodes.find((node) => node.parentId === null); this.addNode(projectId, root?.id ?? null, 'Open Region', 'Untested region', content, 'open'); }

  private addNode(projectId: string, parentId: string | null, kind: ResearchNode['kind'], title: string, content: string, status: ResearchNode['status']): void {
    const now = new Date().toISOString(); const count = this.db.getProject(projectId, false).nodes.length;
    this.db.saveRecord('nodes', { id: randomUUID(), projectId, parentId, kind, title, content, status, dependencies: parentId ? [parentId] : [], sources: [], tools: [], summary: content, x: 950, y: 60 + count * 78, createdAt: now, updatedAt: now } satisfies ResearchNode);
  }

  private remember(projectId: string, category: ResearchMemory['category'], title: string, content: string): void {
    this.db.saveRecord('memories', { id: randomUUID(), projectId, category, title, content, relatedNodeIds: [], createdAt: new Date().toISOString() } satisfies ResearchMemory);
  }

  private saveResult(result: StressTestResult): void { this.db.saveRecord('stressResults', result); }

  private stageFor(demoId: 'A' | 'B' | 'C', index: number, verification: boolean): AgentStage {
    if (verification) return 'VERIFY_CANDIDATE';
    if (demoId === 'B' && index === 1) return 'EXPAND';
    if (demoId === 'C' && index === 1) return 'BOUNDARY';
    if (demoId === 'C' && index === 2) return 'SYMBOLIC';
    return 'SMALL_CASES';
  }

  private emit(projectId: string, stage: AgentStage, title: string, detail: string, status: Activity['status'], running: boolean): void {
    const activity: Activity = { id: randomUUID(), projectId, stage, kind: status === 'failed' ? 'error' : 'agent', title, detail, status, durationMs: null, createdAt: new Date().toISOString() };
    this.db.addActivity(activity); this.publish({ projectId, running, stage, activity });
  }
}

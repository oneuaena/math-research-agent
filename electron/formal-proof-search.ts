import { randomUUID } from 'node:crypto';
import type { FormalProofSearchRun, KnowledgeRecord, ToolResult } from '../src/shared/types';
import type { ResearchDatabase } from './database';
import { FormalBindingService } from './formal-binding';
import type { ToolRunner } from './tool-runner';
import { ResourceBudgetService } from './resource-budget';

const SAFE_TACTICS = new Set(['rfl', 'simp', 'simpa', 'aesop', 'omega', 'linarith', 'norm_num', 'ring', 'ring_nf', 'positivity', 'constructor', 'assumption', 'decide', 'exact', 'apply', 'intro', 'intros', 'cases', 'induction', 'rw']);
const DEFAULT_TACTICS = ['rfl', 'simp', 'simpa', 'norm_num', 'decide', 'omega', 'linarith', 'ring', 'aesop'];

export class FormalProofSearchEngine {
  constructor(private readonly db: ResearchDatabase, private readonly tools: ToolRunner) {}

  /**
   * Tests constrained Lean tactic scripts against a frozen declaration. Every
   * successful branch is independently accepted by Lean before certification.
   * Incomplete branches remain recorded observations, never proofs.
   */
  async run(projectId: string, bindingId: string, proposals: string[], maxAttempts: number, signal?: AbortSignal): Promise<FormalProofSearchRun> {
    const bindingService = new FormalBindingService(this.db);
    const binding = this.db.getProject(projectId, false).formalBindings.find((item) => item.id === bindingId);
    if (!binding) throw new Error('FORMAL_BINDING_REQUIRED: formal proof search needs a frozen binding.');
    if (binding.status === 'INVALID') throw new Error('FORMAL_BINDING_INVALID: cannot search against an invalidated binding.');
    const createdAt = new Date().toISOString();
    let run: FormalProofSearchRun = { id: randomUUID(), projectId, bindingId, status: 'RUNNING', goalState: '', attemptedTactics: [], beam: [], totalAttempts: 0, maxAttempts: Math.max(1, Math.min(128, maxAttempts)), startedAt: createdAt, updatedAt: createdAt, completedAt: null, error: '' };
    this.db.saveRecord('formalProofSearchRuns', run);
    const probe = await this.check(projectId, bindingId, `${binding.leanStatement} := by\n  exact ?_`);
    run.goalState = compactOutput(probe);
    const candidates = [...new Set([...proposals, ...DEFAULT_TACTICS])].filter(validTactic).slice(0, run.maxAttempts);
    try {
      for (const script of candidates) {
        if (signal?.aborted) throw new Error('CANCELLED');
        new ResourceBudgetService(this.db).consume(projectId, 'proofAttempts', 1);
        const source = `${binding.leanStatement} := by\n  ${script.replace(/\n/g, '\n  ')}`;
        const preflight = bindingService.verify(projectId, bindingId, source);
        if (!preflight.ok) throw new Error(preflight.error);
        const result = await this.check(projectId, bindingId, source);
        const status = result.ok ? 'VERIFIED' as const : 'PARTIAL' as const;
        const output = compactOutput(result); const remainingGoals = countGoals(output);
        run.attemptedTactics.push({ script, status, output, remainingGoals });
        run.totalAttempts += 1;
        if (result.ok) {
          bindingService.certify(projectId, bindingId, source, result.output || result.stdout);
          run = { ...run, status: 'COMPLETED', beam: [{ script, remainingGoals: 0, score: Number.MAX_SAFE_INTEGER }], updatedAt: new Date().toISOString(), completedAt: new Date().toISOString() };
          this.db.saveRecord('formalProofSearchRuns', run);
          return run;
        }
        const beam = [...run.beam, { script, remainingGoals, score: -remainingGoals }].sort((a, b) => b.score - a.score || a.script.localeCompare(b.script)).slice(0, 12);
        run = { ...run, beam, updatedAt: new Date().toISOString() };
        this.db.saveRecord('formalProofSearchRuns', run);
      }
      const error = 'No tactic script closed the frozen Lean goal within the bounded proof-search budget.';
      run = { ...run, status: 'FAILED', error, updatedAt: new Date().toISOString(), completedAt: new Date().toISOString() };
      this.db.saveRecord('formalProofSearchRuns', run);
      this.recordFailedState(projectId, run);
      return run;
    } catch (error) {
      const paused = signal?.aborted || error instanceof Error && error.message === 'CANCELLED';
      run = { ...run, status: paused ? 'PAUSED' : 'FAILED', error: paused ? 'CANCELLED: checkpoint retained for resume.' : error instanceof Error ? error.message : 'Formal proof search failed.', updatedAt: new Date().toISOString(), completedAt: paused ? null : new Date().toISOString() };
      this.db.saveRecord('formalProofSearchRuns', run);
      if (!paused) this.recordFailedState(projectId, run);
      return run;
    }
  }

  private async check(projectId: string, bindingId: string, code: string): Promise<ToolResult> {
    return this.tools.run({ projectId, name: 'lean_check', purpose: 'Bounded formal proof search candidate', input: { bindingId, code } });
  }

  private recordFailedState(projectId: string, run: FormalProofSearchRun): void {
    const now = new Date().toISOString();
    const record: KnowledgeRecord = { id: randomUUID(), projectId, kind: 'FAILED_PROOF_STATE', title: 'Failed Lean proof-search state', content: JSON.stringify({ bindingId: run.bindingId, goalState: run.goalState, attemptedTactics: run.attemptedTactics }), hashes: {}, relatedIds: [run.id, run.bindingId], verificationStatus: 'unverified', createdAt: now, updatedAt: now };
    this.db.saveRecord('knowledgeRecords', record);
  }
}

export function validTactic(value: string): boolean {
  const script = value.trim();
  if (!script || script.length > 2_000 || /(?:sorry|admit|axiom|unsafe|run_tac|#eval|#check|\bimport\b|\bopen\b)/i.test(script)) return false;
  return script.split(/\r?\n/).every((line) => {
    const command = line.trim().split(/[\s[(]/, 1)[0]; return SAFE_TACTICS.has(command);
  });
}
function countGoals(output: string): number { return Math.max(1, (output.match(/⊢/g) ?? []).length); }
function compactOutput(result: ToolResult): string { return [result.output, result.stdout, result.stderr, result.error].filter(Boolean).join('\n').slice(0, 12_000); }

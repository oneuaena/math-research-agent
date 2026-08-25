import { randomUUID } from 'node:crypto';
import type { FormalProofSearchRun, KnowledgeRecord } from '../src/shared/types';
import type { ResearchDatabase } from './database';
import { FormalBindingService } from './formal-binding';
import { LeanReplayAdapter, type ReplayedProofState } from './formal-proof/lean-replay-adapter';
import type { ToolRunner } from './tool-runner';
import { ResourceBudgetService } from './resource-budget';

const SAFE_TACTICS = new Set(['rfl', 'simp', 'simpa', 'aesop', 'omega', 'linarith', 'norm_num', 'ring', 'ring_nf', 'positivity', 'constructor', 'assumption', 'decide', 'exact', 'apply', 'intro', 'intros', 'cases', 'induction', 'rw']);
const DEFAULT_TACTICS = ['rfl', 'simp', 'simpa', 'norm_num', 'decide', 'omega', 'linarith', 'ring', 'aesop'];
const BEAM_WIDTH = 12; const MAX_DEPTH = 8;

/**
 * Bounded proof-state beam search.  Each node is a deterministic Lean replay
 * of an accepted tactic prefix; only a separate no-sorry kernel check can
 * close and certify the frozen declaration.
 */
export class FormalProofSearchEngine {
  constructor(private readonly db: ResearchDatabase, private readonly tools: ToolRunner) {}

  async run(projectId: string, bindingId: string, proposals: string[], maxAttempts: number, signal?: AbortSignal): Promise<FormalProofSearchRun> {
    const bindingService = new FormalBindingService(this.db); const snapshot = this.db.getProject(projectId, false);
    const binding = snapshot.formalBindings.find((item) => item.id === bindingId);
    if (!binding) throw new Error('FORMAL_BINDING_REQUIRED: formal proof search needs a frozen binding.');
    if (binding.status === 'INVALID') throw new Error('FORMAL_BINDING_INVALID: cannot search against an invalidated binding.');
    const createdAt = new Date().toISOString(); const max = Math.max(1, Math.min(128, maxAttempts));
    let run: FormalProofSearchRun = { id: randomUUID(), projectId, bindingId, status: 'RUNNING', goalState: '', attemptedTactics: [], beam: [], totalAttempts: 0, maxAttempts: max, startedAt: createdAt, updatedAt: createdAt, completedAt: null, error: '' };
    this.db.saveRecord('formalProofSearchRuns', run);
    const adapter = new LeanReplayAdapter(this.tools);
    try {
      const root = await adapter.root(projectId, bindingId, binding.leanStatement);
      if (!root) throw new Error('LEAN_REPLAY_UNAVAILABLE: Lean did not return a replayable root proof state.');
      run = { ...run, goalState: root.rawTrace, beam: [toBeam(root)], updatedAt: new Date().toISOString() }; this.db.saveRecord('formalProofSearchRuns', run);
      const candidates = [...new Set([...proposals, ...DEFAULT_TACTICS])].filter(validTactic).slice(0, max);
      const seen = new Set([root.stateHash]); let frontier = [root];
      while (frontier.length && run.totalAttempts < max) {
        if (signal?.aborted) throw new Error('CANCELLED');
        const expanded: ReplayedProofState[] = [];
        for (const state of frontier) {
          if (state.depth >= MAX_DEPTH || run.totalAttempts >= max) continue;
          for (const tactic of candidates) {
            if (signal?.aborted) throw new Error('CANCELLED'); if (run.totalAttempts >= max) break;
            const history = [...state.tacticHistory, tactic];
            new ResourceBudgetService(this.db).consume(projectId, 'proofAttempts', 1);
            const fullSource = `${binding.leanStatement} := by\n${history.map((item) => `  ${item.replace(/\n/g, '\n  ')}`).join('\n')}`;
            const preflight = bindingService.verify(projectId, bindingId, fullSource); if (!preflight.ok) throw new Error(preflight.error);
            const closed = await adapter.closes(projectId, bindingId, binding.leanStatement, history); run.totalAttempts += 1;
            if (closed.ok) {
              run.attemptedTactics.push({ script: history.join('\n'), status: 'VERIFIED', output: compactOutput(closed), remainingGoals: 0 });
              bindingService.certify(projectId, bindingId, fullSource, closed.output || closed.stdout);
              const certified = { ...toBeam({ ...state, tacticHistory: history, depth: history.length, goals: [], status: 'CLOSED' }), status: 'CLOSED' as const, score: Number.MAX_SAFE_INTEGER };
              run = { ...run, status: 'COMPLETED', beam: [certified], updatedAt: new Date().toISOString(), completedAt: new Date().toISOString() }; this.db.saveRecord('formalProofSearchRuns', run); return run;
            }
            const child = await adapter.replay(projectId, bindingId, binding.leanStatement, history, state.proofStateId);
            if (!child) { run.attemptedTactics.push({ script: history.join('\n'), status: 'FAILED', output: compactOutput(closed), remainingGoals: state.goals.length }); continue; }
            if (seen.has(child.stateHash)) { run.attemptedTactics.push({ script: history.join('\n'), status: 'FAILED', output: 'Duplicate replayed proof state.', remainingGoals: child.goals.length }); continue; }
            seen.add(child.stateHash); expanded.push(child); run.attemptedTactics.push({ script: history.join('\n'), status: 'PARTIAL', output: child.rawTrace, remainingGoals: child.goals.length });
          }
        }
        frontier = expanded.sort(compareState).slice(0, BEAM_WIDTH);
        run = { ...run, beam: frontier.map(toBeam), goalState: frontier[0]?.rawTrace ?? run.goalState, updatedAt: new Date().toISOString() }; this.db.saveRecord('formalProofSearchRuns', run);
      }
      run = { ...run, status: 'FAILED', error: 'No replayed Lean proof-state branch closed the frozen declaration within the bounded proof-search budget.', updatedAt: new Date().toISOString(), completedAt: new Date().toISOString() }; this.db.saveRecord('formalProofSearchRuns', run); this.recordFailedState(projectId, run); return run;
    } catch (error) {
      const paused = signal?.aborted || error instanceof Error && error.message === 'CANCELLED';
      run = { ...run, status: paused ? 'PAUSED' : 'FAILED', error: paused ? 'CANCELLED: replay frontier checkpoint retained for resume.' : error instanceof Error ? error.message : 'Formal proof search failed.', updatedAt: new Date().toISOString(), completedAt: paused ? null : new Date().toISOString() };
      this.db.saveRecord('formalProofSearchRuns', run); if (!paused) this.recordFailedState(projectId, run); return run;
    }
  }

  private recordFailedState(projectId: string, run: FormalProofSearchRun): void {
    const now = new Date().toISOString(); const record: KnowledgeRecord = { id: randomUUID(), projectId, kind: 'FAILED_PROOF_STATE', title: 'Failed Lean replay proof-state search', content: JSON.stringify({ bindingId: run.bindingId, goalState: run.goalState, beam: run.beam, attemptedTactics: run.attemptedTactics }), hashes: {}, relatedIds: [run.id, run.bindingId], verificationStatus: 'unverified', createdAt: now, updatedAt: now };
    this.db.saveRecord('knowledgeRecords', record);
  }
}

export function validTactic(value: string): boolean {
  const script = value.trim(); if (!script || script.length > 2_000 || /(?:sorry|admit|axiom|unsafe|run_tac|#eval|#check|\bimport\b|\bopen\b)/i.test(script)) return false;
  return script.split(/\r?\n/).every((line) => SAFE_TACTICS.has(line.trim().split(/[\s[(]/, 1)[0]));
}
function toBeam(state: ReplayedProofState): FormalProofSearchRun['beam'][number] { return { proofStateId: state.proofStateId, parentStateId: state.parentStateId, tacticHistory: state.tacticHistory, goals: state.goals, stateHash: state.stateHash, depth: state.depth, score: -state.goals.length * 100 - state.depth, status: state.status }; }
function compareState(left: ReplayedProofState, right: ReplayedProofState): number { return left.goals.length - right.goals.length || left.depth - right.depth || left.stateHash.localeCompare(right.stateHash); }
function compactOutput(result: { output?: string; stdout?: string; stderr?: string; error?: string }): string { return [result.output, result.stdout, result.stderr, result.error].filter(Boolean).join('\n').slice(0, 12_000); }

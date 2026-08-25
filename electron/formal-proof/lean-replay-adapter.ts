import { createHash, randomUUID } from 'node:crypto';
import type { ToolResult } from '../../src/shared/types';
import type { ToolRunner } from '../tool-runner';

export interface ReplayGoal { localContext: string[]; target: string; }
export interface ReplayedProofState {
  proofStateId: string; theoremBindingId: string; parentStateId: string | null; tacticHistory: string[];
  goals: ReplayGoal[]; depth: number; stateHash: string; status: 'ACTIVE' | 'CLOSED' | 'FAILED'; rawTrace: string;
}

/**
 * Lean does not expose a serializable kernel-state API through this desktop
 * runner.  This adapter therefore persists a deterministic tactic prefix and
 * asks Lean's `trace_state` tactic to replay that exact prefix on every node.
 * A state is retained only when Lean accepts the prefix before the internal
 * terminal `sorry`; the latter is never used for certification.
 */
export class LeanReplayAdapter {
  constructor(private readonly tools: ToolRunner) {}

  async root(projectId: string, bindingId: string, declaration: string): Promise<ReplayedProofState | null> {
    return this.replay(projectId, bindingId, declaration, [], null);
  }

  async replay(projectId: string, bindingId: string, declaration: string, tacticHistory: string[], parentStateId: string | null): Promise<ReplayedProofState | null> {
    const source = replaySource(declaration, tacticHistory);
    const result = await this.tools.run({ projectId, name: 'lean_check', purpose: 'Replay an accepted partial Lean proof prefix', input: { bindingId, code: source } });
    if (!result.ok) return null;
    const rawTrace = outputOf(result); const goals = parseTraceState(rawTrace);
    // A replay with no extracted goal is not a usable partial state.  Closed
    // proofs are checked separately without the internal terminal `sorry`.
    if (!goals.length) return null;
    const stateHash = createHash('sha256').update(JSON.stringify({ declaration, tacticHistory, goals })).digest('hex');
    return { proofStateId: randomUUID(), theoremBindingId: bindingId, parentStateId, tacticHistory, goals, depth: tacticHistory.length, stateHash, status: 'ACTIVE', rawTrace };
  }

  async closes(projectId: string, bindingId: string, declaration: string, tacticHistory: string[]): Promise<ToolResult> {
    const body = tacticHistory.map((tactic) => `  ${tactic.replace(/\n/g, '\n  ')}`).join('\n');
    return this.tools.run({ projectId, name: 'lean_check', purpose: 'Lean kernel check for a frozen proof-search candidate', input: { bindingId, code: `${declaration} := by\n${body}` } });
  }
}

function replaySource(declaration: string, tactics: string[]): string {
  const body = tactics.map((tactic) => `  ${tactic.replace(/\n/g, '\n  ')}`).join('\n');
  return `${declaration} := by\n${body}${body ? '\n' : ''}  trace_state\n  all_goals sorry`;
}

function outputOf(result: ToolResult): string { return [result.output, result.stdout, result.stderr, result.error].filter(Boolean).join('\n'); }

/** Parses Lean trace_state output into the context and target that Lean printed. */
export function parseTraceState(output: string): ReplayGoal[] {
  const normalized = output.replace(/\r\n/g, '\n'); const marker = normalized.lastIndexOf('⊢');
  if (marker < 0) return [];
  const before = normalized.slice(0, marker).split('\n'); const target = normalized.slice(marker + 1).split('\n').find((line) => line.trim())?.trim() ?? '';
  if (!target) return [];
  const context = before.slice(Math.max(0, before.lastIndexOf('case ') + 1)).map((line) => line.trim()).filter((line) => line && !line.startsWith('warning:'));
  return [{ localContext: context, target }];
}

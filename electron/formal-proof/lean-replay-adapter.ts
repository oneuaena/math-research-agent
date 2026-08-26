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
    const result = await this.tools.replayLeanProofState({ projectId, declaration, tacticHistory });
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

function outputOf(result: { output?: string; stdout?: string; stderr?: string; error?: string }): string { return [result.output, result.stdout, result.stderr, result.error].filter(Boolean).join('\n'); }

/** Parses Lean trace_state output into the context and target that Lean printed. */
export function parseTraceState(output: string): ReplayGoal[] {
  const lines = output.replace(/\r\n/g, '\n').split('\n'); const goals: ReplayGoal[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const marker = lines[index].indexOf('⊢'); if (marker < 0) continue;
    const target = lines[index].slice(marker + 1).trim(); if (!target) continue;
    let start = index - 1;
    while (start >= 0 && !/^\s*case\b/.test(lines[start]) && !lines[start].includes('⊢')) start -= 1;
    const context = lines.slice(start + 1, index).map((line) => line.trim()).filter((line) => line && !/^case\b/.test(line) && !/^warning:|^declaration uses ['"]sorry/i.test(line));
    goals.push({ localContext: context, target });
  }
  return goals;
}

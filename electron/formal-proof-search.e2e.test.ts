import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { ResearchDatabase } from './database';
import { FormalBindingService } from './formal-binding';
import { FormalProofSearchEngine } from './formal-proof-search';
import { ToolRunner } from './tool-runner';
import { resolveLeanRuntime } from './tools/lean-adapter';

vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => process.cwd() } }));

const realLean = resolveLeanRuntime('').available ? describe : describe.skip;
const directory = mkdtempSync(join(tmpdir(), 'mra-proof-replay-e2e-'));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

realLean('FormalProofSearchEngine real Lean replay', () => {
  it('replays root and partial states, then certifies only a strict complete proof', async () => {
    const db = new ResearchDatabase(join(directory, 'research.sqlite3'));
    try {
      const projectId = db.createProject({ name: 'proof replay', question: 'prove conjunction', goal: '', background: '', knownResults: '', constraints: '', mode: 'formalize' }).project.id;
      const binding = new FormalBindingService(db).freezeAiProposed(projectId, 'Given p and q, prove p and q.', '{"goal":"p ∧ q"}', 'theorem conjunction_test (p q : Prop) (hp : p) (hq : q) : p ∧ q');
      const tools = new ToolRunner(directory, () => ({ pythonPath: 'python', leanPath: '', maxToolSeconds: 120 }));
      // 12 safe candidates are expanded per frontier state; 32 allows the
      // root, the first partial state, and the closing third-depth state.
      const run = await new FormalProofSearchEngine(db, tools).run(projectId, binding.id, ['constructor', 'exact hp', 'exact hq'], 32);
      expect(run, run.error).toMatchObject({ status: 'COMPLETED' });
      expect(run.attemptedTactics.some((item) => item.status === 'PARTIAL' && item.script === 'constructor')).toBe(true);
      expect(run.attemptedTactics.some((item) => item.status === 'PARTIAL' && item.script === 'constructor\nexact hp')).toBe(true);
      // The production beam may choose an equivalent legal branch (for
      // example, `omega` can close the hypothesis-backed first subgoal), so
      // assert the security-relevant terminal properties rather than one
      // incidental beam ordering.
      expect(run.beam[0]).toMatchObject({ status: 'CLOSED', goals: [] });
      expect(run.beam[0].tacticHistory).toContain('constructor');
      expect(run.beam[0].tacticHistory).toContain('exact hq');
      expect(db.getProject(projectId, false).formalBindings.find((item) => item.id === binding.id)).toMatchObject({ status: 'KERNEL_CERTIFIED', mappingAuthority: 'AI_PROPOSED', equivalenceStatus: 'NOT_INDEPENDENTLY_CERTIFIED' });
      expect(run.attemptedTactics.every((item) => !item.output.includes('KERNEL_CERTIFIED'))).toBe(true);
    } finally { db.close(); }
  }, 650_000);
});

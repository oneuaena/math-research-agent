import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ResearchDatabase } from './database';
import { FormalBindingService } from './formal-binding';
import { ResearchOrchestrator } from './research-orchestrator';
import type { ModelProvider } from './provider';
import type { ToolRunner } from './tool-runner';

describe('frozen formal binding service', () => {
  it('allows only the declaration frozen before Lean and keeps AI scope distinct', () => {
    const directory = mkdtempSync(join(tmpdir(), 'mra-binding-service-'));
    const db = new ResearchDatabase(join(directory, 'research.sqlite3'));
    try {
      const snapshot = db.createProject({ name: 'Binding fixture', question: 'Every natural number equals itself.', goal: '', background: '', knownResults: '', constraints: '', mode: 'formalize', variables: 'n', domain: 'Nat', assumptions: '' });
      const service = new FormalBindingService(db);
      const binding = service.freezeAiProposed(snapshot.project.id, snapshot.project.question, 'forall n : Nat, n = n', 'theorem reflexiveNat (n : Nat) : n = n');
      const source = 'theorem reflexiveNat (n : Nat) : n = n := by\n  rfl';
      expect(service.verify(snapshot.project.id, binding.id, source)).toMatchObject({ ok: true, binding: { status: 'FROZEN', equivalenceStatus: 'NOT_INDEPENDENTLY_CERTIFIED' } });
      expect(service.verify(snapshot.project.id, binding.id, 'theorem unrelated : True := by\n  trivial')).toMatchObject({ ok: false, error: expect.stringContaining('FORMAL_BINDING_MISMATCH') });
      expect(service.freezeAiProposed(snapshot.project.id, snapshot.project.question, 'forall n : Nat, n = n', 'theorem reflexiveNat (n : Nat) : n = n').id).toBe(binding.id);
    } finally {
      db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('never creates a binding from a FORMAL_VERIFY proof submission', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'mra-binding-orchestrator-'));
    const db = new ResearchDatabase(join(directory, 'research.sqlite3'));
    try {
      const snapshot = db.createProject({ name: 'No auto-bind fixture', question: 'A claim.', goal: '', background: '', knownResults: '', constraints: '', mode: 'formalize', variables: '', domain: '', assumptions: '' });
      const tools = { run: async () => { throw new Error('Lean runner must not start without a frozen binding.'); } } as unknown as ToolRunner;
      const provider = {} as ModelProvider;
      const orchestrator = new ResearchOrchestrator(db, tools, provider, () => undefined) as unknown as { runTrackedTool(stage: 'FORMAL_VERIFY', invocation: { projectId: string; name: 'lean_check'; purpose: string; input: Record<string, unknown> }): Promise<{ ok: boolean; error?: string }> };
      const result = await orchestrator.runTrackedTool('FORMAL_VERIFY', { projectId: snapshot.project.id, name: 'lean_check', purpose: 'Regression: no auto-bind', input: { code: 'theorem unrelated : True := by\n  trivial' } });
      expect(result).toMatchObject({ ok: false, error: expect.stringContaining('FORMAL_BINDING_REQUIRED') });
      expect(db.getProject(snapshot.project.id, false).formalBindings).toHaveLength(0);
    } finally {
      db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

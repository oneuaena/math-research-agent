import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { formalizationSchema, roleActionSchema, type RoleAction } from '../src/shared/research';
import type { AgentStage } from '../src/shared/types';
import { ResearchDatabase } from './database';
import type { ModelProvider, ProviderRoleRequest, StageResult } from './provider';
import { ResearchOrchestrator } from './research-orchestrator';
import { ToolRunner } from './tool-runner';
import { resolveLeanRuntime } from './tools/lean-adapter';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => process.cwd(),
  },
}));

const emptyAction = (stage: AgentStage): RoleAction => ({
  title: `${stage} action`,
  summary: `${stage} completed conservatively.`,
  rationaleSummary: 'Synthetic end-to-end verification fixture.',
  evidence: [], proposedNodes: [], branches: [], proofSteps: [], proofReviews: [], toolCalls: [],
  nextStage: 'EXPLORE' as const,
  failures: [], tokenUsage: { input: 0, output: 0, total: 0 },
});

const realFormalToolchain = resolveLeanRuntime('').available ? describe : describe.skip;

realFormalToolchain('Agent formal verification toolchain', () => {
  it('executes Python, Z3, and Lean without promoting an AI-proposed mapping to the original claim', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'mra-formal-e2e-'));
    const db = new ResearchDatabase(join(directory, 'research.sqlite3'));
    const tools = new ToolRunner(directory, () => ({ pythonPath: process.env.MRA_TEST_PYTHON || 'python', leanPath: '', maxToolSeconds: 120 }));
    const theorem = 'For every natural number n, n = n.';
    const provider: ModelProvider = {
      async respondChat() { return 'unused'; },
      async runStage(stage): Promise<StageResult> { return { title: stage, summary: 'unused', status: 'unverified' }; },
      async formalize() {
        return formalizationSchema.parse({
          quantifiers: ['for every natural number n'],
          variables: [{ name: 'n', domain: 'Nat', description: 'natural number' }],
          domains: { n: 'Nat' }, assumptions: [],
          target: { relation: '=', left: 'n', right: 'n', description: theorem },
          equivalentForms: ['n = n'], searchParameters: { min: 0, max: 99 }, validationRules: ['exact integer equality'],
          executable: { kind: 'finite-search', variable: 'n', expression: 'n == n', predicate: 'custom', range: { min: 0, max: 99, sampleCount: 100 }, exactArithmetic: true },
          symbolicExpressions: ['n = n'], leanStatement: 'theorem reflexiveNat (n : Nat) : n = n', naturalLanguageOnly: false, uncertainty: [], confidence: 1,
        });
      },
      async runRole(request: ProviderRoleRequest) {
        const action = emptyAction(request.stage);
        if (request.stage === 'EXPERIMENT') action.toolCalls.push({ name: 'run_python', purpose: 'Check the first 100 natural numbers', input: { code: 'result = all(n == n for n in range(100))' } });
        if (request.stage === 'PROOF_ATTEMPT') action.proofSteps.push({ title: 'Reflexivity', statement: theorem, argument: 'Equality is reflexive.', dependencies: [], critical: true });
        if (request.stage === 'PROOF_CRITIQUE') {
          const proof = db.getProject(request.snapshot.project.id, false).proofs.at(-1)!;
          action.proofReviews.push({ stepId: proof.steps[0].id, status: 'VALID', comment: 'The step is a direct instance of equality reflexivity.' });
        }
        if (request.stage === 'SYMBOLIC_VERIFY') action.toolCalls.push({ name: 'z3_check', purpose: 'Check the negated SMT encoding', input: { smt2: '(declare-const n Int) (assert (not (= n n)))' } });
        if (request.stage === 'FORMAL_VERIFY') {
          const proof = db.getProject(request.snapshot.project.id, false).proofs.at(-1)!;
          const binding = request.snapshot.formalBindings.at(-1)!;
          action.toolCalls.push({
            name: 'lean_check',
            purpose: 'Verify equality reflexivity with the Lean kernel',
            input: { code: 'theorem reflexiveNat (n : Nat) : n = n := by\n  rfl', bindingId: binding.id, proofId: proof.id, formalizationOf: proof.theorem },
          });
        }
        return roleActionSchema.parse(action);
      },
    };

    try {
      db.saveSettings({ ...db.getSettings(), provider: 'local', maxIterations: 40, maxToolSeconds: 120, maxResearchMinutes: 5, checkpointEvery: 100 });
      const snapshot = db.createProject({ name: 'Formal toolchain fixture', question: theorem, goal: 'Verify a simple theorem with distinct evidence levels.', background: '', knownResults: '', constraints: '', mode: 'autonomous', variables: 'n', domain: 'Nat' });
      const orchestrator = new ResearchOrchestrator(db, tools, provider, () => undefined);
      await orchestrator.run(snapshot.project.id, new AbortController().signal);

      const completed = db.getProject(snapshot.project.id, false);
      expect(completed.sessions.at(-1)?.status).toBe('PAUSED');
      expect(completed.experiments.find((item) => item.tool === 'run_python')).toMatchObject({ status: 'succeeded', verificationStatus: 'computationally-verified' });
      expect(completed.experiments.find((item) => item.tool === 'z3_check')).toMatchObject({ status: 'succeeded', verificationStatus: 'bounded-check' });
      expect(completed.experiments.find((item) => item.tool === 'lean_check')).toMatchObject({ status: 'succeeded', verificationStatus: 'formally-verified' });
      expect(completed.evidence.some((item) => item.verificationLevel === 'BOUNDED_CHECK')).toBe(true);
      expect(completed.evidence.some((item) => item.verificationLevel === 'UNSAT')).toBe(true);
      expect(completed.evidence.some((item) => item.verificationLevel === 'FORMALLY_VERIFIED')).toBe(true);
      expect(completed.formalBindings).toEqual(expect.arrayContaining([expect.objectContaining({ status: 'KERNEL_CERTIFIED', equivalenceStatus: 'NOT_INDEPENDENTLY_CERTIFIED' })]));
      expect(completed.resourceBudgets.at(-1)).toMatchObject({ status: 'ACTIVE', limits: { maxToolSeconds: 900 } });
      expect(completed.proofs.at(-1)).toMatchObject({ theorem, status: 'CANDIDATE', verificationStatus: 'llm-assessed-only', independentlyReviewed: true });

      const auditPath = join(directory, 'logs', 'verification-audit.jsonl');
      expect(existsSync(auditPath)).toBe(true);
      const entries = readFileSync(auditPath, 'utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line) as { tool: string });
      expect(entries.map((entry) => entry.tool)).toEqual(expect.arrayContaining(['run_python', 'z3_check', 'lean_check']));
    } finally {
      db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  // A cache-miss on a fresh GitHub Windows runner can spend more than the
  // historical 650 seconds preparing Mathlib. Keep this integration check
  // bounded, while allowing the first-run toolchain bootstrap to finish.
  }, 900_000);
});

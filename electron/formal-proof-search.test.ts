import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResearchDatabase } from './database';
import { FormalBindingService } from './formal-binding';
import { FormalProofSearchEngine, validTactic } from './formal-proof-search';
import type { ToolRunner } from './tool-runner';

const folders: string[] = []; const databases: ResearchDatabase[] = [];
function setup() { const folder = mkdtempSync(join(tmpdir(), 'mra-proof-search-')); folders.push(folder); const db = new ResearchDatabase(join(folder, 'research.sqlite3')); databases.push(db); const projectId = db.createProject({ name: 'proof search', question: 'n equals n', goal: '', background: '', knownResults: '', constraints: '', mode: 'formalize' }).project.id; return { db, projectId }; }
afterEach(() => { while (databases.length) databases.pop()!.close(); while (folders.length) rmSync(folders.pop()!, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); });

describe('FormalProofSearchEngine', () => {
  it('certifies only a tactic that closes the frozen statement and records failures separately', async () => {
    const { db, projectId } = setup();
    const binding = new FormalBindingService(db).freezeAiProposed(projectId, 'For every natural n, n=n.', '{"target":"n=n"}', 'theorem frozen (n : Nat) : n = n');
    const runTool = vi.fn(async (invocation: { input: { code: string } }) => ({ ok: /\brfl\b/.test(invocation.input.code) && !/exact \?_/.test(invocation.input.code), success: /\brfl\b/.test(invocation.input.code), output: 'kernel output', stdout: '', stderr: '', error: 'unsolved goals', errorType: 'PROGRAM_ERROR' as const, exitCode: 0, durationMs: 1, timeout: false, verificationStatus: 'FORMALLY_VERIFIED' as const }));
    const result = await new FormalProofSearchEngine(db, { run: runTool } as unknown as ToolRunner).run(projectId, binding.id, ['sorry', 'rfl'], 8);
    expect(result.status).toBe('COMPLETED'); expect(result.attemptedTactics.map((item) => item.script)).toContain('rfl');
    expect(db.getProject(projectId, false).formalBindings.find((item) => item.id === binding.id)?.status).toBe('KERNEL_CERTIFIED');
    expect(runTool.mock.calls.every(([call]) => String(call.input.code).includes('theorem frozen (n : Nat) : n = n'))).toBe(true);
  });
  it('rejects proof escapes before Lean is invoked', () => { expect(validTactic('sorry')).toBe(false); expect(validTactic('run_tac unsafeCast')).toBe(false); expect(validTactic('rfl')).toBe(true); });
});

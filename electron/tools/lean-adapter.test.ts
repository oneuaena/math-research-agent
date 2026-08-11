import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { resolveLeanRuntime, runLeanVerification, unsoundLeanConstructs } from './lean-adapter';

const temporary = mkdtempSync(join(tmpdir(), 'mra-lean-test-'));
const runtime = resolveLeanRuntime('');
const realLean = runtime.available ? describe : describe.skip;

afterAll(() => rmSync(temporary, { recursive: true, force: true }));

describe('Lean source policy', () => {
  it('rejects sorry, admit, axioms, constants, native_decide, and unsafe declarations', () => {
    expect(unsoundLeanConstructs('theorem t : True := by sorry')).toContain('sorry');
    expect(unsoundLeanConstructs('axiom falseProof : False\ntheorem t : False := falseProof')).toContain('axiom/constant');
    expect(unsoundLeanConstructs('theorem t : True := by native_decide')).toContain('native_decide');
    expect(unsoundLeanConstructs('#eval IO.println "unsafe"\nexample : True := by trivial')).toContain('command execution');
  });

  it('does not treat comments as proof escapes', () => {
    expect(unsoundLeanConstructs('-- sorry is prohibited\nexample : True := by trivial')).toEqual([]);
  });
});

realLean('real Lean 4 kernel adapter', () => {
  it('accepts a valid theorem through Lake and the Lean kernel', async () => {
    const result = await runLeanVerification({ code: 'example (n : Nat) : n = n := by\n  rfl', artifactFile: join(temporary, 'valid.lean'), userDataPath: temporary, configuredPath: '', timeoutMs: 120_000 });
    expect(result).toMatchObject({ ok: true, success: true, errorType: 'NONE', exitCode: 0, timeout: false, verificationStatus: 'FORMALLY_VERIFIED', verificationLevel: 'FORMALLY_VERIFIED' });
  }, 130_000);

  it('returns a real compiler error for an invalid theorem', async () => {
    const result = await runLeanVerification({ code: 'example : False := by\n  trivial', artifactFile: join(temporary, 'invalid.lean'), userDataPath: temporary, configuredPath: '', timeoutMs: 120_000 });
    expect(result.ok).toBe(false);
    expect(result.errorType).toBe('PROGRAM_ERROR');
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/type mismatch|unsolved goals|application type mismatch|False/i);
  }, 130_000);

  it('rejects sorry before invoking the kernel', async () => {
    const result = await runLeanVerification({ code: 'example : True := by\n  sorry', artifactFile: join(temporary, 'sorry.lean'), userDataPath: temporary, configuredPath: '', timeoutMs: 120_000 });
    expect(result).toMatchObject({ ok: false, errorType: 'UNSOUND_PROOF', verificationStatus: 'REJECTED_UNSOUND' });
  });
});

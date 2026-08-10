import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CASE_ATTACKS } from '../../electron/stress-engine';

function run(name: string, code: string): string {
  const input = name === 'run_python' ? { code } : { expression: code, variable: 'n', symbols: ['n'] };
  const child = spawnSync('python', ['-I', join(process.cwd(), 'python', 'worker.py')], {
    input: JSON.stringify({ name, input }), encoding: 'utf8', timeout: 20_000,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
  });
  if (child.error) throw child.error;
  const response = JSON.parse(child.stdout.trim()) as { ok: boolean; output: string; error?: string };
  if (!response.ok) throw new Error(response.error);
  return response.output;
}

describe('Conjecture Stress Test workflows', () => {
  it('Case A finds and independently verifies the early exact counterexample', () => {
    expect(run(CASE_ATTACKS.A[0].tool, CASE_ATTACKS.A[0].code)).toBe('FOUND|4|21');
    expect(run(CASE_ATTACKS.A[1].tool, CASE_ATTACKS.A[1].code)).toMatch(/^VERIFIED\|4\|21\|.*\|True$/);
  });

  it('Case B expands after the first range survives, then verifies n = 40', () => {
    expect(run(CASE_ATTACKS.B[0].tool, CASE_ATTACKS.B[0].code)).toBe('NONE');
    expect(run(CASE_ATTACKS.B[1].tool, CASE_ATTACKS.B[1].code)).toBe('FOUND|40|1681');
    expect(run(CASE_ATTACKS.B[2].tool, CASE_ATTACKS.B[2].code)).toMatch(/^VERIFIED\|40\|1681\|.*\|True$/);
  });

  it('Case C survives bounded exact, boundary, and symbolic checks without a false proof claim', () => {
    expect(run(CASE_ATTACKS.C[0].tool, CASE_ATTACKS.C[0].code)).toBe('NONE');
    expect(run(CASE_ATTACKS.C[1].tool, CASE_ATTACKS.C[1].code)).toBe('NONE');
    expect(run(CASE_ATTACKS.C[2].tool, CASE_ATTACKS.C[2].code)).toBe('0');
  });
});

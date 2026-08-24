import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runBoundedProcess } from './process-runner';

const python = process.env.MRA_TEST_PYTHON || 'python';
const worker = join(process.cwd(), 'python', 'worker.py');
const projectId = '00000000-0000-4000-8000-000000000011';

async function workerRequest(name: 'run_python' | 'z3_check', input: Record<string, unknown>, timeoutMs = 10_000) {
  const execution = await runBoundedProcess({
    executable: python,
    args: ['-I', '-B', '-X', 'utf8', worker],
    cwd: process.cwd(),
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1' },
    stdin: JSON.stringify({ projectId, name, purpose: 'integration test', input }),
    timeoutMs,
    maxOutputBytes: 4 * 1024 * 1024,
  });
  return { execution, envelope: execution.stdout.trim() ? JSON.parse(execution.stdout) as Record<string, unknown> : null };
}

function pigeonhole(pigeons: number, holes: number): string {
  const lines: string[] = [];
  for (let pigeon = 0; pigeon < pigeons; pigeon += 1) for (let hole = 0; hole < holes; hole += 1) lines.push(`(declare-const p_${pigeon}_${hole} Bool)`);
  for (let pigeon = 0; pigeon < pigeons; pigeon += 1) lines.push(`(assert (or ${Array.from({ length: holes }, (_, hole) => `p_${pigeon}_${hole}`).join(' ')}))`);
  for (let hole = 0; hole < holes; hole += 1) for (let first = 0; first < pigeons; first += 1) for (let second = first + 1; second < pigeons; second += 1) lines.push(`(assert (not (and p_${first}_${hole} p_${second}_${hole})))`);
  return lines.join('\n');
}

describe('bounded Python worker transport', () => {
  it('keeps program stdout separate from the JSON protocol', async () => {
    const { execution, envelope } = await workerRequest('run_python', { code: 'print("hello")' });
    expect(execution.exitCode).toBe(0);
    expect(envelope).toMatchObject({ protocol_version: 2, ok: true, output: 'hello', stdout: 'hello\n', error_type: 'NONE', exit_code: 0 });
  });

  it('reports Python exceptions as PROGRAM_ERROR with traceback', async () => {
    const { envelope } = await workerRequest('run_python', { code: '1 / 0' });
    expect(envelope).toMatchObject({ ok: false, error_type: 'PROGRAM_ERROR', exit_code: 1, verification_status: 'PROGRAM_FAILURE' });
    expect(String(envelope?.stderr)).toContain('ZeroDivisionError');
  });

  it('preserves Unicode stdout', async () => {
    const { envelope } = await workerRequest('run_python', { code: 'print("中文输出")' });
    expect(envelope).toMatchObject({ ok: true, stdout: '中文输出\n', output: '中文输出' });
  });

  it('handles a large bounded stdout without corrupting the adapter', async () => {
    const { envelope } = await workerRequest('run_python', { code: 'print("x" * 250000)' });
    expect(envelope?.ok).toBe(true);
    expect(String(envelope?.stdout)).toHaveLength(250001);
  });

  it('supports safe combinatorics and JSON checkpoint fallbacks without opening dunder access', async () => {
    const { envelope } = await workerRequest('run_python', { code: [
      'import itertools',
      'import collections',
      'import random',
      'import pickle',
      'import numpy as np',
      'pairs = list(itertools.combinations([1, 2, 3, 4], 2))',
      'counts = collections.Counter([1, 1, 2])',
      'rng = random.Random(71)',
      'checkpoint = pickle.loads(pickle.dumps({"pairs": len(pairs), "count": counts[1], "seed": rng.randrange(1000)}))',
      "result = f'{checkpoint[\"pairs\"]}|{checkpoint[\"count\"]}|{np.__version__}'",
    ].join('\n') });
    expect(envelope).toMatchObject({ ok: true, output: expect.stringMatching(/^6\\|2\\|/), compatibility_fallbacks: expect.arrayContaining(['itertools=>safe standard-library facade', 'collections=>safe standard-library facade', 'random=>safe standard-library facade', 'pickle=>json-checkpoint facade']) });
  });

  it('continues to reject non-version dunder access', async () => {
    const { envelope } = await workerRequest('run_python', { code: 'result = math.__dict__' });
    expect(envelope).toMatchObject({ ok: false, error_type: 'VALIDATION_ERROR' });
  });

  it('terminates an infinite program at the process timeout', async () => {
    const { execution, envelope } = await workerRequest('run_python', { code: 'while True:\n    pass' }, 150);
    expect(execution.timedOut).toBe(true);
    expect(envelope).toBeNull();
  });
});

describe('Z3 worker adapter', () => {
  it('distinguishes SAT and returns a model', async () => {
    const { envelope } = await workerRequest('z3_check', { smt2: '(declare-const x Int) (assert (> x 0)) (assert (< x 2))' });
    expect(envelope).toMatchObject({ ok: true, verification_status: 'SAT', verification_level: 'SAT' });
    expect(JSON.parse(String(envelope?.output))).toMatchObject({ status: 'SAT', bounded: true });
  });

  it('distinguishes UNSAT', async () => {
    const { envelope } = await workerRequest('z3_check', { smt2: '(declare-const x Int) (assert (> x 1)) (assert (< x 0))' });
    expect(envelope).toMatchObject({ ok: true, verification_status: 'UNSAT', verification_level: 'UNSAT' });
  });

  it('distinguishes UNKNOWN and records timeout as reason_unknown', async () => {
    const { envelope } = await workerRequest('z3_check', { smt2: pigeonhole(18, 17), timeoutMs: 1 }, 20_000);
    expect(envelope).toMatchObject({ ok: true, verification_status: 'UNKNOWN', verification_level: 'UNKNOWN', reason_unknown: 'timeout' });
  });
});

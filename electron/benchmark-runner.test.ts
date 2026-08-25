import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BenchmarkRunner } from './benchmark-runner';
import { ResearchDatabase } from './database';

describe('BenchmarkRunner', () => {
  it('runs all baseline/level combinations, executes an N71 smoke search, and derives adversarial metrics', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'mra-benchmark-')); const db = new ResearchDatabase(join(directory, 'research.sqlite3'));
    try {
      const project = db.createProject({ name: 'benchmark', question: '', goal: '', background: '', knownResults: '', constraints: '', mode: 'autonomous' });
      const run = await new BenchmarkRunner(db).run(project.project.id);
      expect(run.cases).toHaveLength(24);
      const n71 = run.cases.filter((item) => item.level === 4);
      expect(n71).toHaveLength(6); expect(n71.map((item) => ({ status: item.status, detail: item.detail }))).toEqual(Array.from({ length: 6 }, () => ({ status: 'INCONCLUSIVE', detail: 'Bounded smoke search executed; this is progress evidence, not a solution claim.' }))); expect(n71.every((item) => item.evaluations > 0)).toBe(true);
      expect(run.adversarial).toHaveLength(3); expect(run.adversarial.every((item) => item.rejected)).toBe(true);
      expect(run.metrics.denominators.falseVerification).toBe(run.adversarial.length); expect(run.metrics.falseVerifiedRate).toBe(0);
      expect(db.listRecords(project.project.id, 'benchmarkRuns')).toHaveLength(1);
    } finally { db.close(); rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); }
  }, 30_000);
});

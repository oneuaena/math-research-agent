import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BenchmarkRunner } from './benchmark-runner';
import { ResearchDatabase } from './database';

describe('BenchmarkRunner', () => {
  it('records fixed levels and never marks the N71 schema check solved', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'mra-benchmark-')); const db = new ResearchDatabase(join(directory, 'research.sqlite3'));
    try {
      const project = db.createProject({ name: 'benchmark', question: '', goal: '', background: '', knownResults: '', constraints: '', mode: 'autonomous' });
      const run = await new BenchmarkRunner(db).run(project.project.id);
      expect(run.cases).toHaveLength(4); expect(run.cases.find((item) => item.level === 4)?.status).toBe('INCONCLUSIVE'); expect(run.metrics.falseVerifiedRate).toBe(0);
      expect(db.listRecords(project.project.id, 'benchmarkRuns')).toHaveLength(1);
    } finally { db.close(); rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); }
  }, 30_000);
});

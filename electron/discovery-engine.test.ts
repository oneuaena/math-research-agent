import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ResearchDatabase } from './database';
import { DiscoveryEngine } from './discovery-engine';

const directories: string[] = [];
const databases: ResearchDatabase[] = [];
const input = {
  problem: {
    universeSize: 18,
    candidateSize: 5,
    incompatibilities: [[0, 1], [2, 3], [4, 5]] as Array<[number, number]>,
    coverageGroups: [[0, 3, 6, 9, 12, 15], [1, 4, 7, 10, 13, 16], [2, 5, 8, 11, 14, 17]],
  },
  config: { populationSize: 16, generations: 4, workerCount: 3, seed: 71, mutationRate: 0.2, archiveLimit: 20 },
};

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'mra-discovery-')); directories.push(directory);
  const database = new ResearchDatabase(join(directory, 'research.sqlite3'));
  databases.push(database);
  const projectId = database.createProject({ name: 'Discovery', question: 'Find a finite construction.', goal: '', background: '', knownResults: '', constraints: '', mode: 'autonomous' }).project.id;
  return { database, projectId };
}

afterEach(() => {
  while (databases.length) databases.pop()!.close();
  while (directories.length) rmSync(directories.pop()!, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
});

describe('DiscoveryEngine', () => {
  it('persists a deterministic Pareto archive from bounded worker evaluation', async () => {
    const first = setup(); const second = setup();
    const firstRun = await new DiscoveryEngine(first.database).start(first.projectId, input);
    const secondRun = await new DiscoveryEngine(second.database).start(second.projectId, input);
    expect(firstRun.status).toBe('COMPLETED');
    expect(firstRun.totalEvaluated).toBe(input.config.populationSize * input.config.generations);
    expect(firstRun.archive.length).toBeGreaterThan(0);
    expect(firstRun.archive.map((candidate) => ({ ...candidate, fingerprint: undefined }))).toEqual(secondRun.archive.map((candidate) => ({ ...candidate, fingerprint: undefined })));
    expect(first.database.getProject(first.projectId, false).discoveryRuns.at(-1)?.status).toBe('COMPLETED');
    for (const candidate of firstRun.archive) {
      expect(new Set(candidate.genes).size).toBe(candidate.genes.length);
      expect(candidate.genes).toEqual([...candidate.genes].sort((left, right) => left - right));
      expect(candidate.violations).toBeGreaterThanOrEqual(0);
      expect(candidate.coverage).toBeGreaterThanOrEqual(0);
    }
  });

  it('pauses before work and resumes from its persisted generation', async () => {
    const pausedCase = setup(); const uninterruptedCase = setup();
    const controller = new AbortController(); controller.abort();
    const engine = new DiscoveryEngine(pausedCase.database);
    const paused = await engine.start(pausedCase.projectId, input, controller.signal);
    expect(paused.status).toBe('PAUSED');
    expect(paused.generation).toBe(0);
    const resumed = await engine.resume(pausedCase.projectId, paused.id);
    const uninterrupted = await new DiscoveryEngine(uninterruptedCase.database).start(uninterruptedCase.projectId, input);
    expect(resumed.status).toBe('COMPLETED');
    expect(resumed.archive).toEqual(uninterrupted.archive);
    expect(resumed.totalEvaluated).toBe(uninterrupted.totalEvaluated);
  });

  it('rejects unsafe or out-of-bound specifications before workers are started', () => {
    expect(() => DiscoveryEngine.parseInput({ ...input, config: { ...input.config, workerCount: 33 } })).toThrow('Invalid discovery specification');
    expect(() => DiscoveryEngine.parseInput({ ...input, config: { ...input.config, populationSize: 1_024, generations: 1_000 } })).toThrow('Invalid discovery specification');
    expect(() => DiscoveryEngine.parseInput({ ...input, problem: { ...input.problem, candidateSize: 19 } })).toThrow('Invalid discovery specification');
    expect(() => DiscoveryEngine.parseInput({ ...input, problem: { ...input.problem, incompatibilities: [[0, 18]] } })).toThrow('Invalid discovery specification');
  });

  it('keeps an imported 1.3 legacy run readable and resumable after the additive migration', async () => {
    const { database, projectId } = setup();
    const controller = new AbortController(); controller.abort();
    const paused = await new DiscoveryEngine(database).start(projectId, input, controller.signal);
    database.saveRecord('discoveryRuns', {
      ...paused, id: 'legacy-v130', error: 'Imported legacy checkpoint.',
    });
    const resumed = await new DiscoveryEngine(database).resume(projectId, 'legacy-v130');
    expect(resumed.status).toBe('COMPLETED');
    expect(resumed.specification).toBeUndefined();
  });
});

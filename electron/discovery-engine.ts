import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { z } from 'zod';
import type { DiscoveryCandidate, DiscoveryConfig, DiscoveryProblem, DiscoveryRun } from '../src/shared/types';
import type { ResearchDatabase } from './database';

const integer = z.number().int();
const problemSchema = z.object({
  universeSize: integer.min(2).max(4_096),
  candidateSize: integer.min(1).max(512),
  incompatibilities: z.array(z.tuple([integer.min(0), integer.min(0)])).max(20_000),
  coverageGroups: z.array(z.array(integer.min(0)).min(1).max(512)).max(1_024),
}).superRefine((value, context) => {
  if (value.candidateSize > value.universeSize) context.addIssue({ code: 'custom', message: 'candidateSize cannot exceed universeSize.' });
  for (const [left, right] of value.incompatibilities) {
    if (left >= value.universeSize || right >= value.universeSize || left === right) context.addIssue({ code: 'custom', message: 'Each incompatibility must contain two different universe indices.' });
  }
  for (const group of value.coverageGroups) if (group.some((item) => item >= value.universeSize)) context.addIssue({ code: 'custom', message: 'Coverage groups may only contain universe indices.' });
});

const configSchema = z.object({
  populationSize: integer.min(8).max(1_024),
  generations: integer.min(1).max(10_000),
  workerCount: integer.min(1).max(32),
  seed: integer.min(1).max(2_147_483_646),
  mutationRate: z.number().min(0.01).max(1),
  archiveLimit: integer.min(8).max(256),
}).superRefine((value, context) => {
  if (value.populationSize * value.generations > 1_000_000) context.addIssue({ code: 'custom', message: 'populationSize × generations cannot exceed 1,000,000 evaluations per run.' });
});

const evaluatorSource = `
const { parentPort, workerData } = require('node:worker_threads');
function evaluate(genes, problem) {
  const selected = new Set(genes);
  let violations = 0;
  for (const [left, right] of problem.incompatibilities) if (selected.has(left) && selected.has(right)) violations += 1;
  let coverage = 0;
  for (const group of problem.coverageGroups) if (group.some((item) => selected.has(item))) coverage += 1;
  let spread = 0;
  for (let left = 0; left < genes.length; left += 1) for (let right = left + 1; right < genes.length; right += 1) spread += Math.abs(genes[right] - genes[left]);
  return { genes, violations, coverage, spread };
}
parentPort.postMessage(workerData.population.map((genes) => evaluate(genes, workerData.problem)));
`;

type RawCandidate = Pick<DiscoveryCandidate, 'genes' | 'violations' | 'coverage' | 'spread'>;

export class DiscoveryAbortError extends Error {
  constructor() { super('Discovery run was paused.'); this.name = 'DiscoveryAbortError'; }
}

/** A deterministic finite-construction search with a fixed evaluator and bounded worker pool. */
export class DiscoveryEngine {
  constructor(private readonly db: ResearchDatabase) {}

  static parseInput(raw: unknown): { problem: DiscoveryProblem; config: DiscoveryConfig } {
    const parsed = z.object({ problem: problemSchema, config: configSchema }).safeParse(raw);
    if (!parsed.success) throw new Error(`Invalid discovery specification: ${parsed.error.issues.map((issue) => issue.message).join(' ')}`);
    return parsed.data;
  }

  async start(projectId: string, raw: unknown, signal?: AbortSignal): Promise<DiscoveryRun> {
    const { problem, config } = DiscoveryEngine.parseInput(raw);
    const now = new Date().toISOString();
    const run: DiscoveryRun = {
      id: randomUUID(), projectId, status: 'RUNNING', problem, config, generation: 0, totalEvaluated: 0,
      population: [], archive: [], rngState: config.seed,
      startedAt: now, updatedAt: now, completedAt: null, error: '',
    };
    const initialPopulation = this.initialPopulation(problem, config.populationSize, config.seed);
    run.population = initialPopulation.population;
    run.rngState = initialPopulation.rngState;
    this.db.saveRecord('discoveryRuns', run);
    return this.execute(run, signal);
  }

  async resume(projectId: string, runId: string, signal?: AbortSignal): Promise<DiscoveryRun> {
    const run = this.db.getProject(projectId, false).discoveryRuns.find((item) => item.id === runId);
    if (!run) throw new Error('Discovery run was not found in this project.');
    if (run.status === 'COMPLETED') return run;
    const resumed: DiscoveryRun = { ...run, status: 'RUNNING', error: '', completedAt: null, updatedAt: new Date().toISOString() };
    this.db.saveRecord('discoveryRuns', resumed);
    return this.execute(resumed, signal);
  }

  recoverInterruptedRuns(): number {
    let recovered = 0;
    for (const project of this.db.listProjects()) {
      for (const run of this.db.getProject(project.id, false).discoveryRuns) {
        if (run.status !== 'RUNNING') continue;
        this.db.saveRecord('discoveryRuns', { ...run, status: 'PAUSED', error: 'Application restarted; resume continues from the last persisted generation.', updatedAt: new Date().toISOString() });
        recovered += 1;
      }
    }
    return recovered;
  }

  private async execute(initial: DiscoveryRun, signal?: AbortSignal): Promise<DiscoveryRun> {
    let run = initial;
    try {
      for (let generation = run.generation; generation < run.config.generations; generation += 1) {
        this.throwIfAborted(signal);
        const evaluated = await this.evaluatePopulation(run.population, run.problem, run.config.workerCount, signal);
        this.throwIfAborted(signal);
        const withNovelty = evaluated.map((candidate) => ({ ...candidate, fingerprint: candidate.genes.join(','), novelty: novelty(candidate.genes, run.archive), paretoRank: 0 }));
        const mergedArchive = selectArchive([...run.archive, ...withNovelty], run.config.archiveLimit);
        const nextPopulation = this.nextPopulation(mergedArchive, run.problem, run.config, run.rngState);
        run = {
          ...run, generation: generation + 1, totalEvaluated: run.totalEvaluated + evaluated.length, archive: mergedArchive,
          population: nextPopulation.population, rngState: nextPopulation.rngState, updatedAt: new Date().toISOString(),
        };
        this.db.saveRecord('discoveryRuns', run);
      }
      const completed = { ...run, status: 'COMPLETED' as const, completedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      this.db.saveRecord('discoveryRuns', completed);
      return completed;
    } catch (error) {
      const paused = error instanceof DiscoveryAbortError;
      const saved = { ...run, status: paused ? 'PAUSED' as const : 'FAILED' as const, error: paused ? 'Paused by user; resume continues from the last completed generation.' : error instanceof Error ? error.message : 'Discovery evaluator failed.', updatedAt: new Date().toISOString(), completedAt: paused ? null : new Date().toISOString() };
      this.db.saveRecord('discoveryRuns', saved);
      return saved;
    }
  }

  private initialPopulation(problem: DiscoveryProblem, populationSize: number, seed: number): { population: number[][]; rngState: number } {
    let state = seed;
    const population: number[][] = [];
    for (let index = 0; index < populationSize; index += 1) {
      const created = randomCandidate(problem.universeSize, problem.candidateSize, state);
      state = created.rngState;
      population.push(created.genes);
    }
    return { population, rngState: state };
  }

  private nextPopulation(archive: DiscoveryCandidate[], problem: DiscoveryProblem, config: DiscoveryConfig, state: number): { population: number[][]; rngState: number } {
    const population: number[][] = archive.slice(0, Math.min(8, archive.length)).map((candidate) => candidate.genes);
    let rngState = state;
    const parents = archive.length ? archive : [{ genes: randomCandidate(problem.universeSize, problem.candidateSize, rngState).genes } as DiscoveryCandidate];
    while (population.length < config.populationSize) {
      const firstPick = nextRandom(rngState); rngState = firstPick.state;
      const secondPick = nextRandom(rngState); rngState = secondPick.state;
      const first = parents[Math.floor(firstPick.value * parents.length)].genes;
      const second = parents[Math.floor(secondPick.value * parents.length)].genes;
      const crossed = crossover(first, second, problem.universeSize, problem.candidateSize, rngState);
      rngState = crossed.rngState;
      const mutated = mutate(crossed.genes, problem.universeSize, config.mutationRate, rngState);
      rngState = mutated.rngState;
      population.push(mutated.genes);
    }
    return { population, rngState };
  }

  private async evaluatePopulation(population: number[][], problem: DiscoveryProblem, workerCount: number, signal?: AbortSignal): Promise<RawCandidate[]> {
    const count = Math.min(workerCount, population.length);
    const chunks = Array.from({ length: count }, () => [] as number[][]);
    population.forEach((candidate, index) => chunks[index % count].push(candidate));
    const values = await Promise.all(chunks.filter((chunk) => chunk.length).map((chunk) => evaluateChunk(chunk, problem, signal)));
    return values.flat();
  }

  private throwIfAborted(signal?: AbortSignal): void { if (signal?.aborted) throw new DiscoveryAbortError(); }
}

function evaluateChunk(population: number[][], problem: DiscoveryProblem, signal?: AbortSignal): Promise<RawCandidate[]> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DiscoveryAbortError()); return; }
    const worker = new Worker(evaluatorSource, { eval: true, workerData: { population, problem } });
    const abort = () => { void worker.terminate(); reject(new DiscoveryAbortError()); };
    const cleanup = () => signal?.removeEventListener('abort', abort);
    signal?.addEventListener('abort', abort, { once: true });
    worker.once('message', (value: RawCandidate[]) => { cleanup(); resolve(value); });
    worker.once('error', (error) => { cleanup(); reject(error); });
    worker.once('exit', (code) => { if (code !== 0) { cleanup(); reject(new Error(`Discovery evaluator worker exited with code ${code}.`)); } });
  });
}

function nextRandom(state: number): { value: number; state: number } {
  const next = ((state * 48_271) % 2_147_483_647) || 1;
  return { value: next / 2_147_483_647, state: next };
}

function randomCandidate(universeSize: number, candidateSize: number, state: number): { genes: number[]; rngState: number } {
  const selected = new Set<number>(); let rngState = state;
  while (selected.size < candidateSize) { const random = nextRandom(rngState); rngState = random.state; selected.add(Math.floor(random.value * universeSize)); }
  return { genes: [...selected].sort((left, right) => left - right), rngState };
}

function crossover(first: number[], second: number[], universeSize: number, candidateSize: number, state: number): { genes: number[]; rngState: number } {
  let rngState = state; const selected = new Set<number>();
  for (const item of [...first, ...second]) {
    const random = nextRandom(rngState); rngState = random.state;
    if (random.value >= 0.5 && selected.size < candidateSize) selected.add(item);
  }
  while (selected.size < candidateSize) { const random = nextRandom(rngState); rngState = random.state; selected.add(Math.floor(random.value * universeSize)); }
  return { genes: [...selected].sort((left, right) => left - right), rngState };
}

function mutate(genes: number[], universeSize: number, mutationRate: number, state: number): { genes: number[]; rngState: number } {
  let rngState = state; const selected = new Set(genes);
  for (const item of genes) {
    const random = nextRandom(rngState); rngState = random.state;
    if (random.value > mutationRate) continue;
    selected.delete(item);
    while (selected.size < genes.length) { const replacement = nextRandom(rngState); rngState = replacement.state; selected.add(Math.floor(replacement.value * universeSize)); }
  }
  return { genes: [...selected].sort((left, right) => left - right), rngState };
}

function novelty(genes: number[], archive: DiscoveryCandidate[]): number {
  if (archive.length === 0) return genes.length;
  return Math.min(...archive.map((candidate) => symmetricDifference(genes, candidate.genes)));
}

function symmetricDifference(left: number[], right: number[]): number {
  const values = new Set(left);
  for (const item of right) {
    if (values.has(item)) values.delete(item);
    else values.add(item);
  }
  return values.size;
}

function dominates(left: DiscoveryCandidate, right: DiscoveryCandidate): boolean {
  const noWorse = left.violations <= right.violations && left.coverage >= right.coverage && left.spread >= right.spread && left.novelty >= right.novelty;
  return noWorse && (left.violations < right.violations || left.coverage > right.coverage || left.spread > right.spread || left.novelty > right.novelty);
}

function selectArchive(candidates: DiscoveryCandidate[], limit: number): DiscoveryCandidate[] {
  const unique = [...new Map(candidates.map((candidate) => [candidate.fingerprint, candidate])).values()];
  const remaining = new Set(unique.map((candidate) => candidate.fingerprint)); const ranked: DiscoveryCandidate[] = []; let rank = 0;
  while (remaining.size) {
    const front = unique.filter((candidate) => remaining.has(candidate.fingerprint) && !unique.some((other) => remaining.has(other.fingerprint) && other.fingerprint !== candidate.fingerprint && dominates(other, candidate)));
    if (!front.length) break;
    front.sort(compareCandidates); front.forEach((candidate) => { ranked.push({ ...candidate, paretoRank: rank }); remaining.delete(candidate.fingerprint); }); rank += 1;
    if (ranked.length >= limit) break;
  }
  return ranked.slice(0, limit);
}

function compareCandidates(left: DiscoveryCandidate, right: DiscoveryCandidate): number {
  return left.violations - right.violations || right.coverage - left.coverage || right.spread - left.spread || right.novelty - left.novelty || left.fingerprint.localeCompare(right.fingerprint);
}

import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { z } from 'zod';
import type { DiscoveryCandidate, DiscoveryConfig, DiscoveryProblem, DiscoveryRun } from '../src/shared/types';
import type { ResearchDatabase } from './database';
import { aggregateObjectiveValue, candidateValue, createCandidate, crossoverCandidate, digest, evaluateCandidate, makeDiscoverySpecification, mutateCandidate, objectiveUtility, representationUniverse } from './discovery-core';
import type { DiscoverySpecification } from '../src/shared/types';
import { ResourceBudgetService } from './resource-budget';

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
  strategy: z.enum(['evolutionary', 'random', 'hill-climbing', 'beam', 'annealing']).optional(),
  evaluationBudget: integer.min(1).max(1_000_000).optional(),
  checkpointEvery: integer.min(1).max(10_000).optional(),
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

// This is application-authored interpreter code executed in a short-lived
// worker. Worker data is strictly declarative representation/evaluator JSON.
const genericEvaluatorSource = `
const { parentPort, workerData } = require('node:worker_threads');
function dim(r,n,f=0){const v=r.dimensions[n];return Number.isInteger(v)?v:f}
function comb(n,k){if(k>n||k<0)return 0;let x=1;for(let i=1;i<=k;i++)x=x*(n-k+i)/i;return Math.min(Math.round(x),1000000)}
function universe(r){if(r.kind==='MATRIX')return Math.max(1,dim(r,'rows')*dim(r,'columns'));if(r.kind==='GRAPH'){const n=dim(r,'vertexCount');return Math.max(1,n*(n-1)/2)}if(r.kind==='HYPERGRAPH')return Math.max(1,comb(dim(r,'vertexCount'),dim(r,'uniformity')));if(r.kind==='PROGRAM')return Math.max(1,dim(r,'maxNodes'));return Math.max(1,dim(r,'universeSize',dim(r,'length',1)))}
function selected(genes,r){const bits=['BOOLEAN_VECTOR','GRAPH','HYPERGRAPH'].includes(r.kind);return new Set(bits?genes.flatMap((v,i)=>v?[i]:[]):genes.filter(x=>Number.isInteger(x)&&x>=0&&x<universe(r)))}
function triples(values,n){const p=[...values].map(x=>[x%n,Math.floor(x/n)]);let c=0;for(let i=0;i<p.length;i++)for(let j=i+1;j<p.length;j++)for(let k=j+1;k<p.length;k++)if((p[j][0]-p[i][0])*(p[k][1]-p[i][1])===(p[j][1]-p[i][1])*(p[k][0]-p[i][0]))c++;return c}
function evaluate(genes,r,e){const s=selected(genes,r);let violations=0,coverage=0;const details=[];for(const c of e.constraints){let value=0,passed=true,detail='';if(c.kind==='forbidden-tuples'){value=c.tuples.filter(t=>t.every(x=>s.has(x))).length;passed=value===0;detail=value+' forbidden tuples selected'}if(c.kind==='coverage-groups'){value=c.groups.filter(g=>g.some(x=>s.has(x))).length;coverage+=value;detail=value+'/'+c.groups.length+' groups covered'}if(c.kind==='cardinality'){value=Math.abs(s.size-c.target);passed=value===0;detail='cardinality delta '+value}if(c.kind==='all-different'){value=genes.length-new Set(genes).size;passed=value===0;detail=value+' repeated values'}if(c.kind==='bounds'){value=genes.filter(x=>x<c.min||x>c.max).length;passed=value===0;detail=value+' values outside bounds'}if(c.kind==='grid-no-three-in-line'){value=triples(s,c.boardSize);passed=value===0;detail=value+' collinear triples'}if(c.kind==='expression-node-limit'){value=Math.max(0,genes.length-c.maxNodes);passed=value===0;detail='expression node excess '+value}if(!passed)violations+=value||1;details.push({kind:c.kind,passed,value,detail})}const a=[...s].sort((x,y)=>x-y);let spread=0;for(let i=0;i<a.length;i++)for(let j=i+1;j<a.length;j++)spread+=Math.abs(a[j]-a[i]);const value=e.objectives.reduce((total,o)=>total+(o.direction==='minimize'?-1:1)*(o.metric==='violations'?violations:o.metric==='coverage'?coverage:o.metric==='spread'?spread:0),0);return {genes,violations,coverage,spread,value,constraintResults:details}}
parentPort.postMessage(workerData.population.map(genes=>evaluate(genes,workerData.representation,workerData.evaluator)));
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
    if (raw && typeof raw === 'object' && 'specification' in raw) {
      const value = raw as { specification: DiscoverySpecification | unknown; config: DiscoveryConfig };
      return this.startSpecification(projectId, value.specification, value.config, signal);
    }
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

  /**
   * Generic discovery entrance.  The evaluator is a closed declarative DSL;
   * no user or model supplied JavaScript/Python is ever evaluated here.
   */
  async startSpecification(projectId: string, rawSpecification: DiscoverySpecification | unknown, rawConfig: DiscoveryConfig, signal?: AbortSignal): Promise<DiscoveryRun> {
    const config = configSchema.parse(rawConfig);
    const source = rawSpecification && typeof rawSpecification === 'object' && 'representation' in rawSpecification
      ? rawSpecification as DiscoverySpecification : null;
    // Rebuild from the data-only core on every execution. Persisted validation
    // flags/hashes are audit evidence, never a bypass around current validators.
    const specification = makeDiscoverySpecification(projectId, source
      ? { representation: source.representation, evaluator: source.evaluator, semanticScope: source.semanticScope }
      : rawSpecification, source?.origin ?? 'MODEL_PROPOSED');
    if (!specification.validation.schemaValid || !specification.validation.staticValid || !specification.validation.smallCaseValid || !specification.validation.adversarialValid) {
      throw new Error(`DISCOVERY_SPEC_INVALID: ${specification.validation.errors.join(' ') || 'Specification did not pass safety validation.'}`);
    }
    if (config.populationSize * config.generations > (config.evaluationBudget ?? 1_000_000)) throw new Error('RESOURCE_BUDGET_EXCEEDED: discovery configuration exceeds its declared evaluation budget.');
    const budget = new ResourceBudgetService(this.db).current(projectId);
    if (config.workerCount > budget.limits.maxWorkers) throw new Error(`RESOURCE_BUDGET_EXCEEDED: workerCount exceeds project limit ${budget.limits.maxWorkers}.`);
    new ResourceBudgetService(this.db).consume(projectId, 'evaluations', config.populationSize * config.generations);
    const now = new Date().toISOString();
    const legacyProblem: DiscoveryProblem = { universeSize: representationUniverse(specification.representation), candidateSize: Number(specification.representation.dimensions.length ?? 1), incompatibilities: [], coverageGroups: [] };
    const run: DiscoveryRun = {
      id: randomUUID(), projectId, status: 'RUNNING', problem: legacyProblem, config, generation: 0, totalEvaluated: 0, population: [], archive: [], rngState: config.seed,
      startedAt: now, updatedAt: now, completedAt: null, error: '', specification, candidateCertificates: [],
    };
    let state = config.seed;
    for (let index = 0; index < config.populationSize; index += 1) { const candidate = createCandidate(specification.representation, state); state = candidate.state; run.population.push(candidate.genes); }
    run.rngState = state;
    this.db.saveRecord('discoverySpecifications', specification);
    this.db.saveRecord('discoveryRuns', run);
    return this.executeGeneric(run, signal);
  }

  async resume(projectId: string, runId: string, signal?: AbortSignal): Promise<DiscoveryRun> {
    const run = this.db.getProject(projectId, false).discoveryRuns.find((item) => item.id === runId);
    if (!run) throw new Error('Discovery run was not found in this project.');
    if (run.status === 'COMPLETED') return run;
    const resumed: DiscoveryRun = { ...run, status: 'RUNNING', error: '', completedAt: null, updatedAt: new Date().toISOString() };
    this.db.saveRecord('discoveryRuns', resumed);
    return resumed.specification ? this.executeGeneric(resumed, signal) : this.execute(resumed, signal);
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

  private async executeGeneric(initial: DiscoveryRun, signal?: AbortSignal): Promise<DiscoveryRun> {
    let run = initial; const specification = run.specification;
    if (!specification) return run;
    try {
      for (let generation = run.generation; generation < run.config.generations; generation += 1) {
        this.throwIfAborted(signal);
        const rawEvaluated = await this.evaluateGenericPopulation(run.population, specification, run.config.workerCount, signal);
        this.throwIfAborted(signal);
        const evaluated = rawEvaluated.map((result) => {
          const genes = result.genes;
          const fingerprint = digest({ representation: specification.representation, genes });
          const candidate: DiscoveryCandidate = {
            fingerprint, genes, value: candidateValue(genes, specification.representation), representation: specification.representation,
            violations: result.violations, coverage: result.coverage, spread: result.spread, novelty: novelty(genes, run.archive), paretoRank: 0,
            objectiveValues: { violations: result.violations, coverage: result.coverage, spread: result.spread, novelty: novelty(genes, run.archive), value: result.value }, constraintResults: result.constraintResults,
            evaluatorHash: specification.evaluatorHash, generation, strategy: run.config.strategy ?? 'evolutionary',
          };
          return candidate;
        });
        const archive = selectArchive([...run.archive, ...evaluated], run.config.archiveLimit, specification.evaluator);
        let state = run.rngState; const next: number[][] = archive.slice(0, Math.min(8, archive.length)).map((candidate) => candidate.genes);
        const parents = archive.length ? archive : evaluated;
        while (next.length < run.config.populationSize) {
          const a = nextRandom(state); state = a.state; const b = nextRandom(state); state = b.state;
          const first = parents[Math.floor(a.value * parents.length)].genes; const second = parents[Math.floor(b.value * parents.length)].genes;
          let child: { genes: number[]; state: number };
          switch (run.config.strategy ?? 'evolutionary') {
            case 'random': child = createCandidate(specification.representation, state); break;
            case 'hill-climbing': child = mutateCandidate(first, specification.representation, run.config.mutationRate, state); break;
            case 'beam': child = mutateCandidate(parents[Math.min(next.length, parents.length - 1)].genes, specification.representation, run.config.mutationRate / 2, state); break;
            case 'annealing': child = mutateCandidate(first, specification.representation, Math.max(.01, run.config.mutationRate * (1 - generation / run.config.generations)), state); break;
            default: child = crossoverCandidate(first, second, specification.representation, state); child = mutateCandidate(child.genes, specification.representation, run.config.mutationRate, child.state);
          }
          state = child.state; next.push(child.genes);
        }
        const certificates = archive.slice(0, 32).map((candidate) => ({ fingerprint: candidate.fingerprint, candidateHash: digest(candidate.value), evaluatorHash: specification.evaluatorHash, resultHash: digest({ objectiveValues: candidate.objectiveValues, constraintResults: candidate.constraintResults }), createdAt: new Date().toISOString() }));
        run = { ...run, generation: generation + 1, totalEvaluated: run.totalEvaluated + evaluated.length, archive, population: next, rngState: state, candidateCertificates: certificates, updatedAt: new Date().toISOString() };
        this.db.saveRecord('discoveryRuns', run);
      }
      const complete = { ...run, status: 'COMPLETED' as const, completedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; this.db.saveRecord('discoveryRuns', complete); return complete;
    } catch (error) {
      const paused = error instanceof DiscoveryAbortError; const message = paused ? 'Paused by user; resume continues from the last checkpoint.' : error instanceof Error ? error.message : 'Discovery evaluator failed.';
      const saved = { ...run, status: paused ? 'PAUSED' as const : 'FAILED' as const, error: message, failureCode: paused ? 'CANCELLED' as const : 'WORKER_FAILURE' as const, updatedAt: new Date().toISOString(), completedAt: paused ? null : new Date().toISOString() };
      this.db.saveRecord('discoveryRuns', saved); return saved;
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

  private async evaluateGenericPopulation(population: number[][], specification: DiscoverySpecification, workerCount: number, signal?: AbortSignal): Promise<Array<ReturnType<typeof evaluateCandidate>>> {
    const count = Math.min(workerCount, population.length);
    const chunks = Array.from({ length: count }, () => [] as number[][]); population.forEach((candidate, index) => chunks[index % count].push(candidate));
    const values = await Promise.all(chunks.filter((chunk) => chunk.length).map((chunk) => evaluateGenericChunk(chunk, specification, signal)));
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

function evaluateGenericChunk(population: number[][], specification: DiscoverySpecification, signal?: AbortSignal): Promise<Array<ReturnType<typeof evaluateCandidate>>> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DiscoveryAbortError()); return; }
    const worker = new Worker(genericEvaluatorSource, { eval: true, workerData: { population, representation: specification.representation, evaluator: specification.evaluator } });
    let settled = false;
    const settle = (callback: () => void) => { if (settled) return; settled = true; signal?.removeEventListener('abort', abort); callback(); };
    const abort = () => { void worker.terminate(); settle(() => reject(new DiscoveryAbortError())); };
    signal?.addEventListener('abort', abort, { once: true });
    worker.once('message', (value: Array<ReturnType<typeof evaluateCandidate>>) => settle(() => resolve(value)));
    worker.once('error', (error) => settle(() => reject(error)));
    worker.once('exit', (code) => { if (code !== 0) settle(() => reject(new Error(`Generic discovery evaluator worker exited with code ${code}.`))); });
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

function dominates(left: DiscoveryCandidate, right: DiscoveryCandidate, evaluator?: DiscoverySpecification['evaluator']): boolean {
  if (evaluator) {
    if (left.violations > right.violations) return false;
    const leftValues = objectiveValues(left); const rightValues = objectiveValues(right);
    const noWorse = evaluator.objectives.every((objective) => objectiveUtility(objective, leftValues) >= objectiveUtility(objective, rightValues));
    const better = left.violations < right.violations || evaluator.objectives.some((objective) => objectiveUtility(objective, leftValues) > objectiveUtility(objective, rightValues));
    return noWorse && better;
  }
  const noWorse = left.violations <= right.violations && left.coverage >= right.coverage && left.spread >= right.spread && left.novelty >= right.novelty;
  return noWorse && (left.violations < right.violations || left.coverage > right.coverage || left.spread > right.spread || left.novelty > right.novelty);
}

function selectArchive(candidates: DiscoveryCandidate[], limit: number, evaluator?: DiscoverySpecification['evaluator']): DiscoveryCandidate[] {
  const unique = [...new Map(candidates.map((candidate) => [candidate.fingerprint, candidate])).values()];
  const remaining = new Set(unique.map((candidate) => candidate.fingerprint)); const ranked: DiscoveryCandidate[] = []; let rank = 0;
  while (remaining.size) {
    const front = unique.filter((candidate) => remaining.has(candidate.fingerprint) && !unique.some((other) => remaining.has(other.fingerprint) && other.fingerprint !== candidate.fingerprint && dominates(other, candidate, evaluator)));
    if (!front.length) break;
    front.sort((left, right) => compareCandidates(left, right, evaluator)); front.forEach((candidate) => { ranked.push({ ...candidate, paretoRank: rank }); remaining.delete(candidate.fingerprint); }); rank += 1;
    if (ranked.length >= limit) break;
  }
  return ranked.slice(0, limit);
}

function compareCandidates(left: DiscoveryCandidate, right: DiscoveryCandidate, evaluator?: DiscoverySpecification['evaluator']): number {
  if (evaluator) {
    const hard = left.violations - right.violations; if (hard) return hard;
    const leftValues = objectiveValues(left); const rightValues = objectiveValues(right);
    if (evaluator.aggregation === 'weighted') {
      const leftScore = aggregateObjectiveValue(evaluator, leftValues); const rightScore = aggregateObjectiveValue(evaluator, rightValues);
      if (leftScore !== rightScore) return rightScore - leftScore;
    } else if (evaluator.aggregation === 'lexicographic') {
      for (const objective of evaluator.objectives) { const difference = objectiveUtility(objective, rightValues) - objectiveUtility(objective, leftValues); if (difference) return difference; }
    }
  }
  return left.violations - right.violations || right.coverage - left.coverage || right.spread - left.spread || right.novelty - left.novelty || left.fingerprint.localeCompare(right.fingerprint);
}
function objectiveValues(candidate: DiscoveryCandidate): Record<string, number> { return { violations: candidate.violations, coverage: candidate.coverage, spread: candidate.spread, novelty: candidate.novelty, value: 0, ...candidate.objectiveValues }; }

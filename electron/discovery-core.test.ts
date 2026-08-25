import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CandidateRepresentation, DiscoveryConfig } from '../src/shared/types';
import { createCandidate, evaluateCandidate, makeDiscoverySpecification, validateDiscoveryDefinition } from './discovery-core';
import { ResearchDatabase } from './database';
import { DiscoveryEngine } from './discovery-engine';

const directories: string[] = []; const databases: ResearchDatabase[] = [];
const config: DiscoveryConfig = { populationSize: 8, generations: 3, workerCount: 2, seed: 71, mutationRate: .2, archiveLimit: 16, strategy: 'beam', evaluationBudget: 24 };
function setup() { const directory = mkdtempSync(join(tmpdir(), 'mra-discovery-core-')); directories.push(directory); const db = new ResearchDatabase(join(directory, 'research.sqlite3')); databases.push(db); const projectId = db.createProject({ name: 'generic discovery', question: 'construction', goal: '', background: '', knownResults: '', constraints: '', mode: 'autonomous' }).project.id; return { db, projectId }; }
afterEach(() => { while (databases.length) databases.pop()!.close(); while (directories.length) rmSync(directories.pop()!, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); });

describe('generic discovery representation and evaluator', () => {
  it('interprets every candidate kind as data, never executable source', () => {
    const kinds: CandidateRepresentation['kind'][] = ['SET', 'SUBSET', 'TUPLE', 'SEQUENCE', 'PERMUTATION', 'MATRIX', 'GRAPH', 'HYPERGRAPH', 'INTEGER_VECTOR', 'BOOLEAN_VECTOR', 'STRUCTURED_OBJECT', 'PROGRAM'];
    for (const kind of kinds) {
      const dimensions: Record<string, number | string> = kind === 'MATRIX' ? { rows: 2, columns: 3 } : kind === 'GRAPH' ? { vertexCount: 4 } : kind === 'HYPERGRAPH' ? { vertexCount: 5, uniformity: 3 } : kind === 'PROGRAM' ? { maxNodes: 5 } : kind === 'STRUCTURED_OBJECT' ? { length: 3, universeSize: 8, fields: 'a,b,c' } : { length: 3, universeSize: 8 };
      const representation: CandidateRepresentation = { kind, dimensions, schemaVersion: 1 };
      const candidate = createCandidate(representation, 71);
      const result = evaluateCandidate(candidate.genes, representation, { version: 1, constraints: [{ kind: 'bounds', min: 0, max: 1_000_000 }], objectives: [{ name: 'violations', direction: 'minimize', metric: 'violations' }], aggregation: 'pareto' });
      expect(result.violations).toBeGreaterThanOrEqual(0);
    }
  });

  it('validates a 71 by 71, 142-point no-three-in-line representation without legacy 4096 caps', () => {
    const specification = makeDiscoverySpecification('n71', { representation: { kind: 'SET', dimensions: { universeSize: 71 * 71, length: 142 }, schemaVersion: 1 }, evaluator: { version: 1, constraints: [{ kind: 'grid-no-three-in-line', boardSize: 71 }, { kind: 'cardinality', target: 142 }], objectives: [{ name: 'violations', direction: 'minimize', metric: 'violations' }, { name: 'spread', direction: 'maximize', metric: 'spread' }], aggregation: 'pareto' }, semanticScope: 'Select 142 cells of a 71 by 71 grid with no three collinear.' });
    expect(specification.validation.errors).toEqual([]);
    expect(specification.representation.dimensions.universeSize).toBe(5_041);
    expect(specification.validation.smallCaseValid).toBe(true);
  });

  it('rejects non-declarative and malformed evaluator definitions before search', () => {
    const invalid = validateDiscoveryDefinition({ representation: { kind: 'SET', dimensions: { universeSize: 9, length: 3 }, schemaVersion: 1 }, evaluator: { version: 1, constraints: [{ kind: 'javascript', code: 'process.exit()' }], objectives: [{ name: 'v', direction: 'minimize', metric: 'violations' }], aggregation: 'pareto' }, semanticScope: 'unsafe' });
    expect(invalid.errors.length).toBeGreaterThan(0);
  });

  it('persists deterministic generic certificates and obeys the evaluation budget', async () => {
    const first = setup(); const second = setup();
    const input = { representation: { kind: 'SET', dimensions: { universeSize: 16, length: 5 }, schemaVersion: 1 }, evaluator: { version: 1, constraints: [{ kind: 'forbidden-tuples', arity: 2, tuples: [[0, 1], [2, 3]] }, { kind: 'cardinality', target: 5 }], objectives: [{ name: 'violations', direction: 'minimize', metric: 'violations' }, { name: 'spread', direction: 'maximize', metric: 'spread' }], aggregation: 'pareto' }, semanticScope: 'finite set construction' };
    const a = await new DiscoveryEngine(first.db).startSpecification(first.projectId, input, config);
    const b = await new DiscoveryEngine(second.db).startSpecification(second.projectId, input, config);
    expect(a.status).toBe('COMPLETED'); expect(a.totalEvaluated).toBe(24); expect(a.candidateCertificates?.length).toBeGreaterThan(0);
    expect(a.archive).toEqual(b.archive);
    await expect(new DiscoveryEngine(first.db).startSpecification(first.projectId, input, { ...config, generations: 5, evaluationBudget: 32 })).rejects.toThrow('RESOURCE_BUDGET_EXCEEDED');
  });
});

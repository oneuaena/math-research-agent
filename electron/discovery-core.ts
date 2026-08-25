import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { CandidateRepresentation, CandidateRepresentationKind, DiscoveryCandidate, DiscoverySpecification, EvaluatorDefinition } from '../src/shared/types';

const integer = z.number().int();
const representationSchema = z.object({
  kind: z.enum(['SET', 'SUBSET', 'TUPLE', 'SEQUENCE', 'PERMUTATION', 'MATRIX', 'GRAPH', 'HYPERGRAPH', 'INTEGER_VECTOR', 'BOOLEAN_VECTOR', 'STRUCTURED_OBJECT', 'PROGRAM']),
  dimensions: z.record(z.string(), z.union([integer, z.string().max(4_000), z.boolean()])), schemaVersion: z.literal(1),
}).strict();
const constraintSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('forbidden-tuples'), tuples: z.array(z.array(integer).min(2).max(8)).max(250_000), arity: integer.min(2).max(8) }).strict(),
  z.object({ kind: z.literal('coverage-groups'), groups: z.array(z.array(integer).min(1).max(20_000)).max(20_000) }).strict(),
  z.object({ kind: z.literal('cardinality'), target: integer.min(0).max(100_000) }).strict(),
  z.object({ kind: z.literal('all-different') }).strict(),
  z.object({ kind: z.literal('bounds'), min: integer.min(-1_000_000), max: integer.max(1_000_000) }).strict(),
  z.object({ kind: z.literal('grid-no-three-in-line'), boardSize: integer.min(2).max(512) }).strict(),
  z.object({ kind: z.literal('expression-node-limit'), maxNodes: integer.min(1).max(10_000) }).strict(),
]);
const evaluatorSchema = z.object({
  version: z.literal(1), constraints: z.array(constraintSchema).max(64),
  objectives: z.array(z.object({ name: z.string().min(1).max(100), direction: z.enum(['minimize', 'maximize', 'target']), metric: z.enum(['violations', 'coverage', 'spread', 'novelty', 'value']), target: z.number().finite().optional() }).strict()).min(1).max(12),
  aggregation: z.enum(['pareto', 'lexicographic', 'weighted']), weights: z.record(z.string(), z.number().finite()).optional(),
}).strict();
export const genericDiscoverySpecificationSchema = z.object({
  representation: representationSchema, evaluator: evaluatorSchema, semanticScope: z.string().min(1).max(12_000),
}).strict();

export interface EvaluatedCandidate { genes: number[]; violations: number; coverage: number; spread: number; value: number; constraintResults: DiscoveryCandidate['constraintResults']; }

export function digest(value: unknown): string { return createHash('sha256').update(canonical(value)).digest('hex'); }
export function canonical(value: unknown): string { return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item); }

function dimension(value: CandidateRepresentation, name: string, fallback = 0): number {
  const candidate = value.dimensions[name]; return typeof candidate === 'number' && Number.isInteger(candidate) ? candidate : fallback;
}
function requireDimension(value: CandidateRepresentation, name: string, min: number, errors: string[]): number {
  const found = dimension(value, name, -1); if (found < min) errors.push(`${value.kind} requires integer dimensions.${name} >= ${min}.`); return found;
}

/** Schema/static/small/adversarial validation, before a worker or evaluator is allowed to run. */
export function validateDiscoveryDefinition(input: unknown): { representation: CandidateRepresentation; evaluator: EvaluatorDefinition; errors: string[] } {
  const parsed = genericDiscoverySpecificationSchema.safeParse(input);
  if (!parsed.success) return { representation: { kind: 'SET', dimensions: {}, schemaVersion: 1 }, evaluator: { version: 1, constraints: [], objectives: [], aggregation: 'pareto' }, errors: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`) };
  const { representation, evaluator } = parsed.data; const errors: string[] = [];
  const vectorKinds: CandidateRepresentationKind[] = ['SET', 'SUBSET', 'TUPLE', 'SEQUENCE', 'PERMUTATION', 'INTEGER_VECTOR', 'BOOLEAN_VECTOR'];
  if (vectorKinds.includes(representation.kind)) requireDimension(representation, 'length', 1, errors);
  if (representation.kind === 'SET' || representation.kind === 'SUBSET' || representation.kind === 'PERMUTATION') requireDimension(representation, 'universeSize', 1, errors);
  if (representation.kind === 'MATRIX') { requireDimension(representation, 'rows', 1, errors); requireDimension(representation, 'columns', 1, errors); }
  if (representation.kind === 'GRAPH') requireDimension(representation, 'vertexCount', 1, errors);
  if (representation.kind === 'HYPERGRAPH') { requireDimension(representation, 'vertexCount', 1, errors); requireDimension(representation, 'uniformity', 2, errors); }
  if (representation.kind === 'PROGRAM' && dimension(representation, 'maxNodes', 0) < 1) errors.push('PROGRAM requires dimensions.maxNodes >= 1; it is interpreted as expression-tree node count, not executable code.');
  const universe = representationUniverse(representation);
  if (universe > 65_536 || candidateLength(representation) > 65_536) errors.push('Representation exceeds the local bounded evaluator limit of 65,536 encoded positions.');
  for (const constraint of evaluator.constraints) {
    if (constraint.kind === 'forbidden-tuples') for (const tuple of constraint.tuples) {
      if (tuple.length !== constraint.arity || new Set(tuple).size !== tuple.length || tuple.some((item) => item < 0 || item >= universe)) errors.push('forbidden-tuples must have distinct in-range members with declared arity.');
    }
    if (constraint.kind === 'coverage-groups' && constraint.groups.some((group) => group.some((item) => item < 0 || item >= universe))) errors.push('coverage-groups contains an out-of-range member.');
    if (constraint.kind === 'grid-no-three-in-line' && universe < constraint.boardSize * constraint.boardSize) errors.push('grid-no-three-in-line requires a representation universe of boardSize².');
  }
  if (!evaluator.objectives.some((objective) => objective.metric === 'violations')) errors.push('An evaluator must optimize violations so feasibility is auditable.');
  for (const objective of evaluator.objectives) {
    if (objective.direction === 'target' && objective.target === undefined) errors.push(`Target objective ${objective.name} requires a numeric target.`);
  }
  if (evaluator.aggregation === 'weighted') {
    if (!evaluator.weights || evaluator.objectives.some((objective) => !Number.isFinite(evaluator.weights?.[objective.name]))) errors.push('Weighted aggregation requires one finite weight for every objective.');
  }
  return { representation, evaluator, errors: [...new Set(errors)] };
}

export function makeDiscoverySpecification(projectId: string, input: unknown, origin: DiscoverySpecification['origin'] = 'MODEL_PROPOSED'): DiscoverySpecification {
  const validation = validateDiscoveryDefinition(input); const createdAt = new Date().toISOString();
  const payload = input as { semanticScope?: string };
  const validationResult = { schemaValid: validation.errors.length === 0, staticValid: validation.errors.length === 0, smallCaseValid: false, adversarialValid: false, errors: validation.errors };
  const specification: DiscoverySpecification = {
    id: crypto.randomUUID(), projectId, representation: validation.representation, evaluator: validation.evaluator, origin,
    semanticScope: typeof payload.semanticScope === 'string' ? payload.semanticScope : '', validation: validationResult,
    evaluatorHash: digest(validation.evaluator), specificationHash: '', createdAt, updatedAt: createdAt,
  };
  specification.specificationHash = digest({ representation: specification.representation, evaluator: specification.evaluator, semanticScope: specification.semanticScope });
  if (!validation.errors.length) {
    const sample = createCandidate(specification.representation, 71).genes;
    const evaluated = evaluateCandidate(sample, specification.representation, specification.evaluator);
    specification.validation.smallCaseValid = Number.isFinite(evaluated.violations) && Number.isFinite(evaluated.coverage);
    // Adversarial value checks prove that malformed values are rejected by the interpreter rather than executed.
    try {
      // Deliberately malformed numeric genes must be treated as data, not code,
      // and must not escape the evaluator's bounded interpreter.
      evaluateCandidate([-1, Number.MAX_SAFE_INTEGER], specification.representation, specification.evaluator);
      specification.validation.adversarialValid = true;
    } catch (error) {
      specification.validation.errors.push(`Adversarial evaluator validation failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }
  return specification;
}

export function representationUniverse(representation: CandidateRepresentation): number {
  const kind = representation.kind;
  if (kind === 'MATRIX') return Math.max(1, dimension(representation, 'rows') * dimension(representation, 'columns'));
  if (kind === 'GRAPH') { const n = dimension(representation, 'vertexCount'); return Math.max(1, (n * (n - 1)) / 2); }
  if (kind === 'HYPERGRAPH') { const n = dimension(representation, 'vertexCount'); const k = dimension(representation, 'uniformity'); return Math.max(1, combinations(n, k)); }
  if (kind === 'PROGRAM') return Math.max(1, dimension(representation, 'maxNodes'));
  return Math.max(1, dimension(representation, 'universeSize', dimension(representation, 'length', 1)));
}

export function createCandidate(representation: CandidateRepresentation, seed: number): { genes: number[]; state: number } {
  let state = seed; const length = candidateLength(representation); const universe = representationUniverse(representation); const genes: number[] = [];
  const unique = ['SET', 'SUBSET', 'PERMUTATION'].includes(representation.kind);
  const min = dimension(representation, 'min', 0); const max = dimension(representation, 'max', Math.max(1, universe - 1));
  while (genes.length < length) {
    const next = random(state); state = next.state; const gene = representation.kind === 'BOOLEAN_VECTOR' || representation.kind === 'GRAPH' || representation.kind === 'HYPERGRAPH' ? Math.floor(next.value * 2) : min + Math.floor(next.value * (max - min + 1));
    const normalized = unique ? Math.floor(next.value * universe) : gene;
    if (!unique || !genes.includes(normalized)) genes.push(normalized);
  }
  if (unique) genes.sort((a, b) => a - b);
  return { genes, state };
}

export function mutateCandidate(genes: number[], representation: CandidateRepresentation, rate: number, seed: number): { genes: number[]; state: number } {
  let state = seed; const out = [...genes]; const unique = ['SET', 'SUBSET', 'PERMUTATION'].includes(representation.kind); const universe = representationUniverse(representation); const min = dimension(representation, 'min', 0); const max = dimension(representation, 'max', Math.max(1, universe - 1));
  for (let index = 0; index < out.length; index += 1) { const trigger = random(state); state = trigger.state; if (trigger.value > rate) continue; const value = random(state); state = value.state; let gene = unique ? Math.floor(value.value * universe) : min + Math.floor(value.value * (max - min + 1)); if (representation.kind === 'BOOLEAN_VECTOR' || representation.kind === 'GRAPH' || representation.kind === 'HYPERGRAPH') gene = out[index] ? 0 : 1; if (!unique || !out.some((item, other) => other !== index && item === gene)) out[index] = gene; }
  if (unique) out.sort((a, b) => a - b); return { genes: out, state };
}

export function crossoverCandidate(first: number[], second: number[], representation: CandidateRepresentation, seed: number): { genes: number[]; state: number } {
  let state = seed; const length = candidateLength(representation); const unique = ['SET', 'SUBSET', 'PERMUTATION'].includes(representation.kind); const out: number[] = [];
  for (let index = 0; index < length; index += 1) { const pick = random(state); state = pick.state; const value = (pick.value < .5 ? first : second)[index % Math.max(1, (pick.value < .5 ? first : second).length)] ?? 0; if (!unique || !out.includes(value)) out.push(value); }
  while (out.length < length) { const created = createCandidate(representation, state); state = created.state; for (const gene of created.genes) if (!unique || !out.includes(gene)) { out.push(gene); if (out.length === length) break; } }
  if (unique) out.sort((a, b) => a - b); return { genes: out, state };
}

export function evaluateCandidate(genes: number[], representation: CandidateRepresentation, evaluator: EvaluatorDefinition): EvaluatedCandidate {
  const selected = selectedIndices(genes, representation); let violations = 0; let coverage = 0; const details: NonNullable<DiscoveryCandidate['constraintResults']> = [];
  for (const constraint of evaluator.constraints) {
    let value = 0; let passed = true; let detail = '';
    if (constraint.kind === 'forbidden-tuples') { value = constraint.tuples.filter((tuple) => tuple.every((member) => selected.has(member))).length; passed = value === 0; detail = `${value} forbidden tuples selected`; }
    if (constraint.kind === 'coverage-groups') { value = constraint.groups.filter((group) => group.some((member) => selected.has(member))).length; coverage += value; passed = true; detail = `${value}/${constraint.groups.length} groups covered`; }
    if (constraint.kind === 'cardinality') { value = Math.abs(selected.size - constraint.target); passed = value === 0; detail = `cardinality delta ${value}`; }
    if (constraint.kind === 'all-different') { value = genes.length - new Set(genes).size; passed = value === 0; detail = `${value} repeated values`; }
    if (constraint.kind === 'bounds') { value = genes.filter((gene) => gene < constraint.min || gene > constraint.max).length; passed = value === 0; detail = `${value} values outside bounds`; }
    if (constraint.kind === 'grid-no-three-in-line') { value = collinearTriples(selected, constraint.boardSize); passed = value === 0; detail = `${value} collinear triples`; }
    if (constraint.kind === 'expression-node-limit') { value = Math.max(0, genes.length - constraint.maxNodes); passed = value === 0; detail = `expression node excess ${value}`; }
    if (!passed) violations += value || 1; details.push({ kind: constraint.kind, passed, value, detail });
  }
  const items = [...selected].sort((a, b) => a - b); let spread = 0; for (let left = 0; left < items.length; left += 1) for (let right = left + 1; right < items.length; right += 1) spread += Math.abs(items[right] - items[left]);
  return { genes: [...genes], violations, coverage, spread, value: score(violations, coverage, spread, evaluator), constraintResults: details };
}

export function candidateValue(genes: number[], representation: CandidateRepresentation): unknown {
  if (representation.kind === 'MATRIX') { const columns = dimension(representation, 'columns', 1); return Array.from({ length: Math.ceil(genes.length / columns) }, (_, row) => genes.slice(row * columns, (row + 1) * columns)); }
  if (representation.kind === 'STRUCTURED_OBJECT') { const fields = String(representation.dimensions.fields ?? '').split(',').map((item) => item.trim()).filter(Boolean); return Object.fromEntries(genes.map((value, index) => [fields[index] ?? `field${index}`, value])); }
  if (representation.kind === 'PROGRAM') return { language: 'expression-tree-dsl-v1', nodes: genes.map((value, index) => ({ id: index, op: ['constant', 'variable', 'add', 'multiply'][Math.abs(value) % 4] })) };
  return [...genes];
}

function candidateLength(representation: CandidateRepresentation): number { if (representation.kind === 'MATRIX') return dimension(representation, 'rows') * dimension(representation, 'columns'); if (representation.kind === 'GRAPH' || representation.kind === 'HYPERGRAPH') return representationUniverse(representation); return dimension(representation, 'length', dimension(representation, 'maxNodes', 1)); }
function selectedIndices(genes: number[], representation: CandidateRepresentation): Set<number> { const booleanEncoded = ['BOOLEAN_VECTOR', 'GRAPH', 'HYPERGRAPH'].includes(representation.kind); return new Set(booleanEncoded ? genes.flatMap((value, index) => value ? [index] : []) : genes.filter((item) => Number.isInteger(item) && item >= 0 && item < representationUniverse(representation))); }
export function objectiveUtility(objective: EvaluatorDefinition['objectives'][number], values: Record<string, number>): number {
  const value = values[objective.metric] ?? 0;
  if (objective.direction === 'minimize') return -value;
  if (objective.direction === 'maximize') return value;
  return -Math.abs(value - (objective.target ?? 0));
}

/** Objective value is driven only by the declared evaluator, not fixed UI metrics. */
export function aggregateObjectiveValue(evaluator: EvaluatorDefinition, values: Record<string, number>): number {
  return evaluator.objectives.reduce((total, objective, index) => {
    const utility = objectiveUtility(objective, values);
    if (evaluator.aggregation === 'weighted') return total + utility * (evaluator.weights?.[objective.name] ?? 0);
    // Lexicographic and Pareto have no scalar semantics.  This deterministic
    // value is a certificate aid only; archive ordering uses their real rules.
    return total + utility / 10 ** index;
  }, 0);
}
function score(violations: number, coverage: number, spread: number, evaluator: EvaluatorDefinition): number { return aggregateObjectiveValue(evaluator, { violations, coverage, spread, novelty: 0, value: 0 }); }
function random(state: number): { value: number; state: number } { const next = ((state * 48_271) % 2_147_483_647) || 1; return { value: next / 2_147_483_647, state: next }; }
function combinations(n: number, k: number): number { if (k > n || k < 0) return 0; let result = 1; for (let i = 1; i <= k; i += 1) result = (result * (n - k + i)) / i; return Math.min(Math.round(result), 1_000_000); }
function collinearTriples(selected: Set<number>, boardSize: number): number { const points = [...selected].map((point) => [point % boardSize, Math.floor(point / boardSize)] as const); let count = 0; for (let i = 0; i < points.length; i += 1) for (let j = i + 1; j < points.length; j += 1) for (let k = j + 1; k < points.length; k += 1) if ((points[j][0] - points[i][0]) * (points[k][1] - points[i][1]) === (points[j][1] - points[i][1]) * (points[k][0] - points[i][0])) count += 1; return count; }

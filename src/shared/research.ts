import { z } from 'zod';
import type { AgentStage, ProofDocument, ResearchRole, StructuredSpecification, VerificationStatus } from './types';

export const V1_STAGES = [
  'INITIALIZE', 'FORMALIZE', 'PLAN', 'LITERATURE', 'EXPLORE', 'EXPERIMENT', 'PATTERN_DISCOVERY',
  'LEMMA_GENERATION', 'PROOF_ATTEMPT', 'PROOF_CRITIQUE', 'COUNTEREXAMPLE_SEARCH', 'SYMBOLIC_VERIFY',
  'FORMAL_VERIFY', 'SYNTHESIZE', 'REFLECT', 'REPLAN', 'CHECKPOINT', 'COMPLETE', 'PAUSED', 'FAILED',
] as const satisfies readonly AgentStage[];

export const formalizationSchema = z.object({
  quantifiers: z.array(z.string().max(500)).max(30),
  variables: z.array(z.object({ name: z.string().min(1).max(80), domain: z.string().max(500), description: z.string().max(1000) })).max(40),
  domains: z.record(z.string(), z.string().max(1000)),
  assumptions: z.array(z.string().max(2000)).max(100),
  target: z.object({ relation: z.string().max(200), left: z.string().max(4000), right: z.string().max(4000), description: z.string().max(4000) }),
  equivalentForms: z.array(z.string().max(4000)).max(30),
  searchParameters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  validationRules: z.array(z.string().max(2000)).max(50),
  executable: z.object({
    kind: z.enum(['integer-predicate', 'symbolic-identity', 'inequality', 'finite-search']),
    variable: z.string().min(1).max(80), expression: z.string().min(1).max(10_000),
    predicate: z.enum(['is_prime', 'equals_zero', 'nonnegative', 'even', 'custom']),
    range: z.object({ min: z.number().int().nullable(), max: z.number().int().nullable(), sampleCount: z.number().int().min(1).max(1_000_000) }),
    exactArithmetic: z.boolean(),
  }).nullable(),
  symbolicExpressions: z.array(z.string().max(10_000)).max(30),
  leanStatement: z.string().max(20_000).nullable(),
  naturalLanguageOnly: z.boolean(), uncertainty: z.array(z.string().max(2000)).max(50),
  confidence: z.number().min(0).max(1),
});

const proofStepProposalSchema = z.object({
  title: z.string().min(1).max(300), statement: z.string().min(1).max(8000), argument: z.string().max(16_000),
  dependencies: z.array(z.string().max(200)).max(50), critical: z.boolean().default(true),
});

export const nativeToolExecutionSchema = z.object({
  name: z.enum(['run_python', 'symbolic_simplify', 'solve_equation', 'differentiate', 'integrate', 'matrix_compute', 'capability_check', 'z3_check', 'lean_check', 'mathlib_search', 'workspace_write', 'workspace_read', 'download_file', 'run_command']),
  purpose: z.string().min(1).max(500),
  input: z.record(z.string(), z.unknown()),
  ok: z.boolean(),
  success: z.boolean(),
  output: z.string().max(20_000),
  stdout: z.string().max(20_000),
  stderr: z.string().max(20_000),
  error: z.string().max(2000).optional(),
  errorType: z.enum(['NONE', 'TOOL_ERROR', 'PROGRAM_ERROR', 'VALIDATION_ERROR', 'TIMEOUT', 'OUTPUT_LIMIT', 'UNAVAILABLE', 'PROTOCOL_ERROR', 'UNSOUND_PROOF']),
  exitCode: z.number().int().nullable(),
  workerExitCode: z.number().int().nullable().optional(),
  durationMs: z.number().int().min(0),
  timeout: z.boolean(),
  environment: z.string().max(1000).optional(),
  verificationStatus: z.enum(['SUCCESS', 'SAT', 'UNSAT', 'UNKNOWN', 'BOUNDED_CHECK', 'FORMALLY_VERIFIED', 'REJECTED_UNSOUND', 'TOOL_FAILURE', 'PROGRAM_FAILURE']).optional(),
  verificationLevel: z.enum(['CONJECTURE', 'UNCERTAIN', 'HEURISTIC', 'NUMERICAL_EVIDENCE', 'BOUNDED_CHECK', 'SYMBOLIC_CHECK', 'SAT', 'UNSAT', 'UNKNOWN', 'REQUIRES_LEMMA', 'REQUIRES_FORMALIZATION', 'FORMALLY_VERIFIED', 'REFUTED']).optional(),
  reasonUnknown: z.string().max(2000).optional(),
  artifactLocation: z.string().max(2000).optional(),
  auditLogPath: z.string().max(2000).optional(),
});

export const roleActionSchema = z.object({
  title: z.string().min(1).max(300),
  summary: z.string().min(1).max(16_000),
  rationaleSummary: z.string().min(1).max(4000),
  evidence: z.array(z.object({
    title: z.string().min(1).max(300), content: z.string().max(10_000),
    type: z.enum(['exact-computation', 'symbolic-computation', 'numerical-computation', 'user-source', 'model-analysis', 'formal-check']),
    verificationStatus: z.enum(['exactly-verified', 'computationally-verified', 'symbolically-verified', 'numerically-supported', 'llm-assessed-only', 'unverified']),
    reproducible: z.boolean(),
  })).max(30).default([]),
  proposedNodes: z.array(z.object({
    kind: z.enum(['SUBGOAL', 'LEMMA', 'CLAIM', 'IDENTITY', 'PARAMETRIC_FAMILY', 'PROOF_ATTEMPT', 'PROOF_GAP', 'DEAD_END']),
    title: z.string().min(1).max(300), statement: z.string().max(8000),
    status: z.enum(['UNEXPLORED', 'ACTIVE', 'SUPPORTED', 'PROVED_CONDITIONALLY', 'GAP', 'DEAD_END', 'UNKNOWN']),
  })).max(30).default([]),
  branches: z.array(z.object({ title: z.string().min(1).max(300), objective: z.string().max(4000), method: z.string().max(2000), priority: z.number().int().min(1).max(100) })).max(12).default([]),
  proofSteps: z.array(proofStepProposalSchema).max(50).default([]),
  proofReviews: z.array(z.object({
    stepId: z.string().min(1).max(200),
    status: z.enum(['VALID', 'INVALID', 'UNCERTAIN', 'REQUIRES_LEMMA', 'REQUIRES_COMPUTATION', 'REQUIRES_FORMALIZATION']),
    comment: z.string().max(4000),
  })).max(50).default([]),
  toolCalls: z.array(z.object({
    name: z.enum(['run_python', 'symbolic_simplify', 'solve_equation', 'differentiate', 'integrate', 'matrix_compute', 'capability_check', 'z3_check', 'lean_check', 'mathlib_search', 'workspace_write', 'workspace_read', 'download_file', 'run_command']),
    purpose: z.string().min(1).max(500), input: z.record(z.string(), z.unknown()),
  })).max(8).default([]),
  nativeToolExecutions: z.array(nativeToolExecutionSchema).max(12).optional(),
  nextStage: z.enum(V1_STAGES), failures: z.array(z.string().max(3000)).max(30).default([]),
  tokenUsage: z.object({ input: z.number().int().min(0), output: z.number().int().min(0), total: z.number().int().min(0) }).default({ input: 0, output: 0, total: 0 }),
});

export type RoleAction = z.infer<typeof roleActionSchema>;
export type NativeToolExecution = z.infer<typeof nativeToolExecutionSchema>;
export type FormalizationPayload = z.infer<typeof formalizationSchema>;

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
}

function canonicalEnum(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().toUpperCase().replace(/[\s-]+/g, '_')
    : '';
}

function compactFailure(value: unknown): string {
  if (typeof value === 'string') return value.slice(0, 3000);
  const objectValue = record(value);
  if (objectValue) {
    for (const key of ['message', 'reason', 'error', 'description', 'summary', 'title', 'content']) {
      const candidate = objectValue[key];
      if (typeof candidate === 'string' && candidate.trim()) return candidate.trim().slice(0, 3000);
    }
    try { return JSON.stringify(objectValue).slice(0, 3000); }
    catch { return 'Unserializable structured failure.'; }
  }
  return String(value).slice(0, 3000);
}

/**
 * Normalizes narrow, semantics-preserving provider variations before strict validation.
 * It deliberately never upgrades verification status or invents research content.
 */
export function normalizeRoleActionPayload(payload: unknown): unknown {
  const action = record(payload);
  if (!action) return payload;
  const normalized: UnknownRecord = { ...action };

  if (Array.isArray(action.failures)) normalized.failures = action.failures.map(compactFailure);

  if (Array.isArray(action.proposedNodes)) {
    const kindAliases: Record<string, string> = {
      GAP: 'PROOF_GAP', PROOF_GAP: 'PROOF_GAP', PROOF_OBLIGATION: 'PROOF_GAP', MISSING_LEMMA: 'PROOF_GAP',
      GOAL: 'SUBGOAL', TASK: 'SUBGOAL', CONJECTURE: 'CLAIM', HYPOTHESIS: 'CLAIM', RESULT: 'CLAIM',
      PROOF: 'PROOF_ATTEMPT', COUNTEREXAMPLE: 'DEAD_END', FAILED_ROUTE: 'DEAD_END',
    };
    normalized.proposedNodes = action.proposedNodes.map((node) => {
      const item = record(node);
      if (!item) return node;
      const canonical = canonicalEnum(item.kind);
      return { ...item, ...(kindAliases[canonical] ? { kind: kindAliases[canonical] } : {}) };
    });
  }

  if (Array.isArray(action.toolCalls)) {
    const toolAliases: Record<string, string> = {
      PYTHON: 'run_python', RUN_PYTHON: 'run_python', SYMPY: 'symbolic_simplify',
      SYMBOLIC_SIMPLIFICATION: 'symbolic_simplify', Z3: 'z3_check', LEAN: 'lean_check',
      CAPABILITY_CHECK: 'capability_check', RUNTIME_DIAGNOSTICS: 'capability_check',
    };
    normalized.toolCalls = action.toolCalls.map((call) => {
      const item = record(call);
      if (!item) return call;
      const canonical = canonicalEnum(item.name);
      return { ...item, ...(toolAliases[canonical] ? { name: toolAliases[canonical] } : {}) };
    });
  }

  return normalized;
}

export const STAGE_ROLE: Partial<Record<AgentStage, ResearchRole>> = {
  INITIALIZE: 'research-planner', FORMALIZE: 'research-planner', PLAN: 'research-planner', LITERATURE: 'explorer',
  EXPLORE: 'explorer', EXPERIMENT: 'experimental-mathematician', PATTERN_DISCOVERY: 'explorer',
  LEMMA_GENERATION: 'lemma-generator', PROOF_ATTEMPT: 'proof-builder', PROOF_CRITIQUE: 'skeptic',
  COUNTEREXAMPLE_SEARCH: 'experimental-mathematician', SYMBOLIC_VERIFY: 'independent-verifier',
  FORMAL_VERIFY: 'independent-verifier', SYNTHESIZE: 'research-synthesizer', REFLECT: 'research-synthesizer',
  REPLAN: 'research-planner', CHECKPOINT: 'research-synthesizer',
};

export interface TransitionContext {
  hasSpecification: boolean;
  executable: boolean;
  sourceCount: number;
  proofHasGaps: boolean;
  verifiedCounterexample: boolean;
  proofVerified: boolean;
  cycle: number;
  checkpointsInCycle: number;
}

export function chooseNextStage(stage: AgentStage, context: TransitionContext): AgentStage {
  if (context.verifiedCounterexample || context.proofVerified) {
    if (stage === 'CHECKPOINT') return 'COMPLETE';
    return stage === 'SYNTHESIZE' ? 'CHECKPOINT' : 'SYNTHESIZE';
  }
  const transitions: Partial<Record<AgentStage, AgentStage>> = {
    INITIALIZE: 'FORMALIZE', FORMALIZE: 'PLAN', PLAN: context.sourceCount > 0 ? 'LITERATURE' : 'EXPLORE',
    LITERATURE: 'EXPLORE', EXPLORE: context.executable ? 'EXPERIMENT' : 'PATTERN_DISCOVERY',
    EXPERIMENT: 'COUNTEREXAMPLE_SEARCH', COUNTEREXAMPLE_SEARCH: 'PATTERN_DISCOVERY',
    PATTERN_DISCOVERY: 'LEMMA_GENERATION', LEMMA_GENERATION: 'PROOF_ATTEMPT', PROOF_ATTEMPT: 'PROOF_CRITIQUE',
    PROOF_CRITIQUE: context.proofHasGaps && context.cycle < 2 ? 'REFLECT' : 'SYMBOLIC_VERIFY',
    SYMBOLIC_VERIFY: 'FORMAL_VERIFY', FORMAL_VERIFY: 'SYNTHESIZE', REFLECT: 'REPLAN', REPLAN: 'EXPLORE',
    SYNTHESIZE: 'CHECKPOINT', CHECKPOINT: context.checkpointsInCycle >= 5 ? 'PAUSED' : 'EXPLORE',
  };
  return transitions[stage] ?? 'REFLECT';
}

export function proofVerificationStatus(proof: ProofDocument): VerificationStatus {
  if (!proof.independentlyReviewed) return 'unverified';
  if (proof.steps.length === 0 || proof.steps.some((step) => step.critical && step.status !== 'VALID')) return 'unverified';
  return proof.verificationStatus === 'formally-verified' || proof.verificationStatus === 'symbolically-verified' || proof.verificationStatus === 'exactly-verified'
    ? proof.verificationStatus : 'llm-assessed-only';
}

export function canDisplayVerifiedProof(proof: ProofDocument): boolean {
  const status = proofVerificationStatus(proof);
  return proof.status === 'VERIFIED' && status === 'formally-verified';
}

export function specificationLevel(specification: StructuredSpecification): 'machine-executable' | 'symbolic' | 'natural-language' {
  if (specification.executable) return 'machine-executable';
  if (specification.symbolicExpressions.length > 0) return 'symbolic';
  return 'natural-language';
}

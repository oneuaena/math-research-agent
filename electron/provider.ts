import { z } from 'zod';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { app, net } from 'electron';
import {
  formalizationSchema, normalizeRoleActionPayload, roleActionSchema, type FormalizationPayload, type NativeToolExecution, type RoleAction,
} from '../src/shared/research';
import {
  ProviderProtocolError, runProviderToolLoop, type ProviderConversationMessage, type ProviderToolCall,
  type ProviderRequestControl,
} from '../src/shared/provider-protocol';
import { parseProviderHttpResponse, ProviderTransportError } from '../src/shared/provider-transport';
import { extractStructuredJson } from '../src/shared/structured-json';
import { buildProviderSourceContext } from '../src/shared/source-context';
import type {
  AgentStage, DocumentSearchResult, ProjectSnapshot, ProviderConnectionResult, ProviderErrorType, ProviderSettings, ResearchBranch,
  ResearchRole, ToolInvocation, ToolName, ToolResult,
} from '../src/shared/types';
import type { CredentialStore } from './credentials';
import { ProviderDebugLog } from './provider-debug-log';

export interface StageResult { title: string; summary: string; status: 'open' | 'plausible' | 'unverified' | 'verified'; }

export interface ProviderRoleRequest {
  stage: AgentStage;
  role: ResearchRole;
  snapshot: ProjectSnapshot;
  branch: ResearchBranch | null;
  sourceContext?: DocumentSearchResult[];
}

export interface ModelProvider {
  runStage(stage: AgentStage, snapshot: ProjectSnapshot, signal: AbortSignal): Promise<StageResult>;
  formalize(snapshot: ProjectSnapshot, signal: AbortSignal): Promise<FormalizationPayload>;
  runRole(request: ProviderRoleRequest, signal: AbortSignal): Promise<RoleAction>;
  respondChat(messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>, signal: AbortSignal, projectId?: string): Promise<string>;
}

type ErrorPayload = {
  error?: { message?: string; type?: string; code?: string | number };
};

type NativeToolExecutor = (invocation: ToolInvocation) => Promise<ToolResult>;

const nativeToolNames = [
  'run_python', 'symbolic_simplify', 'solve_equation', 'differentiate', 'integrate', 'matrix_compute',
  'capability_check', 'z3_check', 'lean_check', 'mathlib_search', 'workspace_write', 'workspace_read', 'download_file', 'run_command',
] as const satisfies readonly ToolName[];

const nativeToolNameSchema = z.enum(nativeToolNames);
const purposeSchema = z.string().min(1).max(500);
const nativeToolArgumentSchemas: Record<ToolName, z.ZodType<Record<string, unknown>>> = {
  run_python: z.object({ purpose: purposeSchema, code: z.string().min(1).max(20_000) }).passthrough(),
  symbolic_simplify: z.object({ purpose: purposeSchema, expression: z.string().min(1).max(10_000), symbols: z.array(z.string().min(1).max(80)).max(100).optional(), variable: z.string().min(1).max(80).optional() }).passthrough(),
  solve_equation: z.object({ purpose: purposeSchema, expression: z.string().min(1).max(10_000), symbols: z.array(z.string().min(1).max(80)).max(100).optional(), variable: z.string().min(1).max(80).optional() }).passthrough(),
  differentiate: z.object({ purpose: purposeSchema, expression: z.string().min(1).max(10_000), symbols: z.array(z.string().min(1).max(80)).max(100).optional(), variable: z.string().min(1).max(80).optional(), order: z.number().int().min(1).max(20).optional() }).passthrough(),
  integrate: z.object({ purpose: purposeSchema, expression: z.string().min(1).max(10_000), symbols: z.array(z.string().min(1).max(80)).max(100).optional(), variable: z.string().min(1).max(80).optional() }).passthrough(),
  matrix_compute: z.object({ purpose: purposeSchema, matrix: z.array(z.array(z.union([z.string(), z.number()])).max(50)).max(50), operation: z.enum(['det', 'rank', 'eigenvals', 'inverse']) }).passthrough(),
  capability_check: z.object({ purpose: purposeSchema }).passthrough(),
  z3_check: z.object({ purpose: purposeSchema, smt2: z.string().min(1).max(200_000), timeoutMs: z.number().int().min(1).max(120_000).optional() }).passthrough(),
  lean_check: z.object({ purpose: purposeSchema, code: z.string().min(1).max(100_000), bindingId: z.string().uuid(), proofId: z.string().uuid().optional(), formalizationOf: z.string().max(8_000).optional() }).passthrough(),
  mathlib_search: z.object({ purpose: purposeSchema, query: z.string().min(2).max(120) }).passthrough(),
  workspace_write: z.object({ purpose: purposeSchema, path: z.string().min(1).max(240), content: z.string().max(2_000_000) }).passthrough(),
  workspace_read: z.object({ purpose: purposeSchema, path: z.string().min(1).max(240) }).passthrough(),
  download_file: z.object({ purpose: purposeSchema, url: z.string().url().max(4_000), path: z.string().min(1).max(240) }).passthrough(),
  run_command: z.object({ purpose: purposeSchema, command: z.enum(['python', 'lean']), args: z.array(z.string().min(1).max(4_000)).max(100) }).passthrough(),
};

const nativeTools = [
  ['run_python', 'Run bounded Python for an exact or finite mathematical computation.', { purpose: { type: 'string' }, code: { type: 'string' } }, ['purpose', 'code']],
  ['symbolic_simplify', 'Simplify a symbolic expression with SymPy.', { purpose: { type: 'string' }, expression: { type: 'string' }, symbols: { type: 'array', items: { type: 'string' } }, variable: { type: 'string' } }, ['purpose', 'expression']],
  ['solve_equation', 'Solve a symbolic equation represented as expression = 0.', { purpose: { type: 'string' }, expression: { type: 'string' }, symbols: { type: 'array', items: { type: 'string' } }, variable: { type: 'string' } }, ['purpose', 'expression']],
  ['differentiate', 'Differentiate a symbolic expression.', { purpose: { type: 'string' }, expression: { type: 'string' }, symbols: { type: 'array', items: { type: 'string' } }, variable: { type: 'string' }, order: { type: 'integer', minimum: 1, maximum: 20 } }, ['purpose', 'expression']],
  ['integrate', 'Integrate a symbolic expression.', { purpose: { type: 'string' }, expression: { type: 'string' }, symbols: { type: 'array', items: { type: 'string' } }, variable: { type: 'string' } }, ['purpose', 'expression']],
  ['matrix_compute', 'Compute determinant, rank, eigenvalues, or inverse of a finite matrix.', { purpose: { type: 'string' }, matrix: { type: 'array', items: { type: 'array', items: { type: ['number', 'string'] } } }, operation: { type: 'string', enum: ['det', 'rank', 'eigenvals', 'inverse'] } }, ['purpose', 'matrix', 'operation']],
  ['capability_check', 'Report which optional local mathematical verification adapters are available.', { purpose: { type: 'string' } }, ['purpose']],
  ['z3_check', 'Run a bounded SMT-LIB2 satisfiability check. SAT, UNSAT, UNKNOWN, and timeout remain distinct, and the result proves only the supplied encoding.', { purpose: { type: 'string' }, smt2: { type: 'string' }, timeoutMs: { type: 'integer', minimum: 1, maximum: 120000 } }, ['purpose', 'smt2']],
  ['lean_check', 'Compile a Lean 4 theorem only against a pre-existing frozen FORMALIZE binding. bindingId is mandatory and code must have exactly the locked declaration header. Kernel acceptance proves that Lean statement only; the original-language claim is certified only for user-confirmed mappings.', { purpose: { type: 'string' }, code: { type: 'string' }, bindingId: { type: 'string' }, proofId: { type: 'string' }, formalizationOf: { type: 'string' } }, ['purpose', 'code', 'bindingId']],
  ['mathlib_search', 'Search the pinned local Mathlib source for declaration or text fragments. This is local retrieval, not a verification result.', { purpose: { type: 'string' }, query: { type: 'string' } }, ['purpose', 'query']],
  ['workspace_write', 'Persist UTF-8 research data in this project workspace. Use for scripts, seeds, checkpoints, .few files, JSON, and CSV. Paths must be relative and remain available after app restart.', { purpose: { type: 'string' }, path: { type: 'string' }, content: { type: 'string' } }, ['purpose', 'path', 'content']],
  ['workspace_read', 'Read a UTF-8 seed, checkpoint, script, .few, JSON, CSV, or other project-workspace file created earlier. Returns actual file content or an error.', { purpose: { type: 'string' }, path: { type: 'string' } }, ['purpose', 'path']],
  ['download_file', 'Download an HTTP or HTTPS file into this project workspace. Returns the actual saved path, byte count, and SHA-256; verify by calling workspace_read when text is expected.', { purpose: { type: 'string' }, url: { type: 'string' }, path: { type: 'string' } }, ['purpose', 'url', 'path']],
  ['run_command', 'Run an allow-listed local command in this project workspace. command is python or lean only; args are literal arguments, never a shell string. Captures actual stdout, stderr, exit code, and generated files.', { purpose: { type: 'string' }, command: { type: 'string', enum: ['python', 'lean'] }, args: { type: 'array', items: { type: 'string' } } }, ['purpose', 'command', 'args']],
].map(([name, description, properties, required]) => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } },
}));

const nativeToolStages = new Set<AgentStage>([
  'EXPLORE', 'EXPERIMENT', 'PATTERN_DISCOVERY', 'COUNTEREXAMPLE_SEARCH', 'SYMBOLIC_VERIFY', 'FORMAL_VERIFY',
]);

export class ProviderRequestError extends Error {
  constructor(readonly diagnostic: ProviderConnectionResult) {
    super(`${diagnostic.errorType ?? 'UNKNOWN_ERROR'}: ${diagnostic.message}`);
    this.name = 'ProviderRequestError';
  }
}

export function providerErrorForStatus(status: number): ProviderErrorType {
  if (status === 400 || status === 422) return 'BAD_REQUEST';
  if (status === 401 || status === 403) return 'AUTH_FAILED';
  if (status === 402) return 'INSUFFICIENT_BALANCE';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 503) return 'OVERLOADED';
  if (status >= 500) return 'SERVER_ERROR';
  return 'UNKNOWN_ERROR';
}

export function providerNetworkError(error: unknown, callerAborted: boolean, timeoutAborted: boolean): ProviderErrorType {
  if (callerAborted) return 'REQUEST_ABORTED';
  const value = error as { name?: string; message?: string; code?: string; cause?: { code?: string; message?: string } };
  const detail = `${value.name ?? ''} ${value.code ?? ''} ${value.message ?? ''} ${value.cause?.code ?? ''} ${value.cause?.message ?? ''}`.toUpperCase();
  if (timeoutAborted || value.name === 'TimeoutError' || /TIMED[_ -]?OUT|TIMEOUT/.test(detail)) return 'NETWORK_TIMEOUT';
  if (/ENOTFOUND|EAI_AGAIN|NAME_NOT_RESOLVED|DNS/.test(detail)) return 'DNS_ERROR';
  if (/CERT|TLS|SSL|CERTIFICATE|ERR_SSL|ERR_CERT/.test(detail)) return 'TLS_ERROR';
  if (value.name === 'AbortError' || /ERR_ABORTED|ABORTED/.test(detail)) return 'REQUEST_ABORTED';
  return 'UNKNOWN_ERROR';
}

const resultSchema = z.object({
  title: z.string().min(1).max(160),
  summary: z.string().min(1).max(8000),
  status: z.enum(['open', 'plausible', 'unverified', 'verified']).default('unverified'),
});

const roleActionContract = {
  title: 'Short action title',
  summary: 'Concise user-visible research result',
  rationaleSummary: 'Brief rationale without hidden chain of thought',
  evidence: [],
  proposedNodes: [],
  branches: [],
  proofSteps: [],
  proofReviews: [],
  toolCalls: [],
  nextStage: 'FORMALIZE',
  failures: [],
  tokenUsage: { input: 0, output: 0, total: 0 },
};

const roleActionItemContract = {
  evidence: { title: 'string', content: 'string', type: 'exact-computation|symbolic-computation|numerical-computation|user-source|model-analysis|formal-check', verificationStatus: 'exactly-verified|computationally-verified|symbolically-verified|numerically-supported|llm-assessed-only|unverified', reproducible: 'boolean' },
  proposedNodes: { kind: 'SUBGOAL|LEMMA|CLAIM|IDENTITY|PARAMETRIC_FAMILY|PROOF_ATTEMPT|PROOF_GAP|DEAD_END', title: 'string', statement: 'string', status: 'UNEXPLORED|ACTIVE|SUPPORTED|PROVED_CONDITIONALLY|GAP|DEAD_END|UNKNOWN' },
  branches: { title: 'string', objective: 'string', method: 'string', priority: 'integer 1..100' },
  proofSteps: { title: 'string', statement: 'string', argument: 'string', dependencies: 'string[]', critical: 'boolean' },
  proofReviews: { stepId: 'string', status: 'VALID|INVALID|UNCERTAIN|REQUIRES_LEMMA|REQUIRES_COMPUTATION|REQUIRES_FORMALIZATION', comment: 'string' },
  toolCalls: { name: 'run_python|symbolic_simplify|solve_equation|differentiate|integrate|matrix_compute|z3_check|lean_check|workspace_write|workspace_read|download_file|run_command', purpose: 'string', input: 'object' },
};

const localTemplates: Partial<Record<AgentStage, (snapshot: ProjectSnapshot) => StageResult>> = {
  PARSE: (s) => ({ title: 'Conjecture parsed', summary: `Variables: ${s.project.variables || 'unspecified'}\nDomain: ${s.project.domain || 'unspecified'}\nAssumptions: ${s.project.assumptions || 'unspecified'}`, status: 'open' }),
  PLAN_ATTACKS: () => ({ title: 'Attack plan', summary: 'Small cases, boundaries, extremal examples, symbolic manipulation, and parameter sweeps are candidate strategies.', status: 'open' }),
  SMALL_CASES: () => ({ title: 'Small cases', summary: 'No model-only statement is treated as computational evidence.', status: 'unverified' }),
  BOUNDARY: () => ({ title: 'Boundary cases', summary: 'Boundary conditions require a reproducible tool record.', status: 'unverified' }),
  SYMBOLIC: () => ({ title: 'Symbolic checks', summary: 'Symbolic verification requires a recorded exact computation.', status: 'unverified' }),
  EXTREMAL: () => ({ title: 'Extremal cases', summary: 'Extremal constructions remain unverified until evaluated.', status: 'unverified' }),
  VERIFY_CANDIDATE: () => ({ title: 'Candidate verification', summary: 'A candidate must satisfy assumptions and fail the claim on an independent exact rerun.', status: 'unverified' }),
  EXPAND: () => ({ title: 'Expanded search', summary: 'The next parameter region must not duplicate recorded project memory.', status: 'open' }),
  SUMMARIZE: () => ({ title: 'Coverage summary', summary: 'Report tested ranges and remaining uncertainty. Survival is not a proof.', status: 'unverified' }),
  UNDERSTAND: (s) => ({ title: 'Problem structure', summary: `Goal: ${s.project.goal || s.project.question}\n\nAssumptions and definitions require explicit normalization before any proof claim is accepted.`, status: 'open' }),
  PLAN: () => ({ title: 'Research routes', summary: 'Route A: derive consequences from the stated assumptions.\nRoute B: search small or boundary cases for counterexamples.\nRoute C: reformulate using an equivalent invariant or representation.', status: 'open' }),
  EXPLORE: () => ({ title: 'Route comparison', summary: 'Candidate routes are recorded. No route is promoted until its dependencies and boundary cases are checked.', status: 'unverified' }),
  EXPERIMENT: () => ({ title: 'Experiment boundary', summary: 'No question-specific computation was inferred by the local coordinator. Add a structured experiment or configure a model provider.', status: 'open' }),
  VERIFY: () => ({ title: 'Verification pass', summary: 'Statements remain unverified unless supported by a proof, a cited source, or a reproducible tool result.', status: 'unverified' }),
  CRITIQUE: () => ({ title: 'Critical checks', summary: 'Check hidden assumptions, circular dependencies, invalid limit exchanges, omitted edge cases, and counterexamples.', status: 'open' }),
  REFINE: () => ({ title: 'Route refinement', summary: 'Retain only routes whose dependencies remain consistent with the recorded assumptions and evidence.', status: 'plausible' }),
  SYNTHESIZE: (s) => ({ title: 'Research synthesis', summary: `${s.nodes.length} research nodes, ${s.propositions.length} propositions, ${s.experiments.length} experiments, and ${s.failedAttempts.length} failed routes are currently recorded.`, status: 'unverified' }),
  COMPLETE: () => ({ title: 'Run complete', summary: 'The current research record has been persisted. Verification labels are unchanged.', status: 'open' }),
};

export class LocalProvider implements ModelProvider {
  async respondChat(messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>, signal: AbortSignal): Promise<string> {
    if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
    const question = [...messages].reverse().find((message) => message.role === 'user')?.content ?? '';
    return `Local coordinator received: ${question.slice(0, 500)}\n\nConfigure an OpenAI-compatible provider for a model-generated answer. Imported sources and research state remain available to the autonomous workflow.`;
  }

  async runStage(stage: AgentStage, snapshot: ProjectSnapshot, signal: AbortSignal): Promise<StageResult> {
    if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
    await new Promise((resolve) => setTimeout(resolve, 180));
    return localTemplates[stage]?.(snapshot) ?? { title: stage, summary: 'The stage is handled by the autonomous research orchestrator.', status: 'open' };
  }

  async formalize(snapshot: ProjectSnapshot, signal: AbortSignal): Promise<FormalizationPayload> {
    if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
    const project = snapshot.project;
    const text = project.question.trim();
    const normalized = text.replace(/²/g, '**2').replace(/³/g, '**3').replace(/[−–]/g, '-');
    const variableNames = (project.variables || 'n').split(/[,，\s]+/).filter(Boolean).slice(0, 20);
    const variables = variableNames.map((name) => ({ name, domain: project.domain || 'unspecified', description: 'Variable extracted from the project intake.' }));
    let executable: FormalizationPayload['executable'] = null;
    if (/n\s*\*\*2\s*\+\s*n\s*\+\s*1/i.test(normalized) && /prime|素数|質數/i.test(text)) {
      executable = { kind: 'integer-predicate', variable: 'n', expression: 'n**2+n+1', predicate: 'is_prime', range: { min: 1, max: 1000, sampleCount: 1000 }, exactArithmetic: true };
    } else if (/n\s*\*\*2\s*\+\s*n\s*\+\s*41/i.test(normalized) && /prime|素数|質數/i.test(text)) {
      executable = { kind: 'integer-predicate', variable: 'n', expression: 'n**2+n+41', predicate: 'is_prime', range: { min: 0, max: 1000, sampleCount: 1001 }, exactArithmetic: true };
    } else if (/n\s*\(?n\s*\+\s*1\)?/i.test(normalized) && /even|偶数|偶數/i.test(text)) {
      executable = { kind: 'integer-predicate', variable: 'n', expression: 'n*(n+1)', predicate: 'even', range: { min: -5000, max: 5000, sampleCount: 10001 }, exactArithmetic: true };
    }
    const assumptions = [project.assumptions, project.constraints].flatMap((value) => value.split(/[;；\n]+/)).map((value) => value.trim()).filter(Boolean);
    return formalizationSchema.parse({
      quantifiers: /for all|every|任意|所有|∀/i.test(text) ? ['for all stated variables'] : [],
      variables,
      domains: Object.fromEntries(variables.map((item) => [item.name, item.domain])),
      assumptions,
      target: { relation: 'establish-or-refute', left: text, right: 'true under the stated assumptions', description: project.goal || text },
      equivalentForms: [],
      searchParameters: executable ? { min: executable.range.min ?? 0, max: executable.range.max ?? 0, exactArithmetic: executable.exactArithmetic } : {},
      validationRules: ['Do not treat sampled survival as proof.', 'Do not mark a proof verified when a critical step is invalid or uncertain.', 'Record assumptions and evidence for every promoted claim.'],
      executable,
      symbolicExpressions: executable ? [executable.expression] : [],
      leanStatement: null,
      naturalLanguageOnly: !executable,
      uncertainty: [
        ...(project.domain ? [] : ['The variable domain is not fully specified.']),
        ...(executable ? [] : ['No safe machine-executable interpretation was inferred; research must continue symbolically or in natural language.']),
      ],
      confidence: executable ? 0.84 : 0.45,
    });
  }

  async runRole(request: ProviderRoleRequest, signal: AbortSignal): Promise<RoleAction> {
    if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
    const spec = request.snapshot.specifications.at(-1);
    const branch = request.branch;
    const defaults = { evidence: [], proposedNodes: [], branches: [], proofSteps: [], proofReviews: [], toolCalls: [], failures: [], tokenUsage: { input: 0, output: 0, total: 0 } };
    const base = { ...defaults, title: request.stage, summary: 'The research record was advanced conservatively.', rationaleSummary: 'This action follows the current branch and preserves unresolved uncertainty.', nextStage: 'REFLECT' as AgentStage };
    if (request.stage === 'INITIALIZE') return roleActionSchema.parse({ ...base, title: 'Persistent research session initialized', summary: 'A recoverable session, action budget, checkpoint policy, and proof-verification gate are active.', nextStage: 'FORMALIZE' });
    if (request.stage === 'PLAN' || request.stage === 'REPLAN') return roleActionSchema.parse({
      ...base, title: request.stage === 'PLAN' ? 'Independent research routes' : 'Research routes replanned',
      summary: 'Multiple routes are queued and will be interleaved. Their findings and failures are stored independently.',
      branches: [
        { title: 'Structural route', objective: 'Derive consequences directly from definitions and assumptions.', method: 'symbolic decomposition and invariant search', priority: 90 },
        { title: 'Counterexample route', objective: 'Stress boundary and small cases without treating survival as proof.', method: 'exact finite checks where possible', priority: 85 },
        { title: 'Lemma route', objective: 'Identify a minimal intermediate statement that would unlock the target.', method: 'dependency-driven lemma generation', priority: 75 },
        { title: 'Reformulation route', objective: 'Search for equivalent forms and useful representations.', method: 'algebraic and logical reformulation', priority: 65 },
      ], nextStage: 'EXPLORE',
    });
    if (request.stage === 'LITERATURE') return roleActionSchema.parse({ ...base, title: 'Imported-source review', summary: request.snapshot.sources.length ? `Reviewed ${request.snapshot.sources.length} imported source records. Only stored excerpts may be cited.` : 'No literature was imported. No citation was fabricated.', nextStage: 'EXPLORE' });
    if (request.stage === 'EXPLORE') return roleActionSchema.parse({ ...base, title: branch?.title ?? 'Exploration', summary: `Explored ${branch?.objective ?? 'the target'}; all claims remain provisional until supported by reproducible evidence.`, proposedNodes: [{ kind: 'SUBGOAL', title: branch?.title ?? 'Clarify a subgoal', statement: branch?.objective ?? request.snapshot.project.goal, status: 'ACTIVE' }], nextStage: spec?.executable ? 'EXPERIMENT' : 'PATTERN_DISCOVERY' });
    if (request.stage === 'EXPERIMENT' || request.stage === 'COUNTEREXAMPLE_SEARCH') {
      const executable = spec?.executable;
      const code = executable ? buildExactSearchCode(executable) : '';
      return roleActionSchema.parse({ ...base, title: executable ? 'Exact finite search' : 'Experiment not safely executable', summary: executable ? `Run a reproducible exact search over ${executable.variable} in [${executable.range.min}, ${executable.range.max}].` : 'No safe executable specification is available. This does not stop the research loop.', toolCalls: executable ? [{ name: 'run_python', purpose: 'Run an exact finite search from the validated structured specification.', input: { code } }] : [], nextStage: request.stage === 'EXPERIMENT' ? 'COUNTEREXAMPLE_SEARCH' : 'PATTERN_DISCOVERY' });
    }
    if (request.stage === 'PATTERN_DISCOVERY') return roleActionSchema.parse({ ...base, title: 'Pattern candidates', summary: 'Candidate structure was recorded, but pattern observations are not proofs.', proposedNodes: [{ kind: 'CLAIM', title: 'Observed structural candidate', statement: `A potentially useful structure for: ${request.snapshot.project.question}`, status: 'UNKNOWN' }], nextStage: 'LEMMA_GENERATION' });
    if (request.stage === 'LEMMA_GENERATION') return roleActionSchema.parse({ ...base, title: 'Candidate lemma', summary: 'A dependency-focused lemma was proposed for independent checking.', proposedNodes: [{ kind: 'LEMMA', title: 'Candidate bridge lemma', statement: `A sufficient intermediate statement for ${branch?.objective ?? 'the main target'}; exact hypotheses remain to be established.`, status: 'UNEXPLORED' }], nextStage: 'PROOF_ATTEMPT' });
    if (request.stage === 'PROOF_ATTEMPT') return roleActionSchema.parse({ ...base, title: 'Structured proof attempt', summary: 'A draft proof skeleton was created. Model-generated steps start as UNCERTAIN.', proofSteps: [{ title: 'Normalize assumptions', statement: 'Restate the target with explicit domains and hypotheses.', argument: 'Use the validated structured specification as the boundary of the claim.', dependencies: [], critical: true }, { title: 'Bridge to target', statement: 'Apply the proposed intermediate structure to the target.', argument: 'This step requires independent justification and may require a separate lemma.', dependencies: [], critical: true }], nextStage: 'PROOF_CRITIQUE' });
    if (request.stage === 'PROOF_CRITIQUE') {
      const proof = request.snapshot.proofs.at(-1);
      return roleActionSchema.parse({ ...base, title: 'Independent proof critique', summary: 'Every critical step was checked conservatively; unsupported transitions remain uncertain.', proofReviews: (proof?.steps ?? []).map((step) => ({ stepId: step.id, status: step.argument.includes('requires independent') ? 'REQUIRES_LEMMA' : 'UNCERTAIN', comment: 'No independent formal or exact certificate establishes this step.' })), failures: ['A model-only proof cannot satisfy the VERIFIED proof gate.'], nextStage: 'REFLECT' });
    }
    if (request.stage === 'SYMBOLIC_VERIFY') return roleActionSchema.parse({ ...base, title: 'Symbolic verification pass', summary: spec?.symbolicExpressions.length ? 'A symbolic expression is available for tool-based checks.' : 'No safe symbolic expression is available; verification remains unresolved.', toolCalls: spec?.symbolicExpressions.length ? [{ name: 'symbolic_simplify', purpose: 'Simplify the validated expression using SymPy.', input: { expression: spec.symbolicExpressions[0], symbols: spec.variables.map((item) => item.name) } }] : [], nextStage: 'FORMAL_VERIFY' });
    if (request.stage === 'FORMAL_VERIFY') return roleActionSchema.parse({ ...base, title: 'Formal-verifier capability check', summary: 'Optional adapters are detected explicitly. Their absence is recorded and does not crash the research session.', nextStage: 'SYNTHESIZE' });
    if (request.stage === 'SYNTHESIZE') return roleActionSchema.parse({ ...base, title: 'Research synthesis', summary: `${request.snapshot.researchSteps.length} persisted actions, ${request.snapshot.branches.length} branches, ${request.snapshot.evidence.length} evidence records, and ${request.snapshot.proofs.length} proof attempts. Verification labels remain evidence-bound.`, nextStage: 'CHECKPOINT' });
    if (request.stage === 'CHECKPOINT') return roleActionSchema.parse({ ...base, title: 'Recoverable checkpoint', summary: 'Session cursor, branch states, proof records, evidence, failures, and next stage are persisted.', nextStage: 'EXPLORE' });
    if (request.stage === 'REFLECT') return roleActionSchema.parse({ ...base, title: 'Gap reflection', summary: 'Unresolved proof gaps and missing computation were converted into replanning constraints.', nextStage: 'REPLAN' });
    return roleActionSchema.parse(base);
  }
}

interface ChatOptions {
  json: boolean;
  maxTokens: number;
  disableThinking: boolean;
  timeoutMs?: number;
  nativeToolProjectId?: string;
}

interface ChatResult {
  content: string;
  diagnostic: ProviderConnectionResult;
  nativeToolExecutions: NativeToolExecution[];
  tokenUsage: { input: number; output: number; total: number };
  responseShapes: Array<{ finishReason: string | null; hasContent: boolean; hasReasoningContent: boolean; toolCallCount: number }>;
}

export class ResponsesProvider implements ModelProvider {
  private readonly debugLog: ProviderDebugLog;

  constructor(
    private readonly settings: ProviderSettings,
    private readonly credentials: CredentialStore,
    private readonly nativeToolExecutor?: NativeToolExecutor,
  ) {
    this.debugLog = new ProviderDebugLog(join(app.getPath('userData'), 'logs', 'provider-responses.jsonl'));
  }

  async runStage(stage: AgentStage, snapshot: ProjectSnapshot, signal: AbortSignal): Promise<StageResult> {
    const context = {
      question: snapshot.project.question,
      goal: snapshot.project.goal,
      background: snapshot.project.background,
      knownResults: snapshot.project.knownResults,
      constraints: snapshot.project.constraints,
      verifiedPropositions: snapshot.propositions.filter((item) => item.status === 'verified').map((item) => ({ title: item.title, statement: item.statement })),
      failedRoutes: snapshot.failedAttempts.map((item) => ({ title: item.title, reason: item.reason, learned: item.learned })),
      recentMemory: snapshot.memories.slice(-20).map((item) => ({ category: item.category, title: item.title, content: item.content })),
    };
    const prompt = `You are coordinating stage ${stage} of a mathematical research workflow. Return JSON only with title, summary, and status. The summary is a concise user-visible research record: definitions, claims, evidence, dependencies, critique, or result as appropriate. Do not include hidden reasoning or claim verification without proof, source, or reproducible tool evidence.\n\nProject context:\n${JSON.stringify(context)}`;
    const value = await this.requestJson(prompt, signal);
    const parsed = resultSchema.safeParse(value);
    if (parsed.success) return parsed.data;
    throw this.malformed('Research stage response did not match the required JSON contract.', this.endpoint('/chat/completions'), 0, 200);
  }

  async respondChat(messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>, signal: AbortSignal, projectId?: string): Promise<string> {
    const result = await this.chat(messages, signal, { json: false, maxTokens: 4096, disableThinking: true, nativeToolProjectId: projectId });
    return result.content;
  }

  async formalize(snapshot: ProjectSnapshot, signal: AbortSignal): Promise<FormalizationPayload> {
    const contract = {
      quantifiers: ['for all n'],
      variables: [{ name: 'n', domain: 'integers', description: 'integer variable' }],
      domains: { n: 'integers' },
      assumptions: ['n is positive'],
      target: { relation: 'equals', left: 'left expression', right: 'right expression', description: 'claim to establish or refute' },
      equivalentForms: ['equivalent statement'],
      searchParameters: { min: 0, max: 100, exactArithmetic: true },
      validationRules: ['do not treat finite survival as proof'],
      executable: null,
      symbolicExpressions: ['n*(n+1)'],
      leanStatement: null,
      naturalLanguageOnly: false,
      uncertainty: ['unresolved ambiguity'],
      confidence: 0.5,
    };
    const prompt = `Convert the mathematical research question into one JSON object matching this exact shape:\n${JSON.stringify(contract)}\nRules: quantifiers, assumptions, equivalentForms, validationRules, symbolicExpressions, and uncertainty must be arrays of strings; domains must be an object mapping variable names to string domains; every searchParameters value must be one string, number, or boolean, never an array or object; confidence must be a number from 0 to 1. executable must be null unless a safe interpretation exists; if present it must contain kind, variable, expression, predicate, range{min,max,sampleCount}, exactArithmetic. leanStatement must be null unless you can state the exact target as one proof-free Lean declaration header beginning theorem, lemma, or example and containing a colon; it must not contain imports, :=, where, tactics, or a proof body. This candidate is frozen before any Lean proof and is not an independently certified translation of the original language. Do not invent executable mathematics when ambiguous. Return JSON only. Question context:\n${JSON.stringify(snapshot.project)}`;
    const first = await this.requestJson(prompt, signal);
    const parsed = formalizationSchema.safeParse(first);
    if (parsed.success) return parsed.data;
    const issues = parsed.error.issues.slice(0, 20).map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`);
    const repairPrompt = `Repair the following JSON so it matches the exact contract. Return JSON only. Arrays and objects must not replace scalar string/number/boolean fields. Validation issues: ${JSON.stringify(issues)}\nExact shape example: ${JSON.stringify(contract)}\nJSON to repair: ${JSON.stringify(first)}`;
    const repaired = formalizationSchema.safeParse(await this.requestJson(repairPrompt, signal));
    if (repaired.success) return repaired.data;
    throw this.malformed('Formalization remained incompatible after one schema-repair attempt.', this.endpoint('/chat/completions'), 0, 200);
  }

  async runRole(request: ProviderRoleRequest, signal: AbortSignal): Promise<RoleAction> {
    const sourceQuery = [
      request.snapshot.project.question,
      request.snapshot.project.goal,
      request.branch?.objective ?? '',
      request.stage,
      ...request.snapshot.researchSteps.slice(-3).map((step) => `${step.goal} ${step.action} ${step.rationaleSummary}`),
    ].join('\n');
    const sources = request.sourceContext?.length
      ? request.sourceContext.map((chunk) => ({
        sourceId: chunk.sourceId,
        title: chunk.filename,
        indexedCharacters: request.snapshot.sources.find((source) => source.id === chunk.sourceId)?.contentCharacters ?? chunk.text.length,
        extractionStatus: 'complete' as const,
        completeDocumentIncluded: request.sourceContext!.filter((item) => item.sourceId === chunk.sourceId).length >= (request.snapshot.sources.find((source) => source.id === chunk.sourceId)?.chunkCount ?? Number.POSITIVE_INFINITY),
        selectedChunkIndexes: [chunk.chunkIndex],
        totalChunks: request.snapshot.sources.find((source) => source.id === chunk.sourceId)?.chunkCount ?? 1,
        chunks: [{ index: chunk.chunkIndex, page: chunk.page, section: chunk.section, chunkId: chunk.id, text: chunk.text }],
      }))
      : buildProviderSourceContext(request.snapshot.sources, sourceQuery, request.snapshot.researchSteps.length);
    const context = {
      project: request.snapshot.project,
      specification: request.snapshot.specifications.at(-1),
      branch: request.branch,
      recentSteps: request.snapshot.researchSteps.slice(-12),
      proofs: request.snapshot.proofs.slice(-2),
      evidence: request.snapshot.evidence.slice(-20),
      formalBindings: request.snapshot.formalBindings.filter((binding) => binding.status === 'FROZEN' || binding.status === 'KERNEL_CERTIFIED').slice(-8).map((binding) => ({ id: binding.id, originalStatement: binding.originalStatement, formalIr: binding.formalIr, leanStatement: binding.leanStatement, equivalenceStatus: binding.equivalenceStatus })),
      sources,
      literature: request.snapshot.literature.slice(-30).map((record) => ({
        sourceId: record.sourceId, title: record.title, authors: record.authors, year: record.year, venue: record.venue,
        doi: record.doi, url: record.url, arxivId: record.arxivId, abstract: record.abstract, provider: record.provider,
        verificationStatus: record.verificationStatus,
      })),
    };
    const hasNativeTools = nativeToolStages.has(request.stage);
    const toolInstruction = hasNativeTools
      ? ' Native mathematical tools are available when a reproducible computation is useful, but they are optional. Do not repeat a tool in toolCalls[] after executing it natively; toolCalls[] is only a deferred fallback.'
      : '';
    const sourceInstruction = sources.length || request.snapshot.literature.length
      ? ' Imported source chunks and literature metadata are authorized research context. Read every supplied chunk before responding, identify the source title and chunk index when relying on it, and do not claim full-document review when completeDocumentIncluded is false. Cite literature only by the supplied title plus DOI, arXiv ID, or URL; never invent a reference.'
      : '';
    const prompt = `Act as the ${request.role} during stage ${request.stage}. Return exactly one JSON object matching this shape and field types:\n${JSON.stringify(roleActionContract)}\nArray item contracts (instructions only; do not copy placeholder values): ${JSON.stringify(roleActionItemContract)}\nUse [] when a collection has no relevant item. nextStage must be an uppercase research stage.${toolInstruction}${sourceInstruction} A lean_check must include the id of a frozen formalBindings entry as bindingId, and its declaration header must exactly match that entry. Never create or substitute a new formal mapping at verification time. A kernel result for equivalenceStatus NOT_INDEPENDENTLY_CERTIFIED must be labelled Lean-statement-only, not as verification of the original-language claim. Never label model output as verified; citations may only use supplied source chunks; model proof steps are uncertain until independently checked. Context:\n${JSON.stringify(context)}`;
    const response = await this.requestJsonWithMeta(prompt, signal, hasNativeTools ? request.snapshot.project.id : undefined);
    let valueToRepair = normalizeRoleActionPayload(response.value);
    let parsed = roleActionSchema.safeParse(valueToRepair);
    let nativeToolExecutions = response.nativeToolExecutions;
    let tokenUsage = response.tokenUsage;
    for (let schemaRepairAttempt = 0; !parsed.success && schemaRepairAttempt < 2; schemaRepairAttempt += 1) {
      const issues = parsed.error.issues.slice(0, 30).map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`);
      const repairPrompt = `Repair the JSON below to match the exact contract. Return JSON only. All title, summary, and rationaleSummary strings must be non-empty. Do not add mathematical claims; preserve the supplied meaning, use [] for absent collections, and use only the enum values shown in the item contracts.\nContract: ${JSON.stringify(roleActionContract)}\nArray item contracts: ${JSON.stringify(roleActionItemContract)}\nValidation issues: ${JSON.stringify(issues)}\nJSON to repair: ${JSON.stringify(valueToRepair)}`;
      const repaired = await this.requestJsonWithMeta(repairPrompt, signal, undefined, true);
      valueToRepair = normalizeRoleActionPayload(repaired.value);
      parsed = roleActionSchema.safeParse(valueToRepair);
      nativeToolExecutions = [...nativeToolExecutions, ...repaired.nativeToolExecutions];
      tokenUsage = {
        input: tokenUsage.input + repaired.tokenUsage.input,
        output: tokenUsage.output + repaired.tokenUsage.output,
        total: tokenUsage.total + repaired.tokenUsage.total,
      };
    }
    if (!parsed.success) {
      throw this.malformed('Research role response remained incompatible after bounded schema-repair attempts.', this.endpoint('/chat/completions'), 0, 200);
    }
    const action = parsed.data;
    return {
      ...action,
      nativeToolExecutions,
      tokenUsage: tokenUsage.total > 0 ? tokenUsage : action.tokenUsage,
    };
  }

  private async requestJson(prompt: string, signal: AbortSignal): Promise<unknown> {
    return (await this.requestJsonWithMeta(prompt, signal)).value;
  }

  private async requestJsonWithMeta(prompt: string, signal: AbortSignal, nativeToolProjectId?: string, disableThinking = false): Promise<{
    value: unknown;
    nativeToolExecutions: NativeToolExecution[];
    tokenUsage: { input: number; output: number; total: number };
  }> {
    let result = await this.chat([{ role: 'user', content: prompt }], signal, {
      json: true, maxTokens: 8192, disableThinking, nativeToolProjectId,
    });
    let nativeToolExecutions = result.nativeToolExecutions;
    let tokenUsage = result.tokenUsage;
    let modelText = result.content;
    for (let repairAttempt = 0; repairAttempt <= 2; repairAttempt += 1) {
      const extracted = extractStructuredJson(modelText);
      if (extracted) return { value: extracted.value, nativeToolExecutions, tokenUsage };
      if (repairAttempt >= 2) break;
      const repairPrompt = `The HTTP provider response was complete, but the model-generated structured output below is truncated or invalid JSON. Repair only the structured output. Return exactly one compact valid JSON object with no code fence, commentary, or analysis. Preserve the mathematical meaning and follow the original requested contract.\nOriginal request (bounded): ${prompt.slice(0, 12_000)}\nInvalid model output (bounded): ${modelText.slice(0, 20_000)}`;
      const repaired = await this.chat([{ role: 'user', content: repairPrompt }], signal, {
        json: true, maxTokens: 8192, disableThinking: true,
      });
      nativeToolExecutions = [...nativeToolExecutions, ...repaired.nativeToolExecutions];
      tokenUsage = {
        input: tokenUsage.input + repaired.tokenUsage.input,
        output: tokenUsage.output + repaired.tokenUsage.output,
        total: tokenUsage.total + repaired.tokenUsage.total,
      };
      result = repaired;
      modelText = repaired.content;
    }
    throw this.malformed('Model output remained truncated or malformed structured JSON after two bounded compact-repair attempts.', this.endpoint('/chat/completions'), 0, 200);
  }

  async testConnection(signal: AbortSignal = new AbortController().signal): Promise<ProviderConnectionResult> {
    try {
      const result = await this.chat([{ role: 'user', content: 'Reply only with OK' }], signal, { json: false, maxTokens: 8, disableThinking: true, timeoutMs: Math.max(120_000, this.settings.providerTimeoutSeconds * 1000) });
      return { ...result.diagnostic, ok: true, errorType: null, message: 'Received a real model response.', response: result.content.slice(0, 120) };
    } catch (error) {
      if (error instanceof ProviderRequestError) return error.diagnostic;
      const endpoint = this.endpoint('/chat/completions');
      return { ok: false, httpStatus: null, errorType: 'UNKNOWN_ERROR', endpoint, elapsedMs: 0, message: error instanceof Error ? error.message : 'Provider connection failed.', model: this.settings.model, response: '' };
    }
  }

  private async chat(messages: ProviderConversationMessage[], signal: AbortSignal, options: ChatOptions): Promise<ChatResult> {
    const apiKey = this.credentials.read();
    const endpoint = this.endpoint('/chat/completions');
    if (!apiKey) throw new ProviderRequestError({ ok: false, httpStatus: null, errorType: 'AUTH_FAILED', endpoint, elapsedMs: 0, message: 'No provider API key is configured.', model: this.settings.model, response: '' });
    let elapsedMs = 0;
    let httpStatus = 200;
    try {
      const result = await runProviderToolLoop<NativeToolExecution>({
        messages,
        maxToolRounds: 8,
        maxToolCalls: 16,
        maxRecoveryAttempts: 2,
        request: async (conversation, control) => {
          const response = await this.requestChatCompletionWithRetry(apiKey, endpoint, conversation, signal, options, control);
          elapsedMs += response.elapsedMs;
          httpStatus = response.httpStatus;
          return response.data;
        },
        execute: async (call, argumentsValue) => {
          if (!options.nativeToolProjectId || !this.nativeToolExecutor) {
            throw new ProviderProtocolError('Provider requested a native tool when no local tool executor was available.');
          }
          const execution = await this.executeNativeTool(options.nativeToolProjectId, call, argumentsValue);
          return {
            result: execution,
            toolMessage: JSON.stringify({
              ok: execution.ok,
              output: execution.output,
              stdout: execution.stdout,
              stderr: execution.stderr,
              error: execution.error,
              error_type: execution.errorType,
              exit_code: execution.exitCode,
              durationMs: execution.durationMs,
              timeout: execution.timeout,
              environment: execution.environment,
              verification_status: execution.verificationStatus,
              verification_level: execution.verificationLevel,
              reason_unknown: execution.reasonUnknown,
            }),
          };
        },
      });
      return {
        content: result.content,
        nativeToolExecutions: result.executions.map((execution) => execution.result),
        tokenUsage: result.usage,
        responseShapes: result.responseShapes,
        diagnostic: {
          ok: true, httpStatus, errorType: null, endpoint, elapsedMs,
          message: 'Received a real model response.', model: result.model || this.settings.model,
          response: result.content.slice(0, 120),
        },
      };
    } catch (error) {
      if (error instanceof ProviderRequestError) throw error;
      if (error instanceof ProviderProtocolError) throw this.malformed(error.message, endpoint, elapsedMs, httpStatus);
      throw error;
    }
  }

  private async requestChatCompletion(
    apiKey: string,
    endpoint: string,
    messages: ProviderConversationMessage[],
    signal: AbortSignal,
    options: ChatOptions,
    control: ProviderRequestControl,
  ): Promise<{ data: unknown; elapsedMs: number; httpStatus: number }> {
    const timeoutMs = options.timeoutMs ?? this.settings.providerTimeoutSeconds * 1000;
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = AbortSignal.any([signal, timeout]);
    const started = performance.now();
    const effectiveControl: ProviderRequestControl = {
      ...control,
      toolsEnabled: Boolean(control.toolsEnabled && options.nativeToolProjectId && this.nativeToolExecutor),
      disableThinking: Boolean(options.disableThinking || control.disableThinking),
    };
    const body: Record<string, unknown> = {
      model: this.settings.model,
      messages,
      stream: false,
      max_tokens: options.maxTokens,
    };
    if (options.json) body.response_format = { type: 'json_object' };
    if (effectiveControl.toolsEnabled) {
      body.tools = nativeTools;
    }
    if (this.isDeepSeek() && effectiveControl.disableThinking) body.thinking = { type: 'disabled' };

    try {
      const response = await net.fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: combined,
      });
      const elapsedMs = Math.round(performance.now() - started);
      const raw = await response.text();
      const contentType = response.headers.get('content-type') ?? '';
      let data: unknown;
      try {
        data = parseProviderHttpResponse({ status: response.status, contentType, body: raw });
        this.debugLog.write({ endpoint, model: this.settings.model, httpStatus: response.status, contentType, elapsedMs, control: effectiveControl, responseBody: raw, parsedResponse: data });
      } catch (error) {
        if (!(error instanceof ProviderTransportError)) throw error;
        this.debugLog.write({ endpoint, model: this.settings.model, httpStatus: response.status, contentType, elapsedMs, control: effectiveControl, responseBody: raw, parsedResponse: error.details.parsedBody });
        if (error.code === 'HTTP_STATUS') {
          const payload = error.details.parsedBody as ErrorPayload | undefined;
          throw new ProviderRequestError({
            ok: false,
            httpStatus: response.status,
            errorType: providerErrorForStatus(response.status),
            endpoint,
            elapsedMs,
            message: this.safeApiMessage(payload?.error?.message, response.status),
            model: this.settings.model,
            response: '',
          });
        }
        throw new ProviderRequestError({
          ok: false,
          httpStatus: response.status,
          errorType: error.code,
          endpoint,
          elapsedMs,
          message: error.message,
          model: this.settings.model,
          response: '',
        });
      }
      return { data, elapsedMs, httpStatus: response.status };
    } catch (error) {
      if (error instanceof ProviderRequestError) throw error;
      const elapsedMs = Math.round(performance.now() - started);
      const errorType = providerNetworkError(error, signal.aborted, timeout.aborted);
      const message = errorType === 'NETWORK_TIMEOUT'
        ? `Provider HTTP request exceeded ${Math.round(timeoutMs / 1000)} seconds.`
        : error instanceof Error ? error.message : 'Provider network request failed.';
      throw new ProviderRequestError({ ok: false, httpStatus: null, errorType, endpoint, elapsedMs, message, model: this.settings.model, response: '' });
    }
  }

  private async requestChatCompletionWithRetry(
    apiKey: string,
    endpoint: string,
    messages: ProviderConversationMessage[],
    signal: AbortSignal,
    options: ChatOptions,
    control: ProviderRequestControl,
  ): Promise<{ data: unknown; elapsedMs: number; httpStatus: number }> {
    const transient = new Set<ProviderErrorType>([
      'DNS_ERROR', 'TLS_ERROR', 'NETWORK_TIMEOUT', 'RATE_LIMITED', 'SERVER_ERROR', 'OVERLOADED',
      'EMPTY_RESPONSE', 'TRUNCATED_RESPONSE', 'SSE_ERROR', 'HTML_RESPONSE',
    ]);
    const maxRetries = 2;
    let lastError: ProviderRequestError | null = null;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        return await this.requestChatCompletion(apiKey, endpoint, messages, signal, options, { ...control, attempt: control.attempt + attempt });
      } catch (error) {
        if (!(error instanceof ProviderRequestError)) throw error;
        lastError = error;
        if (signal.aborted || attempt >= maxRetries || !error.diagnostic.errorType || !transient.has(error.diagnostic.errorType)) throw error;
        try { await delay(400 * (2 ** attempt), undefined, { signal }); }
        catch { throw error; }
      }
    }
    throw lastError!;
  }

  private async executeNativeTool(projectId: string, call: ProviderToolCall, argumentsValue: Record<string, unknown>): Promise<NativeToolExecution> {
    const name = nativeToolNameSchema.safeParse(call.function.name);
    if (!name.success) throw new ProviderProtocolError(`Provider requested unsupported tool ${call.function.name.slice(0, 100)}.`);
    const validated = nativeToolArgumentSchemas[name.data].safeParse(argumentsValue);
    if (!validated.success) throw new ProviderProtocolError(`Tool call ${name.data} failed local argument validation.`);
    const { purpose, ...input } = validated.data;
    const result = await this.nativeToolExecutor!({ projectId, name: name.data, purpose: String(purpose), input });
    return {
      name: name.data,
      purpose: String(purpose),
      input,
      ok: result.ok,
      success: result.success,
      output: result.output.slice(0, 20_000),
      stdout: result.stdout.slice(0, 20_000),
      stderr: result.stderr.slice(0, 20_000),
      ...(result.error ? { error: this.safeApiMessage(result.error, 0).slice(0, 2000) } : {}),
      errorType: result.errorType,
      exitCode: result.exitCode,
      workerExitCode: result.workerExitCode,
      durationMs: result.durationMs,
      timeout: result.timeout,
      ...(result.environment ? { environment: result.environment.slice(0, 1000) } : {}),
      verificationStatus: result.verificationStatus,
      verificationLevel: result.verificationLevel,
      reasonUnknown: result.reasonUnknown?.slice(0, 2000),
      artifactLocation: result.artifactLocation,
      auditLogPath: result.auditLogPath,
    };
  }

  private endpoint(path: string): string {
    const base = new URL(this.settings.baseUrl);
    if (base.protocol !== 'https:' && base.hostname !== 'localhost' && base.hostname !== '127.0.0.1') throw new Error('Provider URL must use HTTPS, except for a local provider.');
    if (base.username || base.password) throw new Error('Provider URL must not contain credentials.');
    return `${this.settings.baseUrl.replace(/\/$/, '')}${path}`;
  }

  private isDeepSeek(): boolean {
    try { return new URL(this.settings.baseUrl).hostname.toLowerCase().endsWith('deepseek.com'); }
    catch { return false; }
  }

  private malformed(message: string, endpoint: string, elapsedMs: number, httpStatus: number): ProviderRequestError {
    return new ProviderRequestError({ ok: false, httpStatus, errorType: 'MALFORMED_RESPONSE', endpoint, elapsedMs, message, model: this.settings.model, response: '' });
  }

  private safeApiMessage(message: string | undefined, status: number): string {
    const clean = (message || `Provider returned HTTP ${status}.`)
      .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
      .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[redacted]');
    return clean.slice(0, 1000);
  }
}

function buildExactSearchCode(executable: NonNullable<FormalizationPayload['executable']>): string {
  const min = executable.range.min ?? -100;
  const max = executable.range.max ?? 100;
  const predicate = executable.predicate === 'is_prime'
    ? 'is_prime(value)'
    : executable.predicate === 'even' ? 'value % 2 == 0' : executable.predicate === 'nonnegative' ? 'value >= 0' : 'value == 0';
  return `import math\ndef is_prime(value):\n    if value < 2: return False\n    if value % 2 == 0: return value == 2\n    limit = math.isqrt(value)\n    d = 3\n    while d <= limit:\n        if value % d == 0: return False\n        d += 2\n    return True\nfailures = []\nfor ${executable.variable} in range(${min}, ${max + 1}):\n    value = ${executable.expression}\n    if not (${predicate}):\n        failures.append({"${executable.variable}": ${executable.variable}, "value": value})\n        break\nresult = {"range": [${min}, ${max}], "counterexample": failures[0] if failures else None, "survived": not failures}`;
}

export function createProvider(settings: ProviderSettings, credentials: CredentialStore, nativeToolExecutor?: NativeToolExecutor): ModelProvider {
  return settings.provider === 'openai-compatible' ? new ResponsesProvider(settings, credentials, nativeToolExecutor) : new LocalProvider();
}

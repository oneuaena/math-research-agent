export type ResearchMode = 'autonomous' | 'stress-test' | 'explore' | 'prove' | 'disprove' | 'counterexample' | 'formalize' | 'literature' | 'experiment';

export type ResearchStatus = 'verified' | 'plausible' | 'unverified' | 'failed' | 'open' | 'in-progress'
  | 'UNEXPLORED' | 'ACTIVE' | 'SUPPORTED' | 'PROVED_CONDITIONALLY' | 'VERIFIED' | 'REFUTED' | 'GAP' | 'DEAD_END' | 'UNKNOWN';

export type AgentStage =
  | 'INITIALIZE' | 'FORMALIZE' | 'LITERATURE' | 'PATTERN_DISCOVERY' | 'LEMMA_GENERATION'
  | 'PROOF_ATTEMPT' | 'PROOF_CRITIQUE' | 'COUNTEREXAMPLE_SEARCH' | 'SYMBOLIC_VERIFY'
  | 'FORMAL_VERIFY' | 'REFLECT' | 'REPLAN' | 'CHECKPOINT' | 'PAUSED' | 'FAILED'
  | 'PARSE' | 'PLAN_ATTACKS' | 'SMALL_CASES' | 'BOUNDARY' | 'SYMBOLIC' | 'EXTREMAL'
  | 'VERIFY_CANDIDATE' | 'EXPAND' | 'SUMMARIZE'
  | 'UNDERSTAND' | 'PLAN' | 'EXPLORE' | 'EXPERIMENT' | 'VERIFY' | 'CRITIQUE' | 'REFINE' | 'SYNTHESIZE'
  | 'COMPLETE';

export type NodeKind = 'Question' | 'Conjecture' | 'Attack' | 'Experiment' | 'Candidate' | 'Counterexample' | 'Open Region' | 'No Counterexample' | 'Lemma' | 'Definition' | 'Evidence' | 'Proof' | 'Failed Attempt' | 'Reference' | 'Open Problem'
  | 'CONJECTURE' | 'SUBGOAL' | 'LEMMA' | 'CLAIM' | 'EXPERIMENT' | 'COUNTEREXAMPLE' | 'PROOF_ATTEMPT'
  | 'PROOF_GAP' | 'IDENTITY' | 'PARAMETRIC_FAMILY' | 'LITERATURE_RESULT' | 'VERIFICATION' | 'DEAD_END';

export type GraphEdgeKind = 'IMPLIES' | 'DEPENDS_ON' | 'SUPPORTS' | 'REFUTES' | 'GENERALIZES' | 'SPECIAL_CASE_OF' | 'USES' | 'BLOCKED_BY' | 'DERIVED_FROM';
export type ResearchRole = 'research-planner' | 'explorer' | 'experimental-mathematician' | 'lemma-generator' | 'proof-builder' | 'skeptic' | 'independent-verifier' | 'research-synthesizer';
export type ProofStepStatus = 'VALID' | 'INVALID' | 'UNCERTAIN' | 'REQUIRES_LEMMA' | 'REQUIRES_COMPUTATION' | 'REQUIRES_FORMALIZATION';

export type VerificationStatus = 'exactly-verified' | 'computationally-verified' | 'symbolically-verified' | 'numerically-supported' | 'llm-assessed-only' | 'unverified';

export type BlockKind = 'text' | 'math' | 'theorem' | 'lemma' | 'definition' | 'proof' | 'experiment' | 'code' | 'source' | 'agent-note';

export interface Project {
  id: string;
  name: string;
  question: string;
  goal: string;
  background: string;
  knownResults: string;
  constraints: string;
  variables: string;
  domain: string;
  assumptions: string;
  notes: string;
  demoCaseId: 'A' | 'B' | 'C' | null;
  mode: ResearchMode;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string;
}

export interface NotebookBlock {
  id: string;
  projectId: string;
  kind: BlockKind;
  title: string;
  content: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchNode {
  id: string;
  projectId: string;
  parentId: string | null;
  kind: NodeKind;
  title: string;
  content: string;
  status: ResearchStatus;
  dependencies: string[];
  sources: string[];
  tools: string[];
  summary: string;
  x: number;
  y: number;
  createdAt: string;
  updatedAt: string;
  branchId?: string | null;
  statement?: string;
  evidenceIds?: string[];
  verificationStatus?: VerificationStatus;
  historyIds?: string[];
  relatedExperimentIds?: string[];
}

export interface GraphEdge {
  id: string;
  projectId: string;
  sourceId: string;
  targetId: string;
  kind: GraphEdgeKind;
  label: string;
  createdAt: string;
}

export interface FormalVariable { name: string; domain: string; description: string; }
export interface ExecutableSpecification {
  kind: 'integer-predicate' | 'symbolic-identity' | 'inequality' | 'finite-search';
  variable: string;
  expression: string;
  predicate: 'is_prime' | 'equals_zero' | 'nonnegative' | 'even' | 'custom';
  range: { min: number | null; max: number | null; sampleCount: number };
  exactArithmetic: boolean;
}

export interface StructuredSpecification {
  id: string;
  projectId: string;
  originalText: string;
  quantifiers: string[];
  variables: FormalVariable[];
  domains: Record<string, string>;
  assumptions: string[];
  target: { relation: string; left: string; right: string; description: string };
  equivalentForms: string[];
  searchParameters: Record<string, string | number | boolean>;
  validationRules: string[];
  executable: ExecutableSpecification | null;
  symbolicExpressions: string[];
  naturalLanguageOnly: boolean;
  uncertainty: string[];
  confidence: number;
  provider: string;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchBranch {
  id: string;
  projectId: string;
  sessionId: string;
  title: string;
  objective: string;
  method: string;
  status: 'queued' | 'active' | 'paused' | 'blocked' | 'promising' | 'dead-end' | 'complete';
  priority: number;
  parentBranchId: string | null;
  rootNodeId: string;
  lastStepId: string | null;
  findings: string[];
  failures: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ResearchEvidence {
  id: string;
  projectId: string;
  sessionId: string;
  branchId: string | null;
  type: 'exact-computation' | 'symbolic-computation' | 'numerical-computation' | 'user-source' | 'model-analysis' | 'formal-check';
  title: string;
  content: string;
  verificationStatus: VerificationStatus;
  sourceIds: string[];
  experimentIds: string[];
  reproducible: boolean;
  createdAt: string;
}

export interface ResearchStep {
  id: string;
  projectId: string;
  sessionId: string;
  iteration: number;
  stage: AgentStage;
  role: ResearchRole;
  branchId: string | null;
  goal: string;
  action: string;
  rationaleSummary: string;
  inputs: string;
  outputs: string;
  evidenceIds: string[];
  model: string;
  tokenUsage: { input: number; output: number; total: number };
  elapsedMs: number;
  toolCallIds: string[];
  failures: string[];
  dependencies: string[];
  parentNodeId: string | null;
  nextStage: AgentStage;
  createdAt: string;
}

export interface ResearchSession {
  id: string;
  projectId: string;
  status: 'RUNNING' | 'PAUSED' | 'COMPLETE' | 'FAILED';
  currentStage: AgentStage;
  nextStage: AgentStage;
  iteration: number;
  actionCount: number;
  checkpointCount: number;
  activeBranchId: string | null;
  branchCursor: number;
  startedAt: string;
  updatedAt: string;
  lastCheckpointAt: string;
  completedAt: string | null;
  pauseReason: string;
  failure: string;
  totalTokenUsage: number;
  totalElapsedMs: number;
  conclusion: 'candidate-proof' | 'partial-result' | 'counterexample' | 'inconclusive' | null;
}

export interface ProofStep {
  id: string;
  title: string;
  statement: string;
  argument: string;
  dependencies: string[];
  status: ProofStepStatus;
  verifierComment: string;
  critical: boolean;
}

export interface ProofDocument {
  id: string;
  projectId: string;
  sessionId: string;
  branchId: string | null;
  theorem: string;
  assumptions: string[];
  definitions: string[];
  steps: ProofStep[];
  edgeCases: string[];
  conclusion: string;
  status: 'DRAFT' | 'HAS_GAPS' | 'CANDIDATE' | 'VERIFIED';
  verificationStatus: VerificationStatus;
  independentlyReviewed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CapabilityReport {
  python: { available: boolean; version: string };
  sympy: { available: boolean; version: string };
  numpy: { available: boolean; version: string };
  scipy: { available: boolean; version: string };
  z3: { available: boolean; version: string };
  lean: { available: boolean; version: string };
  sage: { available: boolean; version: string };
}

export interface RuntimeDiagnostics {
  ok: boolean;
  source: 'bundled' | 'configured';
  displayPath: string;
  executableExists: boolean;
  canStart: boolean;
  workerOk: boolean;
  workspaceWritable: boolean;
  python: { available: boolean; version: string };
  sympy: { available: boolean; version: string };
  numpy: { available: boolean; version: string };
  scipy: { available: boolean; version: string };
  z3: { available: boolean; version: string; satTest: boolean | null };
  arithmetic: { passed: boolean; output: string };
  factorization: { passed: boolean; output: string };
  error: string;
}

export interface Proposition {
  id: string;
  projectId: string;
  kind: 'Conjecture' | 'Lemma' | 'Theorem';
  title: string;
  statement: string;
  assumptions: string;
  dependencies: string[];
  status: ResearchStatus;
  proof: string;
  verification: string;
  references: string[];
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface Experiment {
  id: string;
  projectId: string;
  purpose: string;
  code: string;
  tool: string;
  input: string;
  output: string;
  interpretation: string;
  relatedNodeId: string | null;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  durationMs: number | null;
  method?: string;
  searchSpace?: string;
  environment?: string;
  verificationStatus?: VerificationStatus;
  rerunOf?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchMemory {
  id: string;
  projectId: string;
  category: 'result' | 'decision' | 'failure' | 'issue' | 'reference' | 'experiment';
  title: string;
  content: string;
  relatedNodeIds: string[];
  createdAt: string;
}

export interface FailedAttempt {
  id: string;
  projectId: string;
  title: string;
  goal: string;
  approach: string;
  reason: string;
  counterexample: string;
  learned: string;
  relatedNodeIds: string[];
  revisitable: boolean;
  createdAt: string;
}

export interface Source {
  id: string;
  projectId: string;
  type: 'user-document' | 'web' | 'agent-generated' | 'tool-generated';
  title: string;
  authors: string;
  abstract: string;
  path: string;
  tags: string[];
  notes: string;
  excerpt: string;
  createdAt: string;
}

export interface AttackRecord {
  id: string;
  projectId: string;
  sequence: number;
  strategy: string;
  method: string;
  inputs: string;
  searchSpace: string;
  code: string;
  result: string;
  status: 'planned' | 'running' | 'exhausted' | 'candidate-found' | 'candidate-rejected' | 'counterexample-found' | 'failed';
  verificationStatus: VerificationStatus;
  verification: string;
  durationMs: number | null;
  experimentIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface VerificationCheck { label: string; passed: boolean; detail: string; }

export interface CounterexampleEvidence {
  inputs: Record<string, string | number>;
  parameters: Record<string, string | number>;
  environment: string;
  exactExpression: string;
  computation: string;
  code: string;
  output: string;
  verificationStatus: VerificationStatus;
  checks: VerificationCheck[];
}

export interface CoverageItem { label: string; value: string; }

export interface StressTestResult {
  id: string;
  projectId: string;
  status: 'running' | 'survived' | 'counterexample-found' | 'inconclusive';
  verificationStatus: VerificationStatus;
  coverage: CoverageItem[];
  remainingUncertainty: string[];
  counterexample: CounterexampleEvidence | null;
  summary: string;
  startedAt: string;
  completedAt: string | null;
}

export interface Activity {
  id: string;
  projectId: string;
  stage: AgentStage | 'IDLE';
  kind: 'agent' | 'tool' | 'system' | 'error';
  title: string;
  detail: string;
  status: 'running' | 'succeeded' | 'failed' | 'cancelled' | 'info';
  durationMs: number | null;
  createdAt: string;
}

export interface ProjectSnapshot {
  project: Project;
  blocks: NotebookBlock[];
  nodes: ResearchNode[];
  propositions: Proposition[];
  experiments: Experiment[];
  memories: ResearchMemory[];
  failedAttempts: FailedAttempt[];
  sources: Source[];
  attacks: AttackRecord[];
  stressResults: StressTestResult[];
  specifications: StructuredSpecification[];
  sessions: ResearchSession[];
  researchSteps: ResearchStep[];
  branches: ResearchBranch[];
  evidence: ResearchEvidence[];
  graphEdges: GraphEdge[];
  proofs: ProofDocument[];
  activities: Activity[];
}

export interface CreateProjectInput {
  name: string;
  question: string;
  goal: string;
  background: string;
  knownResults: string;
  constraints: string;
  mode: ResearchMode;
  variables?: string;
  domain?: string;
  assumptions?: string;
  notes?: string;
  demoCaseId?: 'A' | 'B' | 'C' | null;
}

export interface ProviderSettings {
  provider: 'local' | 'openai-compatible';
  model: string;
  baseUrl: string;
  pythonPath: string;
  maxIterations: number;
  maxToolSeconds: number;
  providerTimeoutSeconds: number;
  maxResearchMinutes: number;
  checkpointEvery: number;
  maxBranches: number;
}

export type ProviderErrorType = 'AUTH_FAILED' | 'INSUFFICIENT_BALANCE' | 'BAD_REQUEST' | 'RATE_LIMITED' | 'SERVER_ERROR'
  | 'OVERLOADED' | 'DNS_ERROR' | 'TLS_ERROR' | 'NETWORK_TIMEOUT' | 'REQUEST_ABORTED' | 'MALFORMED_RESPONSE'
  | 'EMPTY_RESPONSE' | 'TRUNCATED_RESPONSE' | 'SSE_ERROR' | 'HTML_RESPONSE' | 'UNKNOWN_ERROR';

export interface ProviderConnectionResult {
  ok: boolean;
  httpStatus: number | null;
  errorType: ProviderErrorType | null;
  endpoint: string;
  elapsedMs: number;
  message: string;
  model: string;
  response: string;
}

export interface CredentialStatus { configured: boolean; masked: string; secureStorage: boolean; }

export type CollectionName = 'blocks' | 'nodes' | 'propositions' | 'experiments' | 'memories' | 'failedAttempts' | 'sources' | 'attacks' | 'stressResults'
  | 'specifications' | 'sessions' | 'researchSteps' | 'branches' | 'evidence' | 'graphEdges' | 'proofs';

export interface AgentEvent {
  projectId: string;
  running: boolean;
  stage: AgentStage | 'IDLE';
  activity?: Activity;
}

export type ToolName = 'run_python' | 'symbolic_simplify' | 'solve_equation' | 'differentiate' | 'integrate' | 'matrix_compute' | 'capability_check' | 'z3_check';

export interface ToolInvocation { projectId: string; name: ToolName; purpose: string; input: Record<string, unknown>; }
export interface ToolResult { ok: boolean; output: string; error?: string; durationMs: number; environment?: string; }

export interface DesktopApi {
  projects: {
    list(): Promise<Project[]>;
    create(input: CreateProjectInput): Promise<ProjectSnapshot>;
    get(id: string): Promise<ProjectSnapshot>;
    update(id: string, patch: Partial<CreateProjectInput & { name: string }>): Promise<ProjectSnapshot>;
    remove(id: string): Promise<void>;
  };
  records: {
    save<T>(collection: CollectionName, record: T): Promise<ProjectSnapshot>;
    remove(collection: CollectionName, id: string, projectId: string): Promise<ProjectSnapshot>;
  };
  agent: {
    start(projectId: string): Promise<void>;
    resume(projectId: string): Promise<void>;
    pause(projectId: string): Promise<void>;
    stop(projectId: string): Promise<void>;
    onEvent(callback: (event: AgentEvent) => void): () => void;
  };
  tools: { run(invocation: ToolInvocation): Promise<ToolResult> };
  documents: { import(projectId: string): Promise<ProjectSnapshot | null> };
  reports: {
    export(projectId: string, format: 'markdown' | 'latex'): Promise<string | null>;
    exportEvidence(projectId: string): Promise<string | null>;
  };
  settings: {
    get(): Promise<ProviderSettings>;
    save(settings: ProviderSettings): Promise<ProviderSettings>;
    credentialStatus(): Promise<CredentialStatus>;
    saveCredential(apiKey: string): Promise<CredentialStatus>;
    removeCredential(): Promise<CredentialStatus>;
    testProvider(): Promise<ProviderConnectionResult>;
  };
    system: {
      appVersion(): Promise<string>;
      openPath(path: string): Promise<string>;
      runtimeDiagnostics(): Promise<RuntimeDiagnostics>;
    };
}

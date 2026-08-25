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

export type VerificationStatus = 'formally-verified' | 'exactly-verified' | 'computationally-verified' | 'symbolically-verified'
  | 'bounded-check' | 'numerically-supported' | 'llm-assessed-only' | 'unverified';

export type MathematicalVerificationLevel = 'CONJECTURE' | 'UNCERTAIN' | 'HEURISTIC' | 'NUMERICAL_EVIDENCE'
  | 'BOUNDED_CHECK' | 'SYMBOLIC_CHECK' | 'SAT' | 'UNSAT' | 'UNKNOWN' | 'REQUIRES_LEMMA'
  | 'REQUIRES_FORMALIZATION' | 'FORMALLY_VERIFIED' | 'REFUTED';

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
  /** A declaration header proposed during FORMALIZE, never a proof body. */
  leanStatement: string | null;
  naturalLanguageOnly: boolean;
  uncertainty: string[];
  confidence: number;
  provider: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * An immutable, hash-addressed bridge from the user-facing claim through a
 * project Formal IR to the exact Lean declaration accepted by the kernel.
 * It records an auditable binding; it does not claim that natural-language
 * interpretation has been solved automatically.
 */
export interface FormalBinding {
  id: string;
  projectId: string;
  originalStatement: string;
  formalIr: string;
  leanStatement: string;
  originalHash: string;
  formalIrHash: string;
  leanStatementHash: string;
  bindingHash: string;
  proofSourceHash: string | null;
  certificateHash: string | null;
  /** Who accepted the natural-language-to-Lean mapping before any proof ran. */
  mappingAuthority: 'AI_PROPOSED' | 'USER_CONFIRMED';
  /** The kernel may certify the Lean statement without certifying its natural-language interpretation. */
  equivalenceStatus: 'NOT_INDEPENDENTLY_CERTIFIED' | 'USER_CONFIRMED';
  status: 'FROZEN' | 'KERNEL_CERTIFIED' | 'INVALID';
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
  verificationLevel?: MathematicalVerificationLevel;
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
  cycleId: string;
  cycleIndex: number;
  cycleCheckpointStart: number;
  status: 'RUNNING' | 'PAUSED' | 'COMPLETE' | 'FAILED';
  currentStage: AgentStage;
  nextStage: AgentStage;
  checkpointReturnStage?: AgentStage | null;
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

export type ResearchJobStatus = 'QUEUED' | 'RUNNING' | 'RETRY_WAIT' | 'PAUSED' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type ResearchJobDesiredState = 'RUNNING' | 'PAUSED' | 'CANCELLED';

export interface ResearchJob {
  id: string;
  projectId: string;
  status: ResearchJobStatus;
  desiredState: ResearchJobDesiredState;
  resumeRequested: boolean;
  attemptCount: number;
  maxAttempts: number;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  heartbeatAt: string | null;
  nextRunAt: string | null;
  completedAt: string | null;
  lastError: string;
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
  z3: { available: boolean; version: string; satTest: boolean | null; unsatTest: boolean | null };
  lean: { available: boolean; version: string; kernelTest: boolean | null; sorryRejected: boolean | null };
  sage: { available: boolean; version: string };
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
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  workerExitCode?: number | null;
  artifactLocation?: string;
  auditLogPath?: string;
  verificationStatus?: VerificationStatus;
  rerunOf?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchMemory {
  id: string;
  projectId: string;
  category: 'result' | 'decision' | 'failure' | 'issue' | 'reference' | 'experiment' | 'conversation' | 'literature' | 'open-question' | 'source-summary';
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
  type: 'user-document' | 'web' | 'agent-generated' | 'tool-generated' | 'paper' | 'webpage' | 'arxiv' | 'journal' | 'research-note';
  title: string;
  authors: string;
  abstract: string;
  path: string;
  tags: string[];
  notes: string;
  excerpt: string;
  content?: string;
  contentHash?: string;
  contentCharacters?: number;
  extractionStatus?: 'complete' | 'unsupported' | 'failed';
  extractionWarnings?: string[];
  indexedAt?: string;
  documentType?: 'txt' | 'md' | 'tex' | 'docx' | 'pdf' | 'html' | 'abstract';
  pageCount?: number;
  chunkCount?: number;
  indexStatus?: 'pending' | 'indexed' | 'failed' | 'unsupported';
  doi?: string;
  url?: string;
  arxivId?: string;
  year?: number | null;
  venue?: string;
  provider?: LiteratureProviderName;
  retrievalTime?: string;
  literatureVerificationStatus?: 'VERIFIED_METADATA' | 'UNVERIFIED';
  createdAt: string;
}

export interface DocumentChunk {
  id: string;
  projectId: string;
  sourceId: string;
  filename: string;
  documentType: string;
  page: number | null;
  section: string;
  kind: 'title' | 'section' | 'paragraph' | 'list' | 'table' | 'equation' | 'proof' | 'page';
  chunkIndex: number;
  characterStart: number;
  characterEnd: number;
  text: string;
  embedding: number[];
  createdAt: string;
}

export interface DocumentSearchResult extends DocumentChunk {
  score: number;
}

export type ChatTaskRoute = 'CHAT' | 'QUICK_ANALYSIS' | 'DOCUMENT_ANALYSIS' | 'LITERATURE_SEARCH' | 'DEEP_RESEARCH';
export type ChatMessageStatus = 'pending' | 'streaming' | 'completed' | 'stopped' | 'failed';

export interface Conversation {
  id: string;
  projectId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface MessageCitation {
  sourceId: string;
  chunkId: string | null;
  title: string;
  page: number | null;
  section: string;
  url?: string;
  doi?: string;
}

export interface ConversationMessage {
  id: string;
  projectId: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  route: ChatTaskRoute;
  status: ChatMessageStatus;
  attachmentSourceIds: string[];
  citations: MessageCitation[];
  parentMessageId: string | null;
  regeneratedFromId: string | null;
  error: string;
  createdAt: string;
  updatedAt: string;
}

export type LiteratureProviderName = 'arxiv' | 'crossref' | 'openalex' | 'semantic-scholar' | 'web';

export interface LiteratureRecord {
  id: string;
  projectId: string;
  sourceId: string;
  title: string;
  authors: string[];
  year: number | null;
  venue: string;
  doi: string;
  url: string;
  fullTextUrl?: string;
  arxivId: string;
  abstract: string;
  provider: LiteratureProviderName;
  query: string;
  retrievalTime: string;
  verificationStatus: 'VERIFIED_METADATA' | 'UNVERIFIED';
  relevanceScore: number;
}

export interface NoveltyCheck {
  id: string;
  projectId: string;
  claim: string;
  status: 'KNOWN' | 'PARTIALLY_KNOWN' | 'POSSIBLY_NOVEL' | 'UNKNOWN';
  literatureIds: string[];
  summary: string;
  searchedAt: string;
}

export interface LiteratureSearchResult {
  queries: string[];
  records: LiteratureRecord[];
  providerErrors: Array<{ provider: LiteratureProviderName; message: string }>;
}

export interface ChatSendInput {
  projectId: string;
  conversationId?: string;
  content: string;
  attachmentSourceIds?: string[];
  regenerateFromId?: string;
}

export interface ChatEvent {
  projectId: string;
  conversationId: string;
  message: ConversationMessage;
  delta?: string;
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

/**
 * A finite construction problem deliberately has no executable user code.  The
 * evaluator is fixed and auditable: minimize forbidden pairs while maximizing
 * coverage and spread of the selected finite set.
 */
export interface DiscoveryProblem {
  universeSize: number;
  candidateSize: number;
  incompatibilities: Array<[number, number]>;
  coverageGroups: number[][];
}

export interface DiscoveryConfig {
  populationSize: number;
  generations: number;
  workerCount: number;
  seed: number;
  mutationRate: number;
  archiveLimit: number;
}

export interface DiscoveryCandidate {
  fingerprint: string;
  genes: number[];
  violations: number;
  coverage: number;
  spread: number;
  novelty: number;
  paretoRank: number;
}

export interface DiscoveryRun {
  id: string;
  projectId: string;
  status: 'RUNNING' | 'COMPLETED' | 'PAUSED' | 'FAILED';
  problem: DiscoveryProblem;
  config: DiscoveryConfig;
  generation: number;
  totalEvaluated: number;
  population: number[][];
  archive: DiscoveryCandidate[];
  rngState: number;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  error: string;
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
  discoveryRuns: DiscoveryRun[];
  specifications: StructuredSpecification[];
  formalBindings: FormalBinding[];
  sessions: ResearchSession[];
  researchSteps: ResearchStep[];
  branches: ResearchBranch[];
  evidence: ResearchEvidence[];
  graphEdges: GraphEdge[];
  proofs: ProofDocument[];
  conversations: Conversation[];
  messages: ConversationMessage[];
  literature: LiteratureRecord[];
  noveltyChecks: NoveltyCheck[];
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
  leanPath: string;
  maxIterations: number;
  maxToolSeconds: number;
  providerTimeoutSeconds: number;
  maxResearchMinutes: number;
  maxAutonomousHours: number;
  maxTotalTokens: number;
  checkpointEvery: number;
  maxBranches: number;
  literatureSearchMode: 'auto' | 'manual' | 'off';
  literatureProviders: Record<LiteratureProviderName, boolean>;
  searchDomesticSources: boolean;
  searchInternationalSources: boolean;
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
  | 'specifications' | 'sessions' | 'researchSteps' | 'branches' | 'evidence' | 'graphEdges' | 'proofs'
  | 'conversations' | 'messages' | 'literature' | 'noveltyChecks' | 'formalBindings' | 'discoveryRuns';

export interface AgentEvent {
  projectId: string;
  running: boolean;
  stage: AgentStage | 'IDLE';
  activity?: Activity;
}

export type ToolName = 'run_python' | 'symbolic_simplify' | 'solve_equation' | 'differentiate' | 'integrate' | 'matrix_compute' | 'capability_check' | 'z3_check' | 'lean_check'
  | 'mathlib_search' | 'workspace_write' | 'workspace_read' | 'download_file' | 'run_command';

export type ToolErrorType = 'NONE' | 'TOOL_ERROR' | 'PROGRAM_ERROR' | 'VALIDATION_ERROR' | 'TIMEOUT'
  | 'OUTPUT_LIMIT' | 'UNAVAILABLE' | 'PROTOCOL_ERROR' | 'UNSOUND_PROOF';

export type VerificationToolStatus = 'SUCCESS' | 'SAT' | 'UNSAT' | 'UNKNOWN' | 'BOUNDED_CHECK'
  | 'FORMALLY_VERIFIED' | 'REJECTED_UNSOUND' | 'TOOL_FAILURE' | 'PROGRAM_FAILURE';

export interface ToolInvocation { projectId: string; name: ToolName; purpose: string; input: Record<string, unknown>; }
export interface ToolResult {
  ok: boolean;
  success: boolean;
  output: string;
  stdout: string;
  stderr: string;
  error?: string;
  errorType: ToolErrorType;
  exitCode: number | null;
  workerExitCode?: number | null;
  durationMs: number;
  timeout: boolean;
  environment?: string;
  verificationStatus?: VerificationToolStatus;
  verificationLevel?: MathematicalVerificationLevel;
  reasonUnknown?: string;
  artifactLocation?: string;
  auditLogPath?: string;
}

export interface FormalBindingValidation {
  ok: boolean;
  binding?: FormalBinding;
  error?: string;
}

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
    start(projectId: string): Promise<ResearchJob>;
    resume(projectId: string): Promise<ResearchJob>;
    pause(projectId: string): Promise<ResearchJob | null>;
    stop(projectId: string): Promise<ResearchJob | null>;
    jobs(projectId?: string): Promise<ResearchJob[]>;
    onEvent(callback: (event: AgentEvent) => void): () => void;
  };
  tools: { run(invocation: ToolInvocation): Promise<ToolResult> };
  formalBindings: {
    freezeUserConfirmed(projectId: string, originalStatement: string, formalIr: string, leanSource: string): Promise<FormalBinding>;
    verify(projectId: string, bindingId: string, leanSource: string): Promise<FormalBindingValidation>;
  };
  discovery: {
    start(projectId: string, input: { problem: DiscoveryProblem; config: DiscoveryConfig }): Promise<DiscoveryRun>;
    resume(projectId: string, runId: string): Promise<DiscoveryRun>;
    stop(projectId: string): Promise<DiscoveryRun | null>;
  };
  documents: {
    import(projectId: string): Promise<ProjectSnapshot | null>;
    importPaths(projectId: string, paths: string[]): Promise<ProjectSnapshot>;
    importDropped(projectId: string, files: File[]): Promise<ProjectSnapshot>;
    search(projectId: string, query: string, limit?: number): Promise<DocumentSearchResult[]>;
  };
  chat: {
    send(input: ChatSendInput): Promise<ConversationMessage>;
    stop(projectId: string): Promise<void>;
    regenerate(projectId: string, messageId: string): Promise<ConversationMessage>;
    onEvent(callback: (event: ChatEvent) => void): () => void;
  };
  literature: {
    search(projectId: string, query: string): Promise<LiteratureSearchResult>;
  };
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
      openExternal(url: string): Promise<void>;
      runtimeDiagnostics(): Promise<RuntimeDiagnostics>;
    };
}

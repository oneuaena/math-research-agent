import { randomUUID } from 'node:crypto';
import type { ClaimVersion, Conversation, ConversationMessage, ResearchBranch, ResearchEvidence, ResearchNode, ResearchSession, SteeringAuditEntry, SteeringInstruction, SteeringInstructionType } from '../src/shared/types';
import type { ResearchDatabase } from './database';
import type { ModelProvider } from './provider';

const NOW = () => new Date().toISOString();
const STOP_TYPES = new Set<SteeringInstructionType>(['PAUSE_RESEARCH', 'STOP_DISCOVERY_SEARCH', 'STOP_PROOF_SEARCH', 'PAUSE_BRANCH', 'ABANDON_BRANCH']);

export function isUrgentSteering(type: SteeringInstructionType): boolean { return STOP_TYPES.has(type); }

/**
 * Main-process-only conversion of user requests into durable, auditable state
 * changes. It deliberately has no route that upgrades mathematical evidence or
 * proof status: steering changes work, never verification facts.
 */
export class ResearchSteeringService {
  constructor(private readonly db: ResearchDatabase) {}

  submit(projectId: string, input: { rawText: string; type?: SteeringInstructionType; payload?: Record<string, unknown>; targetBranchId?: string | null }): SteeringInstruction {
    const snapshot = this.db.getProject(projectId, false);
    const rawText = input.rawText.trim();
    if (!rawText || rawText.length > 12_000) throw new Error('A steering message must contain 1 to 12,000 characters.');
    const interpreted = input.type ? { type: input.type, source: 'STRUCTURED' as const, explanation: `Structured ${input.type} instruction.` } : interpret(rawText);
    const timestamp = NOW();
    const instruction: SteeringInstruction = {
      id: randomUUID(), projectId, sessionId: snapshot.sessions.at(-1)?.id ?? null, type: interpreted.type,
      rawText, payload: input.payload ?? {}, targetBranchId: input.targetBranchId ?? null,
      priority: isUrgentSteering(interpreted.type) ? 'URGENT' : ['REQUEST_REPLAN', 'CHANGE_RESOURCE_BUDGET'].includes(interpreted.type) ? 'HIGH' : 'NORMAL',
      status: 'PENDING', interpretation: interpreted.explanation, interpretationSource: interpreted.source,
      createdAt: timestamp, appliedAt: null,
    };
    this.db.saveRecord('steeringInstructions', instruction);
    this.recordConversation(projectId, instruction);
    return instruction;
  }

  /** Resolve ambiguous text only at a safe orchestration boundary. */
  async resolveUnclassified(projectId: string, provider: ModelProvider, signal: AbortSignal): Promise<void> {
    const pending = this.db.listRecords<SteeringInstruction>(projectId, 'steeringInstructions')
      .filter((instruction) => instruction.status === 'PENDING' && instruction.type === 'UNCLASSIFIED');
    for (const instruction of pending) {
      if (signal.aborted) return;
      const response = await provider.respondChat([
        { role: 'system', content: 'Interpret one live mathematical-research steering message. Return JSON only: {"type":"one allowed SteeringInstructionType","payload":{},"targetBranchId":null,"explanation":"short"}. Allowed types: ADD_HYPOTHESIS, ADD_BRANCH, PRIORITIZE_BRANCH, DEPRIORITIZE_BRANCH, PAUSE_BRANCH, ABANDON_BRANCH, RESUME_BRANCH, REQUEST_REPLAN, REQUEST_EXPLANATION, ADD_EVIDENCE, RETRACT_EVIDENCE, ADD_CONSTRAINT, REMOVE_CONSTRAINT, CHANGE_SEARCH_STRATEGY, CHANGE_DISCOVERY_PARAMETERS, CHANGE_RESOURCE_BUDGET, PRIORITIZE_LEMMA, START_DISCOVERY_SEARCH, STOP_DISCOVERY_SEARCH, START_PROOF_SEARCH, STOP_PROOF_SEARCH, PAUSE_RESEARCH, RESUME_RESEARCH, CREATE_CLAIM_VERSION, REQUEST_STATUS_UPGRADE, UNCLASSIFIED. Never claim or request VERIFIED; ordinary new theorem statements should be ADD_HYPOTHESIS or CREATE_CLAIM_VERSION.' },
        { role: 'user', content: instruction.rawText },
      ], signal, projectId);
      const parsed = parseModelInterpretation(response);
      if (!parsed) continue;
      this.db.saveRecord('steeringInstructions', {
        ...instruction,
        type: parsed.type,
        payload: { ...instruction.payload, ...parsed.payload },
        targetBranchId: parsed.targetBranchId ?? instruction.targetBranchId,
        priority: isUrgentSteering(parsed.type) ? 'URGENT' : ['REQUEST_REPLAN', 'CHANGE_RESOURCE_BUDGET'].includes(parsed.type) ? 'HIGH' : 'NORMAL',
        interpretation: parsed.explanation,
        interpretationSource: 'MODEL',
      });
    }
  }

  /** Called at every orchestrator boundary; returns a deterministic replan hint. */
  applyPending(projectId: string, session: ResearchSession): { session: ResearchSession; replan: boolean; pause: boolean } {
    this.ensureInitialClaim(projectId);
    let current = session; let replan = false; let pause = false;
    const pending = this.db.listRecords<SteeringInstruction>(projectId, 'steeringInstructions')
      .filter((item) => item.status === 'PENDING').sort((a, b) => priority(b.priority) - priority(a.priority) || a.createdAt.localeCompare(b.createdAt));
    for (const [index, instruction] of pending.entries()) {
      const before = JSON.stringify({ session: { status: current.status, nextStage: current.nextStage }, branch: instruction.targetBranchId ? this.branch(projectId, instruction.targetBranchId) : null });
      const result = this.applyOne(projectId, current, instruction);
      current = result.session; replan ||= result.replan; pause ||= result.pause;
      const completed: SteeringInstruction = { ...instruction, status: result.rejected ? 'REJECTED' : 'APPLIED', appliedAt: NOW() };
      this.db.saveRecord('steeringInstructions', completed);
      const audit: SteeringAuditEntry = {
        id: randomUUID(), projectId, sessionId: current.id, instructionId: instruction.id, timestamp: NOW(), affectedBranchId: instruction.targetBranchId,
        previousState: before, newState: JSON.stringify({ session: { status: current.status, nextStage: current.nextStage }, replan: result.replan, pause: result.pause }),
        reason: result.reason, modelResponse: instruction.interpretation,
      };
      this.db.saveRecord('steeringAudit', audit);
      // A same-batch resume must never silently defeat a newly applied urgent
      // pause. The user can explicitly resume in a later steering message.
      if (result.pause) {
        for (const deferred of pending.slice(index + 1).filter((item) => item.type === 'RESUME_RESEARCH')) {
          this.db.saveRecord('steeringInstructions', { ...deferred, status: 'SUPERSEDED', appliedAt: NOW() });
          this.db.saveRecord('steeringAudit', { id: randomUUID(), projectId, sessionId: current.id, instructionId: deferred.id, timestamp: NOW(), affectedBranchId: deferred.targetBranchId, previousState: 'PENDING', newState: 'SUPERSEDED', reason: 'An urgent pause in the same steering batch takes precedence.', modelResponse: deferred.interpretation } satisfies SteeringAuditEntry);
        }
        return { session: current, replan, pause };
      }
    }
    return { session: current, replan, pause };
  }

  explain(projectId: string, question: string): string {
    const snapshot = this.db.getProject(projectId, false); const session = snapshot.sessions.at(-1);
    const active = snapshot.branches.find((branch) => branch.id === session?.activeBranchId);
    const best = snapshot.discoveryRuns.flatMap((run) => run.archive).sort((a, b) => a.violations - b.violations || b.coverage - a.coverage)[0];
    const failed = snapshot.branches.filter((branch) => branch.status === 'dead-end' || branch.status === 'blocked').map((branch) => branch.title);
    const budget = snapshot.resourceBudgets.at(-1);
    return JSON.stringify({ question, currentStage: session?.currentStage ?? 'IDLE', currentBranch: active ? { id: active.id, title: active.title, objective: active.objective, priority: active.priority } : null,
      activeDiscoveryJobs: snapshot.discoveryRuns.filter((run) => run.status === 'RUNNING').map((run) => run.id), activeProofSearchJobs: snapshot.formalProofSearchRuns.filter((run) => run.status === 'RUNNING').map((run) => run.id),
      bestCandidate: best ? { fingerprint: best.fingerprint, violations: best.violations, coverage: best.coverage } : null, latestEvidence: snapshot.evidence.filter((evidence) => evidence.state !== 'RETRACTED').slice(-3).map((evidence) => evidence.title),
      hypotheses: snapshot.claimVersions.filter((claim) => claim.status === 'HYPOTHESIS').map((claim) => claim.statement), failedBranches: failed,
      resourceUsage: budget ? { used: budget.used, limits: budget.limits } : null, pendingSteering: snapshot.steeringInstructions.filter((item) => item.status === 'PENDING').map((item) => ({ type: item.type, rawText: item.rawText })),
    });
  }

  private applyOne(projectId: string, session: ResearchSession, instruction: SteeringInstruction): { session: ResearchSession; replan: boolean; pause: boolean; rejected?: boolean; reason: string } {
    const payload = instruction.payload; let current = session; let replan = false; let pause = false;
    const target = instruction.targetBranchId ? this.branch(projectId, instruction.targetBranchId) : null;
    const saveBranch = (branch: ResearchBranch) => this.db.saveRecord('branches', { ...branch, updatedAt: NOW() });
    switch (instruction.type) {
      case 'ADD_BRANCH': this.createBranch(projectId, current, instruction, String(payload.title ?? 'User-proposed branch'), String(payload.objective ?? instruction.rawText), String(payload.method ?? 'user steering')); replan = true; break;
      case 'ADD_HYPOTHESIS':
      case 'CREATE_CLAIM_VERSION': this.createClaimVersion(projectId, instruction, String(payload.statement ?? instruction.rawText), instruction.type === 'ADD_HYPOTHESIS' ? 'HYPOTHESIS' : 'USER_PROPOSED'); replan = true; break;
      case 'PRIORITIZE_BRANCH': if (!target) return rejected(current, 'TARGET_BRANCH_REQUIRED'); saveBranch({ ...target, priority: Math.min(10_000, target.priority + Number(payload.delta ?? 100)), status: target.status === 'dead-end' || target.status === 'paused' ? target.status : 'queued' }); break;
      case 'DEPRIORITIZE_BRANCH': if (!target) return rejected(current, 'TARGET_BRANCH_REQUIRED'); saveBranch({ ...target, priority: Math.max(-10_000, target.priority - Number(payload.delta ?? 100)) }); break;
      case 'PAUSE_BRANCH': if (!target) return rejected(current, 'TARGET_BRANCH_REQUIRED'); saveBranch({ ...target, status: 'paused' }); break;
      case 'ABANDON_BRANCH': if (!target) return rejected(current, 'TARGET_BRANCH_REQUIRED'); saveBranch({ ...target, status: 'dead-end', failures: [...target.failures, `Abandoned by user steering: ${instruction.rawText}`].slice(-20) }); replan = true; break;
      case 'RESUME_BRANCH': if (!target) return rejected(current, 'TARGET_BRANCH_REQUIRED'); saveBranch({ ...target, status: 'queued' }); break;
      case 'REQUEST_REPLAN': replan = true; break;
      case 'ADD_CONSTRAINT': this.db.updateProject(projectId, { constraints: [this.db.getProject(projectId, false).project.constraints, String(payload.constraint ?? instruction.rawText)].filter(Boolean).join('\n') }); replan = true; break;
      case 'REMOVE_CONSTRAINT': this.db.updateProject(projectId, { constraints: this.db.getProject(projectId, false).project.constraints.replace(String(payload.constraint ?? instruction.rawText), '').trim() }); replan = true; break;
      case 'CHANGE_RESOURCE_BUDGET': this.changeBudget(projectId, payload); replan = true; break;
      case 'CHANGE_SEARCH_STRATEGY':
      case 'CHANGE_DISCOVERY_PARAMETERS': this.changeDiscovery(projectId, payload); replan = true; break;
      case 'PRIORITIZE_LEMMA': this.createBranch(projectId, current, instruction, `Lemma: ${String(payload.lemma ?? instruction.rawText)}`, String(payload.lemma ?? instruction.rawText), 'lemma search'); replan = true; break;
      case 'ADD_EVIDENCE': this.addUserEvidence(projectId, current, instruction); replan = true; break;
      case 'RETRACT_EVIDENCE': if (!this.retractEvidence(projectId, instruction)) return rejected(current, 'EVIDENCE_NOT_FOUND'); replan = true; break;
      case 'START_DISCOVERY_SEARCH': current = { ...current, nextStage: 'DISCOVERY_SEARCH', updatedAt: NOW() }; break;
      case 'STOP_DISCOVERY_SEARCH': this.pauseActiveDiscovery(projectId); current = { ...current, nextStage: 'REPLAN', updatedAt: NOW() }; replan = true; break;
      case 'START_PROOF_SEARCH': current = { ...current, nextStage: 'PROOF_SEARCH', updatedAt: NOW() }; break;
      case 'STOP_PROOF_SEARCH': this.pauseActiveProofSearch(projectId); current = { ...current, nextStage: 'REPLAN', updatedAt: NOW() }; replan = true; break;
      case 'PAUSE_RESEARCH': current = { ...current, status: 'PAUSED', currentStage: 'PAUSED', nextStage: 'PAUSED', pauseReason: `Paused by steering: ${instruction.rawText}`, updatedAt: NOW() }; pause = true; break;
      case 'RESUME_RESEARCH': current = { ...current, status: 'RUNNING', currentStage: current.nextStage === 'PAUSED' ? 'REPLAN' : current.currentStage, nextStage: current.nextStage === 'PAUSED' ? 'REPLAN' : current.nextStage, pauseReason: '', updatedAt: NOW() }; break;
      case 'REQUEST_STATUS_UPGRADE': return rejected(current, 'VERIFICATION_GATE_REQUIRED: steering cannot promote a claim, evidence, or proof to VERIFIED.');
      case 'REQUEST_EXPLANATION': break;
      case 'UNCLASSIFIED': this.createClaimVersion(projectId, instruction, instruction.rawText, 'HYPOTHESIS'); replan = true; break;
      default: return rejected(current, 'UNSUPPORTED_STEERING_INSTRUCTION');
    }
    return { session: current, replan, pause, reason: instruction.type };
  }

  private ensureInitialClaim(projectId: string): void {
    const snapshot = this.db.getProject(projectId, false); if (snapshot.claimVersions.length) return;
    const claim: ClaimVersion = { id: randomUUID(), projectId, parentClaimVersionId: null, statement: snapshot.project.question, status: 'USER_PROPOSED', createdByInstructionId: null, createdAt: NOW() };
    this.db.saveRecord('claimVersions', claim);
    for (const binding of snapshot.formalBindings.filter((item) => !item.claimVersionId)) this.db.saveRecord('formalBindings', { ...binding, claimVersionId: claim.id, updatedAt: NOW() });
  }
  private recordConversation(projectId: string, instruction: SteeringInstruction): void {
    const snapshot = this.db.getProject(projectId, false); const timestamp = NOW();
    const conversation = snapshot.conversations.find((item) => item.sessionId === instruction.sessionId) ?? { id: randomUUID(), projectId, sessionId: instruction.sessionId, title: `Research steering ${instruction.sessionId?.slice(0, 8) ?? 'idle'}`, createdAt: timestamp, updatedAt: timestamp } satisfies Conversation;
    if (!snapshot.conversations.some((item) => item.id === conversation.id)) this.db.saveRecord('conversations', conversation);
    const user: ConversationMessage = { id: randomUUID(), projectId, conversationId: conversation.id, role: 'user', content: instruction.rawText, route: 'CHAT', status: 'completed', attachmentSourceIds: [], citations: [], parentMessageId: null, regeneratedFromId: null, error: '', createdAt: timestamp, updatedAt: timestamp };
    const system: ConversationMessage = { id: randomUUID(), projectId, conversationId: conversation.id, role: 'system', content: `Steering queued: ${instruction.type}. ${instruction.interpretation}`, route: 'CHAT', status: 'completed', attachmentSourceIds: [], citations: [], parentMessageId: user.id, regeneratedFromId: null, error: '', createdAt: timestamp, updatedAt: timestamp };
    this.db.saveRecord('messages', user); this.db.saveRecord('messages', system);
  }
  private createClaimVersion(projectId: string, instruction: SteeringInstruction, statement: string, status: ClaimVersion['status']): void {
    const claims = this.db.listRecords<ClaimVersion>(projectId, 'claimVersions'); const latest = claims.at(-1);
    this.db.saveRecord('claimVersions', { id: randomUUID(), projectId, parentClaimVersionId: latest?.id ?? null, statement, status, createdByInstructionId: instruction.id, createdAt: NOW() } satisfies ClaimVersion);
  }
  private createBranch(projectId: string, session: ResearchSession, instruction: SteeringInstruction, title: string, objective: string, method: string): void {
    const snapshot = this.db.getProject(projectId, false); const parent = instruction.targetBranchId ? this.branch(projectId, instruction.targetBranchId) : snapshot.branches.find((branch) => branch.id === session.activeBranchId) ?? null; const createdAt = NOW(); const rootNodeId = randomUUID();
    this.db.saveRecord('nodes', { id: rootNodeId, projectId, parentId: parent?.rootNodeId ?? snapshot.nodes.find((node) => node.parentId === null)?.id ?? null, branchId: null, kind: 'SUBGOAL', title, content: objective, statement: objective, status: 'UNEXPLORED', dependencies: parent?.rootNodeId ? [parent.rootNodeId] : [], sources: [], tools: [], summary: `Created from user steering ${instruction.id}.`, x: 300, y: 100 + snapshot.branches.length * 90, createdAt, updatedAt: createdAt } satisfies ResearchNode);
    this.db.saveRecord('branches', { id: randomUUID(), projectId, sessionId: session.id, title, objective, method, status: 'queued', priority: Number(instruction.payload.priority ?? 100), parentBranchId: parent?.id ?? null, rootNodeId, lastStepId: null, findings: [], failures: [], createdAt, updatedAt: createdAt } satisfies ResearchBranch);
  }
  private addUserEvidence(projectId: string, session: ResearchSession, instruction: SteeringInstruction): void { const timestamp = NOW(); this.db.saveRecord('evidence', { id: randomUUID(), projectId, sessionId: session.id, branchId: instruction.targetBranchId, type: 'user-source', title: String(instruction.payload.title ?? 'User-provided research evidence'), content: String(instruction.payload.content ?? instruction.rawText), verificationStatus: 'unverified', sourceIds: [], experimentIds: [], reproducible: false, state: 'ACTIVE', createdAt: timestamp } satisfies ResearchEvidence); }
  private retractEvidence(projectId: string, instruction: SteeringInstruction): boolean {
    const evidenceId = String(instruction.payload.evidenceId ?? ''); const snapshot = this.db.getProject(projectId, false); const evidence = snapshot.evidence.find((item) => item.id === evidenceId); if (!evidence || evidence.state === 'RETRACTED') return false;
    this.db.saveRecord('evidence', { ...evidence, state: 'RETRACTED', retractedAt: NOW(), retractionReason: instruction.rawText });
    for (const node of snapshot.nodes.filter((item) => (item.evidenceIds ?? []).includes(evidence.id))) this.db.saveRecord('nodes', { ...node, status: 'UNKNOWN', verificationStatus: 'unverified', summary: `${node.summary}\nInvalidated because evidence ${evidence.id} was retracted.`, updatedAt: NOW() });
    for (const branch of snapshot.branches.filter((item) => item.id === evidence.branchId)) this.db.saveRecord('branches', { ...branch, status: 'blocked', failures: [...branch.failures, `Evidence retracted: ${evidence.title}`].slice(-20), updatedAt: NOW() });
    return true;
  }
  private changeBudget(projectId: string, payload: Record<string, unknown>): void { const current = this.db.getProject(projectId, false).resourceBudgets.at(-1); if (!current) return; const limits = { ...current.limits, ...payload }; this.db.saveRecord('resourceBudgets', { ...current, limits, updatedAt: NOW() }); }
  private changeDiscovery(projectId: string, payload: Record<string, unknown>): void { const run = this.db.getProject(projectId, false).discoveryRuns.find((item) => item.status === 'PAUSED' || item.status === 'FAILED'); if (run) this.db.saveRecord('discoveryRuns', { ...run, config: { ...run.config, ...payload }, updatedAt: NOW() }); }
  private pauseActiveDiscovery(projectId: string): void { for (const run of this.db.getProject(projectId, false).discoveryRuns.filter((item) => item.status === 'RUNNING')) this.db.saveRecord('discoveryRuns', { ...run, status: 'PAUSED', error: 'Stopped by steering; checkpoint retained.', updatedAt: NOW() }); }
  private pauseActiveProofSearch(projectId: string): void { for (const run of this.db.getProject(projectId, false).formalProofSearchRuns.filter((item) => item.status === 'RUNNING')) this.db.saveRecord('formalProofSearchRuns', { ...run, status: 'PAUSED', error: 'Stopped by steering; checkpoint retained.', updatedAt: NOW() }); }
  private branch(projectId: string, id: string): ResearchBranch | null { return this.db.getProject(projectId, false).branches.find((item) => item.id === id) ?? null; }
}

function rejected(session: ResearchSession, reason: string): { session: ResearchSession; replan: boolean; pause: boolean; rejected: true; reason: string } { return { session, replan: false, pause: false, rejected: true, reason }; }
function priority(value: SteeringInstruction['priority']): number { return value === 'URGENT' ? 2 : value === 'HIGH' ? 1 : 0; }
function interpret(rawText: string): { type: SteeringInstructionType; source: 'RULE_FALLBACK'; explanation: string } {
  const value = rawText.toLowerCase();
  const type: SteeringInstructionType = /暂停|pause/.test(value) ? 'PAUSE_RESEARCH' : /继续|resume/.test(value) ? 'RESUME_RESEARCH' : /放弃|abandon/.test(value) ? 'ABANDON_BRANCH' : /重新规划|replan/.test(value) ? 'REQUEST_REPLAN' : /证据.*撤|retract.*evidence/.test(value) ? 'RETRACT_EVIDENCE' : /证明.*搜索|proof.*search/.test(value) ? 'START_PROOF_SEARCH' : /搜索|discovery/.test(value) ? 'START_DISCOVERY_SEARCH' : /分支|branch/.test(value) ? 'ADD_BRANCH' : /解释|why|what are you doing/.test(value) ? 'REQUEST_EXPLANATION' : 'UNCLASSIFIED';
  return { type, source: 'RULE_FALLBACK', explanation: `Rule fallback interpreted the preserved user text as ${type}.` };
}

function parseModelInterpretation(value: string): { type: SteeringInstructionType; payload: Record<string, unknown>; targetBranchId?: string | null; explanation: string } | null {
  const match = value.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as { type?: unknown; payload?: unknown; targetBranchId?: unknown; explanation?: unknown };
    const types: SteeringInstructionType[] = ['ADD_HYPOTHESIS', 'ADD_BRANCH', 'PRIORITIZE_BRANCH', 'DEPRIORITIZE_BRANCH', 'PAUSE_BRANCH', 'ABANDON_BRANCH', 'RESUME_BRANCH', 'REQUEST_REPLAN', 'REQUEST_EXPLANATION', 'ADD_EVIDENCE', 'RETRACT_EVIDENCE', 'ADD_CONSTRAINT', 'REMOVE_CONSTRAINT', 'CHANGE_SEARCH_STRATEGY', 'CHANGE_DISCOVERY_PARAMETERS', 'CHANGE_RESOURCE_BUDGET', 'PRIORITIZE_LEMMA', 'START_DISCOVERY_SEARCH', 'STOP_DISCOVERY_SEARCH', 'START_PROOF_SEARCH', 'STOP_PROOF_SEARCH', 'PAUSE_RESEARCH', 'RESUME_RESEARCH', 'CREATE_CLAIM_VERSION', 'REQUEST_STATUS_UPGRADE', 'UNCLASSIFIED'];
    if (typeof parsed.type !== 'string' || !types.includes(parsed.type as SteeringInstructionType)) return null;
    return {
      type: parsed.type as SteeringInstructionType,
      payload: parsed.payload && typeof parsed.payload === 'object' && !Array.isArray(parsed.payload) ? parsed.payload as Record<string, unknown> : {},
      targetBranchId: typeof parsed.targetBranchId === 'string' || parsed.targetBranchId === null ? parsed.targetBranchId : undefined,
      explanation: typeof parsed.explanation === 'string' ? parsed.explanation.slice(0, 1_000) : `Model interpreted the preserved user text as ${parsed.type}.`,
    };
  } catch { return null; }
}

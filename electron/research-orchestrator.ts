import { randomUUID } from 'node:crypto';
import { STAGE_LABELS } from '../src/shared/agent';
import { canDisplayVerifiedProof, chooseNextStage, STAGE_ROLE, type RoleAction } from '../src/shared/research';
import type {
  Activity, AgentEvent, AgentStage, Experiment, GraphEdge, ProofDocument, ResearchBranch, ResearchEvidence,
  ResearchNode, ResearchSession, ResearchStep, StructuredSpecification, ToolInvocation, ToolName, ToolResult, VerificationStatus,
} from '../src/shared/types';
import type { ResearchDatabase } from './database';
import type { ModelProvider } from './provider';
import type { ToolRunner } from './tool-runner';
import type { LiteratureSearchService } from './literature-search';
import { FormalBindingService } from './formal-binding';

export interface ResearchRunOptions {
  resumeRequested?: boolean;
}

export interface ResearchStateLogEntry {
  timestamp: string;
  event: 'run_requested' | 'cycle_created' | 'loop_started' | 'action_started' | 'action_completed' | 'loop_stopped' | 'run_failed';
  project_id: string;
  session_id: string;
  cycle_id: string;
  cycle_index: number;
  paused: boolean;
  cycle_completed: boolean;
  pending_tasks: number;
  agent_loop_running: boolean;
  resume_requested: boolean;
  current_stage: AgentStage;
  next_stage: AgentStage;
}

export class ResearchOrchestrator {
  constructor(
    private readonly db: ResearchDatabase,
    private readonly tools: ToolRunner,
    private readonly provider: ModelProvider,
    private readonly publish: (event: AgentEvent) => void,
    private readonly logState: (entry: ResearchStateLogEntry) => void = () => undefined,
    private readonly literature?: LiteratureSearchService,
  ) {}

  async run(projectId: string, signal: AbortSignal, options: ResearchRunOptions = {}): Promise<void> {
    const resumeRequested = options.resumeRequested ?? false;
    const settings = this.db.getSettings();
    let snapshot = this.db.getProject(projectId, false);
    const previous = snapshot.sessions.at(-1);
    let session = this.prepareSession(projectId, previous, resumeRequested);
    this.writeState('run_requested', session, resumeRequested, false);
    if (previous && previous.status === 'PAUSED' && previous.nextStage === 'PAUSED' && resumeRequested) {
      this.writeState('cycle_created', session, resumeRequested, false);
    }
    this.db.saveRecord('sessions', session);
    const runStarted = performance.now();
    let runActions = 0;
    this.writeState('loop_started', session, resumeRequested, true);

    try {
      while (!signal.aborted && runActions < settings.maxIterations && performance.now() - runStarted < settings.maxResearchMinutes * 60_000
        && session.totalElapsedMs < settings.maxAutonomousHours * 3_600_000 && session.totalTokenUsage < settings.maxTotalTokens) {
        snapshot = this.db.getProject(projectId, false);
        const stage = session.nextStage;
        if (stage === 'PAUSED' || stage === 'FAILED' || stage === 'COMPLETE') break;
        this.writeState('action_started', session, resumeRequested, true);
        const started = performance.now();
        const pending = this.activity(projectId, stage, STAGE_LABELS[stage], 'running');
        this.db.addActivity(pending);
        this.publish({ projectId, running: true, stage, activity: pending });

        const branch = this.pickBranch(snapshot.branches, session);
        const { action, specification } = await this.executeStage(stage, snapshot, branch, signal);
        if (signal.aborted) break;
        const toolData = await this.persistActionArtifacts(projectId, session, stage, branch, action, specification, signal);
        snapshot = this.db.getProject(projectId, false);

        const proof = snapshot.proofs.at(-1);
        const verifiedCounterexample = snapshot.nodes.some((node) => node.kind === 'COUNTEREXAMPLE' && node.status === 'VERIFIED');
        if (stage === 'CHECKPOINT') session.checkpointCount += 1;
        let nextStage = chooseNextStage(stage, {
          hasSpecification: snapshot.specifications.length > 0,
          executable: Boolean(snapshot.specifications.at(-1)?.executable),
          sourceCount: snapshot.sources.length,
          proofHasGaps: !proof || proof.steps.some((step) => step.critical && step.status !== 'VALID'),
          verifiedCounterexample,
          proofVerified: Boolean(proof && canDisplayVerifiedProof(proof)),
          cycle: session.checkpointCount,
          checkpointsInCycle: Math.max(0, session.checkpointCount - session.cycleCheckpointStart),
        });
        const checkpointDue = session.actionCount + 1 >= (session.checkpointCount + 1) * settings.checkpointEvery;
        let checkpointReturnStage = session.checkpointReturnStage ?? null;
        if (stage === 'CHECKPOINT' && nextStage !== 'PAUSED' && checkpointReturnStage) {
          nextStage = checkpointReturnStage;
          checkpointReturnStage = null;
        } else if (checkpointDue && nextStage !== 'CHECKPOINT' && ['EXPLORE', 'REFLECT', 'REPLAN', 'SYNTHESIZE'].includes(stage)) {
          checkpointReturnStage = nextStage;
          nextStage = 'CHECKPOINT';
        }
        const elapsedMs = Math.round(performance.now() - started);
        const step: ResearchStep = {
          id: randomUUID(), projectId, sessionId: session.id, iteration: session.iteration + 1, stage,
          role: STAGE_ROLE[stage] ?? 'research-synthesizer', branchId: branch?.id ?? null,
          goal: branch?.objective || snapshot.project.goal || snapshot.project.question,
          action: action.title, rationaleSummary: action.rationaleSummary,
          inputs: JSON.stringify({ stage, branch: branch?.title ?? null }), outputs: action.summary,
          evidenceIds: toolData.evidenceIds, model: settings.provider === 'local' ? 'local-coordinator' : settings.model,
          tokenUsage: action.tokenUsage, elapsedMs, toolCallIds: toolData.toolCallIds,
          failures: action.failures, dependencies: branch?.lastStepId ? [branch.lastStepId] : [],
          parentNodeId: branch?.rootNodeId ?? snapshot.nodes.find((node) => node.parentId === null)?.id ?? null,
          nextStage, createdAt: now(),
        };
        this.db.saveRecord('researchSteps', step);
        if (branch) this.db.saveRecord('branches', { ...branch, status: action.failures.length ? 'blocked' : 'active', lastStepId: step.id, findings: [...branch.findings, action.summary].slice(-20), failures: [...branch.failures, ...action.failures].slice(-20), updatedAt: now() });

        session = {
          ...session, currentStage: stage, nextStage, iteration: session.iteration + 1,
          actionCount: session.actionCount + 1, branchCursor: session.branchCursor + (branch ? 1 : 0),
          activeBranchId: branch?.id ?? null, checkpointReturnStage, updatedAt: now(), totalTokenUsage: session.totalTokenUsage + action.tokenUsage.total,
          totalElapsedMs: session.totalElapsedMs + elapsedMs,
          lastCheckpointAt: stage === 'CHECKPOINT' ? now() : session.lastCheckpointAt,
        };
        this.db.saveRecord('sessions', session);
        this.writeState('action_completed', session, resumeRequested, true);
        runActions += 1;
        const completed = { ...pending, detail: action.summary, status: 'succeeded' as const, durationMs: elapsedMs };
        this.db.addActivity(completed);
        this.publish({ projectId, running: nextStage !== 'PAUSED' && nextStage !== 'COMPLETE', stage, activity: completed });
        if (nextStage === 'PAUSED') break;
      }

      if (signal.aborted) {
        session = { ...session, status: 'PAUSED', currentStage: 'PAUSED', pauseReason: 'Paused by user.', updatedAt: now() };
      } else if (session.nextStage === 'COMPLETE') {
        session = { ...session, status: 'COMPLETE', currentStage: 'COMPLETE', completedAt: now(), updatedAt: now() };
      } else {
        const safetyBudgetReached = session.totalElapsedMs >= settings.maxAutonomousHours * 3_600_000 || session.totalTokenUsage >= settings.maxTotalTokens;
        const reason = safetyBudgetReached
          ? 'AUTONOMY_BUDGET_REACHED: cumulative time or token safety budget was reached. Increase the configured budget and resume after review.'
          : session.nextStage === 'PAUSED' ? 'Checkpoint cycle completed. Resume to continue.' : 'Per-run budget reached. The persistent job will continue from this checkpoint.';
        session = { ...session, status: 'PAUSED', currentStage: 'PAUSED', pauseReason: reason, updatedAt: now() };
      }
      this.db.saveRecord('sessions', session);
      this.writeState('loop_stopped', session, resumeRequested, false);
      const activity = this.activity(projectId, session.currentStage, session.status === 'COMPLETE' ? 'Research complete' : 'Research paused', 'info', session.pauseReason);
      this.db.addActivity(activity);
      this.publish({ projectId, running: false, stage: session.currentStage, activity });
    } catch (error) {
      if (signal.aborted) {
        session = { ...session, status: 'PAUSED', currentStage: 'PAUSED', pauseReason: 'Paused by user.', updatedAt: now() };
        this.db.saveRecord('sessions', session);
        this.writeState('loop_stopped', session, resumeRequested, false);
        const activity = this.activity(projectId, 'PAUSED', 'Research paused', 'info', session.pauseReason);
        this.db.addActivity(activity);
        this.publish({ projectId, running: false, stage: 'PAUSED', activity });
        return;
      }
      const message = error instanceof Error ? error.message : 'Autonomous research failed.';
      session = { ...session, status: 'FAILED', currentStage: 'FAILED', failure: message, updatedAt: now() };
      this.db.saveRecord('sessions', session);
      this.writeState('run_failed', session, resumeRequested, false);
      const activity = this.activity(projectId, 'FAILED', message, 'failed');
      this.db.addActivity(activity);
      this.publish({ projectId, running: false, stage: 'FAILED', activity });
    }
  }

  private async executeStage(stage: AgentStage, snapshot: ReturnType<ResearchDatabase['getProject']>, branch: ResearchBranch | null, signal: AbortSignal): Promise<{ action: RoleAction; specification: StructuredSpecification | null }> {
    if (stage === 'FORMALIZE') {
      const payload = await this.provider.formalize(snapshot, signal);
      const createdAt = now();
      const specification: StructuredSpecification = { id: randomUUID(), projectId: snapshot.project.id, originalText: snapshot.project.question, ...payload, provider: this.db.getSettings().provider, createdAt, updatedAt: createdAt };
      const action: RoleAction = {
        title: 'Structured mathematical specification',
        summary: specification.executable ? 'A machine-executable interpretation was validated and retained with its uncertainty.' : specification.symbolicExpressions.length ? 'A symbolic specification was validated; no unsafe executable interpretation was invented.' : 'A natural-language specification was validated. Research continues without an executable interpretation.',
        rationaleSummary: 'The conjecture was normalized into explicit variables, domains, assumptions, target, search parameters, and validation rules.',
        evidence: [], proposedNodes: [], branches: [], proofSteps: [], proofReviews: [], toolCalls: [], nextStage: 'PLAN', failures: specification.uncertainty, tokenUsage: { input: 0, output: 0, total: 0 },
      };
      return { action, specification };
    }
    let currentSnapshot = snapshot;
    if (stage === 'LITERATURE' && this.literature && this.db.getSettings().literatureSearchMode === 'auto') {
      await this.literature.search(snapshot.project.id, [snapshot.project.question, snapshot.project.goal, branch?.objective ?? ''].filter(Boolean).join(' '), signal);
      currentSnapshot = this.db.getProject(snapshot.project.id, false);
    }
    const sourceQuery = [currentSnapshot.project.question, currentSnapshot.project.goal, branch?.objective ?? '', stage].join('\n');
    const sourceContext = this.db.searchDocumentChunks(currentSnapshot.project.id, sourceQuery, 8);
    if (stage === 'PROOF_CRITIQUE') {
      const [skeptic, verifier] = await Promise.all([
        this.provider.runRole({ stage, role: 'skeptic', snapshot: currentSnapshot, branch, sourceContext }, signal),
        this.provider.runRole({ stage, role: 'independent-verifier', snapshot: currentSnapshot, branch, sourceContext }, signal),
      ]);
      return { action: mergeIndependentReviews(skeptic, verifier), specification: null };
    }
    const action = await this.provider.runRole({ stage, role: STAGE_ROLE[stage] ?? 'research-synthesizer', snapshot: currentSnapshot, branch, sourceContext }, signal);
    return { action, specification: null };
  }

  private async persistActionArtifacts(projectId: string, session: ResearchSession, stage: AgentStage, branch: ResearchBranch | null, action: RoleAction, specification: StructuredSpecification | null, signal: AbortSignal): Promise<{ evidenceIds: string[]; toolCallIds: string[] }> {
    if (specification) this.db.saveRecord('specifications', specification);
    const evidenceIds: string[] = [];
    const toolCallIds: string[] = [];
    for (const proposal of action.evidence) {
      const evidence: ResearchEvidence = { id: randomUUID(), projectId, sessionId: session.id, branchId: branch?.id ?? null, ...proposal, sourceIds: [], experimentIds: [], createdAt: now() };
      this.db.saveRecord('evidence', evidence); evidenceIds.push(evidence.id);
    }
    if ((stage === 'PLAN' || stage === 'REPLAN') && action.branches.length) this.persistBranches(projectId, session, branch, action);
    this.persistNodes(projectId, branch, action, evidenceIds);
    this.persistProof(projectId, session, branch, action);

    for (const execution of action.nativeToolExecutions ?? []) {
      const artifact = this.persistToolArtifact(
        projectId,
        session,
        branch,
        { name: execution.name, purpose: execution.purpose, input: execution.input },
        {
          ok: execution.ok,
          success: execution.success,
          output: execution.output,
          stdout: execution.stdout,
          stderr: execution.stderr,
          error: execution.error,
          errorType: execution.errorType,
          exitCode: execution.exitCode,
          workerExitCode: execution.workerExitCode,
          durationMs: execution.durationMs,
          timeout: execution.timeout,
          environment: execution.environment,
          verificationStatus: execution.verificationStatus,
          verificationLevel: execution.verificationLevel,
          reasonUnknown: execution.reasonUnknown,
          artifactLocation: execution.artifactLocation,
          auditLogPath: execution.auditLogPath,
        },
      );
      toolCallIds.push(artifact.callId);
      evidenceIds.push(artifact.evidenceId);
    }

    const calls: Array<{ name: ToolInvocation['name']; purpose: string; input: Record<string, unknown> }> = action.toolCalls.map((call) => ({ ...call }));
    if (stage === 'FORMAL_VERIFY') calls.push({ name: 'capability_check', purpose: 'Detect optional mathematical verification adapters.', input: {} });
    for (const call of calls) {
      if (signal.aborted) break;
      const invocation: ToolInvocation = { projectId, name: call.name, purpose: call.purpose, input: call.input };
      const result = await this.runTrackedTool(stage, invocation);
      const artifact = this.persistToolArtifact(projectId, session, branch, call, result);
      toolCallIds.push(artifact.callId);
      evidenceIds.push(artifact.evidenceId);
    }
    if (stage === 'FORMAL_VERIFY') {
      const reproduced = await this.reproduceDeterministicResults(projectId, session, branch, signal);
      evidenceIds.push(...reproduced.evidenceIds);
      toolCallIds.push(...reproduced.toolCallIds);
    }
    return { evidenceIds, toolCallIds };
  }

  private async reproduceDeterministicResults(projectId: string, session: ResearchSession, branch: ResearchBranch | null, signal: AbortSignal): Promise<{ evidenceIds: string[]; toolCallIds: string[] }> {
    const reproducibleTools = new Set<ToolName>(['run_python', 'symbolic_simplify', 'solve_equation', 'differentiate', 'integrate', 'matrix_compute', 'z3_check', 'lean_check']);
    const snapshot = this.db.getProject(projectId, false);
    const alreadyReproduced = new Set(snapshot.experiments.map((item) => item.rerunOf).filter((item): item is string => Boolean(item)));
    const originals = snapshot.experiments.filter((item) => item.status === 'succeeded' && !item.rerunOf
      && reproducibleTools.has(item.tool as ToolName) && !alreadyReproduced.has(item.id)).slice(-3);
    const evidenceIds: string[] = [];
    const toolCallIds: string[] = [];
    for (const original of originals) {
      if (signal.aborted) break;
      let input: Record<string, unknown>;
      try { input = JSON.parse(original.input) as Record<string, unknown>; }
      catch { continue; }
      const invocation: ToolInvocation = {
        projectId, name: original.tool as ToolName,
        purpose: `Independent reproduction of experiment ${original.id}: ${original.purpose}`,
        input,
      };
      const result = await this.runTrackedTool('FORMAL_VERIFY', invocation);
      const matches = result.ok && canonicalToolOutput(result.output) === canonicalToolOutput(original.output);
      const createdAt = now();
      const rerun: Experiment = {
        id: randomUUID(), projectId, purpose: invocation.purpose, code: original.code, tool: original.tool,
        input: original.input, output: result.ok ? result.output : result.error ?? '',
        interpretation: matches
          ? 'VERIFIED REPRODUCTION: the deterministic tool was rerun from the persisted input and returned the same normalized output.'
          : 'FAILED REPRODUCTION: the rerun failed or differed from the persisted output; the original result must not be treated as independently reproduced.',
        relatedNodeId: original.relatedNodeId, status: matches ? 'succeeded' : 'failed', durationMs: result.durationMs,
        environment: result.environment, stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode,
        workerExitCode: result.workerExitCode, artifactLocation: result.artifactLocation, auditLogPath: result.auditLogPath,
        verificationStatus: matches ? original.verificationStatus : 'unverified', rerunOf: original.id,
        createdAt, updatedAt: createdAt,
      };
      this.db.saveRecord('experiments', rerun);
      const evidence: ResearchEvidence = {
        id: randomUUID(), projectId, sessionId: session.id, branchId: branch?.id ?? null,
        type: original.tool === 'lean_check' || original.tool === 'z3_check' ? 'formal-check' : 'exact-computation',
        title: matches ? `Reproduced: ${original.purpose}` : `Reproduction mismatch: ${original.purpose}`,
        content: rerun.interpretation, verificationStatus: matches ? (original.verificationStatus ?? 'computationally-verified') : 'unverified',
        sourceIds: [], experimentIds: [original.id, rerun.id], reproducible: matches, createdAt,
      };
      this.db.saveRecord('evidence', evidence);
      toolCallIds.push(rerun.id);
      evidenceIds.push(evidence.id);
    }
    return { evidenceIds, toolCallIds };
  }

  private async runTrackedTool(stage: AgentStage, invocation: ToolInvocation): Promise<ToolResult> {
    const started = performance.now();
    const planned = this.activity(invocation.projectId, stage, `PLANNED: ${invocation.name}`, 'info', invocation.purpose);
    planned.kind = 'tool';
    this.db.addActivity(planned);
    this.publish({ projectId: invocation.projectId, running: true, stage, activity: planned });
    const running = { ...planned, id: randomUUID(), title: `RUNNING: ${invocation.name}`, status: 'running' as const, createdAt: now() };
    this.db.addActivity(running);
    this.publish({ projectId: invocation.projectId, running: true, stage, activity: running });
    let boundInvocation = invocation;
    let bindingId = '';
    if (invocation.name === 'lean_check') {
      const snapshot = this.db.getProject(invocation.projectId, false);
      const proof = typeof invocation.input.proofId === 'string' ? snapshot.proofs.find((item) => item.id === invocation.input.proofId) : undefined;
      const binding = new FormalBindingService(this.db).create(
        invocation.projectId,
        proof?.theorem ?? snapshot.project.question,
        JSON.stringify(snapshot.specifications.at(-1) ?? { originalClaim: snapshot.project.question }),
        String(invocation.input.code ?? ''),
      );
      bindingId = binding.id;
      boundInvocation = { ...invocation, input: { ...invocation.input, bindingId } };
    }
    const result = await this.tools.run(boundInvocation);
    if (result.ok && bindingId) new FormalBindingService(this.db).certify(invocation.projectId, bindingId, String(invocation.input.code ?? ''), result.output || result.stdout);
    const detail = result.ok
      ? `VERIFIED: exit ${result.exitCode ?? 0}; stdout ${(result.stdout ?? '').slice(0, 1_000) || '(empty)'}${result.stderr ? `; stderr ${result.stderr.slice(0, 1_000)}` : ''}`
      : `FAILED: ${result.error ?? 'tool failure'}; exit ${result.exitCode ?? 'n/a'}; stderr ${(result.stderr ?? '').slice(0, 1_000) || '(empty)'}`;
    const completed = { ...planned, id: randomUUID(), title: `${result.ok ? 'VERIFIED' : 'FAILED'}: ${invocation.name}`, detail, status: result.ok ? 'succeeded' as const : 'failed' as const, durationMs: Math.round(performance.now() - started), createdAt: now() };
    this.db.addActivity(completed);
    this.publish({ projectId: invocation.projectId, running: true, stage, activity: completed });
    return result;
  }

  private persistToolArtifact(
    projectId: string,
    session: ResearchSession,
    branch: ResearchBranch | null,
    call: { name: ToolInvocation['name']; purpose: string; input: Record<string, unknown> },
    result: ToolResult,
  ): { callId: string; evidenceId: string } {
    const callId = randomUUID();
    const createdAt = now();
    const verificationStatus: VerificationStatus = !result.ok ? 'unverified'
      : call.name === 'lean_check' && result.verificationStatus === 'FORMALLY_VERIFIED' ? 'formally-verified'
      : call.name === 'z3_check' ? 'bounded-check'
      : call.name === 'symbolic_simplify' || call.name === 'solve_equation' || call.name === 'differentiate' || call.name === 'integrate' || call.name === 'matrix_compute' ? 'symbolically-verified'
      : call.name === 'run_python' ? 'computationally-verified'
      : 'unverified';
    const experiment: Experiment = {
      id: callId,
      projectId,
      purpose: call.purpose,
      code: String(call.input.code ?? call.input.expression ?? call.input.smt2 ?? ''),
      tool: call.name,
      input: JSON.stringify(call.input),
      output: result.ok ? result.output : result.error ?? '',
      interpretation: result.ok ? 'VERIFIED: a local tool returned the recorded exit code, stdout, stderr, and output. Interpret only within the recorded search range and assumptions.' : 'FAILED: the tool did not produce verified mathematical evidence; no mathematical claim was promoted.',
      relatedNodeId: branch?.rootNodeId ?? null,
      status: result.ok ? 'succeeded' : 'failed',
      durationMs: result.durationMs,
      environment: result.environment,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      workerExitCode: result.workerExitCode,
      artifactLocation: result.artifactLocation,
      auditLogPath: result.auditLogPath,
      verificationStatus,
      rerunOf: null,
      createdAt,
      updatedAt: createdAt,
    };
    this.db.saveRecord('experiments', experiment);
    const exact = result.ok && call.name === 'run_python';
    const evidence: ResearchEvidence = {
      id: randomUUID(),
      projectId,
      sessionId: session.id,
      branchId: branch?.id ?? null,
      type: call.name === 'lean_check' || call.name === 'z3_check' || call.name === 'capability_check' ? 'formal-check'
        : call.name === 'symbolic_simplify' || call.name === 'solve_equation' || call.name === 'differentiate' || call.name === 'integrate' || call.name === 'matrix_compute' ? 'symbolic-computation'
        : 'exact-computation',
      title: call.purpose,
      content: result.ok ? result.output : result.error ?? 'Tool failed.',
      verificationStatus: exact && /['"]counterexample['"]\s*:\s*\{/.test(result.output) ? 'exactly-verified' : verificationStatus,
      verificationLevel: result.verificationLevel ?? (result.ok && call.name === 'run_python' ? 'BOUNDED_CHECK' : undefined),
      sourceIds: [],
      experimentIds: [experiment.id],
      reproducible: result.ok,
      createdAt,
    };
    this.db.saveRecord('evidence', evidence);
    if (call.name === 'lean_check' && result.ok && result.verificationStatus === 'FORMALLY_VERIFIED') {
      this.promoteFaithfullyFormalizedProof(projectId, call.input);
    }
    if (exact && /['"]counterexample['"]\s*:\s*\{/.test(result.output)) this.persistCounterexample(projectId, branch, evidence, result.output);
    return { callId, evidenceId: evidence.id };
  }

  private promoteFaithfullyFormalizedProof(projectId: string, input: Record<string, unknown>): void {
    const proofId = typeof input.proofId === 'string' ? input.proofId : '';
    const formalizationOf = typeof input.formalizationOf === 'string' ? input.formalizationOf.trim() : '';
    if (!proofId || !formalizationOf) return;
    const proof = this.db.getProject(projectId, false).proofs.find((item) => item.id === proofId);
    const binding = this.db.getProject(projectId, false).formalBindings
      .filter((item) => item.status === 'KERNEL_CERTIFIED' && item.originalStatement === proof?.theorem.trim())
      .at(-1);
    if (!proof || proof.theorem.trim() !== formalizationOf || !proof.independentlyReviewed || binding?.status !== 'KERNEL_CERTIFIED') return;
    if (proof.steps.length === 0 || proof.steps.some((step) => step.critical && step.status !== 'VALID')) return;
    this.db.saveRecord('proofs', {
      ...proof,
      status: 'VERIFIED',
      verificationStatus: 'formally-verified',
      updatedAt: now(),
    });
  }

  private persistBranches(projectId: string, session: ResearchSession, parentBranch: ResearchBranch | null, action: RoleAction): void {
    const snapshot = this.db.getProject(projectId, false);
    const root = snapshot.nodes.find((node) => node.parentId === null)!;
    const existingTitles = new Set(snapshot.branches.map((item) => item.title));
    for (const proposal of action.branches.filter((item) => !existingTitles.has(item.title)).slice(0, this.db.getSettings().maxBranches)) {
      const createdAt = now(); const nodeId = randomUUID();
      const parentNodeId = parentBranch?.rootNodeId ?? root?.id ?? null;
      this.db.saveRecord('nodes', { id: nodeId, projectId, parentId: parentNodeId, kind: 'SUBGOAL', title: proposal.title, content: proposal.objective, statement: proposal.objective, status: 'UNEXPLORED', dependencies: parentNodeId ? [parentNodeId] : [], sources: [], tools: [], summary: proposal.method, x: 350 + snapshot.branches.length * 40, y: 80 + snapshot.branches.length * 110, createdAt, updatedAt: createdAt } satisfies ResearchNode);
      if (parentNodeId) this.db.saveRecord('graphEdges', { id: randomUUID(), projectId, sourceId: nodeId, targetId: parentNodeId, kind: 'DEPENDS_ON', label: parentBranch ? 'derived research route' : 'research route', createdAt } satisfies GraphEdge);
      this.db.saveRecord('branches', { id: randomUUID(), projectId, sessionId: session.id, title: proposal.title, objective: proposal.objective, method: proposal.method, status: 'queued', priority: proposal.priority, parentBranchId: parentBranch?.id ?? null, rootNodeId: nodeId, lastStepId: null, findings: [], failures: [], createdAt, updatedAt: createdAt } satisfies ResearchBranch);
    }
  }

  private persistNodes(projectId: string, branch: ResearchBranch | null, action: RoleAction, evidenceIds: string[]): void {
    const snapshot = this.db.getProject(projectId, false); const root = snapshot.nodes.find((node) => node.parentId === null);
    for (const proposal of action.proposedNodes) {
      const createdAt = now(); const id = randomUUID(); const parentId = branch?.rootNodeId ?? root?.id ?? null;
      this.db.saveRecord('nodes', { id, projectId, parentId, branchId: branch?.id ?? null, kind: proposal.kind, title: proposal.title, content: proposal.statement, statement: proposal.statement, status: proposal.status, dependencies: parentId ? [parentId] : [], sources: [], tools: [], summary: action.summary, evidenceIds, verificationStatus: 'llm-assessed-only', x: 620 + snapshot.nodes.length * 18, y: 80 + snapshot.nodes.length * 74, createdAt, updatedAt: createdAt } satisfies ResearchNode);
      if (parentId) this.db.saveRecord('graphEdges', { id: randomUUID(), projectId, sourceId: id, targetId: parentId, kind: proposal.kind === 'PROOF_GAP' ? 'BLOCKED_BY' : 'SUPPORTS', label: action.title, createdAt } satisfies GraphEdge);
    }
  }

  private persistProof(projectId: string, session: ResearchSession, branch: ResearchBranch | null, action: RoleAction): void {
    if (action.proofSteps.length) {
      const createdAt = now();
      const proof: ProofDocument = { id: randomUUID(), projectId, sessionId: session.id, branchId: branch?.id ?? null, theorem: this.db.getProject(projectId, false).project.question, assumptions: this.db.getProject(projectId, false).specifications.at(-1)?.assumptions ?? [], definitions: [], steps: action.proofSteps.map((step) => ({ id: randomUUID(), ...step, status: 'UNCERTAIN', verifierComment: 'Awaiting independent verification.' })), edgeCases: [], conclusion: action.summary, status: 'DRAFT', verificationStatus: 'llm-assessed-only', independentlyReviewed: false, createdAt, updatedAt: createdAt };
      this.db.saveRecord('proofs', proof);
    }
    if (action.proofReviews.length) {
      const proof = this.db.getProject(projectId, false).proofs.at(-1); if (!proof) return;
      const reviews = new Map(action.proofReviews.map((review) => [review.stepId, review]));
      const steps = proof.steps.map((step) => { const review = reviews.get(step.id); return review ? { ...step, status: review.status, verifierComment: review.comment } : step; });
      const hasGap = steps.some((step) => step.critical && step.status !== 'VALID');
      this.db.saveRecord('proofs', { ...proof, steps, independentlyReviewed: true, status: hasGap ? 'HAS_GAPS' : 'CANDIDATE', verificationStatus: hasGap ? 'unverified' : 'llm-assessed-only', updatedAt: now() });
    }
  }

  private persistCounterexample(projectId: string, branch: ResearchBranch | null, evidence: ResearchEvidence, output: string): void {
    const snapshot = this.db.getProject(projectId, false); const root = snapshot.nodes.find((node) => node.parentId === null); const createdAt = now(); const id = randomUUID();
    this.db.saveRecord('nodes', { id, projectId, parentId: branch?.rootNodeId ?? root?.id ?? null, branchId: branch?.id ?? null, kind: 'COUNTEREXAMPLE', title: 'Exact counterexample candidate', content: output, statement: output, status: 'VERIFIED', dependencies: [], sources: [], tools: ['run_python'], summary: 'The recorded input failed the validated executable predicate in an exact rerunnable search.', evidenceIds: [evidence.id], verificationStatus: 'exactly-verified', x: 880, y: 180 + snapshot.nodes.length * 52, createdAt, updatedAt: createdAt } satisfies ResearchNode);
    if (root) { this.db.saveRecord('graphEdges', { id: randomUUID(), projectId, sourceId: id, targetId: root.id, kind: 'REFUTES', label: 'exact finite counterexample', createdAt } satisfies GraphEdge); this.db.saveRecord('nodes', { ...root, status: 'REFUTED', updatedAt: createdAt }); }
  }

  private pickBranch(branches: ResearchBranch[], session: ResearchSession): ResearchBranch | null {
    const available = branches.filter((branch) => branch.status !== 'dead-end' && branch.status !== 'complete');
    if (!available.length) return null;
    return available.map((branch, index) => ({
      branch,
      score: branch.priority + (branch.status === 'promising' ? 30 : 0) + (branch.status === 'queued' ? 12 : 0)
        - branch.failures.length * 8 - branch.findings.length * 0.5 - ((index + session.branchCursor) % available.length),
    })).sort((a, b) => b.score - a.score)[0].branch;
  }

  private prepareSession(projectId: string, previous: ResearchSession | undefined, resumeRequested: boolean): ResearchSession {
    if (!previous || previous.status === 'COMPLETE') return this.newSession(projectId);
    const normalized: ResearchSession = {
      ...previous,
      cycleId: previous.cycleId || previous.id,
      cycleIndex: Number.isInteger(previous.cycleIndex) ? previous.cycleIndex : 0,
      cycleCheckpointStart: Number.isInteger(previous.cycleCheckpointStart) ? previous.cycleCheckpointStart : 0,
    };
    const completedCheckpointCycle = normalized.status === 'PAUSED' && normalized.nextStage === 'PAUSED';
    if (resumeRequested && completedCheckpointCycle) {
      return {
        ...normalized,
        cycleId: randomUUID(),
        cycleIndex: normalized.cycleIndex + 1,
        cycleCheckpointStart: normalized.checkpointCount,
        status: 'RUNNING',
        nextStage: normalized.checkpointReturnStage ?? 'EXPLORE',
        checkpointReturnStage: null,
        completedAt: null,
        failure: '',
        pauseReason: '',
        updatedAt: now(),
      };
    }
    return { ...normalized, status: 'RUNNING', completedAt: null, failure: '', pauseReason: '', updatedAt: now() };
  }

  private newSession(projectId: string): ResearchSession {
    const timestamp = now(); const sessionId = randomUUID();
    return { id: sessionId, projectId, cycleId: randomUUID(), cycleIndex: 0, cycleCheckpointStart: 0, status: 'RUNNING', currentStage: 'INITIALIZE', nextStage: 'INITIALIZE', checkpointReturnStage: null, iteration: 0, actionCount: 0, checkpointCount: 0, activeBranchId: null, branchCursor: 0, startedAt: timestamp, updatedAt: timestamp, lastCheckpointAt: timestamp, completedAt: null, pauseReason: '', failure: '', totalTokenUsage: 0, totalElapsedMs: 0, conclusion: null };
  }

  private writeState(event: ResearchStateLogEntry['event'], session: ResearchSession, resumeRequested: boolean, agentLoopRunning: boolean): void {
    const terminalCursor = session.nextStage === 'PAUSED' || session.nextStage === 'FAILED' || session.nextStage === 'COMPLETE';
    this.logState({
      timestamp: now(),
      event,
      project_id: session.projectId,
      session_id: session.id,
      cycle_id: session.cycleId,
      cycle_index: session.cycleIndex,
      paused: session.status === 'PAUSED',
      cycle_completed: session.status === 'PAUSED' && session.nextStage === 'PAUSED',
      pending_tasks: terminalCursor ? 0 : 1,
      agent_loop_running: agentLoopRunning,
      resume_requested: resumeRequested,
      current_stage: session.currentStage,
      next_stage: session.nextStage,
    });
  }

  private activity(projectId: string, stage: Activity['stage'], title: string, status: Activity['status'], detail = ''): Activity {
    return { id: randomUUID(), projectId, stage, kind: status === 'failed' ? 'error' : 'agent', title, detail, status, durationMs: null, createdAt: now() };
  }
}

const reviewSeverity: Record<NonNullable<RoleAction['proofReviews'][number]>['status'], number> = {
  VALID: 0, REQUIRES_COMPUTATION: 1, REQUIRES_FORMALIZATION: 2, REQUIRES_LEMMA: 3, UNCERTAIN: 4, INVALID: 5,
};

function mergeIndependentReviews(skeptic: RoleAction, verifier: RoleAction): RoleAction {
  const skepticReviews = new Map(skeptic.proofReviews.map((item) => [item.stepId, item]));
  const verifierReviews = new Map(verifier.proofReviews.map((item) => [item.stepId, item]));
  const stepIds = [...new Set([...skepticReviews.keys(), ...verifierReviews.keys()])];
  const proofReviews = stepIds.map((stepId) => {
    const left = skepticReviews.get(stepId);
    const right = verifierReviews.get(stepId);
    if (!left || !right) return {
      stepId, status: 'UNCERTAIN' as const,
      comment: `Independent-review disagreement: ${left?.comment ?? 'skeptic supplied no review'} | ${right?.comment ?? 'verifier supplied no review'}`,
    };
    const status = reviewSeverity[left.status] >= reviewSeverity[right.status] ? left.status : right.status;
    return { stepId, status, comment: `Skeptic: ${left.comment}\nIndependent verifier: ${right.comment}` };
  });
  return {
    ...skeptic,
    title: 'Parallel independent proof review',
    summary: `Skeptic review: ${skeptic.summary}\nIndependent verifier: ${verifier.summary}`,
    rationaleSummary: 'Two isolated model calls reviewed the same persisted proof. Their decisions were merged conservatively; a missing or conflicting review cannot become VALID.',
    evidence: [...skeptic.evidence, ...verifier.evidence].slice(0, 30),
    proposedNodes: [...skeptic.proposedNodes, ...verifier.proposedNodes].slice(0, 30),
    branches: [...skeptic.branches, ...verifier.branches].slice(0, 12),
    proofSteps: [...skeptic.proofSteps, ...verifier.proofSteps].slice(0, 50),
    proofReviews,
    toolCalls: [...skeptic.toolCalls, ...verifier.toolCalls].slice(0, 8),
    nativeToolExecutions: [...(skeptic.nativeToolExecutions ?? []), ...(verifier.nativeToolExecutions ?? [])].slice(0, 12),
    failures: [...skeptic.failures, ...verifier.failures].slice(0, 30),
    tokenUsage: {
      input: skeptic.tokenUsage.input + verifier.tokenUsage.input,
      output: skeptic.tokenUsage.output + verifier.tokenUsage.output,
      total: skeptic.tokenUsage.total + verifier.tokenUsage.total,
    },
  };
}

function canonicalToolOutput(value: string): string {
  return value.replace(/\r\n/g, '\n').trim();
}

const now = () => new Date().toISOString();

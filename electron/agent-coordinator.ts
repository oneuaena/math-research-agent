import { randomUUID } from 'node:crypto';
import type { Activity, AgentEvent, ToolInvocation, ToolResult } from '../src/shared/types';
import type { CredentialStore } from './credentials';
import type { ResearchDatabase } from './database';
import { createProvider } from './provider';
import { ResearchOrchestrator, type ResearchStateLogEntry } from './research-orchestrator';
import { StressEngine } from './stress-engine';
import type { ToolRunner } from './tool-runner';
import type { LiteratureSearchService } from './literature-search';
import { FormalBindingService } from './formal-binding';
import { ResourceBudgetService } from './resource-budget';

export class AgentCoordinator {
  private readonly runs = new Map<string, { controller: AbortController; promise: Promise<void> }>();

  constructor(
    private readonly db: ResearchDatabase,
    private readonly credentials: CredentialStore,
    private readonly tools: ToolRunner,
    private readonly publish: (event: AgentEvent) => void,
    private readonly logState: (entry: ResearchStateLogEntry) => void = () => undefined,
    private readonly literature?: LiteratureSearchService,
  ) {}

  start(projectId: string): void {
    void this.startRun(projectId, false);
  }

  resume(projectId: string): void {
    void this.startRun(projectId, true);
  }

  startAndWait(projectId: string, resumeRequested: boolean): Promise<void> {
    return this.startRun(projectId, resumeRequested);
  }

  private startRun(projectId: string, resumeRequested: boolean): Promise<void> {
    const active = this.runs.get(projectId);
    if (active) return active.promise;
    const controller = new AbortController();
    const promise = this.run(projectId, controller, resumeRequested).finally(() => this.runs.delete(projectId));
    this.runs.set(projectId, { controller, promise });
    return promise;
  }

  pause(projectId: string): void {
    this.tools.stop(projectId);
    this.runs.get(projectId)?.controller.abort();
  }

  stop(projectId: string): void {
    this.pause(projectId);
  }

  /** Abort the current safe boundary without changing the persistent job's desired state. */
  interruptForSteering(projectId: string): void {
    this.tools.stop(projectId);
    this.runs.get(projectId)?.controller.abort();
  }

  isRunning(projectId: string): boolean {
    return this.runs.has(projectId);
  }

  private async run(projectId: string, controller: AbortController, resumeRequested: boolean): Promise<void> {
    const settings = this.db.getSettings();
    if (this.db.getProject(projectId, false).project.mode === 'stress-test') {
      try {
        await new StressEngine(this.db, this.tools, this.publish).run(projectId, controller.signal);
      } catch (error) {
        if (!controller.signal.aborted) {
          const activity = this.activity(projectId, 'IDLE', 'error', error instanceof Error ? error.message : 'Stress test failed.', '', 'failed');
          this.db.addActivity(activity);
          this.publish({ projectId, running: false, stage: 'IDLE', activity });
        }
      }
      return;
    }
    try {
      const provider = createProvider(settings, this.credentials, (invocation) => this.executeTool(invocation));
      await new ResearchOrchestrator(this.db, this.tools, provider, this.publish, this.logState, this.literature).run(projectId, controller.signal, { resumeRequested });
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : 'Research run failed.';
      const activity = this.activity(projectId, 'IDLE', 'error', message, '', 'failed');
      this.db.addActivity(activity);
      this.publish({ projectId, running: false, stage: 'IDLE', activity });
    }
  }

  async executeTool(invocation: ToolInvocation): Promise<ToolResult> {
    const planned = this.activity(invocation.projectId, 'IDLE', 'tool', `PLANNED: ${invocation.name}`, invocation.purpose, 'info');
    this.db.addActivity(planned);
    this.publish({ projectId: invocation.projectId, running: true, stage: 'IDLE', activity: planned });
    const running = { ...planned, id: randomUUID(), title: `RUNNING: ${invocation.name}`, status: 'running' as const, createdAt: new Date().toISOString() };
    this.db.addActivity(running);
    this.publish({ projectId: invocation.projectId, running: true, stage: 'IDLE', activity: running });
    const bindingId = invocation.name === 'lean_check' && typeof invocation.input.bindingId === 'string' ? invocation.input.bindingId : '';
    const bindingCheck = invocation.name === 'lean_check'
      ? bindingId ? new FormalBindingService(this.db).verify(invocation.projectId, bindingId, String(invocation.input.code ?? '')) : { ok: false, error: 'FORMAL_BINDING_REQUIRED: native Lean checks require a frozen FORMALIZE binding.' }
      : { ok: true };
    const result: ToolResult = bindingCheck.ok
      ? await this.tools.run(invocation)
      : { ok: false, success: false, output: '', stdout: '', stderr: '', error: bindingCheck.error, errorType: 'VALIDATION_ERROR', exitCode: null, durationMs: 0, timeout: false, verificationStatus: 'PROGRAM_FAILURE' };
    try { new ResourceBudgetService(this.db).consume(invocation.projectId, 'toolSeconds', Math.ceil(result.durationMs / 1_000)); }
    catch (error) { result.ok = false; result.success = false; result.error = error instanceof Error ? error.message : 'RESOURCE_BUDGET_EXCEEDED'; result.errorType = 'VALIDATION_ERROR'; result.verificationStatus = 'PROGRAM_FAILURE'; }
    if (result.ok && invocation.name === 'lean_check' && bindingId) new FormalBindingService(this.db).certify(invocation.projectId, bindingId, String(invocation.input.code ?? ''), result.output || result.stdout);
    const detail = result.ok
      ? `VERIFIED: exit ${result.exitCode ?? 0}; stdout ${(result.stdout ?? '').slice(0, 1_000) || '(empty)'}${result.stderr ? `; stderr ${result.stderr.slice(0, 1_000)}` : ''}`
      : `FAILED: ${result.error ?? 'tool failure'}; exit ${result.exitCode ?? 'n/a'}; stderr ${(result.stderr ?? '').slice(0, 1_000) || '(empty)'}`;
    const complete = { ...planned, id: randomUUID(), title: `${result.ok ? 'VERIFIED' : 'FAILED'}: ${invocation.name}`, detail, status: result.ok ? 'succeeded' as const : 'failed' as const, durationMs: result.durationMs, createdAt: new Date().toISOString() };
    this.db.addActivity(complete);
    this.publish({ projectId: invocation.projectId, running: true, stage: 'IDLE', activity: complete });
    return result;
  }

  private activity(projectId: string, stage: Activity['stage'], kind: Activity['kind'], title: string, detail: string, status: Activity['status']): Activity {
    return { id: randomUUID(), projectId, stage, kind, title, detail, status, durationMs: null, createdAt: new Date().toISOString() };
  }
}

import { randomUUID } from 'node:crypto';
import type { Activity, AgentEvent } from '../src/shared/types';
import type { CredentialStore } from './credentials';
import type { ResearchDatabase } from './database';
import { createProvider } from './provider';
import { ResearchOrchestrator } from './research-orchestrator';
import { StressEngine } from './stress-engine';
import type { ToolRunner } from './tool-runner';

export class AgentCoordinator {
  private readonly runs = new Map<string, AbortController>();

  constructor(
    private readonly db: ResearchDatabase,
    private readonly credentials: CredentialStore,
    private readonly tools: ToolRunner,
    private readonly publish: (event: AgentEvent) => void,
  ) {}

  start(projectId: string): void {
    if (this.runs.has(projectId)) return;
    const controller = new AbortController();
    this.runs.set(projectId, controller);
    void this.run(projectId, controller);
  }

  resume(projectId: string): void { this.start(projectId); }

  pause(projectId: string): void {
    this.tools.stop(projectId);
    this.runs.get(projectId)?.abort();
  }

  stop(projectId: string): void {
    this.pause(projectId);
  }

  private async run(projectId: string, controller: AbortController): Promise<void> {
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
      } finally {
        this.runs.delete(projectId);
      }
      return;
    }
    try {
      const provider = createProvider(settings, this.credentials, (invocation) => this.tools.run(invocation));
      await new ResearchOrchestrator(this.db, this.tools, provider, this.publish).run(projectId, controller.signal);
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : 'Research run failed.';
      const activity = this.activity(projectId, 'IDLE', 'error', message, '', 'failed');
      this.db.addActivity(activity);
      this.publish({ projectId, running: false, stage: 'IDLE', activity });
    } finally {
      this.runs.delete(projectId);
    }
  }

  private activity(projectId: string, stage: Activity['stage'], kind: Activity['kind'], title: string, detail: string, status: Activity['status']): Activity {
    return { id: randomUUID(), projectId, stage, kind, title, detail, status, durationMs: null, createdAt: new Date().toISOString() };
  }
}

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ResearchDatabase } from './database';
import { LocalProvider } from './provider';
import { ResearchOrchestrator, type ResearchStateLogEntry } from './research-orchestrator';
import type { ToolRunner } from './tool-runner';
import type { ResearchSession } from '../src/shared/types';

describe('research checkpoint resume state machine', () => {
  it('creates and advances five new cycles without immediately re-pausing', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'mra-resume-test-'));
    const db = new ResearchDatabase(join(directory, 'research.sqlite3'));
    const logs: ResearchStateLogEntry[] = [];
    const runTool = vi.fn(async () => ({ ok: true, output: '{}', durationMs: 0, environment: 'test' }));
    const tools = { run: runTool } as unknown as ToolRunner;
    try {
      db.saveSettings({
        ...db.getSettings(),
        provider: 'local',
        maxIterations: 500,
        maxResearchMinutes: 5,
        checkpointEvery: 1,
      });
      const snapshot = db.createProject({
        name: 'Resume state machine',
        question: 'Determine whether every locally consistent abstract constraint family has a realization.',
        goal: 'Explore the claim conservatively.',
        background: '',
        knownResults: '',
        constraints: '',
        mode: 'autonomous',
        variables: 'F',
        domain: 'constraint families',
      });
      const orchestrator = new ResearchOrchestrator(db, tools, new LocalProvider(), () => undefined, (entry) => logs.push(entry));
      const signal = new AbortController().signal;

      await orchestrator.run(snapshot.project.id, signal);
      let current = db.getProject(snapshot.project.id, false);
      let session = current.sessions.at(-1)!;
      expect(session.failure).toBe('');
      expect(session.status).toBe('PAUSED');
      expect(session.nextStage).toBe('PAUSED');
      expect(session.cycleIndex).toBe(0);
      expect(session.checkpointCount).toBe(5);
      expect(current.researchSteps.some((step) => step.stage === 'PROOF_ATTEMPT')).toBe(true);
      expect(current.proofs.some((proof) => proof.independentlyReviewed && proof.steps.some((step) => step.verifierComment.includes('Skeptic:') && step.verifierComment.includes('Independent verifier:')))).toBe(true);

      const legacySession = { ...session } as Partial<ResearchSession>;
      delete legacySession.cycleId;
      delete legacySession.cycleIndex;
      delete legacySession.cycleCheckpointStart;
      db.saveRecord('sessions', legacySession as ResearchSession);
      current = db.getProject(snapshot.project.id, false);
      session = current.sessions.at(-1)!;

      for (let expectedCycle = 1; expectedCycle <= 5; expectedCycle += 1) {
        const previousCycleId = session.cycleId;
        const previousActionCount = session.actionCount;
        const previousStepCount = current.researchSteps.length;
        const logStart = logs.length;

        await orchestrator.run(snapshot.project.id, signal, { resumeRequested: true });
        current = db.getProject(snapshot.project.id, false);
        session = current.sessions.at(-1)!;
        const cycleLogs = logs.slice(logStart);

        expect(session.status).toBe('PAUSED');
        expect(session.nextStage).toBe('PAUSED');
        expect(session.cycleIndex).toBe(expectedCycle);
        expect(session.cycleId).not.toBe(previousCycleId);
        expect(session.actionCount).toBeGreaterThan(previousActionCount);
        expect(current.researchSteps.length).toBeGreaterThan(previousStepCount);
        expect(session.checkpointCount).toBe((expectedCycle + 1) * 5);
        expect(cycleLogs.some((entry) => entry.event === 'cycle_created' && entry.pending_tasks === 1)).toBe(true);
        expect(cycleLogs.some((entry) => entry.event === 'action_started' && entry.agent_loop_running)).toBe(true);
        expect(cycleLogs.at(-1)).toMatchObject({
          event: 'loop_stopped',
          cycle_id: session.cycleId,
          paused: true,
          cycle_completed: true,
          pending_tasks: 0,
          agent_loop_running: false,
          resume_requested: true,
        });
      }
    } finally {
      db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }, 30_000);
});

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { roleActionSchema, type RoleAction } from '../src/shared/research';
import type { AgentStage } from '../src/shared/types';
import { ResearchDatabase } from './database';
import type { ModelProvider, ProviderRoleRequest, StageResult } from './provider';
import { ResearchOrchestrator } from './research-orchestrator';
import { ToolRunner } from './tool-runner';

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd() },
}));

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

describe('real project workspace execution chain', () => {
  it('writes, executes, reads after restart, downloads HTTPS, and obtains a Z3 result', async () => {
    const userData = mkdtempSync(join(tmpdir(), 'mra-tool-e2e-'));
    directories.push(userData);
    const projectId = '00000000-0000-4000-8000-000000000071';
    const settings = () => ({ pythonPath: process.env.MRA_TEST_PYTHON || 'python', leanPath: '', maxToolSeconds: 30 });
    const runner = new ToolRunner(userData, settings);

    const wroteScript = await runner.run({ projectId, name: 'workspace_write', purpose: 'Create a real Python script', input: {
      path: 'n71/probe.py', content: 'print("N71_EXECUTION_OK")\n',
    } });
    expect(wroteScript).toMatchObject({ ok: true, exitCode: 0 });
    expect(existsSync(join(userData, 'tool-workspaces', projectId, 'n71', 'probe.py'))).toBe(true);

    const command = await runner.run({ projectId, name: 'run_command', purpose: 'Execute the persisted Python script', input: { command: 'python', args: ['n71/probe.py'] } });
    expect(command).toMatchObject({ ok: true, exitCode: 0 });
    expect(command.stdout).toMatch(/^N71_EXECUTION_OK\r?\n$/);

    const python = await runner.run({ projectId, name: 'run_python', purpose: 'Write and print a persistent checkpoint', input: {
      code: 'import json\nwith open("n71/checkpoint.json", "w", encoding="utf-8") as f:\n    json.dump({"n": 71, "status": "verified-execution"}, f)\nprint("CHECKPOINT_WRITTEN")\nresult = 71',
    } });
    expect(python).toMatchObject({ ok: true, output: '71', stdout: 'CHECKPOINT_WRITTEN\n', exitCode: 0 });

    const restartedRunner = new ToolRunner(userData, settings);
    const checkpoint = await restartedRunner.run({ projectId, name: 'workspace_read', purpose: 'Resume from persisted checkpoint after restart', input: { path: 'n71/checkpoint.json' } });
    expect(checkpoint).toMatchObject({ ok: true, exitCode: 0 });
    expect(checkpoint.output).toContain('"n": 71');
    expect(readFileSync(join(userData, 'tool-workspaces', projectId, 'n71', 'checkpoint.json'), 'utf8')).toContain('verified-execution');

    const download = await restartedRunner.run({ projectId, name: 'download_file', purpose: 'Download a real HTTPS test file', input: { url: 'https://raw.githubusercontent.com/github/gitignore/main/Python.gitignore', path: 'n71/Python.gitignore' } });
    expect(download).toMatchObject({ ok: true, exitCode: 0 });
    expect(JSON.parse(download.output)).toMatchObject({ path: 'n71/Python.gitignore' });
    const downloaded = await restartedRunner.run({ projectId, name: 'workspace_read', purpose: 'Verify the downloaded content', input: { path: 'n71/Python.gitignore' } });
    expect(downloaded.output).toContain('Byte-compiled');

    const solver = await restartedRunner.run({ projectId, name: 'z3_check', purpose: 'Run an actual satisfiability solver', input: { smt2: '(declare-const x Int) (assert (> x 0)) (assert (< x 2))' } });
    expect(solver).toMatchObject({ ok: true, exitCode: 0, verificationStatus: 'SAT' });
    expect(JSON.parse(solver.output)).toMatchObject({ status: 'SAT', bounded: true });
  }, 120_000);

  it('runs a durable destroy-2 batch through the command adapter and resumes after an interruption', async () => {
    const userData = mkdtempSync(join(tmpdir(), 'mra-destroy2-e2e-'));
    directories.push(userData);
    const projectId = '00000000-0000-4000-8000-000000000072';
    const runner = new ToolRunner(userData, () => ({ pythonPath: process.env.MRA_TEST_PYTHON || 'python', leanPath: '', maxToolSeconds: 30 }));
    const baseline = readFileSync(join(process.cwd(), 'examples', 'n71_140_baseline.txt'), 'utf8');
    const driver = readFileSync(join(process.cwd(), 'python', 'n71_destroy2_batch.py'), 'utf8');
    expect((await runner.run({ projectId, name: 'workspace_write', purpose: 'Persist a verified 140-point baseline', input: { path: 'n71/baseline.txt', content: baseline } })).ok).toBe(true);
    expect((await runner.run({ projectId, name: 'workspace_write', purpose: 'Persist the trusted destroy-2 batch driver', input: { path: 'n71/destroy2.py', content: driver } })).ok).toBe(true);

    const interrupted = await runner.run({ projectId, name: 'run_command', purpose: 'Run two exact deletion pairs then simulate interruption', input: { command: 'python', args: ['n71/destroy2.py', '--baseline', 'n71/baseline.txt', '--checkpoint', 'n71/checkpoint.json', '--batch-log', 'n71/batches.jsonl', '--max-pairs', '3', '--reset', '--test-interrupt-after', '2'] } });
    expect(interrupted).toMatchObject({ ok: false, exitCode: 75 });
    expect(interrupted.stdout).toContain('INTERRUPTED_FOR_RESUME_TEST');
    const afterInterrupt = await runner.run({ projectId, name: 'workspace_read', purpose: 'Verify the interruption checkpoint', input: { path: 'n71/checkpoint.json' } });
    expect(JSON.parse(afterInterrupt.output)).toMatchObject({ completed_delete_pairs: 2, next_delete_pair_index: 2, remaining_delete_pairs: 9728, status: 'INTERRUPTED_FOR_RESUME_TEST' });

    const resumed = await new ToolRunner(userData, () => ({ pythonPath: process.env.MRA_TEST_PYTHON || 'python', leanPath: '', maxToolSeconds: 30 })).run({ projectId, name: 'run_command', purpose: 'Resume the exact destroy-2 enumeration from checkpoint', input: { command: 'python', args: ['n71/destroy2.py', '--baseline', 'n71/baseline.txt', '--checkpoint', 'n71/checkpoint.json', '--batch-log', 'n71/batches.jsonl', '--max-pairs', '4'] } });
    expect(resumed).toMatchObject({ ok: true, exitCode: 0 });
    expect(JSON.parse(resumed.stdout)).toMatchObject({ completed_delete_pairs: 6, remaining_delete_pairs: 9724, baseline_triples: 0, status: 'RUNNING' });
  }, 120_000);

  it('routes agent tool calls into the executor and records PLANNED, RUNNING, and VERIFIED states', async () => {
    const userData = mkdtempSync(join(tmpdir(), 'mra-agent-e2e-'));
    directories.push(userData);
    const db = new ResearchDatabase(join(userData, 'research.sqlite3'));
    const tools = new ToolRunner(userData, () => ({ pythonPath: process.env.MRA_TEST_PYTHON || 'python', leanPath: '', maxToolSeconds: 30 }));
    const action = (stage: AgentStage): RoleAction => roleActionSchema.parse({
      title: `${stage} action`, summary: 'PLANNED research action; tool evidence is recorded separately.', rationaleSummary: 'End-to-end executor test.',
      evidence: [], proposedNodes: [], branches: [], proofSteps: [], proofReviews: [], failures: [], tokenUsage: { input: 0, output: 0, total: 0 },
      toolCalls: stage === 'EXPLORE' ? [
        { name: 'workspace_write', purpose: 'Create agent script', input: { path: 'n71/agent_probe.py', content: 'print("AGENT_EXECUTION_OK")\n' } },
        { name: 'run_command', purpose: 'Execute the agent script', input: { command: 'python', args: ['n71/agent_probe.py'] } },
      ] : [],
      nextStage: 'EXPLORE',
    });
    const provider: ModelProvider = {
      async respondChat() { return ''; },
      async runStage(stage): Promise<StageResult> { return { title: stage, summary: 'unused', status: 'unverified' }; },
      async formalize() { return { quantifiers: [], variables: [], domains: {}, assumptions: [], target: { relation: '=', left: '0', right: '0', description: 'fixture' }, equivalentForms: [], searchParameters: { min: 0, max: 1 }, validationRules: [], executable: null, symbolicExpressions: [], naturalLanguageOnly: true, uncertainty: [], confidence: 1 }; },
      async runRole(request: ProviderRoleRequest) { return action(request.stage); },
    };
    try {
      db.saveSettings({ ...db.getSettings(), provider: 'local', maxIterations: 5, maxResearchMinutes: 2, checkpointEvery: 100 });
      const project = db.createProject({ name: 'n=71 execution fixture', question: 'Run the executor fixture.', goal: 'Verify actual local execution.', background: '', knownResults: '', constraints: '', mode: 'autonomous' });
      await new ResearchOrchestrator(db, tools, provider, () => undefined).run(project.project.id, new AbortController().signal);
      const snapshot = db.getProject(project.project.id, false);
      expect(snapshot.experiments.find((item) => item.tool === 'run_command')).toMatchObject({ status: 'succeeded', stdout: expect.stringContaining('AGENT_EXECUTION_OK'), exitCode: 0 });
      expect(snapshot.activities.map((item) => item.title)).toEqual(expect.arrayContaining(['PLANNED: workspace_write', 'RUNNING: workspace_write', 'VERIFIED: workspace_write', 'PLANNED: run_command', 'RUNNING: run_command', 'VERIFIED: run_command']));
    } finally {
      db.close();
    }
  }, 120_000);
});

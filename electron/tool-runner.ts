import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { app } from 'electron';
import { z } from 'zod';
import type { CapabilityReport, RuntimeDiagnostics, ToolInvocation, ToolResult } from '../src/shared/types';
import { resolvePythonRuntime } from './python-runtime';

const invocationSchema = z.object({
  projectId: z.string().uuid(),
  name: z.enum(['run_python', 'symbolic_simplify', 'solve_equation', 'differentiate', 'integrate', 'matrix_compute', 'capability_check', 'z3_check']),
  purpose: z.string().min(1).max(500),
  input: z.record(z.string(), z.unknown()),
});

export class ToolRunner {
  private readonly running = new Map<string, ChildProcessWithoutNullStreams>();

  constructor(
    private readonly userDataPath: string,
    private readonly settings: () => { pythonPath: string; maxToolSeconds: number },
  ) {}

  private runtime() {
    return resolvePythonRuntime({
      packaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      configuredPath: this.settings().pythonPath,
    });
  }

  async run(raw: ToolInvocation): Promise<ToolResult> {
    const invocation = invocationSchema.parse(raw);
    const started = performance.now();
    const workspace = join(this.userDataPath, 'tool-workspaces', invocation.projectId);
    mkdirSync(workspace, { recursive: true });
    const worker = app.isPackaged
      ? join(process.resourcesPath, 'python', 'worker.py')
      : join(app.getAppPath(), 'python', 'worker.py');
    const config = this.settings();
    const runtime = this.runtime();
    if (runtime.source === 'bundled' && !existsSync(runtime.executable)) {
      return {
        ok: false,
        output: '',
        error: `Bundled Python runtime is missing or damaged at ${runtime.displayPath}. Reinstall Math Research Agent.`,
        durationMs: Math.round(performance.now() - started),
      };
    }

    return await new Promise<ToolResult>((resolve) => {
      let stdout = '';
      let stderr = '';
      let settled = false;
      const child = spawn(runtime.executable, ['-I', worker], {
        cwd: workspace,
        windowsHide: true,
        env: {
          PATH: [dirname(runtime.executable), process.env.PATH].filter(Boolean).join(delimiter),
          SYSTEMROOT: process.env.SYSTEMROOT,
          WINDIR: process.env.WINDIR,
          PYTHONIOENCODING: 'utf-8',
          PYTHONUTF8: '1',
          PYTHONNOUSERSITE: '1',
          PYTHONDONTWRITEBYTECODE: '1',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.running.set(invocation.projectId, child);

      const finish = (result: Omit<ToolResult, 'durationMs'>) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.running.delete(invocation.projectId);
        resolve({ ...result, durationMs: Math.round(performance.now() - started) });
      };

      const timer = setTimeout(() => {
        child.kill();
        finish({ ok: false, output: '', error: `Tool exceeded the ${config.maxToolSeconds} second limit.` });
      }, config.maxToolSeconds * 1000);

      child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
      child.on('error', (error) => finish({
        ok: false,
        output: '',
        error: runtime.source === 'bundled'
          ? `Bundled Python runtime could not start. Reinstall Math Research Agent. (${error.message})`
          : `Configured Python could not start: ${error.message}`,
      }));
      child.on('close', () => {
        try {
          const parsed = JSON.parse(stdout.trim()) as { ok: boolean; output?: string; error?: string; environment?: string };
          finish({ ok: parsed.ok, output: parsed.output ?? '', error: parsed.error, environment: parsed.environment });
        } catch {
          finish({ ok: false, output: '', error: stderr.trim() || 'The mathematical tool returned an invalid result.' });
        }
      });
      child.stdin.end(JSON.stringify(invocation));
    });
  }

  stop(projectId: string): void {
    this.running.get(projectId)?.kill();
    this.running.delete(projectId);
  }

  async diagnostics(): Promise<RuntimeDiagnostics> {
    const runtime = this.runtime();
    const projectId = '00000000-0000-4000-8000-000000000001';
    const blank = { available: false, version: '' };
    const problems: string[] = [];
    const executableExists = runtime.source === 'configured' || existsSync(runtime.executable);
    if (!executableExists) problems.push(`Bundled Python runtime is missing at ${runtime.displayPath}.`);

    const workspace = join(this.userDataPath, 'runtime-diagnostics');
    let workspaceWritable = false;
    try {
      mkdirSync(workspace, { recursive: true });
      const probe = join(workspace, '.write-test');
      writeFileSync(probe, 'ok', 'utf8');
      unlinkSync(probe);
      workspaceWritable = true;
    } catch (error) {
      problems.push(`Runtime workspace is not writable: ${error instanceof Error ? error.message : String(error)}`);
    }

    const capabilityResult = await this.run({ projectId, name: 'capability_check', purpose: 'Runtime diagnostics', input: {} });
    let capabilities: CapabilityReport | null = null;
    if (capabilityResult.ok) {
      try { capabilities = JSON.parse(capabilityResult.output) as CapabilityReport; }
      catch { problems.push('The bundled worker returned an invalid capability report.'); }
    } else {
      problems.push(capabilityResult.error ?? 'The Python worker could not start.');
    }

    const arithmeticResult = capabilityResult.ok
      ? await this.run({ projectId, name: 'run_python', purpose: 'Check bundled arithmetic', input: { code: 'result = 2 + 2' } })
      : { ok: false, output: '', error: 'Skipped because Python did not start.', durationMs: 0 };
    const factorResult = capabilityResult.ok
      ? await this.run({ projectId, name: 'run_python', purpose: 'Check bundled SymPy', input: { code: "import sympy as sp\nx = sp.Symbol('x')\nresult = sp.factor(x**2 - 1)" } })
      : { ok: false, output: '', error: 'Skipped because Python did not start.', durationMs: 0 };
    if (!arithmeticResult.ok || arithmeticResult.output.trim() !== '4') problems.push(arithmeticResult.error ?? 'Bundled arithmetic check returned an unexpected result.');
    if (!factorResult.ok || factorResult.output.replace(/\s/g, '') !== '(x-1)*(x+1)') problems.push(factorResult.error ?? 'Bundled SymPy factorization returned an unexpected result.');

    let z3Sat: boolean | null = null;
    if (capabilities?.z3.available) {
      const z3Result = await this.run({
        projectId,
        name: 'z3_check',
        purpose: 'Check bundled Z3',
        input: { smt2: '(declare-const x Int) (assert (> x 1)) (assert (< x 3))' },
      });
      try { z3Sat = z3Result.ok && (JSON.parse(z3Result.output) as { status?: string }).status === 'sat'; }
      catch { z3Sat = false; }
      if (!z3Sat) problems.push(z3Result.error ?? 'Bundled Z3 SAT check failed.');
    }

    return {
      ok: problems.length === 0,
      source: runtime.source,
      displayPath: runtime.displayPath,
      executableExists,
      canStart: capabilityResult.ok,
      workerOk: Boolean(capabilities),
      workspaceWritable,
      python: capabilities?.python ?? blank,
      sympy: capabilities?.sympy ?? blank,
      numpy: capabilities?.numpy ?? blank,
      scipy: capabilities?.scipy ?? blank,
      z3: { ...(capabilities?.z3 ?? blank), satTest: z3Sat },
      arithmetic: { passed: arithmeticResult.ok && arithmeticResult.output.trim() === '4', output: arithmeticResult.output },
      factorization: { passed: factorResult.ok && factorResult.output.replace(/\s/g, '') === '(x-1)*(x+1)', output: factorResult.output },
      error: problems.join(' '),
    };
  }
}

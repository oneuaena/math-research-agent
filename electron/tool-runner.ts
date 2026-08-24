import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { app } from 'electron';
import { z } from 'zod';
import type {
  CapabilityReport, MathematicalVerificationLevel, RuntimeDiagnostics, ToolErrorType, ToolInvocation, ToolResult,
  VerificationToolStatus,
} from '../src/shared/types';
import { resolvePythonRuntime } from './python-runtime';
import { probeLeanVersion, resolveLeanRuntime, runLeanVerification, searchMathlib } from './tools/lean-adapter';
import { runBoundedProcess, type ProcessExecution } from './tools/process-runner';
import { downloadWorkspaceFile, projectWorkspace, readWorkspaceFile, writeWorkspaceFile } from './tools/research-workspace';
import { inputExtension, VerificationAuditLog } from './tools/verification-audit';

const invocationSchema = z.object({
  projectId: z.string().uuid(),
  name: z.enum(['run_python', 'symbolic_simplify', 'solve_equation', 'differentiate', 'integrate', 'matrix_compute', 'capability_check', 'z3_check', 'lean_check', 'mathlib_search', 'workspace_write', 'workspace_read', 'download_file', 'run_command']),
  purpose: z.string().min(1).max(500),
  input: z.record(z.string(), z.unknown()),
});

type WorkerEnvelope = {
  protocol_version?: number;
  ok?: boolean;
  output?: string;
  stdout?: string;
  stderr?: string;
  error?: string;
  error_type?: string;
  exit_code?: number;
  environment?: string;
  verification_status?: string;
  verification_level?: string;
  reason_unknown?: string;
};

const ERROR_TYPES = new Set<ToolErrorType>(['NONE', 'TOOL_ERROR', 'PROGRAM_ERROR', 'VALIDATION_ERROR', 'TIMEOUT', 'OUTPUT_LIMIT', 'UNAVAILABLE', 'PROTOCOL_ERROR', 'UNSOUND_PROOF']);
const VERIFICATION_STATUSES = new Set<VerificationToolStatus>(['SUCCESS', 'SAT', 'UNSAT', 'UNKNOWN', 'BOUNDED_CHECK', 'FORMALLY_VERIFIED', 'REJECTED_UNSOUND', 'TOOL_FAILURE', 'PROGRAM_FAILURE']);
const VERIFICATION_LEVELS = new Set<MathematicalVerificationLevel>(['CONJECTURE', 'UNCERTAIN', 'HEURISTIC', 'NUMERICAL_EVIDENCE', 'BOUNDED_CHECK', 'SYMBOLIC_CHECK', 'SAT', 'UNSAT', 'UNKNOWN', 'REQUIRES_LEMMA', 'REQUIRES_FORMALIZATION', 'FORMALLY_VERIFIED', 'REFUTED']);

function failure(error: string, errorType: ToolErrorType, durationMs = 0, extra: Partial<ToolResult> = {}): ToolResult {
  return {
    ok: false,
    success: false,
    output: '',
    stdout: '',
    stderr: '',
    error,
    errorType,
    exitCode: null,
    durationMs,
    timeout: errorType === 'TIMEOUT',
    verificationStatus: errorType === 'UNSOUND_PROOF' ? 'REJECTED_UNSOUND' : errorType === 'PROGRAM_ERROR' || errorType === 'VALIDATION_ERROR' ? 'PROGRAM_FAILURE' : 'TOOL_FAILURE',
    ...extra,
  };
}

function inputText(invocation: ToolInvocation): string {
  if (invocation.name === 'run_python' || invocation.name === 'lean_check') return String(invocation.input.code ?? '');
  if (invocation.name === 'mathlib_search') return String(invocation.input.query ?? '');
  if (invocation.name === 'z3_check') return String(invocation.input.smt2 ?? '');
  if (invocation.name === 'workspace_write') return String(invocation.input.content ?? '');
  return JSON.stringify(invocation.input, null, 2);
}

function processFailure(execution: ProcessExecution, configuredMessage: string): ToolResult | null {
  if (execution.timedOut) return failure('Tool execution timed out.', 'TIMEOUT', execution.durationMs, { stdout: execution.stdout, stderr: execution.stderr, exitCode: execution.exitCode, workerExitCode: execution.exitCode });
  if (execution.outputLimitExceeded) return failure('Tool output exceeded the 4 MB safety limit.', 'OUTPUT_LIMIT', execution.durationMs, { stdout: execution.stdout, stderr: execution.stderr, exitCode: execution.exitCode, workerExitCode: execution.exitCode });
  if (execution.aborted) return failure('Tool execution was stopped.', 'TOOL_ERROR', execution.durationMs, { stdout: execution.stdout, stderr: execution.stderr, exitCode: execution.exitCode, workerExitCode: execution.exitCode });
  if (execution.spawnError) return failure(`${configuredMessage}: ${execution.spawnError}`, 'TOOL_ERROR', execution.durationMs, { stderr: execution.stderr, workerExitCode: null });
  if (execution.exitCode !== 0) return failure(`Mathematical worker exited with code ${execution.exitCode}.`, 'TOOL_ERROR', execution.durationMs, { stdout: execution.stdout, stderr: execution.stderr, exitCode: execution.exitCode, workerExitCode: execution.exitCode });
  return null;
}

export class ToolRunner {
  private readonly controllers = new Map<string, AbortController>();
  private readonly audit: VerificationAuditLog;

  constructor(
    private readonly userDataPath: string,
    private readonly settings: () => { pythonPath: string; leanPath: string; maxToolSeconds: number },
  ) {
    this.audit = new VerificationAuditLog(userDataPath);
  }

  private runtime() {
    return resolvePythonRuntime({
      packaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      configuredPath: this.settings().pythonPath,
    });
  }

  async run(raw: ToolInvocation): Promise<ToolResult> {
    const parsed = invocationSchema.safeParse(raw);
    if (!parsed.success) return failure(`Invalid tool invocation: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`, 'VALIDATION_ERROR');
    const invocation = parsed.data as ToolInvocation;
    const artifact = this.audit.createArtifact(invocation, inputExtension(invocation.name), inputText(invocation));
    const controller = new AbortController();
    this.controllers.get(invocation.projectId)?.abort();
    this.controllers.set(invocation.projectId, controller);
    let result: ToolResult;
    try {
      result = invocation.name === 'workspace_write' || invocation.name === 'workspace_read' || invocation.name === 'download_file'
        ? await this.runWorkspaceTool(invocation, controller.signal)
        : invocation.name === 'run_command'
          ? await this.runCommand(invocation, controller.signal)
        : invocation.name === 'lean_check'
        ? await runLeanVerification({
            code: String(invocation.input.code ?? ''),
            artifactFile: artifact.inputPath,
            userDataPath: this.userDataPath,
            configuredPath: this.settings().leanPath,
            timeoutMs: this.settings().maxToolSeconds * 1000,
            signal: controller.signal,
          })
        : invocation.name === 'mathlib_search'
          ? await searchMathlib({
              query: String(invocation.input.query ?? ''),
              userDataPath: this.userDataPath,
              configuredPath: this.settings().leanPath,
              timeoutMs: this.settings().maxToolSeconds * 1000,
              signal: controller.signal,
            })
        : await this.runWorker(invocation, controller.signal);
      if (invocation.name === 'capability_check' && result.ok) result = await this.withExternalCapabilities(result);
    } catch (error) {
      result = failure(error instanceof Error ? error.message : String(error), 'TOOL_ERROR');
    } finally {
      if (this.controllers.get(invocation.projectId) === controller) this.controllers.delete(invocation.projectId);
    }
    return this.audit.complete(invocation, result, artifact.directory);
  }

  private workspace(projectId: string): string {
    const workspace = projectWorkspace(this.userDataPath, projectId);
    mkdirSync(workspace, { recursive: true });
    return workspace;
  }

  private async runWorkspaceTool(invocation: ToolInvocation, signal: AbortSignal): Promise<ToolResult> {
    const started = performance.now();
    try {
      const workspace = this.workspace(invocation.projectId);
      if (invocation.name === 'workspace_write') {
        const saved = writeWorkspaceFile(workspace, String(invocation.input.path ?? ''), String(invocation.input.content ?? ''));
        return { ok: true, success: true, output: JSON.stringify(saved), stdout: `Wrote ${saved.path} (${saved.bytes} bytes).`, stderr: '', errorType: 'NONE', exitCode: 0, workerExitCode: 0, durationMs: Math.round(performance.now() - started), timeout: false, environment: `Project workspace ${workspace}`, verificationStatus: 'SUCCESS', verificationLevel: 'BOUNDED_CHECK' };
      }
      if (invocation.name === 'workspace_read') {
        const read = readWorkspaceFile(workspace, String(invocation.input.path ?? ''));
        return { ok: true, success: true, output: read.content, stdout: `Read ${read.path} (${read.bytes} bytes, sha256 ${read.sha256}).`, stderr: '', errorType: 'NONE', exitCode: 0, workerExitCode: 0, durationMs: Math.round(performance.now() - started), timeout: false, environment: `Project workspace ${workspace}`, verificationStatus: 'SUCCESS', verificationLevel: 'BOUNDED_CHECK' };
      }
      const downloaded = await downloadWorkspaceFile(workspace, String(invocation.input.url ?? ''), String(invocation.input.path ?? ''), signal);
      return { ok: true, success: true, output: JSON.stringify(downloaded), stdout: `Downloaded ${downloaded.path} (${downloaded.bytes} bytes, sha256 ${downloaded.sha256}).`, stderr: '', errorType: 'NONE', exitCode: 0, workerExitCode: 0, durationMs: Math.round(performance.now() - started), timeout: false, environment: `Project workspace ${workspace}`, verificationStatus: 'SUCCESS', verificationLevel: 'BOUNDED_CHECK' };
    } catch (error) {
      return failure(error instanceof Error ? error.message : String(error), signal.aborted ? 'TOOL_ERROR' : 'PROGRAM_ERROR', Math.round(performance.now() - started));
    }
  }

  private async runCommand(invocation: ToolInvocation, signal: AbortSignal): Promise<ToolResult> {
    const started = performance.now();
    const command = String(invocation.input.command ?? '');
    const argsValue = invocation.input.args;
    if (!['python', 'lean'].includes(command) || !Array.isArray(argsValue) || argsValue.some((item) => typeof item !== 'string' || item.length > 4_000)) return failure('Invalid allow-listed command invocation.', 'VALIDATION_ERROR');
    const workspace = this.workspace(invocation.projectId);
    for (const argument of argsValue) {
      if (argument.includes('\0')) return failure('Command arguments must not contain NUL bytes.', 'VALIDATION_ERROR');
      if (/^(?:[A-Za-z]:)?[\\/]/.test(argument) || argument.split(/[\\/]/).includes('..')) return failure('Command arguments must stay within the project workspace.', 'VALIDATION_ERROR');
    }
    const python = command === 'python' ? this.runtime() : null;
    const lean = command === 'lean' ? resolveLeanRuntime(this.settings().leanPath) : null;
    if (lean && !lean.available) return failure('Lean is unavailable. Configure a Lean executable before running it.', 'UNAVAILABLE', Math.round(performance.now() - started));
    if (python?.source === 'bundled' && !existsSync(python.executable)) return failure(`Bundled Python runtime is missing or damaged at ${python.displayPath}. Reinstall Math Research Agent.`, 'UNAVAILABLE', Math.round(performance.now() - started));
    const executable = python?.executable ?? lean?.leanExecutable;
    if (!executable) return failure(`${command} executable is unavailable.`, 'UNAVAILABLE', Math.round(performance.now() - started));
    const execution = await runBoundedProcess({
      executable,
      args: [...(python?.argsPrefix ?? []), ...argsValue],
      cwd: workspace,
      env: { ...process.env, PATH: [dirname(executable), process.env.PATH].filter(Boolean).join(delimiter), PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1' },
      timeoutMs: this.settings().maxToolSeconds * 1000,
      maxOutputBytes: 4 * 1024 * 1024,
      signal,
    });
    const failed = processFailure(execution, `${command} could not start`);
    if (failed) return failed;
    return { ok: true, success: true, output: execution.stdout || 'Command completed with no stdout.', stdout: execution.stdout, stderr: execution.stderr, errorType: 'NONE', exitCode: execution.exitCode, workerExitCode: execution.exitCode, durationMs: execution.durationMs, timeout: false, environment: `${command} in project workspace ${workspace}`, verificationStatus: 'SUCCESS', verificationLevel: 'BOUNDED_CHECK' };
  }

  private async runWorker(invocation: ToolInvocation, signal: AbortSignal): Promise<ToolResult> {
    const started = performance.now();
    const workspace = this.workspace(invocation.projectId);
    const worker = app.isPackaged ? join(process.resourcesPath, 'python', 'worker.py') : join(app.getAppPath(), 'python', 'worker.py');
    const runtime = this.runtime();
    if (runtime.source === 'bundled' && !existsSync(runtime.executable)) {
      return failure(`Bundled Python runtime is missing or damaged at ${runtime.displayPath}. Reinstall Math Research Agent.`, 'UNAVAILABLE', Math.round(performance.now() - started));
    }

    const execution = await runBoundedProcess({
      executable: runtime.executable,
      args: [...runtime.argsPrefix, '-I', '-B', '-X', 'utf8', worker],
      cwd: workspace,
      env: {
        PATH: [dirname(runtime.executable), process.env.PATH].filter(Boolean).join(delimiter),
        SYSTEMROOT: process.env.SYSTEMROOT,
        WINDIR: process.env.WINDIR,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
        USERPROFILE: process.env.USERPROFILE,
        LOCALAPPDATA: process.env.LOCALAPPDATA,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
        PYTHONNOUSERSITE: '1',
        PYTHONDONTWRITEBYTECODE: '1',
      },
      stdin: JSON.stringify(invocation),
      timeoutMs: this.settings().maxToolSeconds * 1000,
      maxOutputBytes: 4 * 1024 * 1024,
      signal,
    });
    const failed = processFailure(execution, runtime.source === 'bundled' ? 'Bundled Python runtime could not start' : 'Configured Python could not start');
    if (failed) return failed;

    let envelope: WorkerEnvelope;
    try {
      envelope = JSON.parse(execution.stdout.trim()) as WorkerEnvelope;
    } catch {
      return failure('Python worker returned malformed protocol JSON.', 'PROTOCOL_ERROR', execution.durationMs, { stdout: execution.stdout, stderr: execution.stderr, exitCode: execution.exitCode, workerExitCode: execution.exitCode });
    }
    if (envelope.protocol_version !== 2 || typeof envelope.ok !== 'boolean') {
      return failure('Python worker returned an unsupported result schema.', 'PROTOCOL_ERROR', execution.durationMs, { stdout: execution.stdout, stderr: execution.stderr, exitCode: execution.exitCode, workerExitCode: execution.exitCode });
    }
    const errorType = ERROR_TYPES.has(envelope.error_type as ToolErrorType) ? envelope.error_type as ToolErrorType : envelope.ok ? 'NONE' : 'PROGRAM_ERROR';
    const verificationStatus = VERIFICATION_STATUSES.has(envelope.verification_status as VerificationToolStatus) ? envelope.verification_status as VerificationToolStatus : envelope.ok ? 'SUCCESS' : 'PROGRAM_FAILURE';
    const verificationLevel = VERIFICATION_LEVELS.has(envelope.verification_level as MathematicalVerificationLevel) ? envelope.verification_level as MathematicalVerificationLevel : undefined;
    return {
      ok: envelope.ok,
      success: envelope.ok,
      output: envelope.output ?? '',
      stdout: envelope.stdout ?? '',
      stderr: [envelope.stderr, execution.stderr].filter(Boolean).join('\n'),
      error: envelope.error,
      errorType,
      exitCode: typeof envelope.exit_code === 'number' ? envelope.exit_code : envelope.ok ? 0 : 1,
      workerExitCode: execution.exitCode,
      durationMs: execution.durationMs,
      timeout: false,
      environment: envelope.environment,
      verificationStatus,
      verificationLevel,
      reasonUnknown: envelope.reason_unknown,
    };
  }

  private async withExternalCapabilities(result: ToolResult): Promise<ToolResult> {
    try {
      const report = JSON.parse(result.output) as CapabilityReport;
      const leanRuntime = resolveLeanRuntime(this.settings().leanPath);
      report.lean = { available: leanRuntime.available, version: leanRuntime.available ? await probeLeanVersion(leanRuntime) : '' };
      return { ...result, output: JSON.stringify(report, null, 2) };
    } catch {
      return failure('The mathematical worker returned an invalid capability report.', 'PROTOCOL_ERROR', result.durationMs, { stdout: result.stdout, stderr: result.stderr, workerExitCode: result.workerExitCode });
    }
  }

  stop(projectId: string): void {
    this.controllers.get(projectId)?.abort();
    this.controllers.delete(projectId);
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
    } else problems.push(capabilityResult.error ?? 'The Python worker could not start.');

    const skipped = (message: string) => failure(message, 'UNAVAILABLE');
    const arithmeticResult = capabilityResult.ok
      ? await this.run({ projectId, name: 'run_python', purpose: 'Check bundled arithmetic', input: { code: 'result = 2 + 2' } })
      : skipped('Skipped because Python did not start.');
    const factorResult = capabilityResult.ok
      ? await this.run({ projectId, name: 'run_python', purpose: 'Check bundled SymPy', input: { code: "import sympy as sp\nx = sp.Symbol('x')\nresult = sp.factor(x**2 - 1)" } })
      : skipped('Skipped because Python did not start.');
    if (!arithmeticResult.ok || arithmeticResult.output.trim() !== '4') problems.push(arithmeticResult.error ?? 'Bundled arithmetic check returned an unexpected result.');
    if (!factorResult.ok || factorResult.output.replace(/\s/g, '') !== '(x-1)*(x+1)') problems.push(factorResult.error ?? 'Bundled SymPy factorization returned an unexpected result.');

    let z3Sat: boolean | null = null;
    let z3Unsat: boolean | null = null;
    if (capabilities?.z3.available) {
      const sat = await this.run({ projectId, name: 'z3_check', purpose: 'Check bundled Z3 SAT', input: { smt2: '(declare-const x Int) (assert (> x 0)) (assert (< x 2))' } });
      const unsat = await this.run({ projectId, name: 'z3_check', purpose: 'Check bundled Z3 UNSAT', input: { smt2: '(declare-const x Int) (assert (> x 1)) (assert (< x 0))' } });
      z3Sat = sat.ok && sat.verificationStatus === 'SAT';
      z3Unsat = unsat.ok && unsat.verificationStatus === 'UNSAT';
      if (!z3Sat || !z3Unsat) problems.push(sat.error ?? unsat.error ?? 'Bundled Z3 diagnostics failed.');
    }

    let leanKernelTest: boolean | null = null;
    let sorryRejected: boolean | null = null;
    if (capabilities?.lean.available) {
      const valid = await this.run({ projectId, name: 'lean_check', purpose: 'Check Lean kernel', input: { code: 'example (n : Nat) : n = n := by\n  rfl' } });
      const unsound = await this.run({ projectId, name: 'lean_check', purpose: 'Check Lean sorry rejection', input: { code: 'example : True := by\n  sorry' } });
      leanKernelTest = valid.ok && valid.verificationStatus === 'FORMALLY_VERIFIED';
      sorryRejected = !unsound.ok && unsound.errorType === 'UNSOUND_PROOF';
      if (!leanKernelTest || !sorryRejected) problems.push(valid.error ?? unsound.error ?? 'Lean diagnostics failed.');
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
      z3: { ...(capabilities?.z3 ?? blank), satTest: z3Sat, unsatTest: z3Unsat },
      lean: { ...(capabilities?.lean ?? blank), kernelTest: leanKernelTest, sorryRejected },
      sage: capabilities?.sage ?? blank,
      arithmetic: { passed: arithmeticResult.ok && arithmeticResult.output.trim() === '4', output: arithmeticResult.output },
      factorization: { passed: factorResult.ok && factorResult.output.replace(/\s/g, '') === '(x-1)*(x+1)', output: factorResult.output },
      error: problems.join(' '),
    };
  }
}

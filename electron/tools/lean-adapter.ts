import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, extname, join } from 'node:path';
import type { ToolResult } from '../../src/shared/types';
import { runBoundedProcess } from './process-runner';

export interface LeanRuntime {
  available: boolean;
  lakeExecutable: string;
  leanExecutable: string;
  displayPath: string;
}

function findOnPath(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const suffixes = process.platform === 'win32' ? ['', '.exe', '.cmd'] : [''];
  for (const directory of (env.PATH ?? '').split(delimiter).filter(Boolean)) {
    for (const suffix of suffixes) {
      const candidate = join(directory, `${name}${suffix}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return '';
}

export function resolveLeanRuntime(configuredPath: string, env: NodeJS.ProcessEnv = process.env): LeanRuntime {
  const configured = configuredPath.trim();
  const candidates: string[] = [];
  if (configured) candidates.push(configured);
  if (env.USERPROFILE) candidates.push(join(env.USERPROFILE, '.elan', 'bin', process.platform === 'win32' ? 'lake.exe' : 'lake'));
  const pathLake = findOnPath('lake', env);
  if (pathLake) candidates.push(pathLake);

  for (const candidate of candidates) {
    let lake = candidate;
    let lean = '';
    if (existsSync(candidate) && statSync(candidate).isDirectory()) {
      lake = join(candidate, process.platform === 'win32' ? 'lake.exe' : 'lake');
      lean = join(candidate, process.platform === 'win32' ? 'lean.exe' : 'lean');
    } else if (/lean(?:\.exe)?$/i.test(candidate)) {
      lean = candidate;
      lake = join(dirname(candidate), process.platform === 'win32' ? 'lake.exe' : 'lake');
    } else {
      lean = join(dirname(candidate), process.platform === 'win32' ? 'lean.exe' : 'lean');
    }
    if (existsSync(lake)) return { available: true, lakeExecutable: lake, leanExecutable: existsSync(lean) ? lean : '', displayPath: lake };
  }
  const lean = findOnPath('lean', env);
  return { available: Boolean(lean), lakeExecutable: '', leanExecutable: lean, displayPath: lean || configured || 'Lean/Lake not found' };
}

export async function probeLeanVersion(runtime: LeanRuntime): Promise<string> {
  if (!runtime.available) return '';
  const executable = runtime.lakeExecutable || runtime.leanExecutable;
  const execution = await runBoundedProcess({ executable, args: ['--version'], cwd: dirname(executable), env: process.env, timeoutMs: 10_000, maxOutputBytes: 128 * 1024 });
  return execution.exitCode === 0 ? `${execution.stdout}\n${execution.stderr}`.trim().split(/\r?\n/)[0] ?? '' : '';
}

export function unsoundLeanConstructs(code: string): string[] {
  const withoutComments = code.replace(/\/-[\s\S]*?-\//g, ' ').replace(/--.*$/gm, ' ');
  const checks: Array<[RegExp, string]> = [
    [/\bsorry\b/i, 'sorry'],
    [/\badmit\b/i, 'admit'],
    [/^\s*(?:axiom|constant)\b/im, 'axiom/constant'],
    [/\bnative_decide\b/i, 'native_decide'],
    [/^\s*(?:unsafe|partial)\b/im, 'unsafe/partial'],
    [/#(?:eval|run|guard_msgs)\b/i, 'command execution'],
    [/\b(?:run_tac|elab|macro|syntax|include_str|foreign|extern)\b/i, 'metaprogramming/foreign execution'],
    [/\bIO\s*(?:\.|\[)/i, 'IO execution'],
  ];
  return checks.filter(([pattern]) => pattern.test(withoutComments)).map(([, label]) => label);
}

function result(input: Partial<ToolResult> & Pick<ToolResult, 'ok' | 'output' | 'stdout' | 'stderr' | 'errorType' | 'exitCode' | 'durationMs' | 'timeout'>): ToolResult {
  return {
    success: input.ok,
    verificationStatus: input.ok ? 'FORMALLY_VERIFIED' : input.errorType === 'UNSOUND_PROOF' ? 'REJECTED_UNSOUND' : input.errorType === 'TOOL_ERROR' || input.errorType === 'UNAVAILABLE' ? 'TOOL_FAILURE' : 'PROGRAM_FAILURE',
    verificationLevel: input.ok ? 'FORMALLY_VERIFIED' : 'REQUIRES_FORMALIZATION',
    ...input,
  };
}

export async function runLeanVerification(input: {
  code: string;
  artifactFile: string;
  userDataPath: string;
  configuredPath: string;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<ToolResult> {
  const started = performance.now();
  const code = input.code;
  if (!code.trim() || code.length > 100_000) {
    return result({ ok: false, output: '', stdout: '', stderr: '', error: 'Lean source must contain 1 to 100,000 characters.', errorType: 'VALIDATION_ERROR', exitCode: 1, durationMs: Math.round(performance.now() - started), timeout: false });
  }
  if (!/\b(?:theorem|lemma|example)\b/.test(code)) {
    return result({ ok: false, output: '', stdout: '', stderr: '', error: 'Lean verification requires at least one theorem, lemma, or example declaration.', errorType: 'VALIDATION_ERROR', exitCode: 1, durationMs: Math.round(performance.now() - started), timeout: false });
  }
  const unsound = unsoundLeanConstructs(code);
  if (unsound.length > 0) {
    return result({ ok: false, output: '', stdout: '', stderr: '', error: `Rejected unsound Lean construct(s): ${unsound.join(', ')}.`, errorType: 'UNSOUND_PROOF', exitCode: 1, durationMs: Math.round(performance.now() - started), timeout: false });
  }

  const runtime = resolveLeanRuntime(input.configuredPath);
  if (!runtime.available) {
    return result({ ok: false, output: '', stdout: '', stderr: '', error: 'LEAN_UNAVAILABLE: Install Lean 4 with Elan or configure the Lake/Lean executable.', errorType: 'UNAVAILABLE', exitCode: null, durationMs: Math.round(performance.now() - started), timeout: false, environment: runtime.displayPath });
  }

  const project = join(input.userDataPath, 'formal-verification', 'lean4-project');
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, 'lean-toolchain'), 'leanprover/lean4:v4.32.0\n', 'utf8');
  writeFileSync(join(project, 'lakefile.toml'), 'name = "MRAFormal"\nversion = "0.1.0"\n\n[[lean_lib]]\nname = "MRAFormal"\n', 'utf8');
  if (extname(input.artifactFile).toLowerCase() !== '.lean') throw new Error('Lean artifact path must use the .lean extension.');
  writeFileSync(input.artifactFile, code, 'utf8');

  const executable = runtime.lakeExecutable || runtime.leanExecutable;
  const args = runtime.lakeExecutable ? ['env', 'lean', input.artifactFile] : [input.artifactFile];
  const execution = await runBoundedProcess({
    executable,
    args,
    cwd: project,
    env: { ...process.env, NO_COLOR: '1' },
    timeoutMs: input.timeoutMs,
    maxOutputBytes: 4 * 1024 * 1024,
    signal: input.signal,
  });
  const durationMs = Math.round(performance.now() - started);
  if (execution.timedOut) return result({ ok: false, output: '', stdout: execution.stdout, stderr: execution.stderr, error: 'Lean verification timed out.', errorType: 'TIMEOUT', exitCode: execution.exitCode, workerExitCode: execution.exitCode, durationMs, timeout: true, environment: runtime.displayPath });
  if (execution.outputLimitExceeded) return result({ ok: false, output: '', stdout: execution.stdout, stderr: execution.stderr, error: 'Lean output exceeded the 4 MB limit.', errorType: 'OUTPUT_LIMIT', exitCode: execution.exitCode, workerExitCode: execution.exitCode, durationMs, timeout: false, environment: runtime.displayPath });
  if (execution.spawnError) return result({ ok: false, output: '', stdout: execution.stdout, stderr: execution.stderr, error: `Lean could not start: ${execution.spawnError}`, errorType: 'TOOL_ERROR', exitCode: null, workerExitCode: null, durationMs, timeout: false, environment: runtime.displayPath });
  const combined = `${execution.stdout}\n${execution.stderr}`.trim();
  if (/declaration uses ['"]sorry['"]|unsolved goals/i.test(combined)) {
    return result({ ok: false, output: combined, stdout: execution.stdout, stderr: execution.stderr, error: 'Lean reported an incomplete proof.', errorType: 'UNSOUND_PROOF', exitCode: execution.exitCode, workerExitCode: execution.exitCode, durationMs, timeout: false, environment: runtime.displayPath });
  }
  if (execution.exitCode !== 0) return result({ ok: false, output: combined, stdout: execution.stdout, stderr: execution.stderr, error: combined || `Lean exited with code ${execution.exitCode}.`, errorType: 'PROGRAM_ERROR', exitCode: execution.exitCode, workerExitCode: execution.exitCode, durationMs, timeout: false, environment: runtime.displayPath });
  return result({ ok: true, output: combined || 'Lean kernel accepted the proof.', stdout: execution.stdout, stderr: execution.stderr, errorType: 'NONE', exitCode: 0, workerExitCode: 0, durationMs, timeout: false, environment: runtime.displayPath });
}

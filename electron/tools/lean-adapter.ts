import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, extname, join, relative } from 'node:path';
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

const LEAN_TOOLCHAIN = 'leanprover/lean4:v4.32.0';
const MATHLIB_REVISION = 'v4.32.0';

function formalWorkspace(userDataPath: string): string {
  // Mathlib's source and cache are several GB. Keep them off C: on the
  // configured Windows machine, while preserving a safe local fallback.
  if (process.platform === 'win32' && existsSync('D:\\')) return 'D:\\Math Research Agent\\formal-workspace';
  return join(userDataPath, 'formal-verification');
}

function gitBinDirectory(env: NodeJS.ProcessEnv = process.env): string {
  const pathGit = findOnPath('git', env);
  const candidates = [
    pathGit,
    env.ProgramFiles ? join(env.ProgramFiles, 'Git', 'cmd', 'git.exe') : '',
    env['ProgramFiles(x86)'] ? join(env['ProgramFiles(x86)'], 'Git', 'cmd', 'git.exe') : '',
    env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'Programs', 'Git', 'cmd', 'git.exe') : '',
  ].filter(Boolean);
  const git = candidates.find((candidate) => existsSync(candidate)) ?? '';
  return git ? dirname(git) : '';
}

function formalEnvironment(project: string): NodeJS.ProcessEnv {
  const cacheRoot = join(dirname(project), 'cache');
  mkdirSync(cacheRoot, { recursive: true });
  const gitDirectory = gitBinDirectory();
  return {
    ...process.env,
    PATH: [gitDirectory, process.env.PATH].filter(Boolean).join(delimiter),
    NO_COLOR: '1',
    XDG_CACHE_HOME: cacheRoot,
  };
}

function writeFileIfChanged(path: string, content: string): void {
  if (existsSync(path) && readFileSync(path, 'utf8') === content) return;
  writeFileSync(path, content, 'utf8');
}

/**
 * Create a project-owned, pinned Mathlib environment.  This is deliberately
 * not derived from submitted Lean source: `lake update` is only ever allowed
 * to read this fixed Lake configuration.
 */
async function prepareMathlibProject(project: string, executable: string, timeoutMs: number, signal?: AbortSignal): Promise<string | null> {
  mkdirSync(project, { recursive: true });
  writeFileIfChanged(join(project, 'lean-toolchain'), `${LEAN_TOOLCHAIN}\n`);
  writeFileIfChanged(join(project, 'lakefile.toml'), [
    'name = "MRAFormal"',
    'version = "0.1.0"',
    '',
    '[[require]]',
    'name = "mathlib"',
    'git = "https://github.com/leanprover-community/mathlib4.git"',
    `rev = "${MATHLIB_REVISION}"`,
    '',
    '[[lean_lib]]',
    'name = "MRAFormal"',
    '',
  ].join('\n'));

  const mathlibPackage = join(project, '.lake', 'packages', 'mathlib');
  const mathlib = join(mathlibPackage, 'Mathlib');
  const mathlibOlean = join(mathlibPackage, '.lake', 'build', 'lib', 'lean', 'Mathlib.olean');
  if (existsSync(mathlibOlean)) return null;
  const setupTimeout = Math.max(timeoutMs, 600_000);
  const environment = formalEnvironment(project);
  if (!existsSync(mathlib)) {
    const update = await runBoundedProcess({ executable, args: ['update'], cwd: project, env: environment, timeoutMs: setupTimeout, maxOutputBytes: 4 * 1024 * 1024, signal });
    if (update.timedOut) return 'Mathlib setup timed out while resolving the pinned dependency.';
    if (update.spawnError || update.exitCode !== 0) return `Mathlib dependency setup failed: ${[update.spawnError, update.stderr, update.stdout].filter(Boolean).join('\n').slice(0, 4_000)}`;
  }
  const cache = await runBoundedProcess({ executable, args: ['exe', 'cache', 'get'], cwd: project, env: environment, timeoutMs: setupTimeout, maxOutputBytes: 4 * 1024 * 1024, signal });
  if (cache.timedOut) return 'Mathlib cache setup timed out.';
  if (cache.spawnError || cache.exitCode !== 0) return `Mathlib cache setup failed: ${[cache.spawnError, cache.stderr, cache.stdout].filter(Boolean).join('\n').slice(0, 4_000)}`;
  return existsSync(mathlibOlean) ? null : 'Mathlib setup completed without usable compiled Mathlib artifacts.';
}

/** Local-only declaration/source discovery. It never sends theorem text away. */
export async function searchMathlib(input: {
  query: string;
  userDataPath: string;
  configuredPath: string;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<ToolResult> {
  const started = performance.now();
  const query = input.query.trim();
  if (query.length < 2 || query.length > 120) return {
    ok: false, success: false, output: '', stdout: '', stderr: '', error: 'Mathlib search requires 2 to 120 characters.', errorType: 'VALIDATION_ERROR', exitCode: 1, durationMs: Math.round(performance.now() - started), timeout: false, verificationStatus: 'PROGRAM_FAILURE',
  };
  const runtime = resolveLeanRuntime(input.configuredPath);
  if (!runtime.available || !runtime.lakeExecutable) return {
    ok: false, success: false, output: '', stdout: '', stderr: '', error: 'MATHLIB_REQUIRES_LAKE: Configure Lake before searching Mathlib.', errorType: 'UNAVAILABLE', exitCode: null, durationMs: Math.round(performance.now() - started), timeout: false, environment: runtime.displayPath, verificationStatus: 'TOOL_FAILURE',
  };
  const project = join(formalWorkspace(input.userDataPath), 'lean4-project');
  const setupError = await prepareMathlibProject(project, runtime.lakeExecutable, input.timeoutMs, input.signal);
  if (setupError) return {
    ok: false, success: false, output: '', stdout: '', stderr: '', error: setupError, errorType: 'TOOL_ERROR', exitCode: null, durationMs: Math.round(performance.now() - started), timeout: false, environment: runtime.displayPath, verificationStatus: 'TOOL_FAILURE',
  };
  const root = join(project, '.lake', 'packages', 'mathlib', 'Mathlib');
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches: string[] = [];
  const pending = [root];
  let inspected = 0;
  try {
    while (pending.length > 0 && matches.length < 40 && inspected < 12_000) {
      if (input.signal?.aborted) return { ok: false, success: false, output: '', stdout: '', stderr: '', error: 'Mathlib search was stopped.', errorType: 'TOOL_ERROR', exitCode: null, durationMs: Math.round(performance.now() - started), timeout: false, verificationStatus: 'TOOL_FAILURE' };
      const directory = pending.pop()!;
      for (const item of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, item.name);
        if (item.isDirectory()) pending.push(path);
        else if (item.isFile() && item.name.endsWith('.lean')) {
          inspected += 1;
          const lines = readFileSync(path, 'utf8').split(/\r?\n/);
          for (let index = 0; index < lines.length && matches.length < 40; index += 1) {
            const line = lines[index];
            if (tokens.every((token) => line.toLowerCase().includes(token))) matches.push(`${relative(root, path)}:${index + 1}: ${line.trim().slice(0, 300)}`);
          }
        }
      }
    }
  } catch (error) {
    return { ok: false, success: false, output: '', stdout: '', stderr: '', error: error instanceof Error ? error.message : String(error), errorType: 'TOOL_ERROR', exitCode: null, durationMs: Math.round(performance.now() - started), timeout: false, verificationStatus: 'TOOL_FAILURE' };
  }
  const output = JSON.stringify({ query, matches, searchedFiles: inspected, capped: matches.length === 40 || inspected >= 12_000 }, null, 2);
  return { ok: true, success: true, output, stdout: `${matches.length} local Mathlib source matches.`, stderr: '', errorType: 'NONE', exitCode: 0, workerExitCode: 0, durationMs: Math.round(performance.now() - started), timeout: false, environment: root, verificationStatus: 'SUCCESS' };
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

  const project = join(formalWorkspace(input.userDataPath), 'lean4-project');
  if (extname(input.artifactFile).toLowerCase() !== '.lean') throw new Error('Lean artifact path must use the .lean extension.');
  writeFileSync(input.artifactFile, code, 'utf8');

  const executable = runtime.lakeExecutable || runtime.leanExecutable;
  // Mathlib is required for useful formal mathematics beyond Lean's core.
  // A direct `lean` executable cannot resolve a Lake dependency graph.
  if (!runtime.lakeExecutable) return result({ ok: false, output: '', stdout: '', stderr: '', error: 'MATHLIB_REQUIRES_LAKE: Configure Lake (normally ~/.elan/bin/lake) to use Mathlib.', errorType: 'UNAVAILABLE', exitCode: null, durationMs: Math.round(performance.now() - started), timeout: false, environment: runtime.displayPath });
  const mathlibError = await prepareMathlibProject(project, executable, input.timeoutMs, input.signal);
  if (mathlibError) return result({ ok: false, output: '', stdout: '', stderr: '', error: mathlibError, errorType: 'TOOL_ERROR', exitCode: null, durationMs: Math.round(performance.now() - started), timeout: false, environment: runtime.displayPath });
  const args = runtime.lakeExecutable ? ['env', 'lean', input.artifactFile] : [input.artifactFile];
  const execution = await runBoundedProcess({
    executable,
    args,
    cwd: project,
    env: formalEnvironment(project),
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

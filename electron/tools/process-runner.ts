import { spawn } from 'node:child_process';

export interface ProcessExecution {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  outputLimitExceeded: boolean;
  aborted: boolean;
  spawnError: string;
}

export interface ProcessExecutionOptions {
  executable: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdin?: string;
  timeoutMs: number;
  maxOutputBytes?: number;
  signal?: AbortSignal;
}

const DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

export async function runBoundedProcess(options: ProcessExecutionOptions): Promise<ProcessExecution> {
  const started = performance.now();
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  return await new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let outputBytes = 0;
    let timedOut = false;
    let outputLimitExceeded = false;
    let aborted = false;
    let spawnError = '';
    let settled = false;
    const child = spawn(options.executable, options.args, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const finish = (exitCode: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        exitCode,
        signal,
        stdout,
        stderr,
        durationMs: Math.round(performance.now() - started),
        timedOut,
        outputLimitExceeded,
        aborted,
        spawnError,
      });
    };

    const append = (channel: 'stdout' | 'stderr', chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > maxOutputBytes) {
        outputLimitExceeded = true;
        child.kill();
        return;
      }
      if (channel === 'stdout') stdout += chunk.toString('utf8');
      else stderr += chunk.toString('utf8');
    };

    child.stdout.on('data', (chunk: Buffer) => append('stdout', chunk));
    child.stderr.on('data', (chunk: Buffer) => append('stderr', chunk));
    child.on('error', (error) => {
      spawnError = error.message;
      finish(null, null);
    });
    child.on('close', finish);

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, Math.max(1, options.timeoutMs));

    const abort = () => {
      aborted = true;
      child.kill();
    };
    options.signal?.addEventListener('abort', abort, { once: true });
    child.once('close', () => options.signal?.removeEventListener('abort', abort));

    if (options.stdin !== undefined) child.stdin.end(options.stdin);
    else child.stdin.end();
  });
}

import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { ToolInvocation, ToolResult } from '../../src/shared/types';

const SECRET_PATTERN = /(?:sk-[a-z0-9_-]{12,}|bearer\s+[a-z0-9._-]{12,}|api[_-]?key\s*[:=]\s*[^\s"']+)/gi;

function redact(value: string): string {
  return value.replace(SECRET_PATTERN, '[REDACTED]');
}

function safeJson(value: unknown, pretty = false): string {
  return redact(JSON.stringify(value, null, pretty ? 2 : 0));
}

export class VerificationAuditLog {
  constructor(private readonly userDataPath: string) {}

  createArtifact(invocation: ToolInvocation, extension: string, input: string): { directory: string; inputPath: string } {
    const directory = join(this.userDataPath, 'verification-artifacts', invocation.projectId, invocation.name, `${Date.now()}-${randomUUID()}`);
    mkdirSync(directory, { recursive: true });
    const inputPath = join(directory, `input.${extension}`);
    writeFileSync(inputPath, redact(input), 'utf8');
    return { directory, inputPath };
  }

  complete(invocation: ToolInvocation, result: ToolResult, artifactDirectory: string): ToolResult {
    mkdirSync(artifactDirectory, { recursive: true });
    writeFileSync(join(artifactDirectory, 'stdout.txt'), redact(result.stdout), 'utf8');
    writeFileSync(join(artifactDirectory, 'stderr.txt'), redact(result.stderr), 'utf8');
    writeFileSync(join(artifactDirectory, 'result.json'), safeJson({ ...result, artifactLocation: basename(artifactDirectory) }, true), 'utf8');
    const logDirectory = join(this.userDataPath, 'logs');
    mkdirSync(logDirectory, { recursive: true });
    const auditLogPath = join(logDirectory, 'verification-audit.jsonl');
    appendFileSync(auditLogPath, `${safeJson({
      timestamp: new Date().toISOString(),
      tool: invocation.name,
      projectId: invocation.projectId,
      purpose: invocation.purpose,
      inputArtifact: join(artifactDirectory, 'input.' + inputExtension(invocation.name)),
      output: result.output,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      workerExitCode: result.workerExitCode,
      durationMs: result.durationMs,
      timeout: result.timeout,
      errorType: result.errorType,
      verificationStatus: result.verificationStatus,
      verificationLevel: result.verificationLevel,
    })}\n`, 'utf8');
    return { ...result, artifactLocation: artifactDirectory, auditLogPath };
  }
}

export function inputExtension(name: ToolInvocation['name']): string {
  if (name === 'run_python') return 'py';
  if (name === 'z3_check') return 'smt2';
  if (name === 'lean_check') return 'lean';
  return 'json';
}

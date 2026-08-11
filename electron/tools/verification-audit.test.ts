import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ToolInvocation, ToolResult } from '../../src/shared/types';
import { VerificationAuditLog } from './verification-audit';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

describe('verification audit artifacts', () => {
  it('stores exact inputs and machine outputs while redacting credential patterns', () => {
    const root = mkdtempSync(join(tmpdir(), 'mra-audit-'));
    directories.push(root);
    const invocation: ToolInvocation = {
      projectId: '00000000-0000-4000-8000-000000000012',
      name: 'run_python',
      purpose: 'Audit test',
      input: { code: 'result = 4' },
    };
    const audit = new VerificationAuditLog(root);
    const artifact = audit.createArtifact(invocation, 'py', 'result = 4');
    const result: ToolResult = {
      ok: true,
      success: true,
      output: '4',
      stdout: 'Bearer abcdefghijklmnopqrstuvwxyz',
      stderr: '',
      errorType: 'NONE',
      exitCode: 0,
      workerExitCode: 0,
      durationMs: 5,
      timeout: false,
      verificationStatus: 'SUCCESS',
      verificationLevel: 'BOUNDED_CHECK',
    };
    const saved = audit.complete(invocation, result, artifact.directory);
    expect(readFileSync(artifact.inputPath, 'utf8')).toBe('result = 4');
    expect(readFileSync(join(artifact.directory, 'stdout.txt'), 'utf8')).toBe('[REDACTED]');
    const lines = readFileSync(saved.auditLogPath!, 'utf8').trim().split(/\r?\n/);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({ tool: 'run_python', exitCode: 0, verificationLevel: 'BOUNDED_CHECK' });
  });
});

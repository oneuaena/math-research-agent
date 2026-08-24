import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;

export function projectWorkspace(userDataPath: string, projectId: string): string {
  return resolve(userDataPath, 'tool-workspaces', projectId);
}

export function workspaceFile(workspace: string, requestedPath: string): string {
  if (!requestedPath || requestedPath.length > 240 || isAbsolute(requestedPath)) throw new Error('Workspace paths must be non-empty relative paths.');
  const root = resolve(workspace);
  const target = resolve(root, requestedPath);
  const pathFromRoot = relative(root, target);
  if (!pathFromRoot || pathFromRoot === '..' || pathFromRoot.startsWith('..\\') || isAbsolute(pathFromRoot)) {
    throw new Error('Workspace path escapes the project workspace.');
  }
  return target;
}

export function writeWorkspaceFile(workspace: string, requestedPath: string, content: string): { path: string; bytes: number; sha256: string } {
  const target = workspaceFile(workspace, requestedPath);
  const encoded = Buffer.from(content, 'utf8');
  if (encoded.byteLength > MAX_FILE_BYTES) throw new Error(`Workspace writes are limited to ${MAX_FILE_BYTES} bytes.`);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, encoded, { mode: 0o600 });
  return { path: requestedPath, bytes: encoded.byteLength, sha256: createHash('sha256').update(encoded).digest('hex') };
}

export function readWorkspaceFile(workspace: string, requestedPath: string): { path: string; content: string; bytes: number; sha256: string } {
  const target = workspaceFile(workspace, requestedPath);
  const size = statSync(target).size;
  if (size > MAX_FILE_BYTES) throw new Error(`Workspace reads are limited to ${MAX_FILE_BYTES} bytes.`);
  const content = readFileSync(target, 'utf8');
  return { path: requestedPath, content, bytes: size, sha256: createHash('sha256').update(content, 'utf8').digest('hex') };
}

export async function downloadWorkspaceFile(workspace: string, urlText: string, requestedPath: string, signal?: AbortSignal): Promise<{ path: string; bytes: number; sha256: string; finalUrl: string; contentType: string }> {
  const url = new URL(urlText);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP and HTTPS downloads are allowed.');
  const timeout = AbortSignal.timeout(60_000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetch(url, { redirect: 'follow', signal: combined, headers: { 'User-Agent': 'Math-Research-Agent/1.1' } });
  if (!response.ok) throw new Error(`Download failed with HTTP ${response.status}.`);
  const declaredSize = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredSize) && declaredSize > MAX_DOWNLOAD_BYTES) throw new Error(`Download exceeds the ${MAX_DOWNLOAD_BYTES} byte limit.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > MAX_DOWNLOAD_BYTES) throw new Error(`Download exceeds the ${MAX_DOWNLOAD_BYTES} byte limit.`);
  const target = workspaceFile(workspace, requestedPath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes, { mode: 0o600 });
  return {
    path: requestedPath,
    bytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    finalUrl: response.url,
    contentType: response.headers.get('content-type') ?? '',
  };
}

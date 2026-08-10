import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import { providerResponseSchema, type ProviderRequestControl } from '../src/shared/provider-protocol';

const MAX_LOG_BYTES = 5 * 1024 * 1024;
const MAX_ENTRY_BYTES = 1024 * 1024;
const SENSITIVE_KEYS = new Set(['authorization', 'api_key', 'apikey', 'api-key', 'access_token', 'credential', 'credentials', 'secret']);

function redactString(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[redacted]');
}

function sanitize(value: unknown, key = '', seen = new WeakSet<object>()): unknown {
  if (SENSITIVE_KEYS.has(key.toLowerCase())) return '[redacted]';
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => sanitize(item, '', seen));
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, child]) => [childKey, sanitize(child, childKey, seen)]));
}

export class ProviderDebugLog {
  constructor(private readonly path: string) {}

  write(entry: {
    endpoint: string;
    model: string;
    httpStatus: number;
    contentType: string;
    elapsedMs: number;
    control: ProviderRequestControl;
    responseBody: string;
    parsedResponse?: unknown;
  }): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      this.rotate();
      const schemaFields = providerResponseSchema(entry.parsedResponse ?? entry.responseBody);
      const base = {
        timestamp: new Date().toISOString(),
        endpoint: entry.endpoint,
        model: entry.model,
        httpStatus: entry.httpStatus,
        contentType: entry.contentType,
        elapsedMs: entry.elapsedMs,
        control: entry.control,
        schemaFields,
        responseBody: redactString(entry.responseBody),
        rawResponse: sanitize(entry.parsedResponse),
      };
      let line = JSON.stringify(base);
      if (Buffer.byteLength(line, 'utf8') > MAX_ENTRY_BYTES) {
        line = JSON.stringify({
          ...base,
          responseBody: '[truncated: response exceeded the 1 MiB debug entry limit]',
          rawResponse: { truncated: true, reason: 'response exceeded the 1 MiB debug entry limit' },
        });
      }
      appendFileSync(this.path, `${line}\n`, { encoding: 'utf8', mode: 0o600 });
    } catch {
      // Provider logging must never break a research request.
    }
  }

  private rotate(): void {
    if (!existsSync(this.path) || statSync(this.path).size < MAX_LOG_BYTES) return;
    const previous = `${this.path}.1`;
    if (existsSync(previous)) unlinkSync(previous);
    renameSync(this.path, previous);
  }
}

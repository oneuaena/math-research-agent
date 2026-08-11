import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ResearchStateLogEntry } from './research-orchestrator';

const MAX_LOG_BYTES = 5 * 1024 * 1024;

export class ResearchStateLog {
  constructor(private readonly path: string) {}

  write(entry: ResearchStateLogEntry): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      this.rotate();
      appendFileSync(this.path, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600 });
    } catch {
      // State diagnostics must never interrupt autonomous research.
    }
  }

  private rotate(): void {
    if (!existsSync(this.path) || statSync(this.path).size < MAX_LOG_BYTES) return;
    const previous = `${this.path}.1`;
    if (existsSync(previous)) unlinkSync(previous);
    renameSync(this.path, previous);
  }
}

import { createHash, randomUUID } from 'node:crypto';
import type { KnowledgeRecord, VerificationStatus } from '../src/shared/types';
import type { ResearchDatabase } from './database';

export class ResearchKnowledgeBase {
  constructor(private readonly db: ResearchDatabase) {}

  index(projectId: string, input: { kind: KnowledgeRecord['kind']; title: string; content: string; relatedIds: string[]; verificationStatus: VerificationStatus }): KnowledgeRecord {
    const now = new Date().toISOString(); const content = input.content.slice(0, 50_000); const hash = sha(content);
    const existing = this.db.listRecords<KnowledgeRecord>(projectId, 'knowledgeRecords').find((record) => record.hashes.content === hash);
    if (existing) return existing;
    const record: KnowledgeRecord = { id: randomUUID(), projectId, ...input, content, hashes: { content: hash }, createdAt: now, updatedAt: now };
    this.db.saveRecord('knowledgeRecords', record); return record;
  }

  /** Cross-project retrieval returns only persisted, attributed records; it never promotes their verification status. */
  retrieve(query: string, limit = 12): KnowledgeRecord[] {
    const terms = query.toLowerCase().split(/[^\p{L}\p{N}_]+/u).filter((term) => term.length > 2).slice(0, 24);
    return this.db.listProjects().flatMap((project) => this.db.listRecords<KnowledgeRecord>(project.id, 'knowledgeRecords'))
      .map((record) => ({ record, score: terms.reduce((score, term) => score + Number(`${record.title}\n${record.content}`.toLowerCase().includes(term)), 0) }))
      .filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.record.updatedAt.localeCompare(b.record.updatedAt)).slice(0, Math.max(1, Math.min(50, limit))).map((item) => item.record);
  }
}
function sha(value: string): string { return createHash('sha256').update(value).digest('hex'); }

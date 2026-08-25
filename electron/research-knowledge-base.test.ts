import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ResearchDatabase } from './database';
import { ResearchKnowledgeBase } from './research-knowledge-base';

describe('ResearchKnowledgeBase', () => {
  it('persists typed relations and propagates invalidation through them', () => {
    const directory = mkdtempSync(join(tmpdir(), 'mra-knowledge-')); const db = new ResearchDatabase(join(directory, 'research.sqlite3'));
    try {
      const project = db.createProject({ name: 'knowledge', question: 'q', goal: '', background: '', knownResults: '', constraints: '', mode: 'autonomous' }).project.id;
      const kb = new ResearchKnowledgeBase(db);
      const evidence = kb.index(project, { kind: 'CERTIFICATE', title: 'bounded evidence', content: 'certificate', relatedIds: [], verificationStatus: 'computationally-verified' });
      const lemma = kb.index(project, { kind: 'LEMMA', title: 'dependent lemma', content: 'uses certificate', relatedIds: [evidence.id], verificationStatus: 'formally-verified', relationships: [{ type: 'SUPPORTED_BY', targetId: evidence.id, createdAt: new Date().toISOString() }] });
      const theorem = kb.index(project, { kind: 'THEOREM', title: 'dependent theorem', content: 'uses lemma', relatedIds: [lemma.id], verificationStatus: 'unverified', relationships: [{ type: 'DERIVED_FROM', targetId: lemma.id, createdAt: new Date().toISOString() }] });
      expect(kb.invalidateByDependency(project, evidence.id)).toEqual(expect.arrayContaining([lemma.id, theorem.id]));
      const records = db.getProject(project, false).knowledgeRecords;
      expect(records.find((record) => record.id === lemma.id)).toMatchObject({ lifecycle: 'NEEDS_REVALIDATION', verificationStatus: 'unverified' });
      expect(records.find((record) => record.id === theorem.id)).toMatchObject({ lifecycle: 'INVALIDATED', verificationStatus: 'unverified' });
    } finally { db.close(); rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); }
  });
});

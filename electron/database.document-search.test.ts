import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { embedText } from '../src/shared/retrieval';
import type { DocumentChunk, Source } from '../src/shared/types';
import { ResearchDatabase } from './database';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('document index migration and retrieval', () => {
  it('retrieves a requested page from a document longer than 100 pages', () => {
    const directory = mkdtempSync(join(tmpdir(), 'mra-document-db-'));
    temporaryDirectories.push(directory);
    const database = new ResearchDatabase(join(directory, 'research.sqlite3'));
    try {
      const snapshot = database.createProject({
        name: 'Long document', question: 'Locate the invariant.', goal: '', background: '', knownResults: '', constraints: '', mode: 'explore',
      });
      const projectId = snapshot.project.id;
      const source: Source = {
        id: 'source-long', projectId, type: 'user-document', title: 'long-paper.pdf', authors: '', abstract: '', path: 'synthetic.pdf',
        tags: [], notes: '', excerpt: '', documentType: 'pdf', pageCount: 120, chunkCount: 120, indexStatus: 'indexed', extractionStatus: 'complete', createdAt: new Date().toISOString(),
      };
      database.saveRecord('sources', source);
      const chunks: DocumentChunk[] = Array.from({ length: 120 }, (_, index) => {
        const page = index + 1;
        const text = page === 117
          ? 'The unique page-one-seventeen witness is the copper invariant lambda equals 73.'
          : `Routine discussion on synthetic page ${page}.`;
        return {
          id: `chunk-${page}`, projectId, sourceId: source.id, filename: source.title, documentType: 'pdf', page,
          section: `Page ${page}`, kind: 'page', chunkIndex: index, characterStart: index * 100, characterEnd: index * 100 + text.length,
          text, embedding: embedText(text), createdAt: new Date().toISOString(),
        };
      });
      database.replaceDocumentChunks(projectId, source.id, chunks);

      const results = database.searchDocumentChunks(projectId, 'What does page 117 say about the copper invariant?', 4);

      expect(results).toHaveLength(1);
      expect(results[0].page).toBe(117);
      expect(results[0].text).toContain('lambda equals 73');
      expect(database.getDocumentChunks(projectId, source.id)).toHaveLength(120);
    } finally {
      database.close();
    }
  });

  it('keeps FTS triggers valid when a source is reindexed', () => {
    const directory = mkdtempSync(join(tmpdir(), 'mra-document-db-'));
    temporaryDirectories.push(directory);
    const database = new ResearchDatabase(join(directory, 'research.sqlite3'));
    try {
      const projectId = database.createProject({
        name: 'Reindex', question: 'Find terminology.', goal: '', background: '', knownResults: '', constraints: '', mode: 'explore',
      }).project.id;
      const makeChunk = (id: string, text: string): DocumentChunk => ({
        id, projectId, sourceId: 'source', filename: 'notes.txt', documentType: 'txt', page: null, section: '', kind: 'paragraph',
        chunkIndex: 0, characterStart: 0, characterEnd: text.length, text, embedding: embedText(text), createdAt: new Date().toISOString(),
      });
      database.replaceDocumentChunks(projectId, 'source', [makeChunk('old', 'old terminology')]);
      database.replaceDocumentChunks(projectId, 'source', [makeChunk('new', 'new invariant terminology')]);

      expect(database.searchDocumentChunks(projectId, 'new invariant', 2)[0]?.id).toBe('new');
      expect(database.getDocumentChunks(projectId, 'source').map((chunk) => chunk.id)).toEqual(['new']);
    } finally {
      database.close();
    }
  });
});

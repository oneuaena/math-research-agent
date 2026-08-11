import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentCoordinator } from './agent-coordinator';
import { ChatService } from './chat-service';
import type { CredentialStore } from './credentials';
import { ResearchDatabase } from './database';
import type { LiteratureSearchService } from './literature-search';
import type { ModelProvider } from './provider';
import { embedText } from '../src/shared/retrieval';
import type { DocumentChunk, Source } from '../src/shared/types';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'mra-chat-'));
  directories.push(directory);
  const database = new ResearchDatabase(join(directory, 'research.sqlite3'));
  const projectId = database.createProject({ name: 'Chat', question: 'Study an invariant.', goal: '', background: '', knownResults: '', constraints: '', mode: 'autonomous' }).project.id;
  return { database, projectId };
}

describe('persistent project chat', () => {
  it('includes prior turns in the next provider request', async () => {
    const { database, projectId } = fixture();
    const calls: Array<Array<{ role: string; content: string }>> = [];
    const provider = { respondChat: async (messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>) => { calls.push(messages); return calls.length === 1 ? 'I will remember alpha equals 17.' : 'Alpha equals 17.'; } } as unknown as ModelProvider;
    const service = new ChatService(database, {} as CredentialStore, fakeAgent(), fakeLiterature(), () => undefined, () => provider);
    try {
      const first = await service.send({ projectId, content: 'Remember that alpha equals 17.' });
      await service.send({ projectId, conversationId: first.conversationId, content: 'What is alpha?' });
      expect(calls).toHaveLength(2);
      expect(calls[1].some((message) => message.role === 'user' && message.content.includes('alpha equals 17'))).toBe(true);
      expect(calls[1].some((message) => message.role === 'assistant' && message.content.includes('remember alpha'))).toBe(true);
      expect(database.getProject(projectId, false).messages).toHaveLength(4);
    } finally {
      database.close();
    }
  });

  it('retrieves an indexed page and only records a citation when the model uses its marker', async () => {
    const { database, projectId } = fixture();
    const source: Source = { id: 'pdf', projectId, type: 'user-document', title: 'paper.pdf', authors: '', abstract: '', path: 'paper.pdf', tags: [], notes: '', excerpt: '', documentType: 'pdf', pageCount: 3, chunkCount: 1, extractionStatus: 'complete', indexStatus: 'indexed', createdAt: new Date().toISOString() };
    database.saveRecord('sources', source);
    const text = 'Page three states that the violet invariant equals 41.';
    const chunk: DocumentChunk = { id: 'chunk-page-3', projectId, sourceId: source.id, filename: source.title, documentType: 'pdf', page: 3, section: 'Page 3', kind: 'page', chunkIndex: 0, characterStart: 0, characterEnd: text.length, text, embedding: embedText(text), createdAt: new Date().toISOString() };
    database.replaceDocumentChunks(projectId, source.id, [chunk]);
    let suppliedSystem = '';
    const provider = { respondChat: async (messages: Array<{ role: string; content: string }>) => { suppliedSystem = messages[0].content; return 'The violet invariant equals 41 [S1].'; } } as unknown as ModelProvider;
    const service = new ChatService(database, {} as CredentialStore, fakeAgent(), fakeLiterature(), () => undefined, () => provider);
    try {
      const response = await service.send({ projectId, content: 'What does page 3 of the document state?', attachmentSourceIds: [source.id] });
      expect(suppliedSystem).toContain('violet invariant equals 41');
      expect(response.citations).toEqual([expect.objectContaining({ sourceId: source.id, chunkId: chunk.id, page: 3 })]);
    } finally {
      database.close();
    }
  });
});

function fakeAgent(): AgentCoordinator {
  return { isRunning: () => false, start: () => undefined, resume: () => undefined } as unknown as AgentCoordinator;
}

function fakeLiterature(): LiteratureSearchService {
  return { search: async () => ({ queries: [], records: [], providerErrors: [] }) } as unknown as LiteratureSearchService;
}

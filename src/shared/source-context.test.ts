import { describe, expect, it } from 'vitest';
import { buildProviderSourceContext, chunkDocument } from './source-context';
import type { Source } from './types';

const source = (content: string): Source => ({
  id: 'source-1', projectId: 'project-1', type: 'user-document', title: 'Research packet', authors: '', abstract: '',
  path: 'research.docx', tags: [], notes: '', excerpt: '', content, contentCharacters: content.length,
  extractionStatus: 'complete', extractionWarnings: [], indexedAt: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z',
});

describe('provider source context', () => {
  it('includes a 7,000-character imported document in full', () => {
    const content = `BEGIN_DOCUMENT\n\n${'mathematical source paragraph. '.repeat(250)}\n\nEND_DOCUMENT`;
    const context = buildProviderSourceContext([source(content)], 'mathematical source', 0);
    expect(context).toHaveLength(1);
    expect(context[0].completeDocumentIncluded).toBe(true);
    expect(context[0].chunks.map((chunk) => chunk.text).join('').replace(/\s/g, '')).toBe(content.replace(/\s/g, ''));
    expect(context[0].chunks.at(-1)?.text).toContain('END_DOCUMENT');
    expect(context[0].indexedCharacters).toBe(content.length);
  });

  it('bounds very long provider context while rotating through indexed chunks', () => {
    const content = Array.from({ length: 30 }, (_, index) => `Section ${index}${index === 29 ? ' unique-target-marker' : ''}\n${String(index).repeat(5_500)}`).join('\n\n');
    const chunks = chunkDocument(content);
    const first = buildProviderSourceContext([source(content)], 'unique-target-marker', 0)[0];
    const later = buildProviderSourceContext([source(content)], 'unrelated query', 17)[0];
    expect(chunks.length).toBeGreaterThan(10);
    expect(first.completeDocumentIncluded).toBe(false);
    expect(first.chunks.length).toBeLessThanOrEqual(10);
    expect(first.chunks.some((chunk) => chunk.text.includes('unique-target-marker'))).toBe(true);
    expect(later.selectedChunkIndexes).toContain(17 % chunks.length);
  });
});

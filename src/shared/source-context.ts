import type { Source } from './types';

const CHUNK_CHARACTERS = 6_000;
const MAX_CONTEXT_CHARACTERS = 60_000;

export interface ProviderSourceContext {
  sourceId: string;
  title: string;
  indexedCharacters: number;
  extractionStatus: Source['extractionStatus'];
  completeDocumentIncluded: boolean;
  selectedChunkIndexes: number[];
  totalChunks: number;
  chunks: Array<{ index: number; text: string }>;
}

export function buildProviderSourceContext(sources: Source[], query: string, cursor: number): ProviderSourceContext[] {
  const readable = sources.map((source) => ({ source, text: (source.content ?? source.excerpt ?? '').trim() })).filter((item) => item.text.length > 0);
  if (readable.length === 0) return [];
  const perSourceBudget = Math.max(CHUNK_CHARACTERS, Math.floor(MAX_CONTEXT_CHARACTERS / readable.length));
  return readable.map(({ source, text }) => {
    const chunks = chunkDocument(text);
    const maximumChunks = Math.max(1, Math.floor(perSourceBudget / CHUNK_CHARACTERS));
    const selectedIndexes = selectChunkIndexes(chunks, query, cursor, maximumChunks);
    return {
      sourceId: source.id,
      title: source.title,
      indexedCharacters: source.contentCharacters ?? text.length,
      extractionStatus: source.extractionStatus ?? 'complete',
      completeDocumentIncluded: selectedIndexes.length === chunks.length,
      selectedChunkIndexes: selectedIndexes,
      totalChunks: chunks.length,
      chunks: selectedIndexes.map((index) => ({ index, text: chunks[index] })),
    };
  });
}

export function chunkDocument(text: string, maximumCharacters = CHUNK_CHARACTERS): string[] {
  const normalized = text.replace(/\r\n?/g, '\n').trim();
  if (!normalized) return [];
  const chunks: string[] = [];
  let current = '';
  for (const paragraph of normalized.split(/\n{2,}/)) {
    for (const segment of splitLongParagraph(paragraph, maximumCharacters)) {
      const candidate = current ? `${current}\n\n${segment}` : segment;
      if (candidate.length <= maximumCharacters) current = candidate;
      else {
        if (current) chunks.push(current);
        current = segment;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function splitLongParagraph(paragraph: string, maximumCharacters: number): string[] {
  if (paragraph.length <= maximumCharacters) return [paragraph];
  const segments: string[] = [];
  for (let offset = 0; offset < paragraph.length; offset += maximumCharacters) segments.push(paragraph.slice(offset, offset + maximumCharacters));
  return segments;
}

function selectChunkIndexes(chunks: string[], query: string, cursor: number, maximumChunks: number): number[] {
  if (chunks.length <= maximumChunks) return chunks.map((_, index) => index);
  const terms = queryTerms(query);
  const ranked = chunks.map((chunk, index) => ({ index, score: terms.reduce((total, term) => total + countOccurrences(chunk.toLowerCase(), term), 0) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const selected = new Set<number>([0, cursor % chunks.length]);
  for (const item of ranked) {
    if (selected.size >= maximumChunks) break;
    selected.add(item.index);
  }
  for (let offset = 1; selected.size < maximumChunks; offset += 1) selected.add((cursor + offset) % chunks.length);
  return [...selected].sort((a, b) => a - b);
}

function queryTerms(query: string): string[] {
  const lower = query.toLowerCase();
  const words = lower.match(/[a-z0-9_]{3,}/g) ?? [];
  const cjk = [...lower].filter((character) => /[\u3400-\u9fff]/.test(character));
  const pairs = cjk.slice(0, -1).map((character, index) => `${character}${cjk[index + 1]}`);
  return [...new Set([...words, ...pairs])].slice(0, 100);
}

function countOccurrences(text: string, term: string): number {
  let count = 0;
  let offset = 0;
  while ((offset = text.indexOf(term, offset)) !== -1) { count += 1; offset += term.length; }
  return count;
}

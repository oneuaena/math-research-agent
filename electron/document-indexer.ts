import { randomUUID } from 'node:crypto';
import { embedText } from '../src/shared/retrieval';
import type { DocumentChunk, Source } from '../src/shared/types';
import type { DocumentExtraction, DocumentUnit } from './document-extractor';

const MAX_CHUNK_CHARACTERS = 3_500;

export function buildDocumentChunks(source: Pick<Source, 'id' | 'projectId' | 'title'>, extraction: DocumentExtraction): DocumentChunk[] {
  const pieces = extraction.units.flatMap((unit) => splitUnit(unit));
  const chunks: DocumentChunk[] = [];
  let pending: DocumentUnit | null = null;
  let characterCursor = 0;
  const flush = (): void => {
    if (!pending?.text.trim()) return;
    const text = pending.text.trim();
    const characterStart = characterCursor;
    const characterEnd = characterStart + text.length;
    chunks.push({
      id: randomUUID(), projectId: source.projectId, sourceId: source.id, filename: source.title,
      documentType: extraction.documentType, page: pending.page, section: pending.section, kind: pending.kind,
      chunkIndex: chunks.length, characterStart, characterEnd, text, embedding: embedText(text), createdAt: new Date().toISOString(),
    });
    characterCursor = characterEnd + 2;
    pending = null;
  };
  for (const piece of pieces) {
    const sameLocation = pending && pending.page === piece.page && pending.section === piece.section && pending.kind === piece.kind;
    if (pending && sameLocation && pending.text.length + piece.text.length + 2 <= MAX_CHUNK_CHARACTERS) pending.text += `\n\n${piece.text}`;
    else { flush(); pending = { ...piece }; }
  }
  flush();
  return chunks;
}

function splitUnit(unit: DocumentUnit): DocumentUnit[] {
  if (unit.text.length <= MAX_CHUNK_CHARACTERS) return [unit];
  const pieces: DocumentUnit[] = [];
  let remaining = unit.text;
  while (remaining.length > MAX_CHUNK_CHARACTERS) {
    const candidate = remaining.slice(0, MAX_CHUNK_CHARACTERS);
    const boundary = Math.max(candidate.lastIndexOf('\n'), candidate.lastIndexOf('. '), candidate.lastIndexOf('\u3002'), candidate.lastIndexOf(' '));
    const end = boundary >= Math.floor(MAX_CHUNK_CHARACTERS * 0.6) ? boundary + 1 : MAX_CHUNK_CHARACTERS;
    pieces.push({ ...unit, text: remaining.slice(0, end).trim() });
    remaining = remaining.slice(end).trim();
  }
  if (remaining) pieces.push({ ...unit, text: remaining });
  return pieces;
}

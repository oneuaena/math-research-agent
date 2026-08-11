import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';

const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.tex']);
export const INDEXABLE_DOCUMENT_EXTENSIONS = new Set([...TEXT_EXTENSIONS, '.docx', '.pdf']);
const MAX_EXTRACTED_CHARACTERS = 5_000_000;

export interface DocumentExtraction {
  content: string;
  contentHash: string;
  contentCharacters: number;
  extractionStatus: 'complete' | 'unsupported';
  extractionWarnings: string[];
  indexedAt: string;
  documentType: 'txt' | 'md' | 'tex' | 'docx' | 'pdf';
  pageCount: number;
  units: DocumentUnit[];
}

export interface DocumentUnit {
  text: string;
  page: number | null;
  section: string;
  kind: 'title' | 'section' | 'paragraph' | 'list' | 'table' | 'equation' | 'proof' | 'page';
}

export async function extractDocument(path: string): Promise<DocumentExtraction> {
  const extension = extname(path).toLowerCase();
  let content = '';
  let warnings: string[] = [];
  let units: DocumentUnit[] = [];
  let pageCount = 0;

  if (TEXT_EXTENSIONS.has(extension)) {
    content = await readFile(path, 'utf8');
    units = extension === '.tex' ? latexUnits(content) : paragraphUnits(content);
  } else if (extension === '.docx') {
    const result = await mammoth.extractRawText({ path });
    content = result.value;
    warnings = result.messages.map((message) => message.message).filter(Boolean);
    units = paragraphUnits(content);
  } else if (extension === '.pdf') {
    const parser = new PDFParse({ data: new Uint8Array(await readFile(path)) });
    try {
      const result = await parser.getText();
      pageCount = result.total;
      units = result.pages.map((page) => ({ text: normalizeDocumentText(page.text), page: page.num, section: `Page ${page.num}`, kind: 'page' as const })).filter((unit) => unit.text.length > 0);
      content = units.map((unit) => unit.text).join('\n\n');
      if (units.length < pageCount) warnings.push('One or more PDF pages had no extractable text layer; OCR may be required for those pages.');
    } finally {
      await parser.destroy();
    }
  } else {
    return {
      content: '',
      contentHash: '',
      contentCharacters: 0,
      extractionStatus: 'unsupported',
      extractionWarnings: [`Text extraction is not available for ${extension || 'this file type'}.`],
      indexedAt: new Date().toISOString(),
      documentType: 'txt',
      pageCount: 0,
      units: [],
    };
  }

  content = normalizeDocumentText(content);
  units = units.map((unit) => ({ ...unit, text: normalizeDocumentText(unit.text) })).filter((unit) => unit.text.length > 0);
  if (!content) throw new Error('The document did not contain readable text.');
  if (content.length > MAX_EXTRACTED_CHARACTERS) {
    throw new Error(`The extracted document exceeds the ${MAX_EXTRACTED_CHARACTERS.toLocaleString('en-US')} character indexing limit.`);
  }
  return {
    content,
    contentHash: createHash('sha256').update(content, 'utf8').digest('hex'),
    contentCharacters: content.length,
    extractionStatus: 'complete',
    extractionWarnings: warnings,
    indexedAt: new Date().toISOString(),
    documentType: extension.slice(1) as DocumentExtraction['documentType'],
    pageCount,
    units,
  };
}

function normalizeDocumentText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replaceAll(String.fromCharCode(0), '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function paragraphUnits(value: string): DocumentUnit[] {
  return value.replace(/\r\n?/g, '\n').split(/\n{2,}/).map((text, index) => {
    const clean = text.trim();
    const first = clean.split('\n')[0] ?? '';
    const kind: DocumentUnit['kind'] = index === 0 && first.length <= 180 ? 'title'
      : /^(?:proof|\u8bc1\u660e)(?:\b|\s|[:\uff1a])/i.test(first) ? 'proof'
        : /^(?:theorem|lemma|proposition|definition|corollary|\u5b9a\u7406|\u5f15\u7406|\u547d\u9898|\u5b9a\u4e49|\u63a8\u8bba)(?:\b|\s|[:\uff1a])/i.test(first) ? 'section'
          : /^(?:[-*\u2022]|\d+[.)\u3001])\s*/.test(first) ? 'list'
            : 'paragraph';
    return { text: clean, page: null, section: kind === 'section' || kind === 'proof' || kind === 'title' ? first.slice(0, 240) : '', kind };
  }).filter((unit) => unit.text.length > 0);
}

function latexUnits(value: string): DocumentUnit[] {
  const normalized = value.replace(/\r\n?/g, '\n');
  const blocks = normalized.split(/(?=\\(?:chapter|section|subsection|subsubsection|begin\{(?:definition|theorem|lemma|proposition|proof|equation|align)))/g);
  let currentSection = '';
  return blocks.flatMap((block) => {
    const text = block.trim();
    if (!text) return [];
    const section = text.match(/^\\(?:chapter|section|subsection|subsubsection)\*?\{([^}]*)\}/)?.[1];
    if (section) currentSection = section;
    const environment = text.match(/^\\begin\{([^}]*)\}/)?.[1] ?? '';
    const kind: DocumentUnit['kind'] = section ? 'section'
      : /^(definition|theorem|lemma|proposition)$/.test(environment) ? 'section'
        : environment === 'proof' ? 'proof'
          : /^(equation|align)$/.test(environment) ? 'equation'
            : 'paragraph';
    return [{ text, page: null, section: section ?? currentSection, kind }];
  });
}

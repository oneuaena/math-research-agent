import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { extractDocument } from './document-extractor';

describe('document text extraction', () => {
  it('extracts every paragraph from a DOCX into indexed content', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'mra-docx-test-'));
    const path = join(directory, 'research.docx');
    try {
      const zip = new JSZip();
      zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
      zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
      zip.file('word/document.xml', '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Complete source marker α.</w:t></w:r></w:p><w:p><w:r><w:t>For every integer n, n⁵ − n is divisible by 30.</w:t></w:r></w:p><w:p><w:r><w:t>Final source marker Ω.</w:t></w:r></w:p></w:body></w:document>');
      writeFileSync(path, await zip.generateAsync({ type: 'nodebuffer' }));

      const extraction = await extractDocument(path);

      expect(extraction.extractionStatus).toBe('complete');
      expect(extraction.content).toContain('Complete source marker α.');
      expect(extraction.content).toContain('n⁵ − n is divisible by 30.');
      expect(extraction.content).toContain('Final source marker Ω.');
      expect(extraction.contentCharacters).toBe(extraction.content.length);
      expect(extraction.contentHash).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('preserves PDF page numbers for page-specific retrieval', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'mra-pdf-test-'));
    const path = join(directory, 'research.pdf');
    try {
      const document = await PDFDocument.create();
      const font = await document.embedFont(StandardFonts.Helvetica);
      for (let pageNumber = 1; pageNumber <= 4; pageNumber += 1) {
        const page = document.addPage([600, 800]);
        page.drawText(pageNumber === 3 ? 'Page three theorem marker: invariant kappa equals 29.' : `Routine page ${pageNumber}.`, { x: 50, y: 730, size: 14, font });
      }
      writeFileSync(path, await document.save());

      const extraction = await extractDocument(path);

      expect(extraction.pageCount).toBe(4);
      expect(extraction.units.find((unit) => unit.page === 3)?.text).toContain('kappa equals 29');
      expect(extraction.units.map((unit) => unit.page)).toEqual([1, 2, 3, 4]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

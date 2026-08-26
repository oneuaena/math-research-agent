import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildLatexDocument } from './report';

const compiler = ['xelatex', 'lualatex'].find((candidate) => {
  try { execFileSync(candidate, ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
});

describe('XeLaTeX/LuaLaTeX publication acceptance', () => {
  it.skipIf(!compiler)('compiles the Unicode action-log fixture with no missing-character diagnostics', () => {
    const directory = mkdtempSync(join(tmpdir(), 'mra-latex-'));
    try {
      const source = readFileSync(join(process.cwd(), 'electron', 'fixtures', 'latex-export-action-log.md'), 'utf8');
      const report = buildLatexDocument('Unicode 𝜀 report', source);
      const texPath = join(directory, 'report.tex');
      writeFileSync(texPath, report.tex, 'utf8');
      execFileSync(compiler!, ['-interaction=nonstopmode', '-halt-on-error', '-output-directory', directory, texPath], { stdio: 'pipe' });
      const log = readFileSync(join(directory, 'report.log'), 'utf8');
      expect(existsSync(join(directory, 'report.pdf'))).toBe(true);
      expect(log).not.toMatch(/Missing character|Undefined control sequence/i);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});

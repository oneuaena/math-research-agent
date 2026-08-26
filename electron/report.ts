import type { ProjectSnapshot } from '../src/shared/types';
import { canDisplayVerifiedProof, specificationLevel } from '../src/shared/research';
import { normalizeMathExpression, normalizeUnicodeMathGlyph, unicodeScript } from './latex-unicode';

const section = (title: string, content: string) => `## ${title}\n\n${content.trim() || '—'}\n`;

export function buildMarkdownReport(snapshot: ProjectSnapshot): string {
  const { project } = snapshot;
  const definitions = snapshot.nodes.filter((node) => node.kind === 'Definition').map((node) => `- **${node.title}:** ${node.content}`).join('\n');
  const lemmas = snapshot.propositions.map((item) => `### ${item.title} · ${item.status.toUpperCase()}\n\n${item.statement}\n\n${item.proof || 'Proof not recorded.'}`).join('\n\n');
  const experiments = snapshot.experiments.map((item) => `### ${item.purpose}\n\n- Tool: ${item.tool}\n- Status: ${item.status}\n- Output: ${item.output || '—'}\n- Interpretation: ${item.interpretation || '—'}`).join('\n\n');
  const failures = snapshot.failedAttempts.map((item) => `### ${item.title}\n\n${item.approach}\n\n**Why it failed:** ${item.reason}\n\n**Learned:** ${item.learned}`).join('\n\n');
  const sources = snapshot.sources.map((item) => `- ${item.title}${item.authors ? ` — ${item.authors}` : ''} (${item.type})`).join('\n');
  const unresolved = snapshot.memories.filter((item) => item.category === 'issue').map((item) => `- **${item.title}:** ${item.content}`).join('\n');
  const summary = snapshot.blocks.filter((block) => block.kind === 'agent-note').slice(-3).map((block) => block.content).join('\n\n');
  const specification = snapshot.specifications.at(-1);
  const specificationText = specification ? `Level: ${specificationLevel(specification)}\n\nQuantifiers: ${specification.quantifiers.join('; ') || '—'}\n\nVariables: ${specification.variables.map((item) => `${item.name}: ${item.domain}`).join('; ') || '—'}\n\nAssumptions: ${specification.assumptions.join('; ') || '—'}\n\nTarget: ${specification.target.description}\n\nUncertainty: ${specification.uncertainty.join('; ') || '—'}` : '—';
  const branches = snapshot.branches.map((branch) => `- **${branch.title}** [${branch.status}]: ${branch.objective}`).join('\n');
  const actionLog = snapshot.researchSteps.map((step) => `- ${step.iteration}. ${step.stage} / ${step.role}: ${step.action} — ${step.outputs}`).join('\n');
  const proofRecords = snapshot.proofs.map((proof) => `### ${canDisplayVerifiedProof(proof) ? 'VERIFIED PROOF' : 'NOT VERIFIED'}\n\n**Theorem:** ${proof.theorem}\n\n${proof.steps.map((step, index) => `${index + 1}. **${step.title}** [${step.status}] — ${step.statement}\n   ${step.verifierComment}`).join('\n')}`).join('\n\n');
  return `# ${project.name}\n\n${section('Research Question', project.question)}\n${section('Structured Specification', specificationText)}\n${section('Summary', summary)}\n${section('Definitions', definitions)}\n${section('Known Results', project.knownResults)}\n${section('Research Branches', branches)}\n${section('Research Action Log', actionLog)}\n${section('Experiments', experiments)}\n${section('Structured Proofs', proofRecords)}\n${section('Key Lemmas', lemmas)}\n${section('Counterexamples', snapshot.nodes.filter((n) => n.kind === 'Counterexample' || n.kind === 'COUNTEREXAMPLE').map((n) => `- ${n.title}: ${n.content}`).join('\n'))}\n${section('Failed Approaches', failures)}\n${section('Unresolved Issues', unresolved)}\n${section('Confidence / Verification Status', `Verified proof records: ${snapshot.proofs.filter(canDisplayVerifiedProof).length}\n\nExact or symbolic evidence records: ${snapshot.evidence.filter((item) => item.verificationStatus === 'exactly-verified' || item.verificationStatus === 'symbolically-verified').length}\n\nModel-only evidence is not verification.`)}\n${section('References', sources)}`;
}

type Inline = { type: 'text' | 'math' | 'code' | 'bold' | 'italic'; value: string };

function escapeLatexText(value: string): string {
  return value.replace(/\\/g, '\\textbackslash{}').replace(/([%&#_${}])/g, '\\$1').replace(/~/g, '\\textasciitilde{}').replace(/\^/g, '\\textasciicircum{}');
}

/** Reject document-level commands but otherwise leave user-authored formula syntax intact. */
function validMath(value: string): boolean {
  let braces = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '\\') { index += 1; continue; }
    if (value[index] === '{') braces += 1;
    if (value[index] === '}' && --braces < 0) return false;
  }
  return braces === 0 && !value.includes('\0') && !/\\(?:input|include|write|openout|read|usepackage|documentclass|begin\s*\{document\}|end\s*\{document\})\b/i.test(value);
}

function serializeText(value: string): string {
  let output = '';
  let text = '';
  const flushText = () => { if (text) output += escapeLatexText(text); text = ''; };
  const characters = Array.from(value);
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    const simpleMath = characters.slice(index).join('').match(/^[A-Za-z](?:(?:_(?:\{[A-Za-z0-9+\- ]+\}|[A-Za-z0-9]))|(?:\^(?:\{[A-Za-z0-9+\- ]+\}|[A-Za-z0-9]))){1,2}/);
    if (simpleMath && !(index > 0 && /[A-Za-z0-9]/.test(characters[index - 1])) && !/^[A-Za-z0-9_]/.test(characters[index + simpleMath[0].length] ?? '')) {
      flushText(); output += `$${simpleMath[0]}$`; index += simpleMath[0].length - 1; continue;
    }
    const latex = normalizeUnicodeMathGlyph(character);
    if (latex) {
      let scripts = '';
      while (index + 1 < characters.length && (Object.hasOwn(unicodeScript.SUPER, characters[index + 1]) || Object.hasOwn(unicodeScript.SUB, characters[index + 1]))) scripts += characters[++index];
      flushText(); output += `$${latex}${normalizeMathExpression(scripts)}$`; continue;
    }
    if (Object.hasOwn(unicodeScript.SUPER, character) || Object.hasOwn(unicodeScript.SUB, character)) {
      let scripts = character;
      while (index + 1 < characters.length && (Object.hasOwn(unicodeScript.SUPER, characters[index + 1]) || Object.hasOwn(unicodeScript.SUB, characters[index + 1]))) scripts += characters[++index];
      const base = text.at(-1);
      if (base && /[A-Za-z0-9]/.test(base)) { text = text.slice(0, -1); flushText(); output += `$${base}${normalizeMathExpression(scripts)}$`; }
      else { flushText(); output += `\\textsuperscript{${escapeLatexText(normalizeMathExpression(scripts).replace(/[{}_]/g, ''))}}`; }
      continue;
    }
    text += character;
  }
  flushText();
  return output;
}

function math(value: string): string { return normalizeMathExpression(value); }
function parseInline(value: string): Inline[] { const nodes: Inline[] = []; let cursor = 0; const add = (type: Inline['type'], text: string) => { if (text) nodes.push({ type, value: text }); }; while (cursor < value.length) { const rest = value.slice(cursor); const match = rest.match(/^(\$([^$\n]+)\$|\\\((.*?)\\\)|`([^`]+)`|\*\*([\s\S]+?)\*\*|\*([^*\n]+)\*)/); if (!match) { const next = rest.search(/\$|\\\(|`|\*/); if (next < 0) { add('text', rest); break; } add('text', rest.slice(0, next)); cursor += next; continue; } const raw = match[0]; const type: Inline['type'] = raw.startsWith('$') || raw.startsWith('\\(') ? 'math' : raw.startsWith('`') ? 'code' : raw.startsWith('**') ? 'bold' : 'italic'; add(type, type === 'math' ? (match[2] ?? match[3] ?? '') : match[4] ?? match[5] ?? match[6] ?? ''); cursor += raw.length; } return nodes; }
function serializeInline(value: string): string { return parseInline(value).map((node) => node.type === 'math' ? validMath(node.value) ? `$${math(node.value)}$` : `\\texttt{${escapeLatexText(node.value)}}` : node.type === 'code' ? `\\texttt{${escapeLatexText(node.value)}}` : node.type === 'bold' ? `\\textbf{${serializeInline(node.value)}}` : node.type === 'italic' ? `\\emph{${serializeInline(node.value)}}` : serializeText(node.value)).join(''); }

/** Deterministic Markdown-to-LaTeX serializer with separate text, math, and code paths. */
export function markdownToLatex(markdown: string): { body: string; warnings: string[] } {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n'); const output: string[] = []; const warnings: string[] = []; let index = 0;
  while (index < lines.length) { const line = lines[index]; const fence = line.match(/^```([^\s]*)/);
    if (fence) { const code: string[] = []; index += 1; while (index < lines.length && !lines[index].startsWith('```')) code.push(lines[index++]); if (index === lines.length) warnings.push('LATEX_EXPORT_WARNING: unclosed code fence.'); else index += 1; output.push(`\\begin{lstlisting}[language=${fence[1] || 'text'}]\n${code.join('\n')}\n\\end{lstlisting}`); continue; }
    const display = line.trim() === '$$' || line.trim() === '\\['; if (display) { const end = line.trim() === '$$' ? '$$' : '\\]'; const formula: string[] = []; index += 1; while (index < lines.length && lines[index].trim() !== end) formula.push(lines[index++]); if (index === lines.length || !validMath(formula.join('\n'))) { warnings.push('LATEX_EXPORT_WARNING: malformed display math.'); output.push(`\\texttt{${escapeLatexText([line, ...formula].join('\n'))}}`); } else { output.push(`\\[\n${math(formula.join('\n'))}\n\\]`); index += 1; } continue; }
    const heading = line.match(/^(#{1,3})\s+(.+)/); if (heading) { output.push(`${heading[1].length === 1 ? '\\section*' : heading[1].length === 2 ? '\\section' : '\\subsection'}{${serializeInline(heading[2])}}`); index += 1; continue; }
    if (/^-\s+/.test(line)) { const items: string[] = []; while (index < lines.length && /^-\s+/.test(lines[index])) items.push(`\\item ${serializeInline(lines[index++].slice(2))}`); output.push(`\\begin{itemize}\n${items.join('\n')}\n\\end{itemize}`); continue; }
    if (/^\d+\.\s+/.test(line)) { const items: string[] = []; while (index < lines.length && /^\d+\.\s+/.test(lines[index])) items.push(`\\item ${serializeInline(lines[index++].replace(/^\d+\.\s+/, ''))}`); output.push(`\\begin{enumerate}\n${items.join('\n')}\n\\end{enumerate}`); continue; }
    if (line.trim()) output.push(serializeInline(line)); index += 1;
  } return { body: output.join('\n\n'), warnings };
}

export function buildLatexDocument(title: string, markdown: string): { tex: string; warnings: string[] } {
  const converted = markdownToLatex(markdown); const warningComment = converted.warnings.map((warning) => `% ${warning}`).join('\n');
  return {
    warnings: converted.warnings,
    tex: `% Recommended compiler: XeLaTeX\n% UTF-8 research report; formulas are serialized separately from text.\n\\documentclass[UTF8,11pt]{ctexart}\n\\usepackage[margin=1in]{geometry}\n\\usepackage{amsmath,amssymb,amsthm,mathtools,bm,booktabs,longtable,array,enumitem,xcolor}\n\\usepackage{listings}\n\\usepackage{hyperref}\n\\hypersetup{unicode=true,colorlinks=true,linkcolor=blue,urlcolor=blue}\n\\lstset{basicstyle=\\ttfamily\\small,breaklines=true,columns=fullflexible}\n\\title{${serializeInline(title)}}\n\\begin{document}\n\\maketitle\n${warningComment}\n${converted.body}\n\\end{document}\n`,
  };
}

export function buildLatexReport(snapshot: ProjectSnapshot): string {
  return buildLatexDocument(snapshot.project.name, buildMarkdownReport(snapshot)).tex;
}

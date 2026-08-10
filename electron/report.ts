import type { ProjectSnapshot } from '../src/shared/types';
import { canDisplayVerifiedProof, specificationLevel } from '../src/shared/research';

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

function latexEscape(value: string): string {
  return value.replace(/([%&#_{}])/g, '\\$1').replace(/~/g, '\\textasciitilde{}').replace(/\^/g, '\\textasciicircum{}');
}

export function buildLatexReport(snapshot: ProjectSnapshot): string {
  const markdown = buildMarkdownReport(snapshot);
  const body = markdown.split('\n').map((line) => {
    if (line.startsWith('# ')) return `\\section*{${latexEscape(line.slice(2))}}`;
    if (line.startsWith('## ')) return `\\section{${latexEscape(line.slice(3))}}`;
    if (line.startsWith('### ')) return `\\subsection{${latexEscape(line.slice(4))}}`;
    if (line.startsWith('- ')) return `\\par ${latexEscape(line.slice(2))}`;
    return latexEscape(line);
  }).join('\n');
  return `\\documentclass[11pt]{article}\n\\usepackage[margin=1in]{geometry}\n\\usepackage{amsmath,amssymb,amsthm}\n\\usepackage{hyperref}\n\\title{${latexEscape(snapshot.project.name)}}\n\\begin{document}\n\\maketitle\n${body}\n\\end{document}\n`;
}

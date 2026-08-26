import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { markdownToLatex } from './report';
import { normalizeMathExpression } from './latex-unicode';

describe('publication LaTeX serializer', () => {
  it('preserves authored formula syntax while escaping only surrounding text', () => {
    const { body } = markdownToLatex('中文正文 $x_1^2 + \\frac{a+b}{c+d}$，成功率为 95% 与 proof_state_id。');
    expect(body).toContain('$x_1^2 + \\frac{a+b}{c+d}$');
    expect(body).toContain('95\\%');
    expect(body).toContain('proof\\_state\\_id');
    expect(body).not.toContain('\\\\frac\\{');
  });

  it('normalizes Greek, mathematical unicode glyphs, operators, and scripts', () => {
    expect(normalizeMathExpression('α β γ δ ε ζ η θ ι κ λ μ ν ξ π ρ σ τ υ φ χ ψ ω')).toContain('\\epsilon');
    expect(normalizeMathExpression('ϵ ϑ ϖ ϱ ς ϕ Γ Δ Θ Λ Ξ Π Σ Υ Φ Ψ Ω')).toContain('\\varphi');
    expect(normalizeMathExpression('𝜀𝜈𝜎𝜙𝜔 𝐱 𝑦 𝒛 𝕽')).toBe('\\epsilon\\nu\\sigma\\phi\\omega x y z R');
    expect(normalizeMathExpression('H¹ x₂ aₙ')).toBe('H^{1} x_{2} a_{n}');
    expect(normalizeMathExpression('≤ ≥ ≠ ≈ ≡ ∼ ∝ ± ∓ × ÷ · − → ← ↔ ⇒ ⇐ ⇔ ∈ ∉ ⊂ ⊆ ⊃ ⊇ ∪ ∩ ∅ ∀ ∃ ¬ ∧ ∨ ∇ ∂ ℝ ℕ ℤ ℚ ℂ')).toContain('\\mathbb{C}');
  });

  it('uses conservative math tokens in prose without touching code', () => {
    const { body } = markdownToLatex('The ε-dependent threshold satisfies σ ≤ γ − 1 in L^p.\n\n`𝜀 ≤ γ`\n\n```python\nvalue = "𝜀 ≤ γ"\n```');
    expect(body).toContain('The $\\epsilon$-dependent threshold satisfies $\\sigma$ $\\le$ $\\gamma$ $-$ 1 in $L^p$.');
    expect(body).toContain('\\texttt{𝜀 ≤ γ}');
    expect(body).toContain('value = "𝜀 ≤ γ"');
  });

  it('serializes display math and markdown blocks without double conversion', () => {
    const input = '# 报告 $x^2$\n\n**bold** and *italic* with α ≤ β ⇒ γ ∈ ℝ.\n\n$$\n\\frac{a+b}{c+d}\n$$\n\n```lean\ntheorem example (n : ℕ) : n + 0 = n := by\n  simp\n```';
    const { body, warnings } = markdownToLatex(input);
    expect(warnings).toEqual([]);
    expect(body).toContain('\\section*{报告 $x^2$}');
    expect(body).toContain('\\textbf{bold}'); expect(body).toContain('\\emph{italic}');
    expect(body).toContain('$\\alpha$ $\\le$ $\\beta$ $\\Rightarrow$ $\\gamma$ $\\in$ $\\mathbb{R}$');
    expect(body).toContain('\\[\n\\frac{a+b}{c+d}\n\\]');
    expect(body).toContain('\\begin{lstlisting}[language=lean]');
    expect(body).toContain('theorem example (n : ℕ) : n + 0 = n := by');
  });

  it('keeps a research action-log fixture free of raw unicode math and unsafe injection', () => {
    const fixture = readFileSync(join(process.cwd(), 'electron', 'fixtures', 'latex-export-action-log.md'), 'utf8');
    const { body, warnings } = markdownToLatex(fixture);
    expect(warnings).toEqual([]);
    expect(body).toContain('$\\epsilon$'); expect(body).toContain('$\\sigma$'); expect(body).toContain('$\\mathbb{R}$');
    expect(body).toContain('\\texttt{proof\\_state\\_id}'); expect(body).toContain('theorem check (ε : ℝ)');
    expect(body).not.toContain('\\input{');
  });

  it('safely degrades malformed or document-injecting math', () => {
    const { body, warnings } = markdownToLatex('$$\n\\frac{a}{b\n$$\n\n$\\input{secret}$');
    expect(warnings).toContain('LATEX_EXPORT_WARNING: malformed display math.');
    expect(body).toContain('\\texttt{'); expect(body).toContain('input\\{secret\\}');
  });
});

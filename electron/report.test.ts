import { describe, expect, it } from 'vitest';
import { markdownToLatex } from './report';

describe('publication LaTeX serializer', () => {
  it('preserves formula syntax while escaping only surrounding text', () => {
    const { body } = markdownToLatex('中文正文 $x_1^2 + \\frac{a+b}{c+d}$，成功率为 95% 与 proof_state_id。\n\n$\\sum_{i=1}^{n} i$');
    expect(body).toContain('$x_1^2 + \\frac{a+b}{c+d}$');
    expect(body).toContain('$\\sum_{i=1}^{n} i$');
    expect(body).toContain('95\\%'); expect(body).toContain('proof\\_state\\_id');
    expect(body).not.toContain('\\\\frac\\{'); expect(body).not.toContain('x\\_1');
  });

  it('serializes display math, unicode math, markdown, tables-as-text, and code without double escaping', () => {
    const input = `# 报告 $x^2$\n\n**bold** and *italic* with α ≤ β ⇒ γ ∈ ℝ.\n\n$$\n\\begin{pmatrix}\n1 & 2 \\\\\n3 & 4\n\\end{pmatrix}\n$$\n\n\\[\n\\begin{cases}\nx^2, & x\\ge0\\\\\n-x, & x<0\n\\end{cases}\n\\]\n\n| column | value |\n| x | $a_i$ |\n\n\`\`\`python\nfor i in range(n):\n    x_i = values[i]\n\`\`\`\n\n\`\`\`lean\ntheorem example (n : ℕ) : n + 0 = n := by\n  simp\n\`\`\``;
    const { body, warnings } = markdownToLatex(input);
    expect(warnings).toEqual([]); expect(body).toContain('\\section*{报告 $x^2$}');
    expect(body).toContain('\\textbf{bold}'); expect(body).toContain('\\emph{italic}');
    expect(body).toContain('\\ensuremath{\\alpha} \\ensuremath{\\le} \\ensuremath{\\beta} \\ensuremath{\\Rightarrow} \\ensuremath{\\gamma} \\ensuremath{\\in} \\ensuremath{\\mathbb{R}}');
    expect(body).toContain('\\[\n\\begin{pmatrix}\n1 & 2 \\\\\n3 & 4\n\\end{pmatrix}\n\\]');
    expect(body).toContain('\\begin{cases}'); expect(body).toContain('x\\ge0'); expect(body).toContain('\\begin{lstlisting}[language=python]');
    expect(body).toContain('    x_i = values[i]'); expect(body).toContain('theorem example (n : ℕ)');
    expect(body).toContain('| column | value |'); expect(body).toContain('$a_i$');
  });

  it('safely degrades malformed math instead of emitting a broken document', () => {
    const { body, warnings } = markdownToLatex('$$\n\\frac{a}{b\n$$\n\n$unclosed');
    expect(warnings).toContain('LATEX_EXPORT_WARNING: malformed display math.');
    expect(body).toContain('\\texttt{'); expect(body).toContain('unclosed');
  });
});

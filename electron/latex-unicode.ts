/**
 * Unicode-to-LaTeX normalization used by the report serializer.  Mathematical
 * Alphanumeric Symbols have compatibility decompositions, so NFKD gives us a
 * complete, codepoint-aware base character instead of maintaining a fragile
 * list of visually similar glyphs.
 */
const MATH_SYMBOLS: Record<string, string> = {
  'α': '\\alpha', 'β': '\\beta', 'γ': '\\gamma', 'δ': '\\delta', 'ε': '\\epsilon', 'ζ': '\\zeta', 'η': '\\eta', 'θ': '\\theta', 'ι': '\\iota', 'κ': '\\kappa', 'λ': '\\lambda', 'μ': '\\mu', 'ν': '\\nu', 'ξ': '\\xi', 'π': '\\pi', 'ρ': '\\rho', 'σ': '\\sigma', 'τ': '\\tau', 'υ': '\\upsilon', 'φ': '\\phi', 'χ': '\\chi', 'ψ': '\\psi', 'ω': '\\omega',
  'ϵ': '\\varepsilon', 'ϑ': '\\vartheta', 'ϖ': '\\varpi', 'ϱ': '\\varrho', 'ς': '\\varsigma', 'ϕ': '\\varphi',
  'Γ': '\\Gamma', 'Δ': '\\Delta', 'Θ': '\\Theta', 'Λ': '\\Lambda', 'Ξ': '\\Xi', 'Π': '\\Pi', 'Σ': '\\Sigma', 'Υ': '\\Upsilon', 'Φ': '\\Phi', 'Ψ': '\\Psi', 'Ω': '\\Omega',
  '∞': '\\infty', '≤': '\\le', '≥': '\\ge', '≠': '\\ne', '≈': '\\approx', '≡': '\\equiv', '∼': '\\sim', '∝': '\\propto', '±': '\\pm', '∓': '\\mp', '×': '\\times', '÷': '\\div', '·': '\\cdot', '−': '-',
  '→': '\\to', '←': '\\leftarrow', '↔': '\\leftrightarrow', '⇒': '\\Rightarrow', '⇐': '\\Leftarrow', '⇔': '\\Leftrightarrow',
  '∈': '\\in', '∉': '\\notin', '⊂': '\\subset', '⊆': '\\subseteq', '⊃': '\\supset', '⊇': '\\supseteq', '∪': '\\cup', '∩': '\\cap', '∅': '\\varnothing', '∀': '\\forall', '∃': '\\exists', '¬': '\\neg', '∧': '\\land', '∨': '\\lor', '∇': '\\nabla', '∂': '\\partial',
  'ℝ': '\\mathbb{R}', 'ℕ': '\\mathbb{N}', 'ℤ': '\\mathbb{Z}', 'ℚ': '\\mathbb{Q}', 'ℂ': '\\mathbb{C}',
};

const SUPER: Record<string, string> = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁺': '+', '⁻': '-', '⁼': '=', '⁽': '(', '⁾': ')', 'ⁿ': 'n', 'ⁱ': 'i' };
const SUB: Record<string, string> = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9', '₊': '+', '₋': '-', '₌': '=', '₍': '(', '₎': ')', 'ₐ': 'a', 'ₑ': 'e', 'ₕ': 'h', 'ᵢ': 'i', 'ⱼ': 'j', 'ₖ': 'k', 'ₗ': 'l', 'ₘ': 'm', 'ₙ': 'n', 'ₒ': 'o', 'ₚ': 'p', 'ᵣ': 'r', 'ₛ': 's', 'ₜ': 't', 'ᵤ': 'u', 'ᵥ': 'v', 'ₓ': 'x' };

export function unicodeMathLatex(character: string): string | null {
  if (MATH_SYMBOLS[character]) return MATH_SYMBOLS[character];
  const normalized = character.normalize('NFKD');
  if (normalized.length === 1 && MATH_SYMBOLS[normalized]) return MATH_SYMBOLS[normalized];
  return null;
}

export function isUnicodeMath(character: string): boolean {
  return unicodeMathLatex(character) !== null || Object.hasOwn(SUPER, character) || Object.hasOwn(SUB, character)
    || (character.codePointAt(0) ?? 0) >= 0x1d400 && (character.codePointAt(0) ?? 0) <= 0x1d7ff;
}

/** Normalizes Unicode mathematics inside an already-delimited math expression. */
export function normalizeMathExpression(value: string): string {
  let output = '';
  let superscript = '';
  let subscript = '';
  const flushScripts = () => { if (subscript) output += `_{${subscript}}`; if (superscript) output += `^{${superscript}}`; subscript = ''; superscript = ''; };
  for (const character of value.trim()) {
    if (SUPER[character]) { superscript += SUPER[character]; continue; }
    if (SUB[character]) { subscript += SUB[character]; continue; }
    flushScripts();
    const latex = unicodeMathLatex(character);
    output += latex ?? character.normalize('NFKD');
  }
  flushScripts();
  return output;
}

/** Converts a single Unicode math glyph to its LaTeX payload, if it is one. */
export function normalizeUnicodeMathGlyph(character: string): string | null {
  const latex = unicodeMathLatex(character);
  if (latex) return latex;
  const codepoint = character.codePointAt(0) ?? 0;
  if (codepoint >= 0x1d400 && codepoint <= 0x1d7ff) return character.normalize('NFKD');
  return null;
}

export const unicodeScript = { SUPER, SUB };

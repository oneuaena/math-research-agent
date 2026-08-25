import { describe, expect, it } from 'vitest';
import { createFormalBinding, leanStatementFromDeclaration, leanStatementFromSource } from './formal-binding';

const code = 'import Mathlib\n\n-- the proof body is intentionally excluded from the declaration hash\ntheorem comm (a b : Nat) : a + b = b + a := by\n  omega\n';

describe('formal statement binding', () => {
  it('locks canonical source, Formal IR, and the Lean declaration under stable hashes', () => {
    const binding = createFormalBinding({ projectId: 'project', originalStatement: 'For every a,b in N: a+b=b+a.', formalIr: 'forall a b : Nat; a + b = b + a', leanStatement: leanStatementFromSource(code), mappingAuthority: 'AI_PROPOSED', id: 'binding', createdAt: '2026-08-25T00:00:00.000Z' });
    expect(binding.leanStatement).toBe('theorem comm (a b : Nat) : a + b = b + a');
    expect(binding.bindingHash).toHaveLength(64);
    expect(binding.status).toBe('FROZEN');
    expect(binding.equivalenceStatus).toBe('NOT_INDEPENDENTLY_CERTIFIED');
  });

  it('does not let a changed declaration reuse the same binding', () => {
    const original = leanStatementFromSource(code);
    const swapped = leanStatementFromSource('theorem comm (a b : Nat) : a * b = b * a := by\n  omega');
    expect(swapped).not.toBe(original);
  });

  it('rejects a source without a completed theorem declaration', () => {
    expect(() => leanStatementFromSource('import Mathlib\n#check Nat.add')).toThrow(/theorem, lemma, or example/i);
  });

  it('rejects a proof body when FORMALIZE is freezing the declaration', () => {
    expect(() => leanStatementFromDeclaration(code)).toThrow(/proof body/i);
  });
});

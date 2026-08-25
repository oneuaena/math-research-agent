import { createHash, randomUUID } from 'node:crypto';
import type { FormalBinding, FormalBindingValidation } from '../src/shared/types';
import type { ResearchDatabase } from './database';

function canonical(value: string): string {
  return value.normalize('NFKC').replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n[ \t]*/g, '\n').trim();
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function stripComments(source: string): string {
  return source.replace(/\/-[\s\S]*?-\//g, ' ').replace(/--.*$/gm, ' ');
}

/** Extracts the declaration header, excluding the proof body, deterministically. */
export function leanStatementFromSource(source: string): string {
  const clean = stripComments(source);
  const match = /\b(?:theorem|lemma|example)\b([\s\S]*?)(?::=|\bwhere\b)/m.exec(clean);
  if (!match) throw new Error('Lean source must contain a theorem, lemma, or example declaration with a proof.');
  const statement = canonical(match[0].replace(/(?::=|\bwhere\b)\s*$/, ''));
  if (statement.length < 8 || statement.length > 20_000) throw new Error('Lean theorem statement is outside the permitted size range.');
  return statement;
}

/** Validates a proof-free declaration supplied by FORMALIZE before it is frozen. */
export function leanStatementFromDeclaration(declaration: string): string {
  const clean = canonical(stripComments(declaration));
  if (/:=|\bwhere\b/.test(clean)) throw new Error('Formalization must freeze a Lean declaration header, not a proof body.');
  if (!/^(?:theorem|lemma|example)\b/.test(clean)) throw new Error('Lean declaration must begin with theorem, lemma, or example.');
  if (!/:/.test(clean)) throw new Error('Lean declaration must include its proposition after a colon.');
  if (clean.length < 8 || clean.length > 20_000) throw new Error('Lean theorem statement is outside the permitted size range.');
  return clean;
}

export function createFormalBinding(input: {
  projectId: string;
  originalStatement: string;
  formalIr: string;
  leanStatement: string;
  mappingAuthority: FormalBinding['mappingAuthority'];
  claimVersionId?: string;
  id?: string;
  createdAt?: string;
}): FormalBinding {
  const originalStatement = canonical(input.originalStatement);
  const formalIr = canonical(input.formalIr);
  const leanStatement = leanStatementFromDeclaration(input.leanStatement);
  if (!originalStatement || !formalIr) throw new Error('Original statement and Formal IR are both required before a Lean check.');
  if (originalStatement.length > 20_000 || formalIr.length > 50_000) throw new Error('Formal binding inputs exceed the permitted size limit.');
  const originalHash = digest(originalStatement);
  const formalIrHash = digest(formalIr);
  const leanStatementHash = digest(leanStatement);
  const createdAt = input.createdAt ?? new Date().toISOString();
  return {
    id: input.id ?? randomUUID(), projectId: input.projectId, originalStatement, formalIr, leanStatement,
    originalHash, formalIrHash, leanStatementHash,
    bindingHash: digest(`${originalHash}\n${formalIrHash}\n${leanStatementHash}\n${input.mappingAuthority}`),
    proofSourceHash: null, certificateHash: null,
    mappingAuthority: input.mappingAuthority,
    equivalenceStatus: input.mappingAuthority === 'USER_CONFIRMED' ? 'USER_CONFIRMED' : 'NOT_INDEPENDENTLY_CERTIFIED',
    status: 'FROZEN', createdAt, updatedAt: createdAt,
    claimVersionId: input.claimVersionId,
  };
}

export class FormalBindingService {
  constructor(private readonly database: ResearchDatabase) {}

  private saveFrozen(binding: FormalBinding): FormalBinding {
    const existing = this.database.getProject(binding.projectId, false).formalBindings
      .find((item) => item.bindingHash === binding.bindingHash && item.status !== 'INVALID');
    if (existing) return existing;
    this.database.saveRecord('formalBindings', binding);
    return binding;
  }

  freezeUserConfirmed(projectId: string, originalStatement: string, formalIr: string, leanSource: string): FormalBinding {
    this.database.getProject(projectId, false);
    const binding = createFormalBinding({ projectId, originalStatement, formalIr, leanStatement: leanStatementFromSource(leanSource), mappingAuthority: 'USER_CONFIRMED', claimVersionId: this.claimVersionFor(projectId, originalStatement) });
    return this.saveFrozen(binding);
  }

  freezeAiProposed(projectId: string, originalStatement: string, formalIr: string, leanStatement: string): FormalBinding {
    this.database.getProject(projectId, false);
    const binding = createFormalBinding({ projectId, originalStatement, formalIr, leanStatement, mappingAuthority: 'AI_PROPOSED', claimVersionId: this.claimVersionFor(projectId, originalStatement) });
    return this.saveFrozen(binding);
  }

  verify(projectId: string, bindingId: string, leanSource: string): FormalBindingValidation {
    const binding = this.database.getProject(projectId, false).formalBindings.find((item) => item.id === bindingId);
    if (!binding) return { ok: false, error: 'FORMAL_BINDING_REQUIRED: select a frozen FORMALIZE binding before running Lean.' };
    if (binding.status === 'INVALID') return { ok: false, error: 'FORMAL_BINDING_INVALID: this binding was invalidated and cannot certify a proof.' };
    if (binding.status !== 'FROZEN' && binding.status !== 'KERNEL_CERTIFIED') return { ok: false, error: 'FORMAL_BINDING_NOT_FROZEN: legacy or incomplete bindings cannot certify a proof.' };
    if (!binding.mappingAuthority || !binding.equivalenceStatus) return { ok: false, error: 'FORMAL_BINDING_NOT_FROZEN: legacy bindings cannot be used after the binding-gate upgrade.' };
    try {
      const statement = leanStatementFromSource(leanSource);
      const statementHash = digest(statement);
      if (statementHash !== binding.leanStatementHash) return { ok: false, error: 'FORMAL_BINDING_MISMATCH: Lean declaration differs from the locked theorem statement.' };
      return { ok: true, binding };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Unable to parse Lean theorem statement.' };
    }
  }

  certify(projectId: string, bindingId: string, leanSource: string, kernelOutput: string): FormalBindingValidation {
    const checked = this.verify(projectId, bindingId, leanSource);
    if (!checked.ok || !checked.binding) return checked;
    const updated: FormalBinding = {
      ...checked.binding,
      proofSourceHash: digest(canonical(leanSource)),
      certificateHash: digest(canonical(kernelOutput)),
      status: 'KERNEL_CERTIFIED',
      updatedAt: new Date().toISOString(),
    };
    this.database.saveRecord('formalBindings', updated);
    return { ok: true, binding: updated };
  }

  private claimVersionFor(projectId: string, originalStatement: string): string | undefined {
    const snapshot = this.database.getProject(projectId, false);
    const normalized = canonical(originalStatement);
    return snapshot.claimVersions.slice().reverse().find((claim) => canonical(claim.statement) === normalized)?.id
      ?? snapshot.claimVersions[0]?.id;
  }
}

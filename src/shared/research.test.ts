import { describe, expect, it } from 'vitest';
import { canDisplayVerifiedProof, chooseNextStage, formalizationSchema, normalizeRoleActionPayload, proofVerificationStatus, roleActionSchema } from './research';
import type { ProofDocument } from './types';

describe('v1 research contracts', () => {
  it('continues theoretical research when no executable form exists', () => {
    expect(chooseNextStage('EXPLORE', { hasSpecification: true, executable: false, sourceCount: 0, proofHasGaps: true, verifiedCounterexample: false, proofVerified: false, cycle: 0, checkpointsInCycle: 0 })).toBe('PATTERN_DISCOVERY');
  });

  it('uses checkpoints from the active cycle instead of the cumulative session total', () => {
    const context = { hasSpecification: true, executable: false, sourceCount: 0, proofHasGaps: true, verifiedCounterexample: false, proofVerified: false, cycle: 12 };
    expect(chooseNextStage('CHECKPOINT', { ...context, checkpointsInCycle: 4 })).toBe('EXPLORE');
    expect(chooseNextStage('CHECKPOINT', { ...context, checkpointsInCycle: 5 })).toBe('PAUSED');
  });

  it('rejects incomplete formalization payloads', () => {
    expect(formalizationSchema.safeParse({ quantifiers: [] }).success).toBe(false);
  });

  it('never promotes a model-only proof to verified', () => {
    const proof = { id: 'p', projectId: 'x', sessionId: 's', branchId: null, theorem: 'T', assumptions: [], definitions: [],
      steps: [{ id: '1', title: 'Step', statement: 'S', argument: 'A', dependencies: [], status: 'VALID', verifierComment: 'looks valid', critical: true }],
      edgeCases: [], conclusion: 'T', status: 'VERIFIED', verificationStatus: 'llm-assessed-only', independentlyReviewed: true,
      createdAt: '', updatedAt: '' } satisfies ProofDocument;
    expect(proofVerificationStatus(proof)).toBe('llm-assessed-only');
    expect(canDisplayVerifiedProof(proof)).toBe(false);
  });

  it('normalizes safe provider aliases without changing verification claims', () => {
    const raw = {
      title: 'Gap identified', summary: 'A required lemma remains open.', rationaleSummary: 'The provider used an equivalent node label.',
      proposedNodes: [{ kind: 'GAP', title: 'Missing lemma', statement: 'A bridge lemma is needed.', status: 'GAP' }],
      failures: [{ reason: 'The exhaustive search did not finish.' }],
      toolCalls: [{ name: 'capability_check', purpose: 'Inspect local verifiers', input: {} }],
      nextStage: 'FORMAL_VERIFY', tokenUsage: { input: 0, output: 0, total: 0 },
    };
    const parsed = roleActionSchema.parse(normalizeRoleActionPayload(raw));
    expect(parsed.proposedNodes[0].kind).toBe('PROOF_GAP');
    expect(parsed.failures).toEqual(['The exhaustive search did not finish.']);
    expect(parsed.toolCalls[0].name).toBe('capability_check');
  });

  it('does not coerce unknown node kinds into a valid research claim', () => {
    const raw = {
      title: 'Unknown node', summary: 'The provider used an unsupported label.', rationaleSummary: 'Strict validation remains active.',
      proposedNodes: [{ kind: 'MAGIC_PROOF', title: 'Unsupported', statement: 'No claim is accepted.', status: 'UNKNOWN' }],
      nextStage: 'REFLECT', tokenUsage: { input: 0, output: 0, total: 0 },
    };
    expect(roleActionSchema.safeParse(normalizeRoleActionPayload(raw)).success).toBe(false);
  });
});

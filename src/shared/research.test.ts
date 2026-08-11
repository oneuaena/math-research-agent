import { describe, expect, it } from 'vitest';
import { canDisplayVerifiedProof, chooseNextStage, formalizationSchema, proofVerificationStatus } from './research';
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
});

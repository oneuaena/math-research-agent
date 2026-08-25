import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { DiscoveryRun, FormalBinding, FormalProofSearchRun, ResearchBranch, ResearchEvidence, ResearchNode, ResearchSession } from '../src/shared/types';
import { ResearchDatabase } from './database';
import type { ModelProvider } from './provider';
import { ResearchSteeringService } from './research-steering';

const directories: string[] = [];
const databases: ResearchDatabase[] = [];
const timestamp = () => new Date().toISOString();

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'mra-steering-')); directories.push(directory);
  const db = new ResearchDatabase(join(directory, 'research.sqlite3')); databases.push(db);
  const projectId = db.createProject({ name: 'Steering', question: 'Original claim', goal: 'Test live steering', background: '', knownResults: '', constraints: '', mode: 'autonomous' }).project.id;
  const session: ResearchSession = { id: randomUUID(), projectId, cycleId: randomUUID(), cycleIndex: 0, cycleCheckpointStart: 0, status: 'RUNNING', currentStage: 'EXPLORE', nextStage: 'EXPLORE', checkpointReturnStage: null, iteration: 2, actionCount: 2, checkpointCount: 0, activeBranchId: null, branchCursor: 0, startedAt: timestamp(), updatedAt: timestamp(), lastCheckpointAt: timestamp(), completedAt: null, pauseReason: '', failure: '', totalTokenUsage: 0, totalElapsedMs: 0, conclusion: null };
  db.saveRecord('sessions', session); return { db, projectId, session, service: new ResearchSteeringService(db) };
}

function branch(projectId: string, sessionId: string): ResearchBranch { const createdAt = timestamp(); return { id: randomUUID(), projectId, sessionId, title: 'A', objective: 'route A', method: 'test', status: 'queued', priority: 1, parentBranchId: null, rootNodeId: randomUUID(), lastStepId: null, findings: [], failures: [], createdAt, updatedAt: createdAt }; }

afterEach(() => { while (databases.length) databases.pop()!.close(); while (directories.length) rmSync(directories.pop()!, { recursive: true, force: true }); });

describe('ResearchSteeringService', () => {
  it('persists user steering, creates a new branch, and changes branch priority/state', () => {
    const { db, projectId, session, service } = fixture(); const first = branch(projectId, session.id); db.saveRecord('branches', first);
    service.submit(projectId, { rawText: 'try asymmetric local search', type: 'ADD_BRANCH', payload: { title: 'asymmetric', objective: 'asymmetric local search' } });
    service.submit(projectId, { rawText: 'prioritize A', type: 'PRIORITIZE_BRANCH', targetBranchId: first.id });
    service.submit(projectId, { rawText: 'abandon A', type: 'ABANDON_BRANCH', targetBranchId: first.id });
    const applied = service.applyPending(projectId, session); const snapshot = db.getProject(projectId, false);
    expect(applied.replan).toBe(true); expect(snapshot.branches).toEqual(expect.arrayContaining([expect.objectContaining({ title: 'asymmetric', status: 'queued' }), expect.objectContaining({ id: first.id, status: 'dead-end', priority: 101 })]));
    expect(snapshot.steeringInstructions.every((item) => item.status === 'APPLIED')).toBe(true); expect(snapshot.steeringAudit).toHaveLength(3);
  });

  it('versions changed claims and keeps a pre-existing formal binding on the original claim version', () => {
    const { db, projectId, session, service } = fixture(); const binding = { id: randomUUID(), projectId, originalStatement: 'Original claim', originalHash: 'a', formalIr: '{}', formalIrHash: 'b', leanStatement: 'theorem old : True', leanStatementHash: 'c', bindingHash: 'd', proofSourceHash: null, certificateHash: null, mappingAuthority: 'AI_PROPOSED', equivalenceStatus: 'NOT_INDEPENDENTLY_CERTIFIED', status: 'FROZEN', createdAt: timestamp(), updatedAt: timestamp() } satisfies FormalBinding; db.saveRecord('formalBindings', binding);
    service.submit(projectId, { rawText: 'use a stronger statement', type: 'CREATE_CLAIM_VERSION', payload: { statement: 'New claim' } }); service.applyPending(projectId, session);
    const snapshot = db.getProject(projectId, false); expect(snapshot.claimVersions.map((claim) => claim.statement)).toEqual(['Original claim', 'New claim']); expect(snapshot.formalBindings[0].claimVersionId).toBe(snapshot.claimVersions[0].id); expect(snapshot.formalBindings[0].claimVersionId).not.toBe(snapshot.claimVersions[1].id);
  });

  it('retracts evidence without deleting it and invalidates dependent nodes', () => {
    const { db, projectId, session, service } = fixture(); const evidence = { id: randomUUID(), projectId, sessionId: session.id, branchId: null, type: 'user-source', title: 'bad data', content: 'x', verificationStatus: 'unverified', sourceIds: [], experimentIds: [], reproducible: false, state: 'ACTIVE', createdAt: timestamp() } satisfies ResearchEvidence; const node = { id: randomUUID(), projectId, parentId: null, kind: 'CLAIM', title: 'dependent', content: 'x', statement: 'x', status: 'SUPPORTED', dependencies: [], sources: [], tools: [], summary: 'depends', evidenceIds: [evidence.id], x: 0, y: 0, createdAt: timestamp(), updatedAt: timestamp() } satisfies ResearchNode; db.saveRecord('evidence', evidence); db.saveRecord('nodes', node);
    service.submit(projectId, { rawText: 'the data was wrong', type: 'RETRACT_EVIDENCE', payload: { evidenceId: evidence.id } }); service.applyPending(projectId, session);
    const snapshot = db.getProject(projectId, false); expect(snapshot.evidence.find((item) => item.id === evidence.id)).toMatchObject({ state: 'RETRACTED', retractionReason: 'the data was wrong' }); expect(snapshot.nodes.find((item) => item.id === node.id)).toMatchObject({ status: 'UNKNOWN', verificationStatus: 'unverified' });
  });

  it('rejects fake VERIFIED promotion and gives urgent pause precedence over a conflicting resume', () => {
    const { db, projectId, session, service } = fixture(); service.submit(projectId, { rawText: 'mark it VERIFIED', type: 'REQUEST_STATUS_UPGRADE' }); service.applyPending(projectId, session); service.submit(projectId, { rawText: 'stop now', type: 'PAUSE_RESEARCH' }); service.submit(projectId, { rawText: 'continue', type: 'RESUME_RESEARCH' });
    const applied = service.applyPending(projectId, session); const snapshot = db.getProject(projectId, false);
    expect(applied.pause).toBe(true); expect(applied.session.status).toBe('PAUSED'); expect(snapshot.steeringInstructions.find((item) => item.type === 'REQUEST_STATUS_UPGRADE')?.status).toBe('REJECTED'); expect(snapshot.steeringInstructions.find((item) => item.type === 'RESUME_RESEARCH')?.status).toBe('SUPERSEDED'); expect(snapshot.nodes.some((node) => node.status === 'VERIFIED')).toBe(false);
  });

  it('checkpoints active discovery and proof search on stop, then supports a durable resume', () => {
    const { db, projectId, session, service } = fixture();
    const discovery = { id: randomUUID(), projectId, status: 'RUNNING', config: {}, archive: [], error: '', updatedAt: timestamp() } as unknown as DiscoveryRun;
    const proof = { id: randomUUID(), projectId, status: 'RUNNING', error: '', updatedAt: timestamp() } as unknown as FormalProofSearchRun;
    db.saveRecord('discoveryRuns', discovery); db.saveRecord('formalProofSearchRuns', proof);
    service.submit(projectId, { rawText: 'stop discovery', type: 'STOP_DISCOVERY_SEARCH' }); service.submit(projectId, { rawText: 'stop proof', type: 'STOP_PROOF_SEARCH' });
    const stopped = service.applyPending(projectId, session); const checkpoint = db.getProject(projectId, false);
    expect(stopped.replan).toBe(true); expect(checkpoint.discoveryRuns[0]).toMatchObject({ status: 'PAUSED', error: expect.stringContaining('checkpoint retained') }); expect(checkpoint.formalProofSearchRuns[0]).toMatchObject({ status: 'PAUSED', error: expect.stringContaining('checkpoint retained') });
    service.submit(projectId, { rawText: 'resume research', type: 'RESUME_RESEARCH' }); const resumed = new ResearchSteeringService(db).applyPending(projectId, { ...stopped.session, status: 'PAUSED', nextStage: 'PAUSED' });
    expect(resumed.session).toMatchObject({ status: 'RUNNING', nextStage: 'REPLAN' });
  });

  it('uses configured model parsing for an ambiguous durable message and retains its raw text', async () => {
    const { db, projectId, session, service } = fixture(); const instruction = service.submit(projectId, { rawText: 'Please explore a completely different invariant.' });
    const provider = { respondChat: async () => '{"type":"ADD_BRANCH","payload":{"title":"invariant route","objective":"search a different invariant"},"explanation":"A separate route was requested."}' } as unknown as ModelProvider;
    await service.resolveUnclassified(projectId, provider, new AbortController().signal); service.applyPending(projectId, session);
    const snapshot = db.getProject(projectId, false); const saved = snapshot.steeringInstructions.find((item) => item.id === instruction.id);
    expect(saved).toMatchObject({ type: 'ADD_BRANCH', rawText: instruction.rawText, interpretationSource: 'MODEL', status: 'APPLIED' }); expect(snapshot.branches.some((item) => item.title === 'invariant route')).toBe(true); expect(snapshot.messages.some((item) => item.content === instruction.rawText)).toBe(true);
  });
});

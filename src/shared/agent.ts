import type { AgentStage } from './types';

export const AGENT_STAGES: AgentStage[] = ['PARSE', 'PLAN_ATTACKS', 'SMALL_CASES', 'BOUNDARY', 'SYMBOLIC', 'EXTREMAL', 'VERIFY_CANDIDATE', 'EXPAND', 'SUMMARIZE', 'COMPLETE'];

export function nextAgentStage(stage: AgentStage): AgentStage {
  const index = AGENT_STAGES.indexOf(stage);
  return AGENT_STAGES[Math.min(index + 1, AGENT_STAGES.length - 1)];
}

export const STAGE_LABELS: Record<AgentStage, string> = {
  INITIALIZE: 'Initializing persistent research session',
  FORMALIZE: 'Structuring the mathematical specification',
  LITERATURE: 'Reviewing imported literature evidence',
  PATTERN_DISCOVERY: 'Searching for mathematical patterns',
  LEMMA_GENERATION: 'Generating candidate lemmas',
  PROOF_ATTEMPT: 'Building a structured proof attempt',
  PROOF_CRITIQUE: 'Critiquing proof steps independently',
  COUNTEREXAMPLE_SEARCH: 'Searching for counterexamples',
  SYMBOLIC_VERIFY: 'Running symbolic verification',
  FORMAL_VERIFY: 'Checking formal-verifier capabilities',
  REFLECT: 'Reflecting on gaps and evidence',
  REPLAN: 'Replanning research branches',
  CHECKPOINT: 'Saving a recoverable checkpoint',
  PAUSED: 'Research session paused',
  FAILED: 'Research session failed',
  PARSE: 'Parsing conjecture',
  PLAN_ATTACKS: 'Generating attack strategies',
  SMALL_CASES: 'Testing small cases',
  BOUNDARY: 'Searching boundary conditions',
  SYMBOLIC: 'Running symbolic checks',
  EXTREMAL: 'Exploring extremal examples',
  VERIFY_CANDIDATE: 'Verifying candidate',
  EXPAND: 'Expanding search region',
  SUMMARIZE: 'Recording search coverage',
  UNDERSTAND: 'Analyzing assumptions',
  PLAN: 'Building research routes',
  EXPLORE: 'Exploring candidate routes',
  EXPERIMENT: 'Running mathematical checks',
  VERIFY: 'Verifying dependencies',
  CRITIQUE: 'Testing logical weak points',
  REFINE: 'Refining the surviving route',
  SYNTHESIZE: 'Synthesizing research record',
  COMPLETE: 'Research run complete',
};

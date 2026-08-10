import { describe, expect, it } from 'vitest';
import { AGENT_STAGES, nextAgentStage } from './agent';

describe('research stage machine', () => {
  it('advances through the complete ordered lifecycle', () => {
    let stage = AGENT_STAGES[0];
    const visited = [stage];
    while (stage !== 'COMPLETE') {
      stage = nextAgentStage(stage);
      visited.push(stage);
    }
    expect(visited).toEqual(AGENT_STAGES);
  });

  it('keeps COMPLETE terminal', () => {
    expect(nextAgentStage('COMPLETE')).toBe('COMPLETE');
  });
});

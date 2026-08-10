import type { CreateProjectInput } from './types';

export interface DemoCase { id: 'A' | 'B' | 'C'; label: string; description: string; input: CreateProjectInput; }

export const DEMO_CASES: DemoCase[] = [
  {
    id: 'A', label: 'A · Early counterexample', description: 'A false primality claim; the first counterexample is n = 4.',
    input: {
      name: 'Quadratic primality · early failure',
      question: 'For every integer n ≥ 1, n² + n + 1 is prime.',
      goal: 'Stress test', background: '', knownResults: '', constraints: 'Use exact integer arithmetic.',
      variables: 'n', domain: 'Integers n ≥ 1', assumptions: 'n is an integer and n ≥ 1', notes: '', mode: 'stress-test', demoCaseId: 'A',
    },
  },
  {
    id: 'B', label: 'B · Expanded search', description: 'Euler’s polynomial survives n = 0…39 and fails at n = 40.',
    input: {
      name: 'Euler polynomial primality',
      question: 'For every integer n ≥ 0, n² + n + 41 is prime.',
      goal: 'Stress test', background: '', knownResults: '', constraints: 'Use exact integer arithmetic and factor the first candidate.',
      variables: 'n', domain: 'Integers n ≥ 0', assumptions: 'n is an integer and n ≥ 0', notes: '', mode: 'stress-test', demoCaseId: 'B',
    },
  },
  {
    id: 'C', label: 'C · Survived testing', description: 'A parity claim with no counterexample in the bounded search.',
    input: {
      name: 'Consecutive-product parity',
      question: 'For every integer n, n(n + 1) is even.',
      goal: 'Stress test', background: '', knownResults: '', constraints: 'Search exact integers; do not treat survival as proof.',
      variables: 'n', domain: 'All integers', assumptions: 'n is an integer', notes: '', mode: 'stress-test', demoCaseId: 'C',
    },
  },
];

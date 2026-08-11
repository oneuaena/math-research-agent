const EMBEDDING_DIMENSIONS = 96;

export function embedText(text: string): number[] {
  const vector = Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  for (const token of retrievalTerms(text)) {
    const hash = fnv1a(token);
    const index = hash % EMBEDDING_DIMENSIONS;
    vector[index] += (hash & 1) === 0 ? 1 : -1;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return norm > 0 ? vector.map((value) => value / norm) : vector;
}

export function cosineSimilarity(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length);
  let score = 0;
  for (let index = 0; index < length; index += 1) score += left[index] * right[index];
  return Math.max(-1, Math.min(1, score));
}

export function lexicalSimilarity(text: string, query: string): number {
  const terms = retrievalTerms(query);
  if (terms.length === 0) return 0;
  const lower = text.toLowerCase();
  const matches = terms.filter((term) => lower.includes(term)).length;
  return matches / terms.length;
}

export function retrievalTerms(value: string): string[] {
  const lower = value.toLowerCase();
  const words = lower.match(/[a-z0-9_]{2,}/g) ?? [];
  const cjk = [...lower].filter((character) => /[\u3400-\u9fff]/.test(character));
  const pairs = cjk.slice(0, -1).map((character, index) => `${character}${cjk[index + 1]}`);
  return [...new Set([...words, ...pairs])].slice(0, 300);
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

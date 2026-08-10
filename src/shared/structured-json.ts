export interface StructuredJsonResult {
  value: unknown;
  jsonText: string;
  strategy: 'direct' | 'code-fence' | 'balanced-extraction';
}

function objectOrArray(value: unknown): boolean {
  return value !== null && typeof value === 'object';
}

function parseCandidate(candidate: string): unknown | null {
  try {
    const value = JSON.parse(candidate);
    return objectOrArray(value) ? value : null;
  } catch {
    return null;
  }
}

function balancedCandidates(text: string): string[] {
  const candidates: string[] = [];
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== '{' && text[start] !== '[') continue;
    const stack: string[] = [];
    let inString = false;
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
      const character = text[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') { inString = true; continue; }
      if (character === '{') stack.push('}');
      else if (character === '[') stack.push(']');
      else if (character === '}' || character === ']') {
        if (stack.at(-1) !== character) break;
        stack.pop();
        if (stack.length === 0) {
          candidates.push(text.slice(start, index + 1));
          break;
        }
      }
    }
  }
  return candidates;
}

export function extractStructuredJson(text: string): StructuredJsonResult | null {
  const trimmed = text.trim();
  const direct = parseCandidate(trimmed);
  if (direct !== null) return { value: direct, jsonText: trimmed, strategy: 'direct' };

  const fences = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  for (const match of fences) {
    const candidate = match[1].trim();
    const value = parseCandidate(candidate);
    if (value !== null) return { value, jsonText: candidate, strategy: 'code-fence' };
  }

  const candidates = balancedCandidates(trimmed);
  const startsWithStructure = trimmed.startsWith('{') || trimmed.startsWith('[');
  const eligible = startsWithStructure ? candidates.filter((candidate) => trimmed.startsWith(candidate)) : candidates;
  for (const candidate of eligible) {
    const value = parseCandidate(candidate);
    if (value !== null) return { value, jsonText: candidate, strategy: 'balanced-extraction' };
  }
  return null;
}

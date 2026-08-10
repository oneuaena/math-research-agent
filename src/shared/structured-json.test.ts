import { describe, expect, it } from 'vitest';
import { extractStructuredJson } from './structured-json';

describe('structured model JSON extraction', () => {
  it('parses direct JSON', () => {
    expect(extractStructuredJson('{"ok":true}')).toMatchObject({ value: { ok: true }, strategy: 'direct' });
  });

  it('extracts JSON from a code fence', () => {
    expect(extractStructuredJson('result:\n```json\n{"ok":true}\n```')).toMatchObject({ value: { ok: true }, strategy: 'code-fence' });
  });

  it('extracts a balanced object while respecting braces inside strings', () => {
    expect(extractStructuredJson('prefix {"text":"a } brace","items":[1,2]} suffix')).toMatchObject({
      value: { text: 'a } brace', items: [1, 2] }, strategy: 'balanced-extraction',
    });
  });

  it('does not pretend a truncated object is valid JSON', () => {
    expect(extractStructuredJson('{"title":"partial","items":[')).toBeNull();
    expect(extractStructuredJson('{"title":"partial","item":{"valid":"but nested"},"items":[')).toBeNull();
  });
});

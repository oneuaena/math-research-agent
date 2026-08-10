import { describe, expect, it } from 'vitest';
import { parseProviderHttpResponse, ProviderTransportError } from './provider-transport';
import { normalizeProviderResponse } from './provider-protocol';

describe('provider HTTP transport integration', () => {
  it('parses a complete JSON response', () => {
    const data = parseProviderHttpResponse({ status: 200, contentType: 'application/json', body: '{"choices":[{"message":{"content":"ok"},"finish_reason":"stop"}]}' });
    expect(normalizeProviderResponse(data).content).toBe('ok');
  });

  it('assembles SSE content and reasoning chunks through [DONE]', () => {
    const body = [
      'data: {"model":"deepseek","choices":[{"index":0,"delta":{"role":"assistant","reasoning_content":"think "},"finish_reason":null}]}', '',
      'data: {"choices":[{"index":0,"delta":{"reasoning_content":"more","content":"hel"},"finish_reason":null}]}', '',
      'data: {"choices":[{"index":0,"delta":{"content":"lo"},"finish_reason":"stop"}]}', '',
      'data: [DONE]', '',
    ].join('\n');
    const turn = normalizeProviderResponse(parseProviderHttpResponse({ status: 200, contentType: 'text/event-stream', body }));
    expect(turn.content).toBe('hello');
    expect(turn.reasoningContent).toBe('think more');
  });

  it('assembles multi-chunk tool call names and arguments', () => {
    const body = [
      'data: {"choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"run_python","arguments":"{\\"code\\":"}}]},"finish_reason":null}]}', '',
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"result=1\\"}"}}]},"finish_reason":"tool_calls"}]}', '',
      'data: [DONE]', '',
    ].join('\n');
    const turn = normalizeProviderResponse(parseProviderHttpResponse({ status: 200, contentType: 'text/event-stream; charset=utf-8', body }));
    expect(turn.toolCalls[0]).toMatchObject({ id: 'call_1', function: { name: 'run_python', arguments: '{"code":"result=1"}' } });
  });

  it('rejects truncated HTTP JSON as a transient transport error', () => {
    expect(() => parseProviderHttpResponse({ status: 200, contentType: 'application/json', body: '{"choices":[' }))
      .toThrowError(expect.objectContaining({ code: 'TRUNCATED_RESPONSE', details: expect.objectContaining({ transient: true }) }));
  });

  it('rejects an empty body as a transient transport error', () => {
    expect(() => parseProviderHttpResponse({ status: 200, contentType: 'application/json', body: '  ' }))
      .toThrowError(expect.objectContaining({ code: 'EMPTY_RESPONSE' }));
  });

  it('retains a 429 JSON error body and marks it transient', () => {
    try {
      parseProviderHttpResponse({ status: 429, contentType: 'application/json', body: '{"error":{"message":"rate limited"}}' });
      throw new Error('Expected an HTTP error.');
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderTransportError);
      expect(error).toMatchObject({ code: 'HTTP_STATUS', details: { status: 429, transient: true, parsedBody: { error: { message: 'rate limited' } } } });
    }
  });

  it('retains a 5xx HTML gateway response and marks it transient', () => {
    expect(() => parseProviderHttpResponse({ status: 503, contentType: 'text/html', body: '<html>gateway unavailable</html>' }))
      .toThrowError(expect.objectContaining({ code: 'HTTP_STATUS', details: expect.objectContaining({ status: 503, transient: true }) }));
  });
});

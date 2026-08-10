import { describe, expect, it } from 'vitest';
import {
  normalizeProviderResponse, ProviderProtocolError, runProviderToolLoop, type ProviderConversationMessage,
  type ProviderRequestControl,
} from './provider-protocol';

const normalText = {
  model: 'deepseek-v4-flash',
  choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'hello' } }],
  usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
};

const toolCall = {
  model: 'deepseek-v4-flash',
  choices: [{
    finish_reason: 'tool_calls',
    message: {
      role: 'assistant',
      content: null,
      reasoning_content: 'private tool planning',
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'run_python', arguments: '{"code":"print(1)"}' } }],
    },
  }],
};

describe('provider response normalization', () => {
  it('normalizes a standard Chat Completions text response', () => {
    const turn = normalizeProviderResponse(normalText);
    expect(turn.content).toBe('hello');
    expect(turn.responseFormat).toBe('chat-completions');
    expect(turn.usage.total).toBe(14);
  });

  it('keeps reasoning metadata while preferring the final content', () => {
    const turn = normalizeProviderResponse({
      choices: [{ finish_reason: 'stop', message: { content: 'final answer', reasoning: 'private analysis' } }],
    });
    expect(turn.content).toBe('final answer');
    expect(turn.reasoningContentPresent).toBe(true);
    expect(turn.reasoningOnly).toBe(false);
  });

  it('normalizes nullable content with native tool calls', () => {
    const turn = normalizeProviderResponse(toolCall);
    expect(turn.content).toBe('');
    expect(turn.toolCalls[0].function.name).toBe('run_python');
    expect(turn.message.reasoning_content).toBe('private tool planning');
  });

  it('treats empty content plus reasoning_content as recoverable instead of malformed', () => {
    const turn = normalizeProviderResponse({
      choices: [{ finish_reason: 'length', message: { content: null, reasoning_content: 'analysis stopped before final' } }],
    });
    expect(turn.reasoningOnly).toBe(true);
    expect(turn.content).toBe('');
  });

  it('uses a valid structured result found in reasoning_content', () => {
    const turn = normalizeProviderResponse({
      choices: [{ finish_reason: 'length', message: { content: null, reasoning_content: 'Result:\n```json\n{"ok":true}\n```' } }],
    });
    expect(turn.content).toBe('{"ok":true}');
    expect(turn.contentSource).toBe('reasoning_content');
  });

  it('normalizes Responses API output text and function calls', () => {
    const textTurn = normalizeProviderResponse({
      object: 'response', model: 'gpt-5', status: 'completed',
      output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'response text' }] }],
      usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
    });
    expect(textTurn.content).toBe('response text');
    expect(textTurn.responseFormat).toBe('responses-api');

    const toolTurn = normalizeProviderResponse({
      object: 'response', status: 'in_progress',
      output: [{ type: 'function_call', call_id: 'fc_1', name: 'run_python', arguments: { code: 'result=1' } }],
    });
    expect(toolTurn.toolCalls[0]).toMatchObject({ id: 'fc_1', function: { name: 'run_python' } });
  });

  it('normalizes allowlisted provider-specific text fields', () => {
    const turn = normalizeProviderResponse({ model: 'custom', data: { answer: 'provider answer' } });
    expect(turn.content).toBe('provider answer');
    expect(turn.responseFormat).toBe('provider-specific');
  });

  it('preserves reasoning_content through the complete tool loop', async () => {
    const requests: ProviderConversationMessage[][] = [];
    const final = await runProviderToolLoop({
      messages: [{ role: 'user', content: 'Use the tool and finish.' }],
      request: async (messages) => {
        requests.push(structuredClone(messages));
        return requests.length === 1 ? toolCall : normalText;
      },
      execute: async (_call, args) => ({ result: { ok: true }, toolMessage: JSON.stringify({ ok: true, args }) }),
    });
    expect(final.content).toBe('hello');
    expect(final.executions).toHaveLength(1);
    expect(requests[1][1]).toMatchObject({ role: 'assistant', content: null, reasoning_content: 'private tool planning' });
    expect(requests[1][2]).toMatchObject({ role: 'tool', tool_call_id: 'call_1' });
  });

  it('recovers a reasoning-only response with thinking and tools disabled', async () => {
    const controls: ProviderRequestControl[] = [];
    const final = await runProviderToolLoop({
      messages: [{ role: 'user', content: 'Return JSON.' }],
      request: async (_messages, control) => {
        controls.push(control);
        return controls.length === 1
          ? { choices: [{ finish_reason: 'length', message: { content: null, reasoning_content: 'unfinished reasoning' } }] }
          : { choices: [{ finish_reason: 'stop', message: { content: '{"done":true}' } }] };
      },
      execute: async () => ({ result: null, toolMessage: '' }),
    });
    expect(final.content).toBe('{"done":true}');
    expect(controls[1]).toMatchObject({ toolsEnabled: false, disableThinking: true, reason: 'reasoning-recovery' });
  });

  it('retries malformed responses only a finite number of times and reports their schema', async () => {
    let calls = 0;
    await expect(runProviderToolLoop({
      messages: [{ role: 'user', content: 'Return output.' }],
      request: async () => { calls += 1; return { unexpected: { value: 1 } }; },
      execute: async () => ({ result: null, toolMessage: '' }),
      maxRecoveryAttempts: 2,
    })).rejects.toThrow(ProviderProtocolError);
    expect(calls).toBe(3);
    expect(() => normalizeProviderResponse({ unexpected: { value: 1 } })).toThrow('$.unexpected');
  });
});

type UnknownRecord = Record<string, unknown>;

export type ProviderTransportErrorCode = 'EMPTY_RESPONSE' | 'TRUNCATED_RESPONSE' | 'SSE_ERROR' | 'HTML_RESPONSE' | 'HTTP_STATUS';

export class ProviderTransportError extends Error {
  constructor(
    readonly code: ProviderTransportErrorCode,
    message: string,
    readonly details: {
      status: number;
      contentType: string;
      body: string;
      parsedBody?: unknown;
      transient: boolean;
    },
  ) {
    super(message);
    this.name = 'ProviderTransportError';
  }
}

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
}

function parseJson(body: string): unknown {
  try { return JSON.parse(body); }
  catch {
    throw new Error('invalid-json');
  }
}

function ssePayloads(body: string): { payloads: unknown[]; done: boolean } {
  const payloads: unknown[] = [];
  let dataLines: string[] = [];
  let done = false;
  const flush = (): void => {
    if (dataLines.length === 0) return;
    const data = dataLines.join('\n').trim();
    dataLines = [];
    if (!data) return;
    if (data === '[DONE]') { done = true; return; }
    try { payloads.push(JSON.parse(data)); }
    catch { throw new Error('invalid-sse-json'); }
  };
  for (const rawLine of body.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')) {
    if (!rawLine) { flush(); continue; }
    if (rawLine.startsWith(':')) continue;
    if (rawLine.startsWith('data:')) dataLines.push(rawLine.slice(5).replace(/^ /, ''));
  }
  flush();
  return { payloads, done };
}

function mergeChatChunks(chunks: UnknownRecord[], done: boolean): unknown | null {
  const choices = new Map<number, {
    content: string;
    reasoning: string;
    role: string;
    finishReason: string | null;
    tools: Map<number, { id: string; type: string; name: string; arguments: string }>;
  }>();
  let recognized = false;
  let model = '';
  let id = '';
  let objectType = 'chat.completion';
  let usage: unknown;

  for (const chunk of chunks) {
    if (!Array.isArray(chunk.choices)) continue;
    recognized = true;
    model ||= typeof chunk.model === 'string' ? chunk.model : '';
    id ||= typeof chunk.id === 'string' ? chunk.id : '';
    objectType = typeof chunk.object === 'string' ? chunk.object.replace('.chunk', '') : objectType;
    if (chunk.usage) usage = chunk.usage;
    for (const rawChoice of chunk.choices) {
      const choice = record(rawChoice);
      if (!choice) continue;
      const index = typeof choice.index === 'number' ? choice.index : 0;
      const target = choices.get(index) ?? { content: '', reasoning: '', role: 'assistant', finishReason: null, tools: new Map() };
      const delta = record(choice.delta) ?? record(choice.message) ?? {};
      if (typeof delta.role === 'string') target.role = delta.role;
      if (typeof delta.content === 'string') target.content += delta.content;
      if (typeof delta.reasoning_content === 'string') target.reasoning += delta.reasoning_content;
      else if (typeof delta.reasoning === 'string') target.reasoning += delta.reasoning;
      if (typeof choice.finish_reason === 'string') target.finishReason = choice.finish_reason;
      if (Array.isArray(delta.tool_calls)) {
        for (let position = 0; position < delta.tool_calls.length; position += 1) {
          const rawTool = record(delta.tool_calls[position]);
          if (!rawTool) continue;
          const toolIndex = typeof rawTool.index === 'number' ? rawTool.index : position;
          const fn = record(rawTool.function) ?? {};
          const tool = target.tools.get(toolIndex) ?? { id: '', type: 'function', name: '', arguments: '' };
          if (typeof rawTool.id === 'string') tool.id ||= rawTool.id;
          if (typeof rawTool.type === 'string') tool.type = rawTool.type;
          if (typeof fn.name === 'string') {
            if (!tool.name) tool.name = fn.name;
            else if (fn.name !== tool.name && !tool.name.endsWith(fn.name)) tool.name += fn.name;
          }
          if (typeof fn.arguments === 'string') tool.arguments += fn.arguments;
          target.tools.set(toolIndex, tool);
        }
      }
      choices.set(index, target);
    }
  }
  if (!recognized) return null;
  const complete = done || [...choices.values()].every((choice) => Boolean(choice.finishReason));
  if (!complete) throw new Error('incomplete-sse');
  return {
    id,
    object: objectType,
    model,
    choices: [...choices.entries()].sort(([a], [b]) => a - b).map(([index, choice]) => ({
      index,
      finish_reason: choice.finishReason,
      message: {
        role: choice.role,
        content: choice.content,
        ...(choice.reasoning ? { reasoning_content: choice.reasoning } : {}),
        ...(choice.tools.size ? {
          tool_calls: [...choice.tools.entries()].sort(([a], [b]) => a - b).map(([, tool], position) => ({
            id: tool.id || `sse_call_${position + 1}`,
            type: tool.type || 'function',
            function: { name: tool.name, arguments: tool.arguments },
          })),
        } : {}),
      },
    })),
    ...(usage ? { usage } : {}),
  };
}

function mergeResponsesEvents(events: UnknownRecord[], done: boolean): unknown | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    const response = record(event.response);
    if (response && (event.type === 'response.completed' || response.status === 'completed')) return response;
  }
  if (!events.some((event) => typeof event.type === 'string' && event.type.startsWith('response.'))) return null;
  let outputText = '';
  let reasoningText = '';
  let model = '';
  let responseId = '';
  let completed = done;
  let usage: unknown;
  const functionCalls = new Map<string, { id: string; call_id: string; name: string; arguments: string; type: 'function_call' }>();
  for (const event of events) {
    const type = typeof event.type === 'string' ? event.type : '';
    if (type === 'response.output_text.delta' && typeof event.delta === 'string') outputText += event.delta;
    if ((type === 'response.reasoning_text.delta' || type === 'response.reasoning_summary_text.delta') && typeof event.delta === 'string') reasoningText += event.delta;
    if (type === 'response.completed') completed = true;
    const response = record(event.response);
    if (response) {
      model ||= typeof response.model === 'string' ? response.model : '';
      responseId ||= typeof response.id === 'string' ? response.id : '';
      if (response.usage) usage = response.usage;
    }
    const item = record(event.item);
    if (item?.type === 'function_call') {
      const key = typeof item.id === 'string' ? item.id : typeof item.call_id === 'string' ? item.call_id : `call_${functionCalls.size + 1}`;
      functionCalls.set(key, {
        id: key,
        call_id: typeof item.call_id === 'string' ? item.call_id : key,
        name: typeof item.name === 'string' ? item.name : '',
        arguments: typeof item.arguments === 'string' ? item.arguments : '',
        type: 'function_call',
      });
    }
    if (type === 'response.function_call_arguments.delta' && typeof event.delta === 'string') {
      const key = typeof event.item_id === 'string' ? event.item_id : typeof event.call_id === 'string' ? event.call_id : `call_${String(event.output_index ?? 0)}`;
      const call = functionCalls.get(key) ?? { id: key, call_id: key, name: '', arguments: '', type: 'function_call' as const };
      call.arguments += event.delta;
      functionCalls.set(key, call);
    }
  }
  if (!completed) throw new Error('incomplete-sse');
  return {
    id: responseId,
    object: 'response',
    status: 'completed',
    model,
    output: [
      ...(reasoningText ? [{ type: 'reasoning', summary: [{ type: 'summary_text', text: reasoningText }] }] : []),
      ...(outputText ? [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: outputText }] }] : []),
      ...functionCalls.values(),
    ],
    ...(usage ? { usage } : {}),
  };
}

function parseSse(body: string): unknown {
  let parsed: { payloads: unknown[]; done: boolean };
  try { parsed = ssePayloads(body); }
  catch { throw new Error('invalid-sse-json'); }
  if (parsed.payloads.length === 0) throw new Error('empty-sse');
  const records = parsed.payloads.map(record).filter((item): item is UnknownRecord => Boolean(item));
  const chat = mergeChatChunks(records, parsed.done);
  if (chat) return chat;
  const responses = mergeResponsesEvents(records, parsed.done);
  if (responses) return responses;
  if (!parsed.done) throw new Error('incomplete-sse');
  return records.at(-1)!;
}

function parseSuccessfulBody(status: number, contentType: string, body: string): unknown {
  const trimmed = body.trim();
  if (!trimmed) throw new ProviderTransportError('EMPTY_RESPONSE', 'Provider returned an empty response body.', { status, contentType, body, transient: true });
  if (/text\/event-stream/i.test(contentType) || /^data:/m.test(trimmed)) {
    try { return parseSse(trimmed); }
    catch (error) {
      const message = error instanceof Error && error.message === 'incomplete-sse'
        ? 'Provider SSE stream ended before [DONE] or a terminal finish reason.'
        : 'Provider returned malformed SSE data.';
      throw new ProviderTransportError('SSE_ERROR', message, { status, contentType, body, transient: true });
    }
  }
  if (/text\/html/i.test(contentType) || /^\s*<!doctype html|^\s*<html/i.test(trimmed)) {
    throw new ProviderTransportError('HTML_RESPONSE', 'Provider returned an HTML response instead of API JSON.', { status, contentType, body, transient: true });
  }
  try { return parseJson(trimmed); }
  catch {
    throw new ProviderTransportError('TRUNCATED_RESPONSE', 'Provider returned incomplete or malformed HTTP JSON.', { status, contentType, body, transient: true });
  }
}

export function parseProviderHttpResponse(input: { status: number; contentType: string; body: string }): unknown {
  if (input.status >= 400) {
    let parsedBody: unknown;
    try { parsedBody = parseSuccessfulBody(input.status, input.contentType, input.body); }
    catch { parsedBody = undefined; }
    throw new ProviderTransportError('HTTP_STATUS', `Provider returned HTTP ${input.status}.`, {
      ...input,
      parsedBody,
      transient: input.status === 429 || input.status >= 500,
    });
  }
  return parseSuccessfulBody(input.status, input.contentType, input.body);
}

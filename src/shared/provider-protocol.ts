type UnknownRecord = Record<string, unknown>;

export interface ProviderToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ProviderAssistantMessage extends UnknownRecord {
  role: 'assistant';
  content: string | Array<UnknownRecord> | null;
  reasoning_content?: string | null;
  tool_calls?: ProviderToolCall[];
}

export type ProviderConversationMessage =
  | { role: 'system' | 'user'; content: string }
  | ProviderAssistantMessage
  | { role: 'tool'; tool_call_id: string; content: string };

export type ProviderResponseFormat = 'chat-completions' | 'responses-api' | 'provider-specific';
export type ProviderContentSource = 'message.content' | 'output_text' | 'output.content' | 'provider-text' | 'reasoning_content' | 'none';

export interface ParsedProviderTurn {
  content: string;
  contentSource: ProviderContentSource;
  finishReason: string | null;
  message: ProviderAssistantMessage;
  model: string;
  reasoningContent: string;
  reasoningContentPresent: boolean;
  reasoningOnly: boolean;
  responseFormat: ProviderResponseFormat;
  schemaFields: string[];
  toolCalls: ProviderToolCall[];
  usage: { input: number; output: number; total: number };
}

export interface ProviderRequestControl {
  toolsEnabled: boolean;
  disableThinking: boolean;
  reason: 'normal' | 'reasoning-recovery' | 'malformed-recovery' | 'tool-budget-finalization';
  attempt: number;
}

export interface ProviderToolExecution<T = unknown> {
  call: ProviderToolCall;
  arguments: Record<string, unknown>;
  result: T;
  toolMessage: string;
}

export interface ProviderResponseShape {
  finishReason: string | null;
  hasContent: boolean;
  hasReasoningContent: boolean;
  toolCallCount: number;
  responseFormat: ProviderResponseFormat;
  contentSource: ProviderContentSource;
  schemaFields: string[];
}

export interface ProviderToolLoopResult<T = unknown> extends ParsedProviderTurn {
  executions: ProviderToolExecution<T>[];
  rounds: number;
  responseShapes: ProviderResponseShape[];
}

export class ProviderProtocolError extends Error {
  constructor(message: string, readonly schemaFields: string[] = []) {
    super(message);
    this.name = 'ProviderProtocolError';
  }
}

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function textFromContent(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  const objectValue = record(value);
  if (objectValue) return stringValue(objectValue.text) || stringValue(objectValue.output_text) || textFromContent(objectValue.content);
  if (!Array.isArray(value)) return '';
  return value.map((part) => {
    if (typeof part === 'string') return part;
    const item = record(part);
    if (!item) return '';
    return stringValue(item.text) || stringValue(item.output_text) || textFromContent(item.content);
  }).join('').trim();
}

function reasoningText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  const objectValue = record(value);
  if (objectValue) return textFromContent(objectValue.summary) || textFromContent(objectValue.content) || stringValue(objectValue.text);
  return textFromContent(value);
}

function jsonArguments(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') return JSON.stringify(value);
  return '{}';
}

function toolCallsFrom(value: unknown, prefix: string): ProviderToolCall[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw, index) => {
    const item = record(raw);
    if (!item) return [];
    const fn = record(item.function);
    const name = stringValue(fn?.name) || stringValue(item.name);
    if (!name) return [];
    return [{
      id: stringValue(item.id) || stringValue(item.call_id) || `${prefix}_${index + 1}`,
      type: 'function' as const,
      function: {
        name,
        arguments: jsonArguments(fn?.arguments ?? item.arguments ?? item.input),
      },
    }];
  });
}

function outputItems(raw: UnknownRecord): UnknownRecord[] {
  return Array.isArray(raw.output) ? raw.output.map(record).filter((item): item is UnknownRecord => Boolean(item)) : [];
}

function reasoningFromOutput(items: UnknownRecord[]): string {
  return items.filter((item) => item.type === 'reasoning').map((item) => {
    return textFromContent(item.summary) || textFromContent(item.content) || stringValue(item.text);
  }).filter(Boolean).join('\n').trim();
}

function outputText(items: UnknownRecord[]): string {
  return items.filter((item) => item.type === 'message' || item.role === 'assistant').map((item) => textFromContent(item.content)).filter(Boolean).join('\n').trim();
}

function extractJsonFromReasoning(reasoning: string): string {
  const trimmed = reasoning.trim();
  if (!trimmed) return '';
  const candidates = [trimmed];
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  if (fenced) candidates.push(fenced);
  const objectMatch = trimmed.match(/\{[\s\S]*\}/)?.[0];
  if (objectMatch) candidates.push(objectMatch);
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed !== null && typeof parsed === 'object') return JSON.stringify(parsed);
    } catch {
      // Continue to the next bounded candidate.
    }
  }
  return '';
}

function usageFrom(raw: UnknownRecord): ParsedProviderTurn['usage'] {
  const usage = record(raw.usage) ?? {};
  const input = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0);
  const output = Number(usage.completion_tokens ?? usage.output_tokens ?? 0);
  const total = Number(usage.total_tokens ?? (input + output));
  return {
    input: Number.isFinite(input) && input >= 0 ? Math.round(input) : 0,
    output: Number.isFinite(output) && output >= 0 ? Math.round(output) : 0,
    total: Number.isFinite(total) && total >= 0 ? Math.round(total) : 0,
  };
}

export function providerResponseSchema(raw: unknown, maxDepth = 4): string[] {
  const fields: string[] = [];
  const visit = (value: unknown, path: string, depth: number): void => {
    if (fields.length >= 120) return;
    if (value === null) { fields.push(`${path}:null`); return; }
    if (Array.isArray(value)) {
      fields.push(`${path}:array(${value.length})`);
      if (depth < maxDepth && value.length > 0) visit(value[0], `${path}[0]`, depth + 1);
      return;
    }
    if (typeof value === 'object') {
      const objectValue = value as UnknownRecord;
      fields.push(`${path}:object`);
      if (depth < maxDepth) {
        for (const [key, child] of Object.entries(objectValue)) visit(child, `${path}.${key}`, depth + 1);
      }
      return;
    }
    fields.push(`${path}:${typeof value}`);
  };
  visit(raw, '$', 0);
  return fields;
}

function chatCompletionTurn(raw: UnknownRecord, schemaFields: string[]): ParsedProviderTurn | null {
  if (!Array.isArray(raw.choices) || raw.choices.length === 0) return null;
  const choice = record(raw.choices[0]);
  const message = record(choice?.message) ?? record(choice?.delta);
  if (!choice || !message) return null;
  const originalContent = message.content;
  let content = textFromContent(originalContent) || stringValue(message.final) || stringValue(message.text) || stringValue(choice.text);
  const reasoningContent = reasoningText(message.reasoning_content) || reasoningText(message.reasoning);
  const toolCalls = toolCallsFrom(message.tool_calls, 'chat_call');
  let contentSource: ProviderContentSource = content ? 'message.content' : 'none';
  if (!content && reasoningContent) {
    content = extractJsonFromReasoning(reasoningContent);
    if (content) contentSource = 'reasoning_content';
  }
  const assistantMessage: ProviderAssistantMessage = {
    ...message,
    role: 'assistant',
    content: typeof originalContent === 'string' || Array.isArray(originalContent) || originalContent === null ? originalContent : content || null,
    ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
    ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
  };
  return {
    content,
    contentSource,
    finishReason: stringValue(choice.finish_reason) || null,
    message: assistantMessage,
    model: stringValue(raw.model),
    reasoningContent,
    reasoningContentPresent: Boolean(reasoningContent),
    reasoningOnly: !content && toolCalls.length === 0 && Boolean(reasoningContent),
    responseFormat: 'chat-completions',
    schemaFields,
    toolCalls,
    usage: usageFrom(raw),
  };
}

function responsesApiTurn(raw: UnknownRecord, schemaFields: string[]): ParsedProviderTurn | null {
  const items = outputItems(raw);
  if (!items.length && !stringValue(raw.output_text) && raw.object !== 'response') return null;
  let content = stringValue(raw.output_text) || outputText(items);
  const reasoningContent = reasoningText(raw.reasoning_content) || reasoningText(raw.reasoning) || reasoningFromOutput(items);
  const toolCalls = items.filter((item) => item.type === 'function_call').flatMap((item, index) => toolCallsFrom([item], `response_call_${index + 1}`));
  let contentSource: ProviderContentSource = stringValue(raw.output_text) ? 'output_text' : content ? 'output.content' : 'none';
  if (!content && reasoningContent) {
    content = extractJsonFromReasoning(reasoningContent);
    if (content) contentSource = 'reasoning_content';
  }
  return {
    content,
    contentSource,
    finishReason: stringValue(raw.status) || stringValue(record(raw.incomplete_details)?.reason) || null,
    message: {
      role: 'assistant', content: content || null,
      ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
      ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
    },
    model: stringValue(raw.model),
    reasoningContent,
    reasoningContentPresent: Boolean(reasoningContent),
    reasoningOnly: !content && toolCalls.length === 0 && Boolean(reasoningContent),
    responseFormat: 'responses-api',
    schemaFields,
    toolCalls,
    usage: usageFrom(raw),
  };
}

function providerSpecificTurn(raw: UnknownRecord, schemaFields: string[]): ParsedProviderTurn | null {
  const message = record(raw.message);
  const data = record(raw.data);
  const result = record(raw.result);
  const candidates: Array<[unknown, ProviderContentSource]> = [
    [message?.content, 'message.content'], [raw.output_text, 'output_text'], [raw.output, 'provider-text'], [raw.content, 'provider-text'],
    [raw.text, 'provider-text'], [raw.answer, 'provider-text'], [raw.response, 'provider-text'],
    [raw.completion, 'provider-text'], [raw.generated_text, 'provider-text'], [data?.output_text, 'output_text'],
    [data?.content, 'provider-text'], [data?.text, 'provider-text'], [data?.answer, 'provider-text'],
    [data?.response, 'provider-text'], [result?.content, 'provider-text'], [result?.text, 'provider-text'],
  ];
  let content = '';
  let contentSource: ProviderContentSource = 'none';
  for (const [candidate, source] of candidates) {
    content = textFromContent(candidate);
    if (content) { contentSource = source; break; }
  }
  const reasoningContent = reasoningText(message?.reasoning_content) || reasoningText(message?.reasoning)
    || reasoningText(raw.reasoning_content) || reasoningText(raw.reasoning);
  const toolCalls = toolCallsFrom(message?.tool_calls ?? raw.tool_calls, 'provider_call');
  if (!content && reasoningContent) {
    content = extractJsonFromReasoning(reasoningContent);
    if (content) contentSource = 'reasoning_content';
  }
  if (!content && !reasoningContent && toolCalls.length === 0) return null;
  return {
    content,
    contentSource,
    finishReason: stringValue(raw.finish_reason) || stringValue(raw.stop_reason) || null,
    message: {
      ...(message ?? {}), role: 'assistant', content: message?.content === null ? null : content || null,
      ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
      ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
    },
    model: stringValue(raw.model),
    reasoningContent,
    reasoningContentPresent: Boolean(reasoningContent),
    reasoningOnly: !content && toolCalls.length === 0 && Boolean(reasoningContent),
    responseFormat: 'provider-specific',
    schemaFields,
    toolCalls,
    usage: usageFrom(raw),
  };
}

export function normalizeProviderResponse(raw: unknown): ParsedProviderTurn {
  const schemaFields = providerResponseSchema(raw);
  const root = record(raw);
  if (!root) throw new ProviderProtocolError(`Provider response root was not an object. Schema: ${schemaFields.join(', ')}`, schemaFields);
  const turn = chatCompletionTurn(root, schemaFields) ?? responsesApiTurn(root, schemaFields) ?? providerSpecificTurn(root, schemaFields);
  if (!turn) throw new ProviderProtocolError(`Provider response contained no recognized assistant output. Schema: ${schemaFields.join(', ')}`, schemaFields);
  if (turn.finishReason === 'tool_calls' && turn.toolCalls.length === 0) {
    throw new ProviderProtocolError(`Provider reported finish_reason=tool_calls without executable tool calls. Schema: ${schemaFields.join(', ')}`, schemaFields);
  }
  if (!turn.content && turn.toolCalls.length === 0 && !turn.reasoningOnly) {
    throw new ProviderProtocolError(`Provider response contained neither final content, reasoning, nor executable tool calls. Schema: ${schemaFields.join(', ')}`, schemaFields);
  }
  return turn;
}

export const parseProviderTurn = normalizeProviderResponse;

function parseToolArguments(call: ProviderToolCall): { value: Record<string, unknown> | null; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(call.function.arguments);
  } catch {
    return { value: null, error: `Tool call ${call.function.name} contained invalid JSON arguments.` };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { value: null, error: `Tool call ${call.function.name} arguments must be a JSON object.` };
  }
  return { value: parsed as Record<string, unknown>, error: '' };
}

export async function runProviderToolLoop<T>(options: {
  messages: ProviderConversationMessage[];
  request: (messages: ProviderConversationMessage[], control: ProviderRequestControl) => Promise<unknown>;
  execute: (call: ProviderToolCall, argumentsValue: Record<string, unknown>) => Promise<{ result: T; toolMessage: string }>;
  maxToolRounds?: number;
  maxToolCalls?: number;
  maxRecoveryAttempts?: number;
}): Promise<ProviderToolLoopResult<T>> {
  const messages = [...options.messages];
  const executions: ProviderToolExecution<T>[] = [];
  const maxToolRounds = options.maxToolRounds ?? 8;
  const maxToolCalls = options.maxToolCalls ?? 16;
  const maxRecoveryAttempts = options.maxRecoveryAttempts ?? 2;
  const maxRequests = maxToolRounds + maxRecoveryAttempts * 2 + 4;
  const usage = { input: 0, output: 0, total: 0 };
  const responseShapes: ProviderResponseShape[] = [];
  let toolRounds = 0;
  let reasoningRecoveries = 0;
  let malformedRecoveries = 0;
  let finalizationAttempts = 0;
  let control: ProviderRequestControl = { toolsEnabled: true, disableThinking: false, reason: 'normal', attempt: 0 };

  for (let requestNumber = 1; requestNumber <= maxRequests; requestNumber += 1) {
    let turn: ParsedProviderTurn;
    try {
      turn = normalizeProviderResponse(await options.request(messages, { ...control, attempt: requestNumber }));
    } catch (error) {
      if (!(error instanceof ProviderProtocolError) || malformedRecoveries >= maxRecoveryAttempts) throw error;
      malformedRecoveries += 1;
      messages.push({ role: 'user', content: 'The previous provider response had no recognizable final output. Return only the final answer in the originally required format. Do not call tools or include analysis.' });
      control = { toolsEnabled: false, disableThinking: true, reason: 'malformed-recovery', attempt: requestNumber + 1 };
      continue;
    }

    responseShapes.push({
      finishReason: turn.finishReason,
      hasContent: Boolean(turn.content),
      hasReasoningContent: turn.reasoningContentPresent,
      toolCallCount: turn.toolCalls.length,
      responseFormat: turn.responseFormat,
      contentSource: turn.contentSource,
      schemaFields: turn.schemaFields,
    });
    usage.input += turn.usage.input;
    usage.output += turn.usage.output;
    usage.total += turn.usage.total;

    if (turn.content && turn.toolCalls.length === 0) {
      return { ...turn, usage, executions, rounds: requestNumber, responseShapes };
    }

    if (turn.toolCalls.length > 0) {
      messages.push(turn.message);
      for (const call of turn.toolCalls) {
        const parsedArguments = parseToolArguments(call);
        if (!parsedArguments.value) {
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ok: false, error: parsedArguments.error }) });
          continue;
        }
        if (executions.length >= maxToolCalls) {
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ok: false, error: 'Local tool-call budget reached.' }) });
          continue;
        }
        const execution = await options.execute(call, parsedArguments.value);
        const toolMessage = execution.toolMessage.slice(0, 20_000);
        executions.push({ call, arguments: parsedArguments.value, result: execution.result, toolMessage });
        messages.push({ role: 'tool', tool_call_id: call.id, content: toolMessage });
      }
      toolRounds += 1;
      if (toolRounds >= maxToolRounds || executions.length >= maxToolCalls) {
        messages.push({ role: 'user', content: 'The local tool budget is complete. Using the tool results already present, return only the final answer in the originally required format. Do not call another tool or include analysis.' });
        control = { toolsEnabled: false, disableThinking: true, reason: 'tool-budget-finalization', attempt: requestNumber + 1 };
        finalizationAttempts += 1;
      } else {
        control = { toolsEnabled: true, disableThinking: false, reason: 'normal', attempt: requestNumber + 1 };
      }
      continue;
    }

    if (turn.reasoningOnly) {
      if (reasoningRecoveries >= maxRecoveryAttempts) {
        throw new ProviderProtocolError(`Provider returned reasoning without a final answer after ${maxRecoveryAttempts} bounded recovery attempts. Schema: ${turn.schemaFields.join(', ')}`, turn.schemaFields);
      }
      reasoningRecoveries += 1;
      messages.push({ role: 'user', content: 'The previous response stopped after reasoning and omitted the final answer. Return only the final answer in the originally required format. Do not call tools or include analysis.' });
      control = { toolsEnabled: false, disableThinking: true, reason: 'reasoning-recovery', attempt: requestNumber + 1 };
      continue;
    }

    if (control.reason === 'tool-budget-finalization' && finalizationAttempts <= maxRecoveryAttempts) {
      finalizationAttempts += 1;
      control = { toolsEnabled: false, disableThinking: true, reason: 'tool-budget-finalization', attempt: requestNumber + 1 };
      continue;
    }
  }

  throw new ProviderProtocolError(`Provider response recovery exceeded the finite ${maxRequests}-request budget.`);
}

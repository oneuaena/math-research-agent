import { randomUUID } from 'node:crypto';
import type { ChatEvent, ChatSendInput, Conversation, ConversationMessage, ResearchMemory } from '../src/shared/types';
import { routeChatTask } from '../src/shared/chat-routing';
import type { AgentCoordinator } from './agent-coordinator';
import { ChatContextBuilder, citationsFromAnswer } from './chat-context';
import type { CredentialStore } from './credentials';
import type { ResearchDatabase } from './database';
import type { LiteratureSearchService } from './literature-search';
import { createProvider } from './provider';
import type { ModelProvider } from './provider';

export class ChatService {
  private readonly active = new Map<string, AbortController>();
  private readonly contextBuilder: ChatContextBuilder;

  constructor(
    private readonly database: ResearchDatabase,
    private readonly credentials: CredentialStore,
    private readonly agent: AgentCoordinator,
    private readonly literature: LiteratureSearchService,
    private readonly publish: (event: ChatEvent) => void,
    private readonly providerFactory?: () => ModelProvider,
  ) {
    this.contextBuilder = new ChatContextBuilder(database);
  }

  async send(input: ChatSendInput): Promise<ConversationMessage> {
    const content = input.content.trim();
    if (!content) throw new Error('Message cannot be empty.');
    if (content.length > 50_000) throw new Error('Message exceeds the 50,000 character limit.');
    this.database.getProject(input.projectId, false);
    this.active.get(input.projectId)?.abort();
    const controller = new AbortController();
    this.active.set(input.projectId, controller);
    const conversation = this.ensureConversation(input.projectId, input.conversationId, content);
    const now = new Date().toISOString();
    const route = routeChatTask(content, input.attachmentSourceIds?.length ?? 0);
    const userMessage: ConversationMessage = {
      id: randomUUID(), projectId: input.projectId, conversationId: conversation.id, role: 'user', content, route, status: 'completed',
      attachmentSourceIds: input.attachmentSourceIds ?? [], citations: [], parentMessageId: null, regeneratedFromId: input.regenerateFromId ?? null,
      error: '', createdAt: now, updatedAt: now,
    };
    this.database.saveRecord('messages', userMessage);
    let assistantMessage: ConversationMessage = {
      id: randomUUID(), projectId: input.projectId, conversationId: conversation.id, role: 'assistant', content: '', route, status: 'pending',
      attachmentSourceIds: [], citations: [], parentMessageId: userMessage.id, regeneratedFromId: input.regenerateFromId ?? null,
      error: '', createdAt: now, updatedAt: now,
    };
    this.database.saveRecord('messages', assistantMessage);
    this.publish({ projectId: input.projectId, conversationId: conversation.id, message: assistantMessage });
    try {
      let answer = '';
      let references: ReturnType<ChatContextBuilder['build']>['references'] = [];
      if (route === 'DEEP_RESEARCH') {
        answer = this.startOrResumeResearch(input.projectId);
      } else {
        if (route === 'LITERATURE_SEARCH') await this.literature.search(input.projectId, content, controller.signal);
        const context = this.contextBuilder.build(input.projectId, conversation.id, content, userMessage.attachmentSourceIds);
        references = context.references;
        const provider = this.providerFactory?.() ?? createProvider(this.database.getSettings(), this.credentials, (invocation) => this.agent.executeTool(invocation));
        answer = await provider.respondChat(context.messages, controller.signal, input.projectId);
      }
      if (controller.signal.aborted) return this.finishStopped(assistantMessage);
      assistantMessage = { ...assistantMessage, status: 'streaming', updatedAt: new Date().toISOString() };
      this.database.saveRecord('messages', assistantMessage);
      for (const delta of chunksOf(answer, 120)) {
        if (controller.signal.aborted) return this.finishStopped(assistantMessage);
        assistantMessage = { ...assistantMessage, content: assistantMessage.content + delta, updatedAt: new Date().toISOString() };
        this.publish({ projectId: input.projectId, conversationId: conversation.id, message: assistantMessage, delta });
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      assistantMessage = {
        ...assistantMessage, content: answer, citations: citationsFromAnswer(answer, references), status: 'completed', updatedAt: new Date().toISOString(),
      };
      this.database.saveRecord('messages', assistantMessage);
      this.persistConversationMemory(userMessage, assistantMessage);
      this.publish({ projectId: input.projectId, conversationId: conversation.id, message: assistantMessage });
      return assistantMessage;
    } catch (error) {
      if (controller.signal.aborted) return this.finishStopped(assistantMessage);
      assistantMessage = {
        ...assistantMessage, status: 'failed', error: safeMessage(error), content: '', updatedAt: new Date().toISOString(),
      };
      this.database.saveRecord('messages', assistantMessage);
      this.publish({ projectId: input.projectId, conversationId: conversation.id, message: assistantMessage });
      return assistantMessage;
    } finally {
      if (this.active.get(input.projectId) === controller) this.active.delete(input.projectId);
    }
  }

  stop(projectId: string): void {
    this.active.get(projectId)?.abort();
  }

  async regenerate(projectId: string, messageId: string): Promise<ConversationMessage> {
    const snapshot = this.database.getProject(projectId, false);
    const assistant = snapshot.messages.find((message) => message.id === messageId && message.role === 'assistant');
    if (!assistant?.parentMessageId) throw new Error('The assistant message cannot be regenerated.');
    const user = snapshot.messages.find((message) => message.id === assistant.parentMessageId && message.role === 'user');
    if (!user) throw new Error('The original user message was not found.');
    return this.send({
      projectId, conversationId: assistant.conversationId, content: user.content, attachmentSourceIds: user.attachmentSourceIds, regenerateFromId: assistant.id,
    });
  }

  private ensureConversation(projectId: string, requestedId: string | undefined, firstMessage: string): Conversation {
    const snapshot = this.database.getProject(projectId, false);
    const existing = requestedId
      ? snapshot.conversations.find((conversation) => conversation.id === requestedId)
      : snapshot.conversations.at(-1);
    if (existing) return existing;
    const now = new Date().toISOString();
    const conversation: Conversation = { id: randomUUID(), projectId, title: firstMessage.slice(0, 80), createdAt: now, updatedAt: now };
    this.database.saveRecord('conversations', conversation);
    return conversation;
  }

  private startOrResumeResearch(projectId: string): string {
    const snapshot = this.database.getProject(projectId, false);
    const latest = snapshot.sessions.at(-1);
    if (this.agent.isRunning(projectId)) return '自主研究已在运行，聊天仍可继续使用。';
    if (latest && latest.status !== 'COMPLETE') {
      this.agent.resume(projectId);
      return `已从检查点恢复自主研究。当前循环 ${latest.cycleIndex + 1}，恢复位置：${latest.nextStage}。`;
    }
    this.agent.start(projectId);
    return latest?.status === 'COMPLETE' ? '上一项研究已完成，已启动新的持久研究会话。' : '已启动自主研究。进度、工具调用和检查点会继续持久保存。';
  }

  private finishStopped(message: ConversationMessage): ConversationMessage {
    const stopped = { ...message, status: 'stopped' as const, updatedAt: new Date().toISOString() };
    this.database.saveRecord('messages', stopped);
    this.publish({ projectId: stopped.projectId, conversationId: stopped.conversationId, message: stopped });
    return stopped;
  }

  private persistConversationMemory(user: ConversationMessage, assistant: ConversationMessage): void {
    if (assistant.route === 'CHAT' && assistant.content.length < 400) return;
    const memory: ResearchMemory = {
      id: randomUUID(), projectId: user.projectId, category: assistant.route === 'LITERATURE_SEARCH' ? 'literature' : 'conversation',
      title: user.content.slice(0, 100), content: `User: ${user.content.slice(0, 1_500)}\nAssistant: ${assistant.content.slice(0, 3_500)}`,
      relatedNodeIds: [], createdAt: new Date().toISOString(),
    };
    this.database.saveRecord('memories', memory);
  }
}

function chunksOf(value: string, size: number): string[] {
  if (!value) return [''];
  const chunks: string[] = [];
  for (let index = 0; index < value.length; index += size) chunks.push(value.slice(index, index + size));
  return chunks;
}

function safeMessage(error: unknown): string {
  const value = error instanceof Error ? error.message : 'The chat request failed.';
  return value.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[redacted]').slice(0, 1_000);
}

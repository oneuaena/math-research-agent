import type { ConversationMessage, DocumentSearchResult, MessageCitation, ProjectSnapshot } from '../src/shared/types';
import { lexicalSimilarity } from '../src/shared/retrieval';
import type { ResearchDatabase } from './database';

const MAX_CONTEXT_CHARACTERS = 52_000;

export interface ChatContextReference {
  key: string;
  citation: MessageCitation;
}

export interface BuiltChatContext {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  references: ChatContextReference[];
  retrievedChunks: DocumentSearchResult[];
}

export class ChatContextBuilder {
  constructor(private readonly database: ResearchDatabase) {}

  build(projectId: string, conversationId: string, query: string, attachmentSourceIds: string[] = []): BuiltChatContext {
    const snapshot = this.database.getProject(projectId, false);
    const retrievedChunks = this.retrieveChunks(projectId, query, attachmentSourceIds);
    const references: ChatContextReference[] = [];
    const sourceSections = retrievedChunks.map((chunk, index) => {
      const key = `S${index + 1}`;
      const source = snapshot.sources.find((item) => item.id === chunk.sourceId);
      references.push({ key, citation: {
        sourceId: chunk.sourceId, chunkId: chunk.id, title: source?.title ?? chunk.filename, page: chunk.page, section: chunk.section,
        url: source?.url, doi: source?.doi,
      } });
      return `[${key}] ${source?.title ?? chunk.filename}${chunk.page ? `, page ${chunk.page}` : ''}${chunk.section ? `, ${chunk.section}` : ''}, chunk ${chunk.chunkIndex}\n${chunk.text}`;
    });
    const relevantLiterature = snapshot.literature.map((record) => ({ record, score: lexicalSimilarity(`${record.title}\n${record.abstract}`, query) }))
      .sort((left, right) => right.score - left.score).slice(0, 8);
    const literatureSections = relevantLiterature.map(({ record }, index) => {
      const key = `L${index + 1}`;
      references.push({ key, citation: {
        sourceId: record.sourceId, chunkId: null, title: record.title, page: null, section: record.venue,
        url: record.url, doi: record.doi,
      } });
      return `[${key}] ${record.title} — ${record.authors.join(', ')} (${record.year ?? 'year unknown'}). ${record.venue}. DOI: ${record.doi || 'none'}. URL: ${record.url}\nAbstract: ${record.abstract}`;
    });
    const recentMemories = [...snapshot.memories].sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 10);
    const session = snapshot.sessions.at(-1);
    const researchState = {
      project: snapshot.project,
      session: session ? { status: session.status, stage: session.currentStage, nextStage: session.nextStage, cycleIndex: session.cycleIndex, actionCount: session.actionCount } : null,
      recentResearchActions: snapshot.researchSteps.slice(-8).map((step) => ({ stage: step.stage, goal: step.goal, action: step.action, nextStage: step.nextStage })),
      openProofGaps: snapshot.proofs.slice(-2).flatMap((proof) => proof.steps.filter((step) => step.status !== 'VALID').slice(0, 8).map((step) => ({ title: step.title, status: step.status }))),
      memory: recentMemories.map((memory) => ({ category: memory.category, title: memory.title, content: memory.content })),
    };
    const context = boundText([
      `PROJECT AND PERSISTED RESEARCH STATE\n${JSON.stringify(researchState)}`,
      sourceSections.length ? `IMPORTED DOCUMENT CHUNKS\n${sourceSections.join('\n\n')}` : '',
      literatureSections.length ? `VERIFIED LITERATURE METADATA\n${literatureSections.join('\n\n')}` : '',
    ].filter(Boolean).join('\n\n'), MAX_CONTEXT_CHARACTERS);
    const system = `You are the user-facing mathematical research assistant inside Math Research Agent. Answer the current request directly and concisely. Preserve mathematical uncertainty: model reasoning is not automatically a proof, and computational survival is not proof.\n\nUse only the supplied imported-document chunks for claims about imported documents. Use only the supplied verified metadata for literature citations. Cite a used item with its exact marker, such as [S1] or [L1]. Never invent a title, author, DOI, URL, page, quotation, or source. If the supplied context is insufficient, say so. Do not claim to have read unseen pages or an entire document when only chunks are supplied.\n\n${context}`;
    const dialogue = conversationMessages(snapshot, conversationId).slice(-16).map((message) => ({ role: message.role as 'user' | 'assistant', content: message.content }));
    return { messages: [{ role: 'system', content: system }, ...dialogue], references, retrievedChunks };
  }

  private retrieveChunks(projectId: string, query: string, attachmentSourceIds: string[]): DocumentSearchResult[] {
    const searched = this.database.searchDocumentChunks(projectId, query, attachmentSourceIds.length ? 24 : 10);
    if (attachmentSourceIds.length === 0) return searched.slice(0, 10);
    const requested = new Set(attachmentSourceIds);
    const attached = searched.filter((chunk) => requested.has(chunk.sourceId)).slice(0, 12);
    const other = searched.filter((chunk) => !requested.has(chunk.sourceId)).slice(0, 4);
    return [...attached, ...other];
  }
}

export function citationsFromAnswer(content: string, references: ChatContextReference[]): MessageCitation[] {
  const used = new Set<string>();
  for (const match of content.matchAll(/\[([SL]\d+)\]/g)) used.add(match[1]);
  return references.filter((reference) => used.has(reference.key)).map((reference) => reference.citation);
}

function conversationMessages(snapshot: ProjectSnapshot, conversationId: string): ConversationMessage[] {
  return snapshot.messages.filter((message) => message.conversationId === conversationId && message.role !== 'system' && message.status !== 'pending' && message.status !== 'failed');
}

function boundText(value: string, maximum: number): string {
  if (value.length <= maximum) return value;
  return `${value.slice(0, maximum)}\n\n[Context truncated at a safe boundary.]`;
}

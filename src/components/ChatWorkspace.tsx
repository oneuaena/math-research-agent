import { ExternalLink, FileText, Paperclip, RotateCcw, Send, Square } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ConversationMessage } from '../shared/types';
import { useAppStore } from '../store';
import { MathMarkdown } from './MathMarkdown';

const routeLabel = {
  CHAT: ['对话', 'Chat'], QUICK_ANALYSIS: ['快速分析', 'Quick analysis'], DOCUMENT_ANALYSIS: ['文档分析', 'Document'],
  LITERATURE_SEARCH: ['文献检索', 'Literature'], DEEP_RESEARCH: ['深度研究', 'Deep research'],
} as const;

export function ChatWorkspace() {
  const { snapshot, language, running, stage, chatSending, sendChat, stopChat, regenerateChat, importDocuments, importDropped } = useAppStore();
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const conversation = snapshot?.conversations.at(-1);
  const messages = useMemo(() => snapshot?.messages.filter((message) => message.conversationId === conversation?.id) ?? [], [snapshot?.messages, conversation?.id]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages]);
  if (!snapshot) return null;
  const zh = language === 'zh';
  const submit = async (): Promise<void> => {
    const content = draft.trim();
    if (!content || chatSending) return;
    setDraft('');
    const sourceIds = attachments;
    setAttachments([]);
    await sendChat(content, sourceIds);
  };
  const attach = async (): Promise<void> => {
    const sourceIds = await importDocuments(true);
    setAttachments((current) => [...new Set([...current, ...sourceIds])]);
  };
  const drop = async (files: FileList): Promise<void> => {
    setDragging(false);
    const sourceIds = await importDropped([...files]);
    setAttachments((current) => [...new Set([...current, ...sourceIds])]);
  };
  return <div className={`chat-workspace ${dragging ? 'dragging' : ''}`} onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }} onDrop={(event) => { event.preventDefault(); void drop(event.dataTransfer.files); }}>
    <header className="view-toolbar chat-toolbar"><div><h1>{zh ? '研究对话' : 'Research chat'}</h1><span>{running ? `${zh ? '研究运行中' : 'Research running'} · ${stage}` : zh ? '可直接提问或启动深度研究' : 'Ask directly or start deep research'}</span></div></header>
    <div className="chat-scroll">
      {messages.length === 0 && <div className="chat-empty"><strong>{snapshot.project.question}</strong></div>}
      {messages.map((message) => <ChatMessage key={message.id} message={message} zh={zh} onRegenerate={() => void regenerateChat(message.id)} />)}
      <div ref={endRef} />
    </div>
    <div className="chat-composer-wrap">
      {attachments.length > 0 && <div className="attachment-row">{attachments.map((id) => { const source = snapshot.sources.find((item) => item.id === id); return <button key={id} onClick={() => setAttachments((items) => items.filter((item) => item !== id))}><FileText size={13} />{source?.title ?? id}<span>×</span></button>; })}</div>}
      <div className="chat-composer">
        <button className="icon-button" type="button" onClick={() => void attach()} title={zh ? '导入文档' : 'Import document'}><Paperclip size={18} /></button>
        <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); } }} placeholder={zh ? '输入问题…' : 'Ask a question…'} rows={1} />
        {chatSending ? <button className="chat-send stop" type="button" onClick={() => void stopChat()} title={zh ? '停止回答' : 'Stop'}><Square size={14} fill="currentColor" /></button> : <button className="chat-send" type="button" onClick={() => void submit()} disabled={!draft.trim()} title={zh ? '发送' : 'Send'}><Send size={16} /></button>}
      </div>
    </div>
    {dragging && <div className="drop-mask">{zh ? '松开以导入' : 'Drop to import'}</div>}
  </div>;
}

function ChatMessage({ message, zh, onRegenerate }: { message: ConversationMessage; zh: boolean; onRegenerate(): void }) {
  const route = routeLabel[message.route];
  return <article className={`chat-message ${message.role} ${message.status}`}>
    <header><span>{message.role === 'user' ? (zh ? '你' : 'You') : 'Agent'}</span><em>{zh ? route[0] : route[1]}</em>{message.status === 'pending' && <i>{zh ? '等待' : 'Pending'}</i>}{message.status === 'streaming' && <i>{zh ? '生成中' : 'Writing'}</i>}</header>
    {message.content && <MathMarkdown content={message.content} />}
    {message.error && <p className="chat-error">{message.error}</p>}
    {message.citations.length > 0 && <footer className="citation-row">{message.citations.map((citation, index) => <button key={`${citation.sourceId}-${citation.chunkId ?? index}`} onClick={() => citation.url ? void window.research.system.openExternal(citation.url) : undefined}><span>{index + 1}</span>{citation.title}{citation.page ? ` · p.${citation.page}` : ''}{citation.url && <ExternalLink size={11} />}</button>)}</footer>}
    {message.role === 'assistant' && ['completed', 'failed', 'stopped'].includes(message.status) && <button className="regenerate-button" onClick={onRegenerate}><RotateCcw size={12} />{zh ? '重新生成' : 'Regenerate'}</button>}
  </article>;
}

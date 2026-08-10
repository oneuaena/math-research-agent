import { randomUUID } from '../utils';
import { useState } from 'react';
import { Check, Copy, Edit3, Plus, Trash2, X } from 'lucide-react';
import type { BlockKind, NotebookBlock } from '../shared/types';
import { useAppStore } from '../store';
import { MathMarkdown } from './MathMarkdown';

const blockKinds: Array<{ kind: BlockKind; label: string }> = [
  { kind: 'text', label: 'Text' }, { kind: 'math', label: 'Math' }, { kind: 'theorem', label: 'Theorem' },
  { kind: 'lemma', label: 'Lemma' }, { kind: 'definition', label: 'Definition' }, { kind: 'proof', label: 'Proof' },
  { kind: 'experiment', label: 'Experiment' }, { kind: 'code', label: 'Code' }, { kind: 'source', label: 'Source' },
];

function NotebookCard({ block }: { block: NotebookBlock }) {
  const { saveRecord, removeRecord } = useAppStore();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(block.content);
  const commit = () => { void saveRecord('blocks', { ...block, content: draft, updatedAt: new Date().toISOString() }); setEditing(false); };
  return <article className={`notebook-block block-${block.kind}`}>
    <div className="block-rail"><span>{block.kind.replace('-', ' ')}</span><div className="block-tools">
      <button className="icon-button subtle" onClick={() => void navigator.clipboard.writeText(block.content)} aria-label="Copy"><Copy size={14} /></button>
      <button className="icon-button subtle" onClick={() => setEditing(!editing)} aria-label="Edit">{editing ? <X size={14} /> : <Edit3 size={14} />}</button>
      <button className="icon-button subtle" onClick={() => void removeRecord('blocks', block.id)} aria-label="Delete"><Trash2 size={14} /></button>
    </div></div>
    {block.title && <h3>{block.title}</h3>}
    {editing ? <div className="block-editor"><textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={Math.max(4, draft.split('\n').length + 1)} autoFocus /><button className="icon-button confirm" onClick={commit} aria-label="Save"><Check size={15} /></button></div> :
      block.kind === 'code' ? <pre><code>{block.content}</code></pre> : <MathMarkdown content={block.content} display={block.kind === 'math'} />}
  </article>;
}

export function Notebook() {
  const snapshot = useAppStore((state) => state.snapshot)!;
  const saveRecord = useAppStore((state) => state.saveRecord);
  const [adding, setAdding] = useState(false);
  const add = (kind: BlockKind) => {
    const now = new Date().toISOString();
    const block: NotebookBlock = { id: randomUUID(), projectId: snapshot.project.id, kind, title: kind === 'text' ? '' : kind[0].toUpperCase() + kind.slice(1), content: kind === 'math' ? '\\int_0^1 f(x)\\,dx' : '', position: snapshot.blocks.length, createdAt: now, updatedAt: now };
    void saveRecord('blocks', block); setAdding(false);
  };
  return <div className="notebook-view">
    <header className="page-heading"><div><span className="eyebrow">{snapshot.project.mode.toUpperCase()}</span><h1>{snapshot.project.name}</h1></div></header>
    <section className="research-question"><MathMarkdown content={snapshot.project.question} /></section>
    <div className="notebook-stack">{snapshot.blocks.sort((a, b) => a.position - b.position).map((block) => <NotebookCard key={block.id} block={block} />)}</div>
    <div className="add-block-wrap"><button className="add-block" onClick={() => setAdding(!adding)}><Plus size={15} />Add block</button>
      {adding && <div className="block-menu">{blockKinds.map((item) => <button key={item.kind} onClick={() => add(item.kind)}>{item.label}</button>)}</div>}
    </div>
  </div>;
}

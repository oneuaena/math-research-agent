import { useState, type FormEvent } from 'react';
import { CheckCircle2, File, FileDown, FlaskConical, Plus, RotateCcw, Trash2 } from 'lucide-react';
import type { Experiment, FailedAttempt, Proposition, ResearchMemory, ToolName, VerificationStatus } from '../shared/types';
import { useAppStore } from '../store';
import { randomUUID } from '../utils';
import { MathMarkdown } from './MathMarkdown';
import { Modal } from './Modal';

const Empty = ({ title }: { title: string }) => <div className="collection-empty"><span>∅</span><h3>{title}</h3></div>;

export function PropositionsView({ kind }: { kind: 'Conjecture' | 'Lemma' }) {
  const snapshot = useAppStore((state) => state.snapshot)!;
  const { saveRecord, removeRecord } = useAppStore();
  const [editing, setEditing] = useState<Proposition | null>(null);
  const records = snapshot.propositions.filter((item) => item.kind === kind);
  const create = () => { const now = new Date().toISOString(); setEditing({ id: randomUUID(), projectId: snapshot.project.id, kind, title: '', statement: '', assumptions: '', dependencies: [], status: 'unverified', proof: '', verification: '', references: [], notes: '', createdAt: now, updatedAt: now }); };
  return <div className="collection-view"><header className="view-toolbar"><div><h1>{kind === 'Lemma' ? 'Lemmas' : 'Conjectures'}</h1><span>{records.length} records</span></div><button className="button secondary compact" onClick={create}><Plus size={15} />{kind}</button></header>
    {records.length === 0 ? <Empty title={`No ${kind.toLowerCase()}s`} /> : <div className="record-list">{records.map((record) => <article className="proposition-card" key={record.id} onClick={() => setEditing(record)}>
      <div className="record-top"><span className="kind-label">{record.kind}</span><span className={`status-pill status-${record.status}`}>{record.status}</span></div><h2>{record.title}</h2><MathMarkdown content={record.statement} /><footer><span>{record.dependencies.length} dependencies</span><button className="icon-button subtle" onClick={(event) => { event.stopPropagation(); void removeRecord('propositions', record.id); }}><Trash2 size={14} /></button></footer>
    </article>)}</div>}
    {editing && <PropositionModal value={editing} onClose={() => setEditing(null)} onSave={(value) => { void saveRecord('propositions', { ...value, updatedAt: new Date().toISOString() }); setEditing(null); }} />}
  </div>;
}

function PropositionModal({ value, onClose, onSave }: { value: Proposition; onClose(): void; onSave(value: Proposition): void }) {
  const [record, setRecord] = useState(value);
  const update = (field: keyof Proposition, value: string) => setRecord((current) => ({ ...current, [field]: value }));
  return <Modal title={record.kind} onClose={onClose} wide><form className="editor-form" onSubmit={(e) => { e.preventDefault(); onSave(record); }}>
    <label className="field"><span>Title</span><input autoFocus value={record.title} onChange={(e) => update('title', e.target.value)} required /></label>
    <label className="field"><span>Status</span><select value={record.status} onChange={(e) => update('status', e.target.value)}><option value="unverified">Unverified</option><option value="plausible">Plausible</option><option value="verified">Verified</option><option value="failed">Failed</option><option value="open">Open</option></select></label>
    <label className="field field-full"><span>Statement · Markdown + LaTeX</span><textarea rows={5} value={record.statement} onChange={(e) => update('statement', e.target.value)} required /></label>
    <label className="field"><span>Assumptions</span><textarea rows={4} value={record.assumptions} onChange={(e) => update('assumptions', e.target.value)} /></label>
    <label className="field"><span>Verification</span><textarea rows={4} value={record.verification} onChange={(e) => update('verification', e.target.value)} /></label>
    <label className="field field-full"><span>Proof</span><textarea rows={8} value={record.proof} onChange={(e) => update('proof', e.target.value)} /></label>
    <footer className="modal-actions field-full"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary">Save</button></footer>
  </form></Modal>;
}

export function ExperimentsView() {
  const snapshot = useAppStore((state) => state.snapshot)!;
  const saveRecord = useAppStore((state) => state.saveRecord);
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [purpose, setPurpose] = useState('');
  const [tool, setTool] = useState<ToolName>('symbolic_simplify');
  const [source, setSource] = useState('');
  const run = async (event: FormEvent) => {
    event.preventDefault(); setRunning(true); const now = new Date().toISOString();
    const experiment: Experiment = { id: randomUUID(), projectId: snapshot.project.id, purpose, code: tool === 'run_python' || tool === 'lean_check' ? source : '', tool, input: source, output: '', interpretation: '', relatedNodeId: null, status: 'running', durationMs: null, createdAt: now, updatedAt: now };
    await saveRecord('experiments', experiment);
    const input = tool === 'run_python' || tool === 'lean_check' ? { code: source } : tool === 'z3_check' ? { smt2: source } : tool === 'matrix_compute' ? { matrix: JSON.parse(source), operation: 'det' } : { expression: source, variable: 'x', symbols: ['x'] };
    const result = await window.research.tools.run({ projectId: snapshot.project.id, name: tool, purpose, input });
    const verificationStatus: VerificationStatus = result.verificationStatus === 'FORMALLY_VERIFIED' ? 'formally-verified' : tool === 'z3_check' && result.ok ? 'bounded-check' : tool === 'run_python' && result.ok ? 'computationally-verified' : result.ok ? 'symbolically-verified' : 'unverified';
    await saveRecord('experiments', { ...experiment, output: result.output || result.error || result.stderr || '', status: result.ok ? 'succeeded' : 'failed', durationMs: result.durationMs, environment: result.environment, verificationStatus, updatedAt: new Date().toISOString() });
    setRunning(false); setOpen(false); setPurpose(''); setSource('');
  };
  return <div className="collection-view"><header className="view-toolbar"><div><h1>Experiments</h1><span>{snapshot.experiments.length} runs</span></div><button className="button secondary compact" onClick={() => setOpen(true)}><Plus size={15} />Experiment</button></header>
    {snapshot.experiments.length === 0 ? <Empty title="No experiments" /> : <div className="record-list">{snapshot.experiments.map((item) => <article className="experiment-card" key={item.id}><div className="record-top"><span className="kind-label"><FlaskConical size={13} />{item.tool}</span><span className={`run-status ${item.status}`}>{item.status}</span></div><h2>{item.purpose}</h2><pre>{item.output || item.input}</pre><footer>{item.durationMs ? `${item.durationMs} ms` : '—'}</footer></article>)}</div>}
    {open && <Modal title="New experiment" onClose={() => setOpen(false)}><form className="single-form" onSubmit={(e) => { void run(e); }}>
      <label className="field"><span>Purpose</span><input value={purpose} onChange={(e) => setPurpose(e.target.value)} required /></label>
      <label className="field"><span>Tool</span><select value={tool} onChange={(e) => setTool(e.target.value as ToolName)}><option value="symbolic_simplify">Symbolic simplify</option><option value="solve_equation">Solve equation</option><option value="differentiate">Differentiate</option><option value="integrate">Integrate</option><option value="matrix_compute">Matrix determinant</option><option value="run_python">Python</option><option value="z3_check">Z3 · SMT-LIB2</option><option value="lean_check">Lean 4 · kernel check</option></select></label>
      <label className="field"><span>{tool === 'run_python' ? 'Python code' : tool === 'lean_check' ? 'Lean 4 source' : tool === 'z3_check' ? 'SMT-LIB2' : tool === 'matrix_compute' ? 'Matrix · JSON array' : 'Expression'}</span><textarea rows={8} value={source} onChange={(e) => setSource(e.target.value)} required /></label>
      <footer className="modal-actions"><button type="button" className="button secondary" onClick={() => setOpen(false)}>Cancel</button><button className="button primary" disabled={running}>{running ? 'Running…' : 'Run'}</button></footer>
    </form></Modal>}
  </div>;
}

export function PapersView() {
  const snapshot = useAppStore((state) => state.snapshot)!;
  const importDocuments = useAppStore((state) => state.importDocuments);
  const language = useAppStore((state) => state.language);
  const localSources = snapshot.sources.filter((source) => source.type === 'user-document');
  const openSource = (path: string, url?: string) => url ? window.research.system.openExternal(url) : window.research.system.openPath(path);
  return <div className="collection-view"><header className="view-toolbar"><div><h1>{language === 'zh' ? '论文与来源' : 'Papers & sources'}</h1><span>{snapshot.sources.length} {language === 'zh' ? '个来源' : 'sources'}</span></div><button className="button secondary compact" onClick={() => void importDocuments()}><Plus size={15} />{language === 'zh' ? '导入' : 'Import'}</button></header>
    {snapshot.sources.length === 0 ? <Empty title={language === 'zh' ? '暂无来源' : 'No sources'} /> : <div className="source-sections">
      {localSources.length > 0 && <section><h2>{language === 'zh' ? '导入文档' : 'Imported documents'}</h2><div className="source-list">{localSources.map((source) => <article className="source-card" key={source.id} onClick={() => void openSource(source.path)}><File size={17} /><div><h3>{source.title}</h3><span>{source.documentType?.toUpperCase()} · {source.pageCount ? `${source.pageCount} pages · ` : ''}${source.chunkCount ?? 0} chunks</span><span className={`source-index-status ${source.extractionStatus ?? 'unsupported'}`}>{source.extractionStatus === 'complete' ? (language === 'zh' ? `已读取 · ${(source.contentCharacters ?? source.excerpt.length).toLocaleString()} 字符` : `Indexed · ${(source.contentCharacters ?? source.excerpt.length).toLocaleString()} characters`) : source.extractionStatus === 'failed' ? (language === 'zh' ? '读取失败' : 'Index failed') : (language === 'zh' ? '未提取正文' : 'Text not extracted')}</span></div></article>)}</div></section>}
      {snapshot.literature.length > 0 && <section><h2>{language === 'zh' ? '检索文献' : 'Retrieved literature'}</h2><div className="source-list">{snapshot.literature.slice().reverse().map((record) => <article className="source-card literature-card" key={record.id} onClick={() => record.url ? void openSource('', record.url) : undefined}><File size={17} /><div><h3>{record.title}</h3><span>{record.authors.join(', ') || (language === 'zh' ? '作者未知' : 'Authors unknown')} · {record.year ?? '—'} · {record.provider}</span><span className="source-index-status complete">{record.doi ? `DOI ${record.doi}` : record.arxivId ? `arXiv ${record.arxivId}` : record.verificationStatus}</span></div></article>)}</div></section>}
    </div>}
  </div>;
}

export function MemoryView() {
  const snapshot = useAppStore((state) => state.snapshot)!;
  const saveRecord = useAppStore((state) => state.saveRecord);
  const [open, setOpen] = useState(false); const [title, setTitle] = useState(''); const [content, setContent] = useState('');
  const save = (event: FormEvent) => { event.preventDefault(); const record: ResearchMemory = { id: randomUUID(), projectId: snapshot.project.id, category: 'decision', title, content, relatedNodeIds: [], createdAt: new Date().toISOString() }; void saveRecord('memories', record); setOpen(false); setTitle(''); setContent(''); };
  return <div className="collection-view"><header className="view-toolbar"><div><h1>Research memory</h1><span>{snapshot.memories.length} entries</span></div><button className="button secondary compact" onClick={() => setOpen(true)}><Plus size={15} />Memory</button></header>
    {snapshot.memories.length === 0 ? <Empty title="No research memory" /> : <div className="timeline-list">{snapshot.memories.map((item) => <article key={item.id}><i /><div><span>{item.category}</span><h3>{item.title}</h3><p>{item.content}</p></div></article>)}</div>}
    {open && <SimpleTextModal title="New memory" values={{ title, content }} setters={{ setTitle, setContent }} onClose={() => setOpen(false)} onSave={save} />}
  </div>;
}

export function FailuresView() {
  const snapshot = useAppStore((state) => state.snapshot)!; const saveRecord = useAppStore((state) => state.saveRecord);
  const [open, setOpen] = useState(false); const [title, setTitle] = useState(''); const [content, setContent] = useState('');
  const save = (event: FormEvent) => { event.preventDefault(); const record: FailedAttempt = { id: randomUUID(), projectId: snapshot.project.id, title, goal: '', approach: content, reason: '', counterexample: '', learned: '', relatedNodeIds: [], revisitable: true, createdAt: new Date().toISOString() }; void saveRecord('failedAttempts', record); setOpen(false); };
  return <div className="collection-view"><header className="view-toolbar"><div><h1>Failed attempts</h1><span>{snapshot.failedAttempts.length} routes</span></div><button className="button secondary compact" onClick={() => setOpen(true)}><Plus size={15} />Attempt</button></header>
    {snapshot.failedAttempts.length === 0 ? <Empty title="No failed routes" /> : <div className="record-list">{snapshot.failedAttempts.map((item) => <article className="failure-card" key={item.id}><div className="record-top"><span className="kind-label"><RotateCcw size={13} />Revisitable</span></div><h2>{item.title}</h2><p>{item.approach}</p>{item.reason && <div className="failure-reason">{item.reason}</div>}</article>)}</div>}
    {open && <SimpleTextModal title="Failed attempt" values={{ title, content }} setters={{ setTitle, setContent }} onClose={() => setOpen(false)} onSave={save} />}
  </div>;
}

function SimpleTextModal({ title: modalTitle, values, setters, onClose, onSave }: { title: string; values: { title: string; content: string }; setters: { setTitle(value: string): void; setContent(value: string): void }; onClose(): void; onSave(event: FormEvent): void }) {
  return <Modal title={modalTitle} onClose={onClose}><form className="single-form" onSubmit={onSave}><label className="field"><span>Title</span><input value={values.title} onChange={(e) => setters.setTitle(e.target.value)} required /></label><label className="field"><span>Content</span><textarea rows={7} value={values.content} onChange={(e) => setters.setContent(e.target.value)} required /></label><footer className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary">Save</button></footer></form></Modal>;
}

export function ReportsView() {
  const snapshot = useAppStore((state) => state.snapshot)!; const [path, setPath] = useState('');
  const exportReport = async (format: 'markdown' | 'latex') => { const result = await window.research.reports.export(snapshot.project.id, format); if (result) setPath(result); };
  const verified = snapshot.propositions.filter((item) => item.status === 'verified').length;
  return <div className="collection-view"><header className="view-toolbar"><div><h1>Research report</h1><span>Markdown · LaTeX</span></div></header>
    <section className="report-summary"><div><FileDown size={22} /><h2>{snapshot.project.name}</h2><p>{snapshot.project.question}</p></div><div className="report-metrics"><span><strong>{snapshot.nodes.length}</strong>Nodes</span><span><strong>{verified}</strong>Verified</span><span><strong>{snapshot.experiments.length}</strong>Experiments</span><span><strong>{snapshot.sources.length}</strong>Sources</span></div><div className="report-actions"><button className="button primary" onClick={() => void exportReport('markdown')}>Export Markdown</button><button className="button secondary" onClick={() => void exportReport('latex')}>Export LaTeX</button></div>{path && <button className="export-path" onClick={() => void window.research.system.openPath(path)}><CheckCircle2 size={14} />{path}</button>}</section>
  </div>;
}

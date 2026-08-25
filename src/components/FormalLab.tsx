import { useMemo, useState } from 'react';
import { BookOpenCheck, Search, ShieldCheck, TriangleAlert } from 'lucide-react';
import type { Experiment, VerificationStatus } from '../shared/types';
import { useAppStore } from '../store';
import { randomUUID } from '../utils';

const TEMPLATES = {
  algebra: {
    label: 'Algebra',
    target: 'For real a and b, a + b = b + a.',
    code: 'import Mathlib\n\nexample (a b : ℝ) : a + b = b + a := by\n  ring\n',
  },
  induction: {
    label: 'Induction',
    target: 'Every natural number is no smaller than zero.',
    code: 'import Mathlib\n\nexample (n : ℕ) : 0 ≤ n := by\n  exact Nat.zero_le n\n',
  },
  empty: {
    label: 'Blank',
    target: '',
    code: 'import Mathlib\n\n-- State one theorem or lemma and provide a complete proof.\nexample : True := by\n  trivial\n',
  },
} as const;

function experimentStatus(result: { verificationStatus?: string; ok: boolean }): VerificationStatus {
  return result.verificationStatus === 'FORMALLY_VERIFIED' ? 'formally-verified' : result.ok ? 'symbolically-verified' : 'unverified';
}

export function FormalLab() {
  const snapshot = useAppStore((state) => state.snapshot)!;
  const saveRecord = useAppStore((state) => state.saveRecord);
  const [target, setTarget] = useState<string>(TEMPLATES.algebra.target);
  const [formalIr, setFormalIr] = useState<string>('quantifiers: forall a b : Real\nassumptions: none\nconclusion: a + b = b + a');
  const [code, setCode] = useState<string>(TEMPLATES.algebra.code);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string; artifact?: string } | null>(null);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState('');
  const gaps = useMemo(() => code.split(/\r?\n/).map((line, index) => ({ line, index })).filter(({ line }) => /\b(sorry|admit)\b|by\?/.test(line)), [code]);

  const applyTemplate = (key: keyof typeof TEMPLATES) => {
    setTarget(TEMPLATES[key].target);
    setCode(TEMPLATES[key].code);
    setFormalIr(TEMPLATES[key].target ? `claim: ${TEMPLATES[key].target}` : '');
    setResult(null);
  };

  const run = async () => {
    setRunning(true);
    const now = new Date().toISOString();
    const item: Experiment = { id: randomUUID(), projectId: snapshot.project.id, purpose: target.trim() || 'Lean 4 formal proof check', code, tool: 'lean_check', input: code, output: '', interpretation: target.trim() ? `Formal target: ${target.trim()}` : '', relatedNodeId: null, status: 'running', durationMs: null, createdAt: now, updatedAt: now };
    try {
      await saveRecord('experiments', item);
      const binding = await window.research.formalBindings.create(snapshot.project.id, target, formalIr, code);
      const checked = await window.research.tools.run({ projectId: snapshot.project.id, name: 'lean_check', purpose: item.purpose, input: { code, bindingId: binding.id } });
      await saveRecord('experiments', { ...item, output: checked.output || checked.error || checked.stderr || '', status: checked.ok ? 'succeeded' : 'failed', durationMs: checked.durationMs, environment: checked.environment, verificationStatus: experimentStatus(checked), updatedAt: new Date().toISOString() });
      setResult({ ok: checked.ok, text: checked.output || checked.error || checked.stderr || 'No output.', artifact: checked.artifactLocation });
    } finally {
      setRunning(false);
    }
  };

  const search = async () => {
    if (query.trim().length < 2) return;
    setSearching(true);
    try {
      const found = await window.research.tools.run({ projectId: snapshot.project.id, name: 'mathlib_search', purpose: `Search local Mathlib for ${query.trim()}`, input: { query } });
      setSearchResult(found.ok ? found.output : found.error || found.stderr || 'Search failed.');
    } finally {
      setSearching(false);
    }
  };

  return <div className="formal-lab">
    <header className="view-toolbar"><div><h1>Formal lab</h1><span>Lean 4 · pinned Mathlib · local artifacts</span></div><span className="formal-kernel"><ShieldCheck size={15} />Kernel gate</span></header>
    <section className="formal-notice"><BookOpenCheck size={18} /><div><strong>Locked statement binding</strong><span>Each run stores SHA-256 IDs for the original claim, Formal IR, Lean declaration, proof source, and kernel certificate. The kernel proves the locked Lean declaration; the binding makes any declaration swap fail.</span></div></section>
    <div className="formal-templates">{(Object.keys(TEMPLATES) as Array<keyof typeof TEMPLATES>).map((key) => <button key={key} className="button secondary compact" onClick={() => applyTemplate(key)}>{TEMPLATES[key].label}</button>)}</div>
    <section className="formal-editor-grid">
      <label className="field"><span>Natural-language target</span><textarea rows={6} value={target} onChange={(event) => setTarget(event.target.value)} placeholder="State assumptions and the exact conclusion." /></label>
      <label className="field"><span>Formal specification / Math IR</span><textarea rows={6} value={formalIr} onChange={(event) => setFormalIr(event.target.value)} placeholder="Quantifiers, domains, assumptions, definitions, and conclusion." /></label>
      <label className="field"><span>Lean 4 source</span><textarea className="lean-source" rows={15} value={code} onChange={(event) => setCode(event.target.value)} spellCheck={false} /></label>
    </section>
    {gaps.length > 0 && <section className="formal-gaps"><TriangleAlert size={16} /><div><strong>{gaps.length} unresolved proof gap{gaps.length === 1 ? '' : 's'}</strong><span>{gaps.map(({ line, index }) => `L${index + 1}: ${line.trim()}`).join(' · ')}</span></div></section>}
    <div className="formal-actions"><button className="button primary" disabled={running || gaps.length > 0 || !target.trim() || !formalIr.trim()} onClick={() => void run()}>{running ? 'Checking…' : 'Bind and run Lean kernel check'}</button><span>Uses a project-local Mathlib v4.32.0 dependency and writes a binding plus an audit artifact for every run.</span></div>
    {result && <section className={`formal-result ${result.ok ? 'passed' : 'failed'}`}><strong>{result.ok ? 'FORMALLY VERIFIED — submitted Lean artifact' : 'NOT VERIFIED'}</strong><pre>{result.text}</pre>{result.artifact && <button className="export-path" onClick={() => void window.research.system.openPath(result.artifact!)}>{result.artifact}</button>}</section>}
    <section className="mathlib-search"><header><Search size={16} /><div><h2>Local Mathlib search</h2><span>Searches the pinned local source only; no theorem text is sent to an external service.</span></div></header><div><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void search(); }} placeholder="e.g. card Finset" /><button className="button secondary compact" disabled={searching || query.trim().length < 2} onClick={() => void search()}>{searching ? 'Searching…' : 'Search'}</button></div>{searchResult && <pre>{searchResult}</pre>}</section>
  </div>;
}

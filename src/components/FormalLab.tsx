import { useMemo, useState } from 'react';
import { BookOpenCheck, Search, ShieldCheck, TriangleAlert } from 'lucide-react';
import type { Experiment, FormalBinding, VerificationStatus } from '../shared/types';
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
  const [frozenBinding, setFrozenBinding] = useState<FormalBinding | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string; artifact?: string } | null>(null);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState('');
  const gaps = useMemo(() => code.split(/\r?\n/).map((line, index) => ({ line, index })).filter(({ line }) => /\b(sorry|admit)\b|by\?/.test(line)), [code]);

  const applyTemplate = (key: keyof typeof TEMPLATES) => {
    setTarget(TEMPLATES[key].target);
    setCode(TEMPLATES[key].code);
    setFormalIr(TEMPLATES[key].target ? `claim: ${TEMPLATES[key].target}` : '');
    setFrozenBinding(null);
    setResult(null);
  };

  const freeze = async () => {
    setRunning(true);
    try {
      const binding = await window.research.formalBindings.freezeUserConfirmed(snapshot.project.id, target, formalIr, code);
      setFrozenBinding(binding);
      setResult({ ok: true, text: 'Mapping frozen. Subsequent Lean runs must use this exact declaration header. The kernel can verify the Lean statement; your confirmation records the original-language mapping.' });
    } catch (error) {
      setResult({ ok: false, text: error instanceof Error ? error.message : 'Could not freeze the statement mapping.' });
    } finally {
      setRunning(false);
    }
  };

  const run = async () => {
    if (!frozenBinding) return;
    setRunning(true);
    const now = new Date().toISOString();
    const item: Experiment = { id: randomUUID(), projectId: snapshot.project.id, purpose: target.trim() || 'Lean 4 formal proof check', code, tool: 'lean_check', input: code, output: '', interpretation: target.trim() ? `Formal target: ${target.trim()}` : '', relatedNodeId: null, status: 'running', durationMs: null, createdAt: now, updatedAt: now };
    try {
      await saveRecord('experiments', item);
      const checked = await window.research.tools.run({ projectId: snapshot.project.id, name: 'lean_check', purpose: item.purpose, input: { code, bindingId: frozenBinding.id } });
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
    <section className="formal-notice"><BookOpenCheck size={18} /><div><strong>Frozen statement mapping</strong><span>First confirm and freeze the natural-language target, Formal IR, and Lean declaration. Lean can then prove only that locked declaration; an AI-proposed mapping is never presented as independently certified equivalence to the original language.</span></div></section>
    <div className="formal-templates">{(Object.keys(TEMPLATES) as Array<keyof typeof TEMPLATES>).map((key) => <button key={key} className="button secondary compact" onClick={() => applyTemplate(key)}>{TEMPLATES[key].label}</button>)}</div>
    <section className="formal-editor-grid">
      <label className="field"><span>Natural-language target</span><textarea rows={6} value={target} onChange={(event) => { setTarget(event.target.value); setFrozenBinding(null); }} placeholder="State assumptions and the exact conclusion." /></label>
      <label className="field"><span>Formal specification / Math IR</span><textarea rows={6} value={formalIr} onChange={(event) => { setFormalIr(event.target.value); setFrozenBinding(null); }} placeholder="Quantifiers, domains, assumptions, definitions, and conclusion." /></label>
      <label className="field"><span>Lean 4 source</span><textarea className="lean-source" rows={15} value={code} onChange={(event) => { setCode(event.target.value); setFrozenBinding(null); }} spellCheck={false} /></label>
    </section>
    {gaps.length > 0 && <section className="formal-gaps"><TriangleAlert size={16} /><div><strong>{gaps.length} unresolved proof gap{gaps.length === 1 ? '' : 's'}</strong><span>{gaps.map(({ line, index }) => `L${index + 1}: ${line.trim()}`).join(' · ')}</span></div></section>}
    <div className="formal-actions"><button className="button secondary" disabled={running || gaps.length > 0 || !target.trim() || !formalIr.trim()} onClick={() => void freeze()}>{running ? 'Freezing…' : 'I confirm mapping and freeze'}</button><button className="button primary" disabled={running || gaps.length > 0 || !frozenBinding} onClick={() => void run()}>{running ? 'Checking…' : 'Run Lean against frozen mapping'}</button><span>{frozenBinding ? `Frozen ${frozenBinding.id.slice(0, 8)} · user-confirmed mapping` : 'Freeze the mapping before Lean can run.'}</span></div>
    {result && <section className={`formal-result ${result.ok ? 'passed' : 'failed'}`}><strong>{result.ok ? (result.artifact ? 'LEAN STATEMENT FORMALLY VERIFIED — USER-CONFIRMED MAPPING' : 'MAPPING FROZEN') : 'NOT VERIFIED'}</strong><pre>{result.text}</pre>{result.artifact && <button className="export-path" onClick={() => void window.research.system.openPath(result.artifact!)}>{result.artifact}</button>}</section>}
    <section className="mathlib-search"><header><Search size={16} /><div><h2>Local Mathlib search</h2><span>Searches the pinned local source only; no theorem text is sent to an external service.</span></div></header><div><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void search(); }} placeholder="e.g. card Finset" /><button className="button secondary compact" disabled={searching || query.trim().length < 2} onClick={() => void search()}>{searching ? 'Searching…' : 'Search'}</button></div>{searchResult && <pre>{searchResult}</pre>}</section>
  </div>;
}

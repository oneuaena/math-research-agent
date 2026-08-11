import { useState } from 'react';
import { Check, CheckCircle2, Clipboard, Code2, Download, FlaskConical, SearchX, ShieldCheck, TriangleAlert, X } from 'lucide-react';
import type { VerificationStatus } from '../shared/types';
import { useAppStore } from '../store';
import { MathMarkdown } from './MathMarkdown';
import { knownText, t } from '../i18n';

const VERIFICATION_LABELS: Record<VerificationStatus, string> = {
  'formally-verified': 'FORMALLY VERIFIED',
  'exactly-verified': 'EXACTLY VERIFIED',
  'computationally-verified': 'COMPUTATIONALLY VERIFIED',
  'symbolically-verified': 'SYMBOLICALLY VERIFIED',
  'bounded-check': 'BOUNDED CHECK',
  'numerically-supported': 'NUMERICALLY SUPPORTED',
  'llm-assessed-only': 'LLM ASSESSED ONLY',
  'unverified': 'UNVERIFIED',
};

const VERIFICATION_LABELS_ZH: Record<VerificationStatus, string> = {
  'formally-verified': '形式化验证',
  'exactly-verified': '精确验证', 'computationally-verified': '计算验证', 'symbolically-verified': '符号验证',
  'bounded-check': '有界检查', 'numerically-supported': '数值支持', 'llm-assessed-only': '仅模型评估', 'unverified': '未验证',
};

export function VerificationBadge({ status }: { status: VerificationStatus }) {
  const language = useAppStore((state) => state.language);
  return <span className={`verification-badge verification-${status}`}>{language === 'zh' ? VERIFICATION_LABELS_ZH[status] : VERIFICATION_LABELS[status]}</span>;
}

export function StressResultView() {
  const { snapshot, running, startAgent, language } = useAppStore();
  const [copied, setCopied] = useState('');
  if (!snapshot) return null;
  const result = snapshot.stressResults.at(-1);
  const copy = async (label: string, value: string) => { await navigator.clipboard.writeText(value); setCopied(label); setTimeout(() => setCopied(''), 1200); };
  if (!result) return <div className="stress-result-view"><header className="view-toolbar"><div><h1>{t(language, 'stressTest')}</h1><span>{t(language, 'evidenceFirst')}</span></div></header><section className="result-empty"><SearchX size={25} /><h2>{t(language, 'noTestRun')}</h2><MathMarkdown content={snapshot.project.question} /><button className="button primary" disabled={running} onClick={() => void startAgent()}>{t(language, 'runStressTest')}</button></section></div>;
  if (result.status === 'running') return <div className="stress-result-view"><header className="view-toolbar"><div><h1>{t(language, 'stressTest')}</h1><span>{language === 'zh' ? '运行中' : 'Running'}</span></div></header><section className="result-running"><i /><h2>{t(language, 'attacking')}</h2><p>{snapshot.activities[0]?.title}</p></section></div>;
  const counterexample = result.counterexample;
  return <div className="stress-result-view">
    <header className="view-toolbar"><div><h1>{t(language, 'stressTest')}</h1><span>{new Date(result.completedAt ?? result.startedAt).toLocaleString()}</span></div>{result.verificationStatus && <VerificationBadge status={result.verificationStatus} />}</header>
    <div className="result-content">
      <section className={`result-hero result-${result.status}`}>
        <div className="result-glyph">{result.status === 'counterexample-found' ? <TriangleAlert size={25} /> : result.status === 'survived' ? <ShieldCheck size={25} /> : <SearchX size={25} />}</div>
        <span>{t(language, 'status')}</span><h2>{result.status === 'counterexample-found' ? t(language, 'counterexampleFound') : result.status === 'survived' ? t(language, 'survivedTesting') : t(language, 'inconclusive')}</h2>
        {result.status === 'survived' && <strong>{t(language, 'notProof')}</strong>}
        <MathMarkdown content={snapshot.project.question} />
      </section>
      {counterexample && <section className="counterexample-panel">
        <div className="section-kicker">{t(language, 'counterexample')}</div><div className="counterexample-value">{Object.entries(counterexample.inputs).map(([key, value]) => <span key={key}><i>{key}</i><strong>{value}</strong></span>)}</div>
        <div className="exact-expression"><MathMarkdown content={`$$${counterexample.exactExpression}$$`} /></div>
        <div className="verification-checks">{counterexample.checks.map((check) => <div key={check.label}>{check.passed ? <Check size={15} /> : <X size={15} />}<span><strong>{knownText(language, check.label)}</strong><small>{knownText(language, check.detail)}</small></span></div>)}</div>
        <details className="calculation-details"><summary>{t(language, 'calculation')}</summary><dl><dt>{t(language, 'environment')}</dt><dd>{counterexample.environment}</dd><dt>{t(language, 'output')}</dt><dd><code>{counterexample.output}</code></dd></dl><pre>{counterexample.code}</pre></details>
        <div className="evidence-actions"><button className="button secondary" onClick={() => void copy('counterexample', JSON.stringify(counterexample.inputs))}>{copied === 'counterexample' ? <CheckCircle2 size={14} /> : <Clipboard size={14} />}{t(language, 'copyCounterexample')}</button><button className="button secondary" onClick={() => void copy('python', counterexample.code)}>{copied === 'python' ? <CheckCircle2 size={14} /> : <Code2 size={14} />}{t(language, 'copyPython')}</button><button className="button secondary" onClick={() => void window.research.reports.exportEvidence(snapshot.project.id)}><Download size={14} />{t(language, 'exportEvidence')}</button></div>
      </section>}
      <section className="coverage-panel"><div className="section-kicker">{t(language, 'searchCoverage')}</div><div className="coverage-grid">{result.coverage.map((item) => <div key={`${item.label}-${item.value}`}><span>{knownText(language, item.label)}</span><strong>{item.value}</strong></div>)}</div></section>
      {result.status === 'survived' && <section className="survival-note"><h3>{t(language, 'noCounterexample')}</h3><p>{t(language, 'noCounterexampleNote')}</p></section>}
      {result.remainingUncertainty.length > 0 && <section className="uncertainty-panel"><div className="section-kicker">{t(language, 'remainingUncertainty')}</div><ul>{result.remainingUncertainty.map((item) => <li key={item}>{item}</li>)}</ul></section>}
    </div>
  </div>;
}

export function AttackHistoryView() {
  const snapshot = useAppStore((state) => state.snapshot)!;
  const language = useAppStore((state) => state.language);
  return <div className="collection-view"><header className="view-toolbar"><div><h1>{t(language, 'attackHistory')}</h1><span>{snapshot.attacks.length} {t(language, 'attacks')}</span></div></header>
    {snapshot.attacks.length === 0 ? <div className="collection-empty"><span>∅</span><h3>{t(language, 'noAttacks')}</h3></div> : <div className="attack-list">{snapshot.attacks.sort((a, b) => a.sequence - b.sequence).map((attack) => <article className="attack-card" key={attack.id}>
      <div className="attack-index">#{String(attack.sequence).padStart(2, '0')}</div><div className="attack-body"><div className="record-top"><span className="kind-label"><FlaskConical size={13} />{knownText(language, attack.strategy)}</span><span className={`attack-status attack-${attack.status}`}>{attack.status.replaceAll('-', ' ')}</span></div>
      <h2>{knownText(language, attack.method)}</h2><dl><dt>{t(language, 'searchSpace')}</dt><dd>{attack.searchSpace}</dd><dt>{t(language, 'result')}</dt><dd>{knownText(language, attack.result) || (language === 'zh' ? '等待运行' : 'Pending')}</dd><dt>{t(language, 'duration')}</dt><dd>{attack.durationMs ? `${attack.durationMs} ms` : '—'}</dd></dl><VerificationBadge status={attack.verificationStatus} />
      {attack.code && <details><summary>{t(language, 'viewCode')}</summary><pre>{attack.code}</pre></details>}</div>
    </article>)}</div>}
  </div>;
}

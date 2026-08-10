import { AlertTriangle, Binary, CheckCircle2, CircleDot, Clock3, GitBranch, Network, ShieldCheck } from 'lucide-react';
import { canDisplayVerifiedProof, specificationLevel } from '../shared/research';
import { useAppStore } from '../store';
import { MathMarkdown } from './MathMarkdown';
import { stageZh } from '../i18n';

const text = (zh: boolean, a: string, b: string) => zh ? a : b;
const sessionZh: Record<string, string> = { RUNNING: '运行中', PAUSED: '已暂停', COMPLETE: '已完成', FAILED: '失败' };
const roleZh: Record<string, string> = { 'research-planner': '研究规划', explorer: '探索', 'experimental-mathematician': '数学实验', 'lemma-generator': '引理生成', 'proof-builder': '证明构建', skeptic: '证明批判', 'independent-verifier': '独立验证', 'research-synthesizer': '研究综合' };

export function ResearchConsole() {
  const { snapshot, language } = useAppStore();
  if (!snapshot) return null;
  const zh = language === 'zh';
  const session = snapshot.sessions.at(-1);
  const spec = snapshot.specifications.at(-1);
  const recent = snapshot.researchSteps.slice(-18).reverse();
  return <div className="research-console">
    <header className="view-toolbar"><div><h1>{text(zh, '研究会话', 'Research session')}</h1><span>{session ? `${zh ? sessionZh[session.status] ?? session.status : session.status} · ${zh ? stageZh[session.currentStage] ?? session.currentStage : session.currentStage}` : text(zh, '尚未运行', 'Not started')}</span></div></header>
    <div className="research-body">
      <section className="research-metrics">
        <Metric icon={Clock3} label={text(zh, '行动', 'Actions')} value={String(session?.actionCount ?? 0)} />
        <Metric icon={GitBranch} label={text(zh, '分支', 'Branches')} value={String(snapshot.branches.length)} />
        <Metric icon={ShieldCheck} label={text(zh, '证据', 'Evidence')} value={String(snapshot.evidence.length)} />
        <Metric icon={Network} label={text(zh, '检查点', 'Checkpoints')} value={String(session?.checkpointCount ?? 0)} />
      </section>
      {session?.pauseReason && <div className="research-notice"><CircleDot size={14} /><span>{session.pauseReason}</span></div>}
      <section className="research-panel">
        <div className="research-panel-title"><div><Binary size={15} /><strong>{text(zh, '数学规格', 'Mathematical specification')}</strong></div><span>{spec ? (zh ? { 'machine-executable': '机器可执行', symbolic: '符号规格', 'natural-language': '自然语言规格' }[specificationLevel(spec)] : specificationLevel(spec)) : '—'}</span></div>
        {!spec ? <p className="muted">{text(zh, '运行后生成结构化规格。', 'Run to create a structured specification.')}</p> : <div className="spec-grid">
          <div><small>{text(zh, '量词', 'Quantifiers')}</small><p>{spec.quantifiers.join('；') || '—'}</p></div>
          <div><small>{text(zh, '变量与定义域', 'Variables and domains')}</small><p>{spec.variables.map((item) => `${item.name}: ${item.domain}`).join('；') || '—'}</p></div>
          <div className="wide"><small>{text(zh, '目标', 'Target')}</small><p>{spec.target.description}</p></div>
          <div className="wide"><small>{text(zh, '不确定性', 'Uncertainty')}</small><p>{spec.uncertainty.join('；') || text(zh, '无', 'None')}</p></div>
        </div>}
      </section>
      <section className="research-panel">
        <div className="research-panel-title"><div><CircleDot size={15} /><strong>{text(zh, '行动记录', 'Action log')}</strong></div><span>{snapshot.researchSteps.length}</span></div>
        {recent.length === 0 ? <p className="muted">{text(zh, '尚无行动。', 'No actions yet.')}</p> : <div className="step-list">{recent.map((step) => <article key={step.id}><div><b>{step.iteration}</b><span>{zh ? stageZh[step.stage] ?? step.stage : step.stage}</span><em>{zh ? roleZh[step.role] ?? step.role : step.role}</em></div><strong>{step.action}</strong><p>{step.outputs}</p><footer>{step.elapsedMs} ms · {step.evidenceIds.length} {text(zh, '项证据', 'evidence')}</footer></article>)}</div>}
      </section>
    </div>
  </div>;
}

function Metric({ icon: Icon, label, value }: { icon: typeof Clock3; label: string; value: string }) {
  return <div className="research-metric"><Icon size={16} /><span>{label}</span><strong>{value}</strong></div>;
}

export function BranchesView() {
  const { snapshot, language } = useAppStore(); if (!snapshot) return null; const zh = language === 'zh';
  return <div className="collection-view"><header className="view-toolbar"><div><h1>{text(zh, '研究分支', 'Research branches')}</h1><span>{snapshot.branches.length}</span></div></header>
    {snapshot.branches.length === 0 ? <Empty title={text(zh, '尚无分支', 'No branches')} /> : <div className="record-list">{snapshot.branches.map((branch) => <article className="branch-card" key={branch.id}><div className="record-top"><span className="kind-label"><GitBranch size={13} />{branch.method}</span><span className={`status-pill status-${branch.status}`}>{branch.status}</span></div><h2>{branch.title}</h2><p>{branch.objective}</p><div className="branch-stats"><span>{text(zh, '优先级', 'Priority')} {branch.priority}</span><span>{branch.findings.length} {text(zh, '项发现', 'findings')}</span><span>{branch.failures.length} {text(zh, '项问题', 'issues')}</span></div></article>)}</div>}
  </div>;
}

export function ProofsView() {
  const { snapshot, language } = useAppStore(); if (!snapshot) return null; const zh = language === 'zh';
  return <div className="collection-view"><header className="view-toolbar"><div><h1>{text(zh, '结构化证明', 'Structured proofs')}</h1><span>{snapshot.proofs.length}</span></div></header>
    {snapshot.proofs.length === 0 ? <Empty title={text(zh, '尚无证明草案', 'No proof drafts')} /> : <div className="proof-list">{snapshot.proofs.slice().reverse().map((proof) => { const verified = canDisplayVerifiedProof(proof); return <article className="proof-card" key={proof.id}>
      <header><div><span className="kind-label">THEOREM</span><h2>{proof.theorem}</h2></div><span className={`proof-gate ${verified ? 'verified' : 'blocked'}`}>{verified ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}{verified ? text(zh, '已验证证明', 'VERIFIED PROOF') : text(zh, '验证未通过', 'NOT VERIFIED')}</span></header>
      <div className="proof-steps">{proof.steps.map((step, index) => <section key={step.id}><div><b>{index + 1}</b><strong>{step.title}</strong><span className={`step-status step-${step.status.toLowerCase()}`}>{step.status}</span></div><MathMarkdown content={step.statement} /><p>{step.argument}</p>{step.verifierComment && <small>{step.verifierComment}</small>}</section>)}</div>
    </article>; })}</div>}
  </div>;
}

function Empty({ title }: { title: string }) { return <div className="collection-empty"><span>∅</span><h3>{title}</h3></div>; }

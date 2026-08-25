import { useState } from 'react';
import { Pause, Play, RotateCcw, ShieldAlert, Sparkles } from 'lucide-react';
import type { DiscoveryConfig, DiscoveryProblem, DiscoveryRun } from '../shared/types';
import { useAppStore } from '../store';

const example = JSON.stringify({
  problem: {
    universeSize: 24,
    candidateSize: 7,
    incompatibilities: [[0, 1], [2, 3], [4, 5], [6, 7], [8, 9], [10, 11]],
    coverageGroups: [[0, 4, 8, 12, 16, 20], [1, 5, 9, 13, 17, 21], [2, 6, 10, 14, 18, 22], [3, 7, 11, 15, 19, 23]],
  },
  config: { populationSize: 64, generations: 80, workerCount: 4, seed: 71, mutationRate: 0.18, archiveLimit: 48 },
}, null, 2);

export function DiscoveryLab() {
  const { snapshot, refresh, language } = useAppStore();
  const [source, setSource] = useState(example);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  if (!snapshot) return null;
  const run = snapshot.discoveryRuns.at(-1);
  const start = async () => {
    setBusy(true); setNotice('');
    try {
      const result = await window.research.discovery.start(snapshot.project.id, JSON.parse(source) as { problem: DiscoveryProblem; config: DiscoveryConfig });
      setNotice(result.status === 'COMPLETED' ? (language === 'zh' ? '搜索已完成。' : 'Search completed.') : result.error);
      await refresh();
    } catch (error) { setNotice(error instanceof Error ? error.message : (language === 'zh' ? '无法启动搜索。' : 'Unable to start search.')); }
    finally { setBusy(false); }
  };
  const resume = async () => {
    if (!run) return;
    setBusy(true); setNotice('');
    try { const result = await window.research.discovery.resume(snapshot.project.id, run.id); setNotice(result.status === 'COMPLETED' ? (language === 'zh' ? '搜索已完成。' : 'Search completed.') : result.error); await refresh(); }
    catch (error) { setNotice(error instanceof Error ? error.message : (language === 'zh' ? '无法恢复搜索。' : 'Unable to resume search.')); }
    finally { setBusy(false); }
  };
  const stop = async () => { await window.research.discovery.stop(snapshot.project.id); setNotice(language === 'zh' ? '正在在当前代结束后暂停。' : 'Pausing after the current generation.'); };
  return <div className="discovery-view">
    <header className="view-toolbar"><div><h1>{language === 'zh' ? '构造发现' : 'Construction discovery'}</h1><span>{language === 'zh' ? '有限候选 · Pareto 归档 · 可复现 worker 搜索' : 'Finite candidates · Pareto archive · reproducible worker search'}</span></div></header>
    <div className="discovery-content">
      <section className="discovery-card discovery-intro"><Sparkles size={20} /><div><h2>{language === 'zh' ? '受限的有限构造搜索' : 'Constrained finite-construction search'}</h2><p>{language === 'zh' ? '固定 evaluator 仅计算冲突、覆盖和离散度；不执行模型或用户提供的任意程序。结果是候选与计算记录，不是数学证明。' : 'The fixed evaluator measures conflicts, coverage, and spread only; it never executes model or user code. Results are candidates and computation records, not proofs.'}</p></div></section>
      <section className="discovery-card"><div className="discovery-section-head"><div><h2>{language === 'zh' ? '问题与预算' : 'Problem and budget'}</h2><p>{language === 'zh' ? '索引从 0 开始；worker 数量限制为 1–32。' : 'Indices are zero-based; worker count is capped at 1–32.'}</p></div><button className="button secondary" disabled={busy} onClick={() => setSource(example)}><RotateCcw size={14} />{language === 'zh' ? '载入示例' : 'Load example'}</button></div>
        <textarea aria-label="Discovery specification JSON" className="discovery-editor" value={source} disabled={busy} onChange={(event) => setSource(event.target.value)} spellCheck={false} />
        <div className="discovery-actions">{busy ? <button className="button secondary" onClick={() => void stop()}><Pause size={14} />{language === 'zh' ? '暂停' : 'Pause'}</button> : <button className="button primary" onClick={() => void start()}><Play size={14} />{language === 'zh' ? '开始搜索' : 'Start search'}</button>}{run?.status === 'PAUSED' && !busy && <button className="button secondary" onClick={() => void resume()}><Play size={14} />{language === 'zh' ? '恢复上次搜索' : 'Resume last search'}</button>}</div>
        {notice && <p className="discovery-notice">{notice}</p>}
      </section>
      {run && <RunSummary run={run} language={language} />}
    </div>
  </div>;
}

function RunSummary({ run, language }: { run: DiscoveryRun; language: 'zh' | 'en' }) {
  const best = run.archive[0];
  return <section className="discovery-card"><div className="discovery-section-head"><div><h2>{language === 'zh' ? '最近一次运行' : 'Latest run'}</h2><p>{new Date(run.updatedAt).toLocaleString()}</p></div><span className={`discovery-status status-${run.status.toLowerCase()}`}>{run.status}</span></div>
    <div className="discovery-metrics"><div><span>{language === 'zh' ? '代数' : 'Generation'}</span><strong>{run.generation} / {run.config.generations}</strong></div><div><span>{language === 'zh' ? '已评估候选' : 'Candidates evaluated'}</span><strong>{run.totalEvaluated}</strong></div><div><span>{language === 'zh' ? '归档候选' : 'Archive entries'}</span><strong>{run.archive.length}</strong></div><div><span>{language === 'zh' ? 'worker 上限' : 'Worker cap'}</span><strong>{run.config.workerCount}</strong></div></div>
    {best ? <div className="discovery-best"><h3>{language === 'zh' ? '当前 Pareto 首项' : 'Current leading Pareto entry'}</h3><code>[{best.genes.join(', ')}]</code><span>{language === 'zh' ? `冲突 ${best.violations} · 覆盖 ${best.coverage} · 离散度 ${best.spread} · 新颖性 ${best.novelty}` : `violations ${best.violations} · coverage ${best.coverage} · spread ${best.spread} · novelty ${best.novelty}`}</span></div> : <div className="discovery-warning"><ShieldAlert size={15} />{language === 'zh' ? '尚无已评估候选。' : 'No candidate has been evaluated yet.'}</div>}
    {run.error && <p className="discovery-warning"><ShieldAlert size={15} />{run.error}</p>}
  </section>;
}

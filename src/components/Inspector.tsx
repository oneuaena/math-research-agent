import { CheckCircle2, Circle, Clock3, FlaskConical, TriangleAlert } from 'lucide-react';
import { useAppStore } from '../store';
import { MathMarkdown } from './MathMarkdown';
import { knownText, stageZh, t } from '../i18n';

export function Inspector() {
  const { snapshot, selectedNodeId, running, stage, language } = useAppStore();
  if (!snapshot) return null;
  const node = snapshot.nodes.find((item) => item.id === selectedNodeId);
  return <aside className="inspector">
    <header className="inspector-header"><span>{t(language, 'inspector')}</span>{running && <div className="agent-live"><i />{language === 'zh' ? stageZh[stage] ?? stage : stage}</div>}</header>
    {node ? <section className="node-inspector">
      <div className="record-top"><span className="kind-label">{node.kind}</span><span className={`status-pill status-${node.status}`}>{node.status}</span></div>
      <h2>{node.title}</h2><MathMarkdown content={node.content || node.summary || '—'} />
      <dl><dt>{t(language, 'dependencies')}</dt><dd>{node.dependencies.length || '—'}</dd><dt>{t(language, 'sources')}</dt><dd>{node.sources.length || '—'}</dd><dt>{t(language, 'tools')}</dt><dd>{node.tools.join(', ') || '—'}</dd></dl>
    </section> : <section className="activity-panel">
      <div className="panel-label">{t(language, 'agentActivity')}</div>
      <div className="activity-list">{snapshot.activities.length === 0 ? <div className="compact-empty">{t(language, 'noActivity')}</div> : snapshot.activities.map((activity) => <article className="activity-item" key={activity.id}>
        <div className={`activity-icon ${activity.status}`}>{activity.kind === 'tool' ? <FlaskConical size={13} /> : activity.status === 'failed' ? <TriangleAlert size={13} /> : activity.status === 'succeeded' ? <CheckCircle2 size={13} /> : activity.status === 'running' ? <Clock3 size={13} /> : <Circle size={12} />}</div>
        <div><strong>{language === 'zh' && activity.kind === 'agent' ? stageZh[activity.stage] ?? knownText(language, activity.title) : knownText(language, activity.title)}</strong><span>{language === 'zh' ? stageZh[activity.stage] ?? activity.stage : activity.stage}{activity.durationMs ? ` · ${activity.durationMs} ms` : ''}</span>{activity.detail && <p>{knownText(language, activity.detail)}</p>}</div>
      </article>)}</div>
    </section>}
  </aside>;
}

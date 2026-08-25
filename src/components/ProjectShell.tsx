import {
  ArrowLeft, BookMarked, BrainCircuit, CircleDot, FileOutput, Files, FlaskConical, GitBranch, MessageSquare,
  History, Languages, MemoryStick, Moon, Network, PanelRight, Play, Plus, ScrollText, Settings, ShieldCheck, Square, Sun,
} from 'lucide-react';
import { useState } from 'react';
import { STAGE_LABELS } from '../shared/agent';
import { useAppStore, type WorkspaceView } from '../store';
import { ExperimentsView, FailuresView, MemoryView, PapersView, PropositionsView, ReportsView } from './RecordViews';
import { Inspector } from './Inspector';
import { Notebook } from './Notebook';
import { ResearchTree } from './ResearchTree';
import { AttackHistoryView, StressResultView } from './StressViews';
import { BranchesView, ProofsView, ResearchConsole } from './ResearchViews';
import { stageZh, t, type CopyKey } from '../i18n';
import { ChatWorkspace } from './ChatWorkspace';
import { FormalLab } from './FormalLab';
import { DiscoveryLab } from './DiscoveryLab';

const stressNav: Array<{ view: WorkspaceView; label: CopyKey; icon: typeof CircleDot }> = [
  { view: 'result', label: 'stressTest', icon: ShieldCheck },
  { view: 'attacks', label: 'attackHistory', icon: History },
  { view: 'tree', label: 'attackTree', icon: GitBranch },
  { view: 'experiments', label: 'experiments', icon: FlaskConical },
  { view: 'discovery', label: 'discovery', icon: CircleDot },
  { view: 'formal', label: 'formalLab', icon: ShieldCheck },
  { view: 'memory', label: 'researchMemory', icon: MemoryStick },
  { view: 'notebook', label: 'notebook', icon: BookMarked },
  { view: 'papers', label: 'papers', icon: Files },
  { view: 'reports', label: 'report', icon: FileOutput },
];

const researchNav: Array<{ view: WorkspaceView; label: CopyKey; icon: typeof CircleDot }> = [
  { view: 'chat', label: 'chat', icon: MessageSquare },
  { view: 'research', label: 'researchSession', icon: CircleDot },
  { view: 'tree', label: 'proofGraph', icon: Network },
  { view: 'branches', label: 'branches', icon: GitBranch },
  { view: 'proofs', label: 'proofs', icon: ScrollText },
  { view: 'formal', label: 'formalLab', icon: ShieldCheck },
  { view: 'experiments', label: 'experiments', icon: FlaskConical },
  { view: 'discovery', label: 'discovery', icon: CircleDot },
  { view: 'memory', label: 'researchMemory', icon: MemoryStick },
  { view: 'notebook', label: 'notebook', icon: BookMarked },
  { view: 'papers', label: 'papers', icon: Files },
  { view: 'reports', label: 'report', icon: FileOutput },
];

export function ProjectShell({ openSettings }: { openSettings(): void }) {
  const { snapshot, view, setView, closeProject, running, stage, startAgent, resumeAgent, pauseAgent, importDocuments, theme, toggleTheme, language, toggleLanguage } = useAppStore();
  const [inspectorOpen, setInspectorOpen] = useState(true);
  if (!snapshot) return null;
  const latestSession = snapshot.sessions.at(-1);
  const nav = snapshot.project.mode === 'stress-test' ? stressNav : researchNav;
  const resume = snapshot.project.mode !== 'stress-test' && Boolean(latestSession);
  const content = {
    chat: <ChatWorkspace />,
    research: <ResearchConsole />, branches: <BranchesView />, proofs: <ProofsView />,
    formal: <FormalLab />,
    discovery: <DiscoveryLab />,
    result: <StressResultView />, attacks: <AttackHistoryView />,
    notebook: <Notebook />, tree: <ResearchTree />, conjectures: <PropositionsView kind="Conjecture" />,
    lemmas: <PropositionsView kind="Lemma" />, experiments: <ExperimentsView />, papers: <PapersView />,
    failures: <FailuresView />, memory: <MemoryView />, reports: <ReportsView />,
  }[view];
  return <div className={`workspace-shell ${inspectorOpen ? '' : 'inspector-closed'}`}>
    <header className="workspace-topbar">
      <div className="workspace-brand"><span className="brand-mark">∴</span><span>Math Research Agent</span></div>
      <div className="project-crumb"><span>/</span><strong>{snapshot.project.name}</strong></div>
      <div className="run-state">{running && <><i /><span>{stage === 'IDLE' ? (language === 'zh' ? '运行中' : 'Running') : language === 'zh' ? stageZh[stage] ?? stage : STAGE_LABELS[stage]}</span></>}</div>
      <div className="workspace-actions"><span className="model-chip"><BrainCircuit size={14} />{snapshot.project.mode === 'stress-test' ? t(language, 'stressEngine') : t(language, 'autonomousResearch')}</span>
        <button className={`button run-button ${running ? 'stop' : ''}`} onClick={() => void (running ? pauseAgent() : resume ? resumeAgent() : startAgent())}>{running ? <><Square size={13} fill="currentColor" />{t(language, 'pause')}</> : <><Play size={13} fill="currentColor" />{resume ? t(language, 'resume') : t(language, 'run')}</>}</button>
        <button className="language-button compact-language" onClick={toggleLanguage} aria-label="Switch language"><Languages size={14} />{language === 'zh' ? 'EN' : '中'}</button>
        <button className="icon-button" onClick={() => setInspectorOpen(!inspectorOpen)} aria-label="Toggle inspector"><PanelRight size={17} /></button>
      </div>
    </header>
    <aside className="navigator">
      <button className="back-button" onClick={closeProject}><ArrowLeft size={15} />{t(language, 'projects')}</button>
      <div className="nav-label">PROJECT</div>
      <nav>{nav.map((item) => <button key={item.view} className={view === item.view ? 'active' : ''} onClick={() => setView(item.view)}><item.icon size={15} /><span>{t(language, item.label)}</span></button>)}</nav>
      <div className="navigator-bottom"><button onClick={() => void importDocuments()}><Plus size={15} />{t(language, 'importDocument')}</button><button onClick={openSettings}><Settings size={15} />{t(language, 'settings')}</button><button onClick={toggleTheme}>{theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}{t(language, 'theme')}</button></div>
    </aside>
    <main className="workspace-main">{content}</main>
    {inspectorOpen && <Inspector />}
  </div>;
}

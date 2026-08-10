import { useState } from 'react';
import { ArrowUpRight, Languages, Moon, Plus, Settings, Sun, Trash2 } from 'lucide-react';
import { t } from '../i18n';
import { useAppStore } from '../store';
import { NewProjectModal } from './NewProjectModal';

export function Dashboard({ openSettings }: { openSettings(): void }) {
  const { projects, openProject, removeProject, theme, toggleTheme, language, toggleLanguage } = useAppStore();
  const [creating, setCreating] = useState(false);
  return <div className="dashboard">
    <header className="dashboard-topbar">
      <div className="brand"><span className="brand-mark">∴</span><span>Math Research Agent</span></div>
      <div className="top-actions"><button className="language-button" onClick={toggleLanguage} aria-label="Switch language"><Languages size={15} />{language === 'zh' ? 'EN' : '中'}</button><button className="icon-button" onClick={toggleTheme} aria-label="Toggle theme">{theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}</button><button className="icon-button" onClick={openSettings} aria-label="Settings"><Settings size={17} /></button></div>
    </header>
    <main className="dashboard-main">
      <section className="dashboard-heading"><div><span className="eyebrow">{t(language, 'autonomousResearch').toUpperCase()}</span><h1>{language === 'zh' ? '提出问题，持续研究。' : 'Ask a question. Keep researching.'}</h1><p className="dashboard-subtitle">{language === 'zh' ? '结构化猜想、并行探索、保存证据与证明缺口。' : 'Formalize conjectures, explore branches, and persist evidence and proof gaps.'}</p></div><button className="button primary" onClick={() => setCreating(true)}><Plus size={16} />{t(language, 'newProject')}</button></section>
      <section className="project-section"><div className="section-title"><h2>{t(language, 'recent')}</h2></div>
        {projects.length === 0 ? <div className="dashboard-empty"><div className="empty-symbol">∅</div><h3>{t(language, 'noProjects')}</h3><button className="text-button" onClick={() => setCreating(true)}>{t(language, 'createProject')}</button></div> :
          <div className="project-grid">{projects.map((project) => <article className="project-card" key={project.id} onClick={() => void openProject(project.id)}>
            <div className="project-card-top"><span className="project-mode">{project.mode === 'stress-test' ? t(language, 'stressTest') : project.mode === 'autonomous' ? t(language, 'autonomousResearch') : project.mode}</span><button className="icon-button subtle" aria-label="Delete project" onClick={(event) => { event.stopPropagation(); if (confirm(language === 'zh' ? `删除“${project.name}”？` : `Delete “${project.name}”?`)) void removeProject(project.id); }}><Trash2 size={14} /></button></div>
            <h3>{project.name}</h3><p>{project.question}</p>
            <footer><time>{new Date(project.updatedAt).toLocaleDateString()}</time><ArrowUpRight size={15} /></footer>
          </article>)}</div>}
      </section>
    </main>
    {creating && <NewProjectModal onClose={() => setCreating(false)} />}
  </div>;
}

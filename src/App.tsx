import { useEffect, useState } from 'react';
import { AlertCircle, X } from 'lucide-react';
import { Dashboard } from './components/Dashboard';
import { ProjectShell } from './components/ProjectShell';
import { SettingsModal } from './components/SettingsModal';
import { useAppStore } from './store';

export function App() {
  const { snapshot, loading, error, clearError, loadProjects, handleAgentEvent, theme } = useAppStore();
  const [settings, setSettings] = useState(false);
  useEffect(() => { void loadProjects(); const unsubscribe = window.research.agent.onEvent(handleAgentEvent); return unsubscribe; }, [loadProjects, handleAgentEvent]);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  return <>
    {loading && !snapshot ? <div className="app-loading"><span className="brand-mark">∴</span></div> : snapshot ? <ProjectShell openSettings={() => setSettings(true)} /> : <Dashboard openSettings={() => setSettings(true)} />}
    {settings && <SettingsModal onClose={() => setSettings(false)} />}
    {error && <div className="error-toast"><AlertCircle size={16} /><span>{error}</span><button className="icon-button" onClick={clearError}><X size={15} /></button></div>}
  </>;
}

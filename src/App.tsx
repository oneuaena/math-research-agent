import { useEffect, useState } from 'react';
import { AlertCircle, X } from 'lucide-react';
import { Dashboard } from './components/Dashboard';
import { ProjectShell } from './components/ProjectShell';
import { SettingsModal } from './components/SettingsModal';
import { useAppStore } from './store';

export function App() {
  const { snapshot, loading, error, clearError, loadProjects, handleAgentEvent, handleChatEvent, theme } = useAppStore();
  const [settings, setSettings] = useState(false);
  useEffect(() => {
    void loadProjects();
    const unsubscribeAgent = window.research.agent.onEvent(handleAgentEvent);
    const unsubscribeChat = window.research.chat.onEvent(handleChatEvent);
    return () => { unsubscribeAgent(); unsubscribeChat(); };
  }, [loadProjects, handleAgentEvent, handleChatEvent]);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  return <>
    {loading && !snapshot ? <div className="app-loading"><span className="brand-mark">∴</span></div> : snapshot ? <ProjectShell openSettings={() => setSettings(true)} /> : <Dashboard openSettings={() => setSettings(true)} />}
    {settings && <SettingsModal onClose={() => setSettings(false)} />}
    {error && <div className="error-toast"><AlertCircle size={16} /><span>{error}</span><button className="icon-button" onClick={clearError}><X size={15} /></button></div>}
  </>;
}

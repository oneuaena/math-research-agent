import { useEffect, useState, type FormEvent } from 'react';
import type { CredentialStatus, ProviderConnectionResult, ProviderSettings, RuntimeDiagnostics } from '../shared/types';
import { Modal } from './Modal';
import { t } from '../i18n';
import { useAppStore } from '../store';

export function SettingsModal({ onClose }: { onClose(): void }) {
  const language = useAppStore((state) => state.language);
  const [settings, setSettings] = useState<ProviderSettings | null>(null);
  const [credential, setCredential] = useState<CredentialStatus | null>(null);
  const [key, setKey] = useState('');
  const [status, setStatus] = useState('');
  const [diagnostic, setDiagnostic] = useState<ProviderConnectionResult | null>(null);
  const [runtimeDiagnostic, setRuntimeDiagnostic] = useState<RuntimeDiagnostics | null>(null);
  const [appVersion, setAppVersion] = useState('');
  useEffect(() => {
    void Promise.all([window.research.settings.get(), window.research.settings.credentialStatus()]).then(([nextSettings, nextCredential]) => { setSettings(nextSettings); setCredential(nextCredential); });
    void window.research.system.runtimeDiagnostics().then(setRuntimeDiagnostic);
    void window.research.system.appVersion().then(setAppVersion);
  }, []);
  if (!settings || !credential) return <Modal title={t(language, 'settings')} onClose={onClose}><div className="modal-loading">Loading…</div></Modal>;
  const update = <K extends keyof ProviderSettings>(field: K, value: ProviderSettings[K]) => setSettings((current) => current ? { ...current, [field]: value } : current);
  const updateLiteratureProvider = (provider: keyof ProviderSettings['literatureProviders'], enabled: boolean) => setSettings((current) => current ? { ...current, literatureProviders: { ...current.literatureProviders, [provider]: enabled } } : current);
  const persist = async () => { setSettings(await window.research.settings.save(settings)); if (key.trim()) { setCredential(await window.research.settings.saveCredential(key)); setKey(''); } };
  const save = async (event: FormEvent) => { event.preventDefault(); await persist(); setDiagnostic(null); setStatus(language === 'zh' ? '已保存。' : 'Saved.'); };
  const test = async () => { setStatus(language === 'zh' ? '正在发送最小模型请求…' : 'Sending a minimal model request…'); setDiagnostic(null); await persist(); const result = await window.research.settings.testProvider(); setDiagnostic(result); setStatus(result.message); };
  const checkRuntime = async () => { setStatus(language === 'zh' ? '正在检查运行环境…' : 'Checking runtime…'); setRuntimeDiagnostic(null); const result = await window.research.system.runtimeDiagnostics(); setRuntimeDiagnostic(result); setStatus(result.ok ? (language === 'zh' ? '运行环境正常。' : 'Runtime ready.') : result.error); };
  return <Modal title={t(language, 'settings')} onClose={onClose} wide>
    <form className="settings-form" onSubmit={save}>
      <section><h3>{t(language, 'modelProvider')}</h3><div className="settings-grid">
        <label className="field"><span>{t(language, 'provider')}</span><select value={settings.provider} onChange={(e) => update('provider', e.target.value as ProviderSettings['provider'])}><option value="local">{language === 'zh' ? '本地协调器' : 'Local coordinator'}</option><option value="openai-compatible">OpenAI-compatible API</option></select></label>
        <label className="field"><span>{t(language, 'model')}</span><input value={settings.model} onChange={(e) => update('model', e.target.value)} disabled={settings.provider === 'local'} /></label>
        <label className="field field-full"><span>Base URL</span><input value={settings.baseUrl} onChange={(e) => update('baseUrl', e.target.value)} disabled={settings.provider === 'local'} /></label>
        <label className="field field-full"><span>{t(language, 'apiKey')} · {credential.configured ? t(language, 'configured') : t(language, 'notConfigured')}</span><input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={credential.masked || (language === 'zh' ? '输入密钥' : 'Enter key')} disabled={settings.provider === 'local'} /></label>
      </div>
      {settings.provider !== 'local' && <p className="privacy-note">{language === 'zh' ? '研究运行会把问题、研究状态以及已提取的导入文档片段发送给所配置的模型 Provider；原始文件保留在本机。' : 'Research runs send the question, research state, and extracted imported-document chunks to the configured model provider; original files remain local.'}</p>}
      </section>
      <section><h3>{language === 'zh' ? '文献检索' : 'Literature search'}</h3><div className="literature-settings-grid">
        <label className="field"><span>{language === 'zh' ? '自动检索' : 'Search mode'}</span><select value={settings.literatureSearchMode} onChange={(event) => update('literatureSearchMode', event.target.value as ProviderSettings['literatureSearchMode'])}><option value="auto">{language === 'zh' ? '自动' : 'Automatic'}</option><option value="manual">{language === 'zh' ? '仅手动' : 'Manual only'}</option><option value="off">{language === 'zh' ? '关闭' : 'Off'}</option></select></label>
        <div className="field"><span>{language === 'zh' ? '检索范围' : 'Search scope'}</span><div className="checkbox-line"><label><input type="checkbox" checked={settings.searchDomesticSources} onChange={(event) => update('searchDomesticSources', event.target.checked)} />{language === 'zh' ? '中文查询' : 'Chinese queries'}</label><label><input type="checkbox" checked={settings.searchInternationalSources} onChange={(event) => update('searchInternationalSources', event.target.checked)} />{language === 'zh' ? '国际来源' : 'International'}</label></div></div>
        <div className="field field-full"><span>Providers</span><div className="checkbox-line provider-options">{(['arxiv', 'crossref', 'openalex', 'semantic-scholar', 'web'] as const).map((provider) => <label key={provider}><input type="checkbox" checked={settings.literatureProviders[provider]} onChange={(event) => updateLiteratureProvider(provider, event.target.checked)} />{provider === 'web' ? (language === 'zh' ? 'Web（未配置时会明确报错）' : 'Web (reports when unconfigured)') : provider}</label>)}</div></div>
      </div></section>
      <section><h3>{t(language, 'runtime')}</h3><div className="settings-grid">
        <label className="field field-full"><span>{t(language, 'pythonExecutable')}</span><input value={runtimeDiagnostic?.source === 'bundled' ? `Bundled · ${runtimeDiagnostic.displayPath}` : settings.pythonPath} onChange={(e) => update('pythonPath', e.target.value)} disabled={runtimeDiagnostic?.source === 'bundled'} /></label>
        <label className="field field-full"><span>{language === 'zh' ? 'Lean 4 / Lake 可执行文件（留空自动检测）' : 'Lean 4 / Lake executable (blank for auto-detect)'}</span><input value={settings.leanPath} onChange={(e) => update('leanPath', e.target.value)} placeholder={language === 'zh' ? '自动检测 ~/.elan/bin/lake' : 'Auto-detect ~/.elan/bin/lake'} /></label>
        <label className="field"><span>{language === 'zh' ? '每轮行动预算' : 'Actions per run'}</span><input type="number" min={1} max={500} value={settings.maxIterations} onChange={(e) => update('maxIterations', Number(e.target.value))} /></label>
        <label className="field"><span>{t(language, 'toolTimeout')}</span><input type="number" min={2} max={120} value={settings.maxToolSeconds} onChange={(e) => update('maxToolSeconds', Number(e.target.value))} /></label>
        <label className="field"><span>{language === 'zh' ? 'Provider HTTP 超时 · 秒' : 'Provider HTTP timeout · seconds'}</span><input type="number" min={120} max={600} value={settings.providerTimeoutSeconds} onChange={(e) => update('providerTimeoutSeconds', Number(e.target.value))} /></label>
        <label className="field"><span>{language === 'zh' ? '最长研究时间 · 分钟' : 'Maximum research time · minutes'}</span><input type="number" min={1} max={720} value={settings.maxResearchMinutes} onChange={(e) => update('maxResearchMinutes', Number(e.target.value))} /></label>
        <label className="field"><span>{language === 'zh' ? '检查点间隔 · 行动' : 'Checkpoint interval · actions'}</span><input type="number" min={1} max={100} value={settings.checkpointEvery} onChange={(e) => update('checkpointEvery', Number(e.target.value))} /></label>
        <label className="field"><span>{language === 'zh' ? '最大研究分支' : 'Maximum branches'}</span><input type="number" min={1} max={12} value={settings.maxBranches} onChange={(e) => update('maxBranches', Number(e.target.value))} /></label>
      </div>
      <div className={`provider-diagnostic ${runtimeDiagnostic?.ok ? 'success' : runtimeDiagnostic ? 'failure' : ''}`} aria-label="Runtime diagnostics">
        <header><strong>{runtimeDiagnostic ? (runtimeDiagnostic.ok ? (language === 'zh' ? '运行环境正常' : 'RUNTIME READY') : (language === 'zh' ? '运行环境异常' : 'RUNTIME ERROR')) : (language === 'zh' ? '正在检查…' : 'Checking…')}</strong><button type="button" className="button secondary compact" onClick={checkRuntime}>{language === 'zh' ? '重新检查' : 'Check again'}</button></header>
        {runtimeDiagnostic && <><dl>
          <dt>App</dt><dd>{appVersion || '—'}</dd>
          <dt>Python</dt><dd>{runtimeDiagnostic.python.available ? runtimeDiagnostic.python.version : 'Unavailable'}</dd>
          <dt>SymPy</dt><dd>{runtimeDiagnostic.sympy.available ? runtimeDiagnostic.sympy.version : 'Unavailable'}</dd>
          <dt>NumPy</dt><dd>{runtimeDiagnostic.numpy.available ? runtimeDiagnostic.numpy.version : 'Not bundled'}</dd>
          <dt>SciPy</dt><dd>{runtimeDiagnostic.scipy.available ? runtimeDiagnostic.scipy.version : 'Not bundled'}</dd>
          <dt>Z3</dt><dd>{runtimeDiagnostic.z3.available ? `${runtimeDiagnostic.z3.version}${runtimeDiagnostic.z3.satTest ? ' · SAT OK' : ''}${runtimeDiagnostic.z3.unsatTest ? ' · UNSAT OK' : ''}` : 'Not bundled'}</dd>
          <dt>Lean 4</dt><dd>{runtimeDiagnostic.lean.available ? `${runtimeDiagnostic.lean.version || 'Available'}${runtimeDiagnostic.lean.kernelTest ? ' · KERNEL OK' : ''}${runtimeDiagnostic.lean.sorryRejected ? ' · SORRY REJECTED' : ''}` : 'Unavailable'}</dd>
          <dt>Sage</dt><dd>{runtimeDiagnostic.sage.available ? runtimeDiagnostic.sage.version : 'Optional · unavailable'}</dd>
          <dt>Worker</dt><dd>{runtimeDiagnostic.workerOk ? 'OK' : 'FAILED'}</dd>
          <dt>Workspace</dt><dd>{runtimeDiagnostic.workspaceWritable ? 'Writable' : 'FAILED'}</dd>
          <dt>2 + 2</dt><dd>{runtimeDiagnostic.arithmetic.passed ? '4 · OK' : 'FAILED'}</dd>
          <dt>factor(x² − 1)</dt><dd>{runtimeDiagnostic.factorization.passed ? '(x − 1)(x + 1) · OK' : 'FAILED'}</dd>
        </dl>{runtimeDiagnostic.error && <p>{runtimeDiagnostic.error}</p>}</>}
      </div></section>
      {diagnostic && <section className={`provider-diagnostic ${diagnostic.ok ? 'success' : 'failure'}`} aria-label="Provider diagnostic">
        <header><strong>{diagnostic.ok ? (language === 'zh' ? '连接成功' : 'CONNECTED') : diagnostic.errorType}</strong><span>{diagnostic.elapsedMs} ms</span></header>
        <dl><dt>HTTP</dt><dd>{diagnostic.httpStatus ?? '—'}</dd><dt>{language === 'zh' ? '类型' : 'Type'}</dt><dd>{diagnostic.errorType ?? 'OK'}</dd><dt>{language === 'zh' ? '端点' : 'Endpoint'}</dt><dd>{diagnostic.endpoint}</dd><dt>{language === 'zh' ? '模型' : 'Model'}</dt><dd>{diagnostic.model}</dd></dl>
        <p>{diagnostic.message}{diagnostic.ok && diagnostic.response ? ` · ${diagnostic.response}` : ''}</p>
      </section>}
      <footer className="modal-actions"><span className="save-status">{status}</span>{credential.configured && <button type="button" className="button danger" onClick={async () => { setCredential(await window.research.settings.removeCredential()); setStatus(language === 'zh' ? '密钥已移除。' : 'Key removed.'); }}>{t(language, 'removeKey')}</button>}<button type="button" className="button secondary" onClick={test}>{t(language, 'test')}</button><button className="button primary">{t(language, 'save')}</button></footer>
    </form>
  </Modal>;
}

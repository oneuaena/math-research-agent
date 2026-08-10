import { useState, type FormEvent } from 'react';
import type { CreateProjectInput, ResearchMode } from '../shared/types';
import { DEMO_CASES } from '../shared/demoCases';
import { demoCopy, t } from '../i18n';
import { useAppStore } from '../store';
import { Modal } from './Modal';

const modes: Array<{ value: ResearchMode; zh: string; en: string }> = [
  { value: 'autonomous', zh: '自主研究', en: 'Autonomous research' },
  { value: 'stress-test', zh: '压力测试', en: 'Stress test' },
];

export function NewProjectModal({ onClose }: { onClose(): void }) {
  const createProject = useAppStore((state) => state.createProject);
  const language = useAppStore((state) => state.language);
  const [form, setForm] = useState<CreateProjectInput>({ name: '', question: '', goal: '', background: '', knownResults: '', constraints: '', variables: '', domain: '', assumptions: '', notes: '', mode: 'autonomous', demoCaseId: null });
  const update = (key: keyof CreateProjectInput, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.name.trim() || !form.question.trim()) return;
    await createProject(form);
    onClose();
  };
  return <Modal title={t(language, 'newProject')} onClose={onClose} wide>
    <form className="intake-form" onSubmit={submit}>
      <label className="field"><span>{t(language, 'projectName')}</span><input autoFocus value={form.name} onChange={(e) => update('name', e.target.value)} required /></label>
      <div className="field"><span>{t(language, 'researchMode')}</span><div className="mode-grid compact-modes">{modes.map((mode) => <button type="button" key={mode.value} className={form.mode === mode.value ? 'mode-option active' : 'mode-option'} onClick={() => setForm((current) => ({ ...current, mode: mode.value, demoCaseId: null, goal: mode.value === 'stress-test' ? 'Stress test' : current.goal === 'Stress test' ? '' : current.goal }))}>{language === 'zh' ? mode.zh : mode.en}</button>)}</div></div>
      {form.mode === 'stress-test' && <div className="field field-full"><span>{t(language, 'testConjectures')}</span><div className="demo-grid">{DEMO_CASES.map((demo) => { const text = demoCopy[demo.id][language]; return <button type="button" key={demo.id} className={form.demoCaseId === demo.id ? 'demo-option active' : 'demo-option'} onClick={() => setForm({ ...demo.input })}><strong>{text[0]}</strong><small>{text[1]}</small></button>; })}</div></div>}
      <label className="field field-full"><span>{t(language, 'statement')}</span><textarea rows={4} value={form.question} onChange={(e) => update('question', e.target.value)} required /></label>
      {form.mode !== 'stress-test' && <label className="field field-full"><span>{language === 'zh' ? '研究目标' : 'Research goal'}</span><input value={form.goal} onChange={(e) => update('goal', e.target.value)} /></label>}
      <label className="field"><span>{t(language, 'variables')}</span><input value={form.variables ?? ''} onChange={(e) => update('variables', e.target.value)} /></label>
      <label className="field"><span>{t(language, 'domain')}</span><input value={form.domain ?? ''} onChange={(e) => update('domain', e.target.value)} /></label>
      <label className="field field-full"><span>{t(language, 'assumptions')}</span><textarea rows={3} value={form.assumptions ?? ''} onChange={(e) => update('assumptions', e.target.value)} /></label>
      <label className="field"><span>{t(language, 'constraints')}</span><textarea rows={3} value={form.constraints} onChange={(e) => update('constraints', e.target.value)} /></label>
      <label className="field"><span>{t(language, 'notes')}</span><textarea rows={3} value={form.notes ?? ''} onChange={(e) => update('notes', e.target.value)} /></label>
      <footer className="modal-actions field-full"><button type="button" className="button secondary" onClick={onClose}>{t(language, 'cancel')}</button><button className="button primary" disabled={!form.name.trim() || !form.question.trim()}>{t(language, 'createProject')}</button></footer>
    </form>
  </Modal>;
}

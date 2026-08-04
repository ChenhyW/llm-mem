import React, { useState, useCallback, useEffect } from 'react';
import type { Settings, DependencyStatus } from '../types';
import { TerminalPreview } from './TerminalPreview';
import { useContextPreview } from '../hooks/useContextPreview';
import { DEFAULT_SETTINGS } from '../constants/settings';

export interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: Settings;
  onSave: (settings: Settings) => Promise<boolean>;
  isSaving: boolean;
  saveStatus: string;
  restartWorker: () => Promise<boolean>;
  isRestarting: boolean;
  restartStatus: string;
  dependencyHealth: DependencyStatus[];
}

type TabKey = 'basic' | 'model' | 'embed' | 'context' | 'diagnosis' | 'mcp';

interface Tab {
  key: TabKey;
  label: string;
  icon: React.ReactNode;
}

const TABS: Tab[] = [
  {
    key: 'basic',
    label: '基础',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.09a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
  },
  {
    key: 'model',
    label: '模型',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="9 11 12 8 15 11 12 14 9 11"/><path d="M12 2L4 6v6c0 4.42 3.37 8.42 8 10 4.63-1.58 8-5.58 8-10V6l-8-4z"/></svg>,
  },
  {
    key: 'embed',
    label: '向量',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="20" y2="4"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>,
  },
  {
    key: 'context',
    label: '上下文',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>,
  },
  {
    key: 'diagnosis',
    label: '诊断',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>,
  },
];

function CollapsibleSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(true);
  return (
    <div className={`settings-section-collapsible ${isOpen ? 'open' : ''}`}>
      <button
        className="section-header-btn"
        onClick={() => setIsOpen(!isOpen)}
        type="button"
      >
        <div className="section-header-content">
          <span className="section-title">{title}</span>
        </div>
        <svg
          className={`chevron-icon ${isOpen ? 'rotated' : ''}`}
          width="16" height="16" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {isOpen && <div className="section-content">{children}</div>}
    </div>
  );
}

interface FieldProps {
  label: string;
  tooltip?: string;
  children: React.ReactNode;
}
function Field({ label, tooltip, children }: FieldProps) {
  return (
    <div className="settings-field">
      <label className="settings-field-label">
        {label}
        {tooltip && <span className="tooltip-indicator" title={tooltip}>?</span>}
      </label>
      <div className="settings-field-input">{children}</div>
    </div>
  );
}

function TextField({
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={e => onChange(e.target.value)}
      className="settings-input"
    />
  );
}

function SelectField({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (v: string) => void;
}) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className="settings-input">
      {options.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

function ToggleField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: 'true' | 'false') => void;
}) {
  const on = value === 'true';
  return (
    <div className="settings-togger-row">
      <span className="settings-field-label">{label}</span>
      <button
        type="button"
        className={`toggle-btn ${on ? 'on' : 'off'}`}
        onClick={() => onChange(on ? 'false' : 'true')}
      >
        <span className="toggle-knob" />
      </button>
    </div>
  );
}

export function SettingsModal({
  isOpen,
  onClose,
  settings,
  onSave,
  isSaving,
  saveStatus,
  restartWorker,
  isRestarting,
  restartStatus,
  dependencyHealth,
}: SettingsModalProps) {
  const [draft, setDraft] = useState<Settings>(settings);
  const [activeTab, setActiveTab] = useState<TabKey>('basic');

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  const set = useCallback((key: keyof Settings, v: string) => {
    setDraft(d => ({ ...d, [key]: v }));
  }, []);

  const handleSave = async () => {
    const ok = await onSave(draft);
    if (ok) setTimeout(() => onClose(), 1500);
  };

  const handleSaveAndRestart = async () => {
    await onSave(draft);
    await restartWorker();
  };

  const handleCancel = () => {
    setDraft(settings);
    setActiveTab('basic');
    onClose();
  };

  const contextPreview = useContextPreview(draft);

  if (!isOpen) return null;

  const renderTab = () => {
    const provider = draft.LLM_MEM_PROVIDER ?? DEFAULT_SETTINGS.LLM_MEM_PROVIDER;
    const modelKey = provider === 'openrouter' ? 'LLM_MEM_OPENROUTER_MODEL' : 'LLM_MEM_MODEL';
    const modelValue = draft[modelKey] ?? DEFAULT_SETTINGS[modelKey];

    switch (activeTab) {
      case 'basic':
        return (
          <CollapsibleSection title="基础配置">
            <Field label="Worker 端口" tooltip="Worker HTTP 服务端口（改后需重启）">
              <TextField value={draft.LLM_MEM_WORKER_PORT ?? DEFAULT_SETTINGS.LLM_MEM_WORKER_PORT}
                onChange={v => set('LLM_MEM_WORKER_PORT', v)} />
            </Field>
            <Field label="Worker 主机" tooltip="Worker 监听地址">
              <TextField value={draft.LLM_MEM_WORKER_HOST ?? DEFAULT_SETTINGS.LLM_MEM_WORKER_HOST}
                onChange={v => set('LLM_MEM_WORKER_HOST', v)} />
            </Field>
            <Field label="日志级别" tooltip="DEBUG / INFO / WARN / ERROR / SILENT">
              <SelectField
                value={draft.LLM_MEM_LOG_LEVEL ?? 'INFO'}
                onChange={v => set('LLM_MEM_LOG_LEVEL', v)}
                options={[
                  { value: 'DEBUG', label: 'DEBUG' },
                  { value: 'INFO', label: 'INFO' },
                  { value: 'WARN', label: 'WARN' },
                  { value: 'ERROR', label: 'ERROR' },
                  { value: 'SILENT', label: 'SILENT' },
                ]}
              />
            </Field>
            <Field label="数据目录" tooltip="llm-mem 数据存放目录（默认 ~/.llm-mem）">
              <TextField value={draft.LLM_MEM_DATA_DIR ?? ''} placeholder="~/.llm-mem"
                onChange={v => set('LLM_MEM_DATA_DIR', v)} />
            </Field>
          </CollapsibleSection>
        );
      case 'model':
        return (
          <CollapsibleSection title="LLM Provider">
            <Field label="Provider" tooltip="AI 模型提供商">
              <SelectField
                value={draft.LLM_MEM_PROVIDER ?? 'claude'}
                onChange={v => set('LLM_MEM_PROVIDER', v)}
                options={[
                  { value: 'claude', label: 'claude (Claude SDK)' },
                  { value: 'gemini', label: 'gemini (Google)' },
                  { value: 'openrouter', label: 'openrouter (OpenRouter)' },
                ]}
              />
            </Field>
            <Field label="模型 (MODEL)" tooltip="生成观察摘要所使用的 LLM 模型名称（随 Provider 自动切换字段）">
              <TextField value={modelValue}
                onChange={v => set(modelKey, v)} />
            </Field>
            {draft.LLM_MEM_PROVIDER === 'claude' && (
              <div className="settings-field" style={{ opacity: 0.7 }}>
                <span className="settings-field-label">Claude 认证方式</span>
                <span className="settings-input" style={{ color: 'var(--color-text-muted)', cursor: 'default' }}>
                  subscription（Claude SDK 登录，在 Claude 中 /login 后生效）
                </span>
              </div>
            )}
            {draft.LLM_MEM_PROVIDER === 'gemini' && (
              <>
                <Field label="Gemini API Key">
                  <TextField value={draft.LLM_MEM_GEMINI_API_KEY ?? ''}
                    onChange={v => set('LLM_MEM_GEMINI_API_KEY', v)} type="password" />
                </Field>
                <ToggleField label="启用限流"
                  value={draft.LLM_MEM_GEMINI_RATE_LIMITING_ENABLED ?? 'true'}
                  onChange={v => set('LLM_MEM_GEMINI_RATE_LIMITING_ENABLED', v)} />
              </>
            )}
            {draft.LLM_MEM_PROVIDER === 'openrouter' && (
              <>
                <Field label="API Key">
                  <TextField value={draft.LLM_MEM_OPENROUTER_API_KEY ?? ''}
                    onChange={v => set('LLM_MEM_OPENROUTER_API_KEY', v)} type="password" />
                </Field>
                <Field label="Base URL (可选)" tooltip="自定义网关地址，如 https://api.deepseek.com 或 http://localhost:1234/v1。留空则使用默认 OpenRouter 端点">
                  <TextField value={draft.LLM_MEM_OPENROUTER_BASE_URL ?? ''}
                    onChange={v => set('LLM_MEM_OPENROUTER_BASE_URL', v)} />
                </Field>
                <Field label="OpenRouter App Name">
                  <TextField value={draft.LLM_MEM_OPENROUTER_APP_NAME ?? 'llm-mem'}
                    onChange={v => set('LLM_MEM_OPENROUTER_APP_NAME', v)} />
                </Field>
              </>
            )}
          </CollapsibleSection>
        );
      case 'embed':
        return (
          <CollapsibleSection title="向量搜索 (Ollama + hnswlib)">
            <Field label="Ollama 地址 (OLLAMA_URL)" tooltip="例如 http://192.168.1.2:11434">
              <TextField value={draft.LLM_MEM_OLLAMA_URL ?? DEFAULT_SETTINGS.LLM_MEM_OLLAMA_URL}
                onChange={v => set('LLM_MEM_OLLAMA_URL', v)} />
            </Field>
            <Field label="嵌入模型" tooltip="用于 hnswlib 向量检索的嵌入模型名">
              <TextField value={draft.LLM_MEM_VECTOR_EMBEDDING_MODEL ?? 'nomic-embed-text'}
                onChange={v => set('LLM_MEM_VECTOR_EMBEDDING_MODEL', v)} />
            </Field>
            <ToggleField label="禁用向量搜索"
              value={draft.LLM_MEM_DISABLE_VECTOR_SEARCH ?? 'false'}
              onChange={v => set('LLM_MEM_DISABLE_VECTOR_SEARCH', v)} />
          </CollapsibleSection>
        );
      case 'context':
        return (
          <>
            <CollapsibleSection title="上下文注入">
              <Field label="引用观察数" tooltip="注入上下文时检索的观察数量 (1-200)">
                <TextField value={draft.LLM_MEM_CONTEXT_OBSERVATIONS ?? '50'}
                  onChange={v => set('LLM_MEM_CONTEXT_OBSERVATIONS', v)} />
              </Field>
              <Field label="全文引用条数" tooltip="注入完整内容的条数 (0-20)">
                <TextField value={draft.LLM_MEM_CONTEXT_FULL_COUNT ?? '0'}
                  onChange={v => set('LLM_MEM_CONTEXT_FULL_COUNT', v)} />
              </Field>
              <Field label="全文引用字段" tooltip="narrative 或 facts">
                <SelectField
                  value={draft.LLM_MEM_CONTEXT_FULL_FIELD ?? 'narrative'}
                  onChange={v => set('LLM_MEM_CONTEXT_FULL_FIELD', v)}
                  options={[
                    { value: 'narrative', label: 'narrative' },
                    { value: 'facts', label: 'facts' },
                  ]}
                />
              </Field>
              <Field label="引用会话数" tooltip="注入的最近会话数 (1-50)">
                <TextField value={draft.LLM_MEM_CONTEXT_SESSION_COUNT ?? '10'}
                  onChange={v => set('LLM_MEM_CONTEXT_SESSION_COUNT', v)} />
              </Field>
            </CollapsibleSection>
            <CollapsibleSection title="显示选项">
              <ToggleField label="显示读取 token 数"
                value={draft.LLM_MEM_CONTEXT_SHOW_READ_TOKENS ?? 'false'}
                onChange={v => set('LLM_MEM_CONTEXT_SHOW_READ_TOKENS', v)} />
              <ToggleField label="显示写入 token 数"
                value={draft.LLM_MEM_CONTEXT_SHOW_WORK_TOKENS ?? 'false'}
                onChange={v => set('LLM_MEM_CONTEXT_SHOW_WORK_TOKENS', v)} />
              <ToggleField label="显示节省数量"
                value={draft.LLM_MEM_CONTEXT_SHOW_SAVINGS_AMOUNT ?? 'false'}
                onChange={v => set('LLM_MEM_CONTEXT_SHOW_SAVINGS_AMOUNT', v)} />
              <ToggleField label="显示节省百分比"
                value={draft.LLM_MEM_CONTEXT_SHOW_SAVINGS_PERCENT ?? 'true'}
                onChange={v => set('LLM_MEM_CONTEXT_SHOW_SAVINGS_PERCENT', v)} />
              <ToggleField label="显示最近摘要"
                value={draft.LLM_MEM_CONTEXT_SHOW_LAST_SUMMARY ?? 'true'}
                onChange={v => set('LLM_MEM_CONTEXT_SHOW_LAST_SUMMARY', v)} />
              <ToggleField label="显示最近消息"
                value={draft.LLM_MEM_CONTEXT_SHOW_LAST_MESSAGE ?? 'false'}
                onChange={v => set('LLM_MEM_CONTEXT_SHOW_LAST_MESSAGE', v)} />
            </CollapsibleSection>
            <CollapsibleSection title="上下文预览">
              <TerminalPreview content={contextPreview.preview || ''} />
            </CollapsibleSection>
          </>
        );
      case 'diagnosis':
        return (
          <CollapsibleSection title="依赖健康状态">
            {dependencyHealth.length === 0 && (
              <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                暂无诊断信息（Worker 可能未启动）
              </p>
            )}
            {dependencyHealth.map((d, i) => {
              const color = d.kind === 'ok' ? '#22c55e' : d.kind === 'setup_required' ? '#f59e0b' : '#ef4444';
              return (
                <div key={i} className="diagnosis-row" style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0',
                  borderLeft: `3px solid ${color}`, paddingLeft: 10,
                }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: '50%',
                    backgroundColor: color, display: 'inline-block', flex: 'none',
                  }} />
                  <span style={{ fontSize: 13, wordBreak: 'break-word' }}>
                    <b>{d.name}</b> — {d.message ?? d.kind}
                  </span>
                </div>
              );
            })}
          </CollapsibleSection>
        );
      default:
        return null;
    }
  };

  return (
    <div className="modal-backdrop" onClick={handleCancel}>
      <div className="settings-modal context-settings-modal" onClick={e => e.stopPropagation()}>
        <div className="settings-modal-header modal-header">
          <h2>设置</h2>
          <button className="close-btn" onClick={handleCancel}>×</button>
        </div>

        <div className="settings-tabs" style={{ display: 'flex', gap: '6px', padding: '10px 20px 0 20px', borderBottom: '1px solid var(--color-border-secondary)', background: 'var(--color-bg-secondary)', overflowX: 'auto', flexShrink: 0 }}>
          {TABS.map(t => (
            <button
              key={t.key}
              className={`settings-tab ${activeTab === t.key ? 'active' : ''}`}
              onClick={() => setActiveTab(t.key)}
              type="button"
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </div>

        <div className="settings-modal-body">
          {renderTab()}
        </div>

        <div className="settings-modal-footer modal-footer" style={{ justifyContent: 'flex-end' }}>
          <span className="settings-status save-status">{saveStatus}</span>
          <span className="settings-status save-status">{restartStatus}</span>
          <button className="save-btn" onClick={handleCancel}
            disabled={isSaving || isRestarting}>取消</button>
          <button className="save-btn" onClick={handleSave}
            disabled={isSaving || isRestarting}>
            {isSaving ? '保存中...' : '保存'}
          </button>
          <button
            className="save-btn"
            style={{ background: 'var(--accent-color, #f0a000)' }}
            onClick={handleSaveAndRestart}
            disabled={isSaving || isRestarting}
            title="保存配置并重启 Worker，使变更立即生效">
            {isRestarting ? '重启中...' : '保存并重启'}
          </button>
        </div>
      </div>
    </div>
  );
}

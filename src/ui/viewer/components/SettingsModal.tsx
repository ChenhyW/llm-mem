import React, { useState, useCallback, useEffect } from 'react';
import type { Settings, DependencyStatus } from '../types';
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
      </label>
      {tooltip && <div className="settings-field-desc">{tooltip}</div>}
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

  const [rebuildStatus, setRebuildStatus] = useState('');
  const [isRebuilding, setIsRebuilding] = useState(false);
  const [customEmbedMode, setCustomEmbedMode] = useState(false);

  // Poll rebuild status every 2s whenever modal is open
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch('/api/vector/rebuild/progress');
        const data = await res.json();
        if (cancelled) return;
        if (data.status === 'running') {
          setIsRebuilding(true);
          const processed = (data.vectorized ?? 0) + (data.failed ?? 0);
          const parts = [`正在重算向量…（${processed}/${data.total ?? '?'}`];
          if (data.failed > 0) parts.push(`，${data.failed} 条失败`);
          parts.push('）');
          setRebuildStatus(parts.join(''));
        } else if (data.status === 'done') {
          setIsRebuilding(false);
          const parts = ['重算完成，重建 ' + (data.rebuilt ?? '?') + ' 条'];
          if (data.skipped > 0) parts.push('，跳过 ' + data.skipped + ' 条');
          setRebuildStatus(parts.join(''));
        } else if (data.status === 'failed') {
          setIsRebuilding(false);
          setRebuildStatus('重算失败：' + (data.error ?? '未知错误'));
        } else {
          setIsRebuilding(false);
        }
      } catch { /* server not ready */ }
    };
    const timer = setInterval(poll, 2000);
    poll(); // immediate first check
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  const handleRebuild = async () => {
    setRebuildStatus('正在重算向量…');
    try {
      const res = await fetch('/api/vector/rebuild', { method: 'POST' });
      const data = await res.json();
      if (data.status === 'started') {
        setIsRebuilding(true);
        setRebuildStatus('正在重算向量…');
      } else if (data.status === 'running') {
        setIsRebuilding(true);
        setRebuildStatus('向量重算已在运行中');
      } else {
        setRebuildStatus(data.status === 'done' ? '重算完成，已重建 ' + (data.elements ?? '?') + ' 条' : '重算失败：' + (data.error ?? '未知错误'));
      }
    } catch {
      setRebuildStatus('重算请求失败');
    }
  };

  if (!isOpen) return null;

  const renderTab = () => {
    switch (activeTab) {
      case 'basic':
        return (
          <CollapsibleSection title="基础配置">
            <Field label="Worker 端口" tooltip="Worker HTTP 服务监听的端口。llm-mem 默认 37701，改端口后需重启 Worker 生效。">
              <TextField value={draft.LLM_MEM_WORKER_PORT ?? DEFAULT_SETTINGS.LLM_MEM_WORKER_PORT}
                onChange={v => set('LLM_MEM_WORKER_PORT', v)} />
            </Field>
            <Field label="Worker 主机" tooltip="Worker 监听地址。留空监听所有网卡；设为 127.0.0.1 仅本机可访问。">
              <TextField value={draft.LLM_MEM_WORKER_HOST ?? DEFAULT_SETTINGS.LLM_MEM_WORKER_HOST}
                onChange={v => set('LLM_MEM_WORKER_HOST', v)} />
            </Field>
            <Field label="日志级别" tooltip="Worker 控制台日志详细程度。DEBUG 最详细适合排查，INFO 为日常默认，WARN/ERROR 只留问题，SILENT 几乎不输出。">
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
            <Field label="数据目录" tooltip="llm-mem 的 SQLite 数据库、日志等数据存放位置。默认 ~/.llm-mem，留空即用默认值。（需重启生效）">
              <TextField value={draft.LLM_MEM_DATA_DIR ?? ''} placeholder="~/.llm-mem"
                onChange={v => set('LLM_MEM_DATA_DIR', v)} />
            </Field>
          </CollapsibleSection>
        );
      case 'model':
        return (
          <CollapsibleSection title="LLM Provider">
            <Field label="Provider" tooltip="选择 LLM 提供商。claude 使用 Claude SDK（订阅制）；gemini 使用 Google AI；openrouter 使用 OpenRouter 网关，适合接 DeepSeek 等第三方模型。切换后下方字段会相应变化。">
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
            <Field label="输出语言" tooltip="LLM 生成观察摘要时使用的语言。zh 输出中文摘要，en 输出英文摘要。（需重启生效）">
              <SelectField
                value={draft.LLM_MEM_OUTPUT_LANGUAGE ?? 'zh'}
                onChange={v => set('LLM_MEM_OUTPUT_LANGUAGE', v)}
                options={[
                  { value: 'zh', label: '中文 (zh)' },
                  { value: 'en', label: '英文 (en)' },
                ]}
              />
            </Field>
            {draft.LLM_MEM_PROVIDER === 'claude' && (
              <>
                <Field label="模型 (MODEL)" tooltip="生成观察摘要所使用的 LLM 模型名称">
                  <TextField value={draft.LLM_MEM_MODEL ?? DEFAULT_SETTINGS.LLM_MEM_MODEL}
                    onChange={v => set('LLM_MEM_MODEL', v)} />
                </Field>
                <Field label="Claude 认证方式" tooltip="subscription / api-key / gateway / cli">
                <SelectField
                  value={draft.LLM_MEM_CLAUDE_AUTH_METHOD ?? 'subscription'}
                  onChange={v => set('LLM_MEM_CLAUDE_AUTH_METHOD', v)}
                  options={[
                    { value: 'subscription', label: 'subscription (Claude SDK 登录)' },
                    { value: 'api-key', label: 'api-key (ANTHROPIC_API_KEY)' },
                    { value: 'gateway', label: 'gateway' },
                    { value: 'cli', label: 'cli' },
                  ]}
                />
              </Field>
              </>
            )}
            {draft.LLM_MEM_PROVIDER === 'gemini' && (
              <>
                <Field label="Gemini API Key">
                  <TextField value={draft.LLM_MEM_GEMINI_API_KEY ?? ''}
                    onChange={v => set('LLM_MEM_GEMINI_API_KEY', v)} type="password" />
                </Field>
                <Field label="Gemini 模型">
                  <SelectField
                    value={draft.LLM_MEM_GEMINI_MODEL ?? 'gemini-flash-latest'}
                    onChange={v => set('LLM_MEM_GEMINI_MODEL', v)}
                    options={[
                      { value: 'gemini-flash-latest', label: 'gemini-flash-latest' },
                      { value: 'gemini-flash-lite-latest', label: 'gemini-flash-lite-latest' },
                      { value: 'gemini-3.5-flash', label: 'gemini-3.5-flash' },
                      { value: 'gemini-3.1-flash-lite', label: 'gemini-3.1-flash-lite' },
                      { value: 'gemini-3-flash-preview', label: 'gemini-3-flash-preview' },
                    ]}
                  />
                </Field>
                <ToggleField label="启用限流"
                  value={draft.LLM_MEM_GEMINI_RATE_LIMITING_ENABLED ?? 'true'}
                  onChange={v => set('LLM_MEM_GEMINI_RATE_LIMITING_ENABLED', v)} />
              </>
            )}
            {draft.LLM_MEM_PROVIDER === 'openrouter' && (
              <>
                <Field label="OpenRouter API Key">
                  <TextField value={draft.LLM_MEM_OPENROUTER_API_KEY ?? ''}
                    onChange={v => set('LLM_MEM_OPENROUTER_API_KEY', v)} type="password" />
                </Field>
                <Field label="OpenRouter 模型">
                  <TextField value={draft.LLM_MEM_OPENROUTER_MODEL ?? 'xiaomi/mimo-v2-flash:free'}
                    onChange={v => set('LLM_MEM_OPENROUTER_MODEL', v)} />
                </Field>
                <Field label="OpenRouter Base URL" tooltip="自定义 OpenAI 兼容网关地址（可选），留空用 OpenRouter 默认端点">
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
        const embedModel = draft.LLM_MEM_VECTOR_EMBEDDING_MODEL ?? 'qwen3-embedding:0.6b';
        const EMBEDDING_PRESETS = ['qwen3-embedding:0.6b', 'nomic-embed-text', 'bge-m3', 'multilingual-e5-large'];
        const isCustomEmbed = customEmbedMode || !EMBEDDING_PRESETS.includes(embedModel);
        const handleEmbedSelect = (v: string) => {
          if (v === '__custom__') { setCustomEmbedMode(true); return; }
          setCustomEmbedMode(false);
          set('LLM_MEM_VECTOR_EMBEDDING_MODEL', v);
        };
        return (
          <CollapsibleSection title="向量搜索 (Ollama + hnswlib)">
            <Field label="Ollama 地址 (OLLAMA_URL)" tooltip="运行嵌入模型的 Ollama 服务地址，例如 http://192.168.1.2:11434。用于把观察记录编码成向量以支持语义检索。（需重启生效）">
              <TextField value={draft.LLM_MEM_OLLAMA_URL ?? DEFAULT_SETTINGS.LLM_MEM_OLLAMA_URL}
                onChange={v => set('LLM_MEM_OLLAMA_URL', v)} />
            </Field>
            <Field label="嵌入模型" tooltip="用于 hnswlib 向量检索的嵌入模型名。切换后建议点击下方「全量重算向量」用新模型重建索引。（需重启生效）">
              <SelectField
                value={isCustomEmbed ? '__custom__' : embedModel}
                onChange={handleEmbedSelect}
                options={[
                  { value: 'qwen3-embedding:0.6b', label: 'qwen3-embedding:0.6b（多语言，推荐）' },
                  { value: 'nomic-embed-text', label: 'nomic-embed-text（英文）' },
                  { value: 'bge-m3', label: 'bge-m3（多语言）' },
                  { value: 'multilingual-e5-large', label: 'multilingual-e5-large（多语言）' },
                  { value: '__custom__', label: '自定义...' },
                ]}
              />
              {isCustomEmbed && (
                <div style={{ marginTop: 6 }}>
                  <TextField value={embedModel === '__custom__' ? '' : embedModel}
                    onChange={v => set('LLM_MEM_VECTOR_EMBEDDING_MODEL', v)} />
                  <div className="settings-field-desc" style={{ marginTop: 4, fontSize: 12, color: 'var(--color-text-tertiary)' }}>
                    当前自定义模型：「{embedModel === '__custom__' ? '' : embedModel}」，通过上方下拉选择预设可直接切换。
                  </div>
                </div>
              )}
            </Field>
            <ToggleField label="禁用向量搜索"
              value={draft.LLM_MEM_DISABLE_VECTOR_SEARCH ?? 'false'}
              onChange={v => set('LLM_MEM_DISABLE_VECTOR_SEARCH', v)} />
            <div className="settings-field" style={{ padding: '8px 10px', marginTop: 8, borderTop: '1px solid var(--color-border-secondary)' }}>
              <button className="btn-warning" onClick={handleRebuild} type="button" disabled={isRebuilding}
                style={{ width: '100%', padding: '8px 0', fontSize: 13 }}>
                全量重算向量
              </button>
              {rebuildStatus && (
                <div style={{ marginTop: 6, fontSize: 12, color: rebuildStatus.includes('失败') ? '#ef4444' : rebuildStatus.includes('完成') ? 'var(--accent-color, #f0a000)' : '#f59e0b' }}>
                  {isRebuilding && <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: '#f59e0b', marginRight: 6, animation: 'pulse 1s infinite' }} />}
                  {rebuildStatus}
                </div>
              )}
            </div>
          </CollapsibleSection>
        );
      case 'context':
        return (
          <>
            <CollapsibleSection title="上下文注入">
              <Field label="引用观察数" tooltip="每次注入上下文时最多检索的相关观察记录数量（1-200）。数量越大背景信息越多，但消耗的 token 也越多。默认 50 条一般已够用。（无需重启，下次注入生效）">
                <TextField value={draft.LLM_MEM_CONTEXT_OBSERVATIONS ?? '50'}
                  onChange={v => set('LLM_MEM_CONTEXT_OBSERVATIONS', v)} />
              </Field>
              <Field label="全文引用条数" tooltip="在注入的观察记录中，有多少条会带上完整的叙述文本（默认 0 即只注入标题）。打开后会大幅增加注入的 token 量，适合希望模型看到更多细节时使用。（无需重启，下次注入生效）">
                <TextField value={draft.LLM_MEM_CONTEXT_FULL_COUNT ?? '0'}
                  onChange={v => set('LLM_MEM_CONTEXT_FULL_COUNT', v)} />
              </Field>
              <Field label="全文引用字段" tooltip="决定全文引用时使用观察记录的哪个字段。narrative 是模型生成的叙事性摘要（推荐，信息量丰富）；facts 是结构化事实字段（适合需要精确数据时）。（无需重启，下次注入生效）">
                <SelectField
                  value={draft.LLM_MEM_CONTEXT_FULL_FIELD ?? 'narrative'}
                  onChange={v => set('LLM_MEM_CONTEXT_FULL_FIELD', v)}
                  options={[
                    { value: 'narrative', label: 'narrative（叙事摘要，推荐）' },
                    { value: 'facts', label: 'facts（结构化事实）' },
                  ]}
                />
              </Field>
              <Field label="引用会话数" tooltip="注入时回看最近多少个会话的时间窗口。默认 10，即只从最近 10 个会话里选观察记录；设大些可看到更早的工作，设小些更聚焦最近。（无需重启，下次注入生效）">
                <TextField value={draft.LLM_MEM_CONTEXT_SESSION_COUNT ?? '10'}
                  onChange={v => set('LLM_MEM_CONTEXT_SESSION_COUNT', v)} />
              </Field>
            </CollapsibleSection>
            <CollapsibleSection title="语义注入（按提示词检索）">
              <ToggleField label="启用语义注入"
                value={draft.LLM_MEM_SEMANTIC_INJECT ?? 'false'}
                onChange={v => set('LLM_MEM_SEMANTIC_INJECT', v)} />
              <Field label="注入条数" tooltip="每次语义注入时最多拼入的相关记忆条数（1-20）。默认 5，数量越多信息越丰富但提示词越长。（无需重启，下次注入生效）">
                <TextField value={draft.LLM_MEM_SEMANTIC_INJECT_LIMIT ?? '5'}
                  onChange={v => set('LLM_MEM_SEMANTIC_INJECT_LIMIT', v)} />
              </Field>
              <Field label="最低匹配分数" tooltip="语义注入时只返回分数 ≥ 此值的记忆（0-1）。默认 0.75，值越高结果越精准但可能无匹配；设 0 关闭过滤。（无需重启，下次注入生效）">
                <TextField value={draft.LLM_MEM_SEMANTIC_INJECT_MIN_SCORE ?? '0.75'}
                  onChange={v => set('LLM_MEM_SEMANTIC_INJECT_MIN_SCORE', v)} />
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
      <div className="context-settings-modal" onClick={e => e.stopPropagation()}>
        <button className="modal-close-btn" onClick={handleCancel} title="关闭" aria-label="关闭">×</button>
        <div className="settings-modal-header">
          <div>
            <h2>设置</h2>
            <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>配置 llm-mem 行为，保存并重启后生效</span>
          </div>
        </div>

        <div className="settings-tabs">
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

        <div className="settings-modal-footer">
          <span className="settings-status">{saveStatus}</span>
          <span className="settings-status restart-status">{restartStatus}</span>
          <button className="btn-secondary" onClick={handleCancel}
            disabled={isSaving || isRestarting}>取消</button>
          <button className="btn-primary" onClick={handleSave}
            disabled={isSaving || isRestarting}>
            {isSaving ? '保存中...' : '保存'}
          </button>
          <button
            className="btn-warning"
            onClick={handleSaveAndRestart}
            disabled={isSaving || isRestarting}
            title="保存配置并重启 Worker，使变更立即生效"
          >
            {isRestarting ? '重启中...' : '保存并重启'}
          </button>
        </div>
      </div>
    </div>
  );
}

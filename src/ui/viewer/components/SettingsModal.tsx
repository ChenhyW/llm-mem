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

type TabKey = 'basic' | 'model' | 'embed' | 'context' | 'diagnosis';

interface Tab {
  key: TabKey;
  label: string;
  icon: React.ReactNode;
}

const TABS: Tab[] = [
  {
    key: 'basic',
    label: '基础',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.09a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>,
  },
  {
    key: 'model',
    label: '模型',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="9 11 12 8 15 11 12 14 9 11" /><path d="M12 2L4 6v6c0 4.42 3.37 8.42 8 10 4.63-1.58 8-5.58 8-10V6l-8-4z" /></svg>,
  },
  {
    key: 'embed',
    label: '向量',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 3 21 3 21 8" /><line x1="4" y1="20" x2="20" y2="4" /><polyline points="21 16 21 21 16 21" /><line x1="15" y1="15" x2="21" y2="21" /><line x1="4" y1="4" x2="9" y2="9" /></svg>,
  },
  {
    key: 'context',
    label: '上下文',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" /></svg>,
  },
  {
    key: 'diagnosis',
    label: '诊断',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" /></svg>,
  },
];

function CollapsibleSection({ title, children }: { title: string; children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(true);
  return (
    <div className={'settings-section-collapsible ' + (isOpen ? 'open' : '')}>
      <button className="section-header-btn" onClick={() => setIsOpen(!isOpen)} type="button">
        <div className="section-header-content"><span className="section-title">{title}</span></div>
        <svg className={'chevron-icon ' + (isOpen ? 'rotated' : '')} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
      </button>
      {isOpen && <div className="section-content">{children}</div>}
    </div>
  );
}

function FieldWithDesc({ label, desc, children }: { label: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="settings-field">
      <div className="settings-field-label">
        <span className="settings-field-name">{label}</span>
        <span className="settings-field-desc">{desc}</span>
      </div>
      <div className="settings-field-input">{children}</div>
    </div>
  );
}

function ToggleWithDesc({ label, desc, value, onChange }: { label: string; desc: string; value: string; onChange: (v: 'true' | 'false') => void }) {
  const on = value === 'true';
  return (
    <div className="settings-togger-row">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
        <span className="settings-field-label">
          <span className="settings-field-name">{label}</span>
          <span className="settings-field-desc">{desc}</span>
        </span>
      </div>
      <button type="button" className={'toggle-btn ' + (on ? 'on' : 'off')} onClick={() => onChange(on ? 'false' : 'true')}>
        <span className="toggle-knob" />
      </button>
    </div>
  );
}

function TextField({ value, onChange, placeholder, type = 'text' }: { value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <input type={type} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} className="settings-input" />
  );
}

function SelectField({ value, options, onChange }: { value: string; options: Array<{ value: string; label: string }>; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className="settings-input">
      {options.map(o => (<option key={o.value} value={o.value}>{o.label}</option>))}
    </select>
  );
}

export function SettingsModal({ isOpen, onClose, settings, onSave, isSaving, saveStatus, restartWorker, isRestarting, restartStatus, dependencyHealth }: SettingsModalProps) {
  const [draft, setDraft] = useState<Settings>(settings);
  const [activeTab, setActiveTab] = useState<TabKey>('basic');

  useEffect(() => { setDraft(settings); }, [settings]);
  const set = useCallback((key: keyof Settings, v: string) => { setDraft(d => ({ ...d, [key]: v })); }, []);

  const handleSave = async () => { const ok = await onSave(draft); if (ok) setTimeout(() => onClose(), 1500); };
  const handleSaveAndRestart = async () => { await onSave(draft); await restartWorker(); };
  const handleCancel = () => { setDraft(settings); setActiveTab('basic'); onClose(); };
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
            <FieldWithDesc label="Worker 端口" desc="Worker HTTP 服务监听的端口。llm-mem 默认 37701，改端口后需要重启 Worker 才能生效。">
              <TextField value={draft.LLM_MEM_WORKER_PORT ?? DEFAULT_SETTINGS.LLM_MEM_WORKER_PORT} onChange={v => set('LLM_MEM_WORKER_PORT', v)} />
            </FieldWithDesc>
            <FieldWithDesc label="Worker 主机" desc="Worker 监听的网络地址。留空则监听所有网卡；设为 127.0.0.1 仅本机可访问。">
              <TextField value={draft.LLM_MEM_WORKER_HOST ?? DEFAULT_SETTINGS.LLM_MEM_WORKER_HOST} onChange={v => set('LLM_MEM_WORKER_HOST', v)} />
            </FieldWithDesc>
            <FieldWithDesc label="日志级别" desc="Worker 控制台日志的详细程度。DEBUG 最详细适合排查；INFO 是日常默认；WARN/ERROR 只保留问题；SILENT 几乎不输出。">
              <SelectField value={draft.LLM_MEM_LOG_LEVEL ?? 'INFO'} onChange={v => set('LLM_MEM_LOG_LEVEL', v)} options={[{ value: 'DEBUG', label: 'DEBUG' }, { value: 'INFO', label: 'INFO' }, { value: 'WARN', label: 'WARN' }, { value: 'ERROR', label: 'ERROR' }, { value: 'SILENT', label: 'SILENT' }]} />
            </FieldWithDesc>
            <FieldWithDesc label="数据目录" desc="llm-mem 的 SQLite 数据库、日志等数据存放位置。默认 ~/.llm-mem，留空即使用默认值。">
              <TextField value={draft.LLM_MEM_DATA_DIR ?? ''} placeholder="~/.llm-mem" onChange={v => set('LLM_MEM_DATA_DIR', v)} />
            </FieldWithDesc>
          </CollapsibleSection>
        );
      case 'model':
        return (
          <CollapsibleSection title="LLM Provider">
            <FieldWithDesc label="Provider" desc="选择 LLM 提供商。claude 使用 Claude SDK（订阅制）；gemini 使用 Google AI；openrouter 使用 OpenRouter 网关，适合接 DeepSeek 等第三方模型。切换后下方字段会相应变化。">
              <SelectField value={draft.LLM_MEM_PROVIDER ?? 'claude'} onChange={v => set('LLM_MEM_PROVIDER', v)} options={[{ value: 'claude', label: 'claude (Claude SDK)' }, { value: 'gemini', label: 'gemini (Google)' }, { value: 'openrouter', label: 'openrouter (OpenRouter)' }]} />
            </FieldWithDesc>
            <FieldWithDesc label="模型 (MODEL)" desc="用于生成观察摘要的 LLM 模型名称。claude 时使用 LLM_MEM_MODEL，openrouter 时使用 LLM_MEM_OPENROUTER_MODEL。">
              <TextField value={modelValue} onChange={v => set(modelKey, v)} />
            </FieldWithDesc>
            <FieldWithDesc label="输出语言" desc="LLM 生成观察摘要时使用的语言。zh 输出中文摘要，en 输出英文摘要。">
              <SelectField value={draft.LLM_MEM_OUTPUT_LANGUAGE ?? 'zh'} onChange={v => set('LLM_MEM_OUTPUT_LANGUAGE', v)} options={[{ value: 'zh', label: '中文 (zh)' }, { value: 'en', label: '英文 (en)' }]} />
            </FieldWithDesc>
            {draft.LLM_MEM_PROVIDER === 'claude' && (
              <div className="settings-field" style={{ opacity: 0.7 }}>
                <div className="settings-field-label"><span className="settings-field-name">Claude 认证方式</span></div>
                <div className="settings-field-input"><span className="settings-input" style={{ color: 'var(--color-text-muted)', cursor: 'default' }}>subscription（Claude SDK 登录，在 Claude 中 /login 后生效）</span></div>
              </div>
            )}
            {draft.LLM_MEM_PROVIDER === 'gemini' && (
              <>
                <FieldWithDesc label="Gemini API Key" desc="Google AI 的 API 密钥，用于调用 Gemini 模型生成观察摘要。可从 Google AI Studio 获取。">
                  <TextField value={draft.LLM_MEM_GEMINI_API_KEY ?? ''} onChange={v => set('LLM_MEM_GEMINI_API_KEY', v)} type="password" />
                </FieldWithDesc>
                <ToggleWithDesc label="启用限流" desc="是否对 Gemini API 请求启用限流，避免超出免费额度触发速率限制。建议保持启用。" value={draft.LLM_MEM_GEMINI_RATE_LIMITING_ENABLED ?? 'true'} onChange={v => set('LLM_MEM_GEMINI_RATE_LIMITING_ENABLED', v)} />
              </>
            )}
            {draft.LLM_MEM_PROVIDER === 'openrouter' && (
              <>
                <FieldWithDesc label="API Key" desc="OpenRouter 的 API 密钥，用于调用模型。在 OpenRouter 后台获取。">
                  <TextField value={draft.LLM_MEM_OPENROUTER_API_KEY ?? ''} onChange={v => set('LLM_MEM_OPENROUTER_API_KEY', v)} type="password" />
                </FieldWithDesc>
                <FieldWithDesc label="Base URL（可选）" desc="自定义 OpenAI 兼容网关地址，例如 https://api.deepseek.com 或 http://localhost:1234/v1。留空则直接使用 OpenRouter 默认端点。">
                  <TextField value={draft.LLM_MEM_OPENROUTER_BASE_URL ?? ''} onChange={v => set('LLM_MEM_OPENROUTER_BASE_URL', v)} />
                </FieldWithDesc>
                <FieldWithDesc label="OpenRouter App Name" desc="在 OpenRouter 后台展示的 App 名称，用于区分流量来源，默认 llm-mem。">
                  <TextField value={draft.LLM_MEM_OPENROUTER_APP_NAME ?? 'llm-mem'} onChange={v => set('LLM_MEM_OPENROUTER_APP_NAME', v)} />
                </FieldWithDesc>
              </>
            )}
          </CollapsibleSection>
        );
      case 'embed':
        return (
          <CollapsibleSection title="向量搜索（Ollama + hnswlib）">
            <FieldWithDesc label="Ollama 地址" desc="运行嵌入模型的 Ollama 服务地址，例如 http://192.168.1.2:11434。用于把观察记录编码成向量以支持语义检索；留空则无法启用向量搜索。">
              <TextField value={draft.LLM_MEM_OLLAMA_URL ?? DEFAULT_SETTINGS.LLM_MEM_OLLAMA_URL} onChange={v => set('LLM_MEM_OLLAMA_URL', v)} />
            </FieldWithDesc>
            <FieldWithDesc label="嵌入模型" desc="Ollama 中用于生成向量的嵌入模型名，例如 nomic-embed-text。需要先在 Ollama 中 pull 该模型（ollama pull nomic-embed-text）。">
              <TextField value={draft.LLM_MEM_VECTOR_EMBEDDING_MODEL ?? 'nomic-embed-text'} onChange={v => set('LLM_MEM_VECTOR_EMBEDDING_MODEL', v)} />
            </FieldWithDesc>
            <ToggleWithDesc label="禁用向量搜索" desc="开启后关闭语义向量检索，所有检索退化为 SQLite 关键词匹配；语义注入也会同步降级为关键词匹配。仅在不需要语义检索或 Ollama 不可用时启用。" value={draft.LLM_MEM_DISABLE_VECTOR_SEARCH ?? 'false'} onChange={v => set('LLM_MEM_DISABLE_VECTOR_SEARCH', v)} />
          </CollapsibleSection>
        );
      case 'context':
        return (
          <>
            <CollapsibleSection title="上下文注入">
              <FieldWithDesc label="引用观察数" desc="每次注入上下文时最多检索的相关观察记录数量（1-200）。数量越大背景信息越多，但消耗的 token 也越多。默认 50 条一般已够用。">
                <TextField value={draft.LLM_MEM_CONTEXT_OBSERVATIONS ?? '50'} onChange={v => set('LLM_MEM_CONTEXT_OBSERVATIONS', v)} />
              </FieldWithDesc>
              <FieldWithDesc label="引用会话数" desc="注入时回看最近多少个会话的时间窗口。默认 10，即只从最近 10 个会话里选观察记录；设大些可看到更早的工作，设小些更聚焦最近。它与上面的「观察数」共同决定最终注入内容。">
                <TextField value={draft.LLM_MEM_CONTEXT_SESSION_COUNT ?? '10'} onChange={v => set('LLM_MEM_CONTEXT_SESSION_COUNT', v)} />
              </FieldWithDesc>
              <FieldWithDesc label="全文引用条数" desc="在注入的观察记录中，有多少条会带上完整的叙述文本（默认 0 即只注入标题）。打开后会大幅增加注入的 token 量，适合希望模型看到更多细节时使用。">
                <TextField value={draft.LLM_MEM_CONTEXT_FULL_COUNT ?? '0'} onChange={v => set('LLM_MEM_CONTEXT_FULL_COUNT', v)} />
              </FieldWithDesc>
              <FieldWithDesc label="全文引用字段" desc="决定全文引用时使用观察记录的哪个字段。narrative 是模型生成的叙事性摘要（推荐，信息量丰富）；facts 是结构化事实字段（适合需要精确数据时）。">
                <SelectField value={draft.LLM_MEM_CONTEXT_FULL_FIELD ?? 'narrative'} onChange={v => set('LLM_MEM_CONTEXT_FULL_FIELD', v)} options={[{ value: 'narrative', label: 'narrative（叙事摘要，推荐）' }, { value: 'facts', label: 'facts（结构化事实）' }]} />
              </FieldWithDesc>
            </CollapsibleSection>
            <CollapsibleSection title="显示选项">
              <ToggleWithDesc label="显示读取 token 数" desc="在注入的上下文块里显示本次读取了多少输入 token。" value={draft.LLM_MEM_CONTEXT_SHOW_READ_TOKENS ?? 'false'} onChange={v => set('LLM_MEM_CONTEXT_SHOW_READ_TOKENS', v)} />
              <ToggleWithDesc label="显示写入 token 数" desc="在注入的上下文块里显示本次生成了多少输出 token。" value={draft.LLM_MEM_CONTEXT_SHOW_WORK_TOKENS ?? 'false'} onChange={v => set('LLM_MEM_CONTEXT_SHOW_WORK_TOKENS', v)} />
              <ToggleWithDesc label="显示节省数量" desc="显示记忆注入相比从零开始推理节省了多少 token 的具体数值。" value={draft.LLM_MEM_CONTEXT_SHOW_SAVINGS_AMOUNT ?? 'false'} onChange={v => set('LLM_MEM_CONTEXT_SHOW_SAVINGS_AMOUNT', v)} />
              <ToggleWithDesc label="显示节省百分比" desc="显示记忆注入相比从零开始推理节省了多少百分比。默认开启。" value={draft.LLM_MEM_CONTEXT_SHOW_SAVINGS_PERCENT ?? 'true'} onChange={v => set('LLM_MEM_CONTEXT_SHOW_SAVINGS_PERCENT', v)} />
              <ToggleWithDesc label="显示最近摘要" desc="在注入的上下文块末尾附加最近一次会话的摘要，帮助模型了解工作脉络。默认开启。" value={draft.LLM_MEM_CONTEXT_SHOW_LAST_SUMMARY ?? 'true'} onChange={v => set('LLM_MEM_CONTEXT_SHOW_LAST_SUMMARY', v)} />
              <ToggleWithDesc label="显示最近消息" desc="在注入的上下文块中附加最近一次对话的最后几条消息原文。" value={draft.LLM_MEM_CONTEXT_SHOW_LAST_MESSAGE ?? 'false'} onChange={v => set('LLM_MEM_CONTEXT_SHOW_LAST_MESSAGE', v)} />
            </CollapsibleSection>
            <CollapsibleSection title="上下文预览">
              <div className="settings-field" style={{ padding: '8px 10px', marginBottom: 8 }}>
                <div className="settings-field-label" style={{ marginBottom: 6 }}>
                  <span className="settings-field-name">项目</span>
                  <span className="settings-field-desc">选择要预览注入上下文的项目；换项目后预览会自动刷新。</span>
                </div>
                <div className="settings-field-input">
                  <select value={contextPreview.selectedProject ?? ''} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => contextPreview.setSelectedProject(e.target.value)} className="settings-input">
                    {contextPreview.projects.length === 0 && <option>(暂无项目)</option>}
                    {contextPreview.projects.map(p => (<option key={p} value={p}>{p}</option>))}
                  </select>
                </div>
              </div>
              <div className="settings-field" style={{ padding: '6px 10px', marginBottom: 8 }}>
                <span className="settings-field-desc">预览使用服务器持久化的设置生成，仅用于确认注入内容的结构；弹框中的「显示选项」开关需要在「保存并重启」后才反映到真实注入。</span>
              </div>
              <div className="context-preview-terminal">
                <TerminalPreview content={contextPreview.preview || ''} isLoading={contextPreview.isLoading} />
                {contextPreview.error && (
                  <div className="settings-field" style={{ padding: '8px 10px', marginTop: 6, border: '1px solid var(--accent-color, #ef4444)', borderRadius: 6 }}>
                    <span className="settings-field-desc" style={{ color: 'var(--accent-color, #ef4444)' }}>预览加载失败：{contextPreview.error}</span>
                  </div>
                )}
              </div>
            </CollapsibleSection>
            <CollapsibleSection title="语义注入（按提示词检索）">
              <ToggleWithDesc label="启用语义注入" desc="开启后每次用户输入（≥20 字）时会按语义检索相关记忆并拼入提示词。仅 Worker 模式生效，Server 模式跳过；禁用向量搜索后会退化为关键词检索。" value={draft.LLM_MEM_SEMANTIC_INJECT ?? 'false'} onChange={v => set('LLM_MEM_SEMANTIC_INJECT', v)} />
              <FieldWithDesc label="注入条数" desc="每次语义注入时最多拼入的相关记忆条数（1-20）。默认 5，数量越多信息越丰富但提示词越长。" >
                <TextField value={draft.LLM_MEM_SEMANTIC_INJECT_LIMIT ?? '5'} onChange={v => set('LLM_MEM_SEMANTIC_INJECT_LIMIT', v)} />
              </FieldWithDesc>
            </CollapsibleSection>
          </>
        );
      case 'diagnosis':
        return (
          <CollapsibleSection title="依赖健康状态">
            {dependencyHealth.length === 0 && (<p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>暂无诊断信息（Worker 可能未启动）</p>)}
            {dependencyHealth.map((d, i) => {
              const color = d.kind === 'ok' ? '#22c55e' : d.kind === 'setup_required' ? '#f59e0b' : '#ef4444';
              return (
                <div key={i} className="diagnosis-row" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderLeft: '3px solid ' + color, paddingLeft: 10 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: color, display: 'inline-block', flex: 'none' }} />
                  <span style={{ fontSize: 13, wordBreak: 'break-word' }}><b>{d.name}</b> — {d.message ?? d.kind}</span>
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
            <button key={t.key} className={'settings-tab ' + (activeTab === t.key ? 'active' : '')} onClick={() => setActiveTab(t.key)} type="button">
              {t.icon}<span>{t.label}</span>
            </button>
          ))}
        </div>
        <div className="settings-modal-body">{renderTab()}</div>
        <div className="settings-modal-footer modal-footer" style={{ justifyContent: 'flex-end' }}>
          <span className="settings-status save-status">{saveStatus}</span>
          <span className="settings-status save-status">{restartStatus}</span>
          <button className="save-btn" onClick={handleCancel} disabled={isSaving || isRestarting}>取消</button>
          <button className="save-btn" onClick={handleSave} disabled={isSaving || isRestarting}>{isSaving ? '保存中...' : '保存'}</button>
          <button className="save-btn" style={{ background: 'var(--accent-color, #f0a000)' }} onClick={handleSaveAndRestart} disabled={isSaving || isRestarting} title="保存配置并重启 Worker，使变更立即生效">{isRestarting ? '重启中...' : '保存并重启'}</button>
        </div>
      </div>
    </div>
  );
}

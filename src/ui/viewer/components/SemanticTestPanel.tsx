import React, { useState, useCallback } from 'react';
import { API_ENDPOINTS } from '../constants/api';

export interface SemanticTestPanelProps {
  projects: string[];
}

interface TestResult {
  status: 'idle' | 'loading' | 'error' | 'empty' | 'ok';
  context: string;
  count: number;
  message?: string;
}

export function SemanticTestPanel({ projects }: SemanticTestPanelProps) {
  const [query, setQuery] = useState('');
  const [selectedProject, setSelectedProject] = useState('');
  const [limit, setLimit] = useState('5');
  const [result, setResult] = useState<TestResult>({ status: 'idle', context: '', count: 0 });

  const handleTest = useCallback(async () => {
    if (!query.trim() || query.trim().length < 20) {
      setResult({ status: 'error', context: '', count: 0, message: '提示词太短，至少 20 个字符' });
      return;
    }
    setResult({ status: 'loading', context: '', count: 0 });
    const params = new URLSearchParams({ q: query.trim(), limit: String(limit) });
    if (selectedProject) params.append('project', selectedProject);
    try {
      const resp = await fetch(`${API_ENDPOINTS.SEMANTIC_CONTEXT}?${params}`);
      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        setResult({ status: 'error', context: '', count: 0, message: `请求失败 (${resp.status})${errText ? ': ' + errText : ''}` });
        return;
      }
      const data = await resp.json();
      if (!data.context || data.context.trim().length === 0) {
        setResult({ status: 'empty', context: '', count: data.count || 0, message: '未找到相关记忆' });
        return;
      }
      setResult({ status: 'ok', context: data.context, count: data.count || 0 });
    } catch (err) {
      const message = err instanceof Error ? err.message : '请求失败';
      setResult({ status: 'error', context: '', count: 0, message });
    }
  }, [query, selectedProject, limit]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      handleTest();
    }
  }, [handleTest]);

  const clearResult = useCallback(() => {
    setResult({ status: 'idle', context: '', count: 0 });
  }, []);

  return (
    <div className="semantic-test-panel">
      <div className="semantic-test-header">
        <h2>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="16 3 21 3 21 8" />
            <line x1="4" y1="20" x2="20" y2="4" />
            <polyline points="21 16 21 21 16 21" />
            <line x1="15" y1="15" x2="21" y2="21" />
            <line x1="4" y1="4" x2="9" y2="9" />
          </svg>
          语义注入测试
        </h2>
        <p className="semantic-test-description">
          输入一段提示词，按语义检索相关记忆，预览实际会拼入提示词的注入内容。
          提示：仅 Worker 模式生效，Server 模式跳过；禁用向量搜索后会退化为关键词检索。
        </p>
      </div>

      <div className="semantic-test-card">
        <div className="semantic-test-controls">
          <div className="semantic-test-control">
            <label>项目</label>
            <select
              value={selectedProject}
              onChange={e => setSelectedProject(e.target.value)}
              className="semantic-test-select"
            >
              <option value="">全部项目</option>
              {projects.map(p => (<option key={p} value={p}>{p}</option>))}
            </select>
          </div>
          <div className="semantic-test-control">
            <label>注入条数</label>
            <input
              type="number"
              min="1"
              max="20"
              value={limit}
              onChange={e => setLimit(e.target.value)}
              className="semantic-test-input semantic-test-input--small"
            />
          </div>
        </div>

        <div className="semantic-test-prompts-row">
          <label className="semantic-test-control-title" style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500 }}>
            提示词
          </label>
          <div className="semantic-test-row">
            <div className="semantic-test-control" style={{ width: '100%' }}>
              <textarea
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="粘贴或输入一段提示词（至少 20 个字符）..."
                rows={4}
                className="semantic-test-textarea"
              />
            </div>
          </div>
        </div>

        <div className="semantic-test-row">
          <div style={{ flex: 1, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, padding: '2px 0' }}>
            按 <code style={{
              padding: '1px 6px', borderRadius: 4,
              background: 'var(--color-bg-tertiary)',
              color: 'var(--text-secondary)',
              fontSize: 11, fontFamily: 'ui-monospace, SF Mono, Menlo, monospace',
            }}>⌘ Enter</code> 快速测试
          </div>
          <button
            className="semantic-test-button"
            onClick={handleTest}
            disabled={result.status === 'loading' || !query.trim()}
          >
            {result.status === 'loading' && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                style={{ animation: 'spin 1s linear infinite' }}>
                <path d="M21 12a9 9 0 1 1-6.219-8.563" />
              </svg>
            )}
            {result.status === 'loading' ? '检索中...' : '测试注入'}
          </button>
        </div>
      </div>

      {result.status === 'idle' && (
        <div className="semantic-test-empty">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <span>输入提示词后点击「测试注入」</span>
          <span style={{ fontSize: 12, opacity: 0.7 }}>预览语义检索到的记忆注入内容</span>
        </div>
      )}

      {result.status === 'error' && (
        <div className="semantic-test-result semantic-test-result--error">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span style={{ fontWeight: 600 }}>请求失败</span>
          </div>
          <div>{result.message}</div>
        </div>
      )}

      {result.status === 'empty' && (
        <div className="semantic-test-result semantic-test-result--empty">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><path d="M16 16s-1.5-2-4-2-4 2-4 2" /><line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" />
            </svg>
            <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>未找到相关记忆</span>
            {result.count > 0 && <span style={{ fontSize: 12, opacity: 0.8 }}>({result.count} 条命中)</span>}
          </div>
        </div>
      )}

      {result.status === 'ok' && (
        <div className="semantic-test-result semantic-test-result--ok">
          <div className="semantic-test-result-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
              <span>命中 {result.count} 条相关记忆</span>
            </div>
            <span className="semantic-test-result-meta" style={{ cursor: 'pointer' }} onClick={clearResult}>
              × 清空
            </span>
          </div>
          <pre className="semantic-test-result-body">{result.context}</pre>
        </div>
      )}
    </div>
  );
}

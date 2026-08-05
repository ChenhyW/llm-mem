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

    const params = new URLSearchParams({
      q: query.trim(),
      limit: String(limit),
    });
    if (selectedProject) {
      params.append('project', selectedProject);
    }

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

  const handleRun = useCallback(() => {
    handleTest();
  }, [handleTest]);

  return (
    <div className="semantic-test-panel">
      <div className="semantic-test-header">
        <h2>语义注入测试</h2>
        <p className="semantic-test-description">
          输入一段提示词，按语义检索相关记忆，预览会拼入提示词的注入内容。
        </p>
      </div>

      <div className="semantic-test-controls">
        <div className="semantic-test-control">
          <label>项目</label>
          <select
            value={selectedProject}
            onChange={e => setSelectedProject(e.target.value)}
            className="semantic-test-select"
          >
            <option value="">全部项目</option>
            {projects.map(p => (
              <option key={p} value={p}>{p}</option>
            ))}
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

      <div className="semantic-test-control">
        <label>提示词</label>
        <textarea
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="粘贴一段提示词（至少 20 个字符）..."
          rows={3}
          className="semantic-test-textarea"
        />
      </div>

      <button
        className="semantic-test-button"
        onClick={handleRun}
        disabled={result.status === 'loading' || !query.trim()}
      >
        {result.status === 'loading' ? '检索中...' : '测试注入'}
      </button>

      {result.status === 'idle' && (
        <div className="semantic-test-empty">
          输入提示词后点击「测试注入」，预览语义检索到的记忆注入内容。
        </div>
      )}

      {result.status === 'error' && (
        <div className="semantic-test-result semantic-test-result--error">
          {result.message}
        </div>
      )}

      {result.status === 'empty' && (
        <div className="semantic-test-result semantic-test-result--empty">
          未找到相关记忆（{result.count} 条命中）
        </div>
      )}

      {result.status === 'ok' && (
        <div className="semantic-test-result semantic-test-result--ok">
          <div className="semantic-test-result-header">
            命中 {result.count} 条相关记忆
          </div>
          <pre className="semantic-test-result-body">{result.context}</pre>
        </div>
      )}
    </div>
  );
}

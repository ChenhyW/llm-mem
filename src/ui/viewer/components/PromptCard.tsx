import React, { useState } from 'react';
import { UserPrompt } from '../types';
import { formatDate } from '../utils/formatters';

interface PromptCardProps {
  prompt: UserPrompt;
}

export function PromptCard({ prompt }: PromptCardProps) {
  const date = formatDate(prompt.created_at_epoch);
  const [showInjection, setShowInjection] = useState(false);

  const semanticContext = prompt.semantic_context?.trim() || '';
  const hasSemanticContext = semanticContext.length > 0;

  if (hasSemanticContext && !showInjection) {
    // Parse the count of observation sections (each starts with ### )
    const sectionCount = (semanticContext.match(/^### /gm) || []).length;
    return (
      <div className="card prompt-card">
        <div className="card-header">
          <div className="card-header-left">
            <span className="card-type">Prompt</span>
            <span className={`card-source source-${prompt.platform_source || 'claude'}`}>
              {prompt.platform_source || 'claude'}
            </span>
            <span className="card-project">{prompt.project}</span>
          </div>
        </div>
        <div className="card-content">
          {prompt.prompt_text}
        </div>
        <div className="prompt-semantic-injection">
          <div className="prompt-semantic-injection-summary">
            <span>🔍 语义注入（拼入了 {sectionCount} 条相关记忆）</span>
            <button
              className="prompt-semantic-injection-toggle"
              onClick={() => setShowInjection(true)}
            >
              查看注入内容
            </button>
          </div>
        </div>
        <div className="card-meta">
          <span className="meta-date">#{prompt.id} • {date}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="card prompt-card">
      <div className="card-header">
        <div className="card-header-left">
          <span className="card-type">Prompt</span>
          <span className={`card-source source-${prompt.platform_source || 'claude'}`}>
            {prompt.platform_source || 'claude'}
          </span>
          <span className="card-project">{prompt.project}</span>
        </div>
      </div>
      <div className="card-content">
        {prompt.prompt_text}
      </div>
      {hasSemanticContext && showInjection && (
        <div className="prompt-semantic-injection">
          <div className="prompt-semantic-injection-summary">
            <span>🔍 语义注入内容</span>
            <button
              className="prompt-semantic-injection-toggle"
              onClick={() => setShowInjection(false)}
            >
              收起
            </button>
          </div>
          <pre className="prompt-semantic-injection-body">{semanticContext}</pre>
        </div>
      )}
      <div className="card-meta">
        <span className="meta-date">#{prompt.id} • {date}</span>
      </div>
    </div>
  );
}

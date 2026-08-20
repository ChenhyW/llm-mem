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
  // Observation sections are written as level-3 headings ("### ...") and the
  // top-level "## Relevant Past Work" wrapper is level-2. Count level-3
  // headings (or, defensively, any level-2/level-3 heading minus the wrapper).
  const headingMatches = semanticContext.match(/^#{2,3} /gm) || [];
  const sectionCount = Math.max(
    0,
    headingMatches.length - (semanticContext.includes('Relevant Past Work') ? 1 : 0)
  );

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
      <div className="prompt-semantic-injection">
        <div className="prompt-semantic-injection-summary">
          <span>🔍 语义注入（拼入了 {sectionCount} 条相关记忆）</span>
          {hasSemanticContext ? (
            <button
              className="prompt-semantic-injection-toggle"
              onClick={() => setShowInjection(true)}
            >
              查看注入内容
            </button>
          ) : (
            <span style={{ fontSize: 10, color: '#9ca3af', fontWeight: 500 }}>无相关记忆</span>
          )}
        </div>
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

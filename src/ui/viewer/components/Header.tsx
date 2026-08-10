import React from 'react';
import { ThemeToggle } from './ThemeToggle';
import { ThemePreference } from '../hooks/useTheme';
import { GitHubStarsButton } from './GitHubStarsButton';
import { useSpinningFavicon } from '../hooks/useSpinningFavicon';

interface HeaderProps {
  projects: string[];
  currentFilter: string;
  onFilterChange: (filter: string) => void;
  isProcessing: boolean;
  queueDepth: number;
  themePreference: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  onSettingsToggle: () => void;
  appTab: string;
  onTabChange: (tab: string) => void;
  tabs: Array<{ key: string; label: string; icon: React.ReactNode }>;
}

export function Header({
  projects,
  currentFilter,
  onFilterChange,
  isProcessing,
  queueDepth,
  themePreference,
  onThemeChange,
  onSettingsToggle,
  appTab,
  onTabChange,
  tabs,
}: HeaderProps) {
  useSpinningFavicon(isProcessing);

  return (
    <div className="header">
      <div className="header-main">
        <h1>
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <img
              src="claude-mem-logomark.webp"
              alt=""
              className={`logomark ${isProcessing ? 'spinning' : ''}`}
            />
            {queueDepth > 0 && (
              <div className="queue-bubble">{queueDepth}</div>
            )}
          </div>
          <span className="logo-text">llm-mem</span>
        </h1>
        <div className="header-tabs">
          {tabs.map(t => (
            <button
              key={t.key}
              className={`header-tab ${appTab === t.key ? 'active' : ''}`}
              onClick={() => onTabChange(t.key)}
              type="button"
            >
              <span>{t.icon}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="status">
        <select
          value={currentFilter}
          onChange={e => onFilterChange(e.target.value)}
        >
          <option value="">全部项目</option>
          {projects.map(project => (
            <option key={project} value={project}>{project}</option>
          ))}
        </select>
        <ThemeToggle
          preference={themePreference}
          onThemeChange={onThemeChange}
        />
        <button
          className="settings-btn"
          onClick={onSettingsToggle}
          title="设置"
          aria-label="设置"
        >
          <svg className="settings-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l-.43-.25a2 2 0 0 1 2 0l.15-.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path>
            <circle cx="12" cy="12" r="3"></circle>
          </svg>
        </button>
      </div>
    </div>
  );
}

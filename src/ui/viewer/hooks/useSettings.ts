import { useState, useEffect } from 'react';
import { Settings, DependencyStatus } from '../types';
import { DEFAULT_SETTINGS } from '../constants/settings';
import { API_ENDPOINTS } from '../constants/api';

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');
  const [isRestarting, setIsRestarting] = useState(false);
  const [restartStatus, setRestartStatus] = useState('');
  const [dependencyHealth, setDependencyHealth] = useState<DependencyStatus[]>([]);
  const [isDependencyLoading, setIsDependencyLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setIsDependencyLoading(true);
      try {
        const [settingsData, dep] = await Promise.all([
          fetch(API_ENDPOINTS.SETTINGS).then(r => {
            if (!r.ok) throw new Error(`Failed to load settings (${r.status})`);
            return r.json();
          }),
          fetch(API_ENDPOINTS.DEPENDENCY_HEALTH)
            .then(async r => {
              if (!r.ok) return [];
              const data = await r.json();
              // Endpoint returns {degraded, statuses:[...]} object.
              return Array.isArray(data) ? data : (data?.statuses || []);
            })
            .catch(() => [])
        ]);
        setSettings({ ...DEFAULT_SETTINGS, ...settingsData });
        if (Array.isArray(dep)) setDependencyHealth(dep);
      } catch {
        // offline / worker not started — keep defaults
      } finally {
        setIsDependencyLoading(false);
      }
    };
    load();
  }, []);

  const submitSettings = async (newSettings: Settings) => {
    const response = await fetch(API_ENDPOINTS.SETTINGS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newSettings),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      setSaveStatus(`✗ 错误: ${data?.error || response.statusText}`);
      return false;
    }
    const result = await response.json();
    if (result.success) {
      setSettings(newSettings);
      setSaveStatus('✓ 已保存');
      return true;
    }
    setSaveStatus(`✗ 错误: ${result.error}`);
    return false;
  };

  const saveSettings = async (newSettings: Settings) => {
    setIsSaving(true);
    setSaveStatus('正在保存...');
    const ok = await submitSettings(newSettings);
    setIsSaving(false);
    setTimeout(() => setSaveStatus(''), 3000);
    return ok;
  };

  const restartWorker = async () => {
    setIsRestarting(true);
    setRestartStatus('正在重启 worker...');
    try {
      const response = await fetch(API_ENDPOINTS.RESTART, { method: 'POST' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        setRestartStatus(`✗ 重启失败: ${data.error || response.statusText}`);
        setIsRestarting(false);
        return false;
      }
      setRestartStatus('Worker 正在重启，请稍候...');
      // Page will auto-reconnect via SSE; no-op from here.
      return true;
    } catch (err) {
      setRestartStatus('✗ 重启失败: 无法连接到 worker');
      setIsRestarting(false);
      return false;
    }
  };

  return {
    settings,
    saveSettings,
    isSaving,
    saveStatus,
    restartWorker,
    isRestarting,
    restartStatus,
    dependencyHealth,
    isDependencyLoading,
  };
}

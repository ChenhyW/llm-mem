import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { API_ENDPOINTS } from '../constants/api';
import type { StatsOverview, StatsTimeSeriesRow, StatsSessionRow } from '../types';

interface StatisticsPanelProps {
  projects: string[];
  currentProject: string;
}

type TrendMetric = 'total_tokens' | 'input_tokens' | 'output_tokens' | 'llm_calls' | 'batches' | 'observations' | 'summaries';
type SessionSort = 'tokens' | 'calls' | 'date';

const METRICS: Array<{ key: TrendMetric; label: string; unit: string; color: string }> = [
  { key: 'total_tokens', label: '总 Token', unit: 'tok', color: '#6366f1' },
  { key: 'input_tokens', label: '输入 Token', unit: 'tok', color: '#06b6d4' },
  { key: 'output_tokens', label: '输出 Token', unit: 'tok', color: '#22c55e' },
  { key: 'llm_calls', label: 'LLM 调用', unit: '次', color: '#f59e0b' },
  { key: 'batches', label: '批次数', unit: '批', color: '#ec4899' },
  { key: 'observations', label: '观察数', unit: '条', color: '#a78bfa' },
  { key: 'summaries', label: '摘要数', unit: '条', color: '#f97316' },
];

const PERIODS: Array<{ days: number; label: string }> = [
  { days: 7, label: '7 天' },
  { days: 30, label: '30 天' },
];

function fmt(n: number, dec = 0): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(dec) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(dec) + 'K';
  return n.toFixed(dec);
}

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  } catch { return iso; }
}

function useStats(periodDays: number, project: string) {
  const [overview, setOverview] = useState<StatsOverview | null>(null);
  const [series, setSeries] = useState<StatsTimeSeriesRow[]>([]);
  const [sessions, setSessions] = useState<StatsSessionRow[]>([]);
  const [sessionsOffset, setSessionsOffset] = useState(0);
  const [sessionsHasMore, setSessionsHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSessionsOffset(0);
    setSessionsHasMore(false);

    Promise.all([
      fetch(`${API_ENDPOINTS.STATS_TOKENS}${project ? '?project=' + encodeURIComponent(project) : ''}`)
        .then(r => r.ok ? r.json() : Promise.reject(new Error(`StatsTokens ${r.status}`))),
      fetch(`${API_ENDPOINTS.STATS_TIME}?days=${periodDays}${project ? '&project=' + encodeURIComponent(project) : ''}`)
        .then(r => r.ok ? r.json() : Promise.reject(new Error(`StatsTime ${r.status}`))),
      fetch(`${API_ENDPOINTS.STATS_SESSIONS}?offset=0&limit=20${project ? '&project=' + encodeURIComponent(project) : ''}&sortBy=tokens`)
        .then(r => r.ok ? r.json() : Promise.reject(new Error(`StatsSessions ${r.status}`))),
    ])
      .then(([ov, ser, ses]) => {
        if (cancelled) return;
        setOverview(ov);
        setSeries(Array.isArray(ser) ? ser : []);
        setSessions(Array.isArray(ses) ? ses : []);
        setSessionsHasMore((Array.isArray(ses) ? ses.length : 0) >= 20);
      })
      .catch(err => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [periodDays, project]);

  const loadMoreSessions = useCallback((sort: SessionSort) => {
    const next = sessionsOffset + (sessions.length - (sessionsHasMore ? 1 : 0));
    fetch(`${API_ENDPOINTS.STATS_SESSIONS}?offset=${next}&limit=20${project ? '&project=' + encodeURIComponent(project) : ''}&sortBy=${sort}`)
      .then(r => r.ok ? r.json() : Promise.resolve([]))
      .then((arr: any) => {
        if (!Array.isArray(arr)) return;
        setSessionsOffset(next);
        setSessionsHasMore(arr.length >= 20);
        setSessions(prev => [...prev, ...arr.slice(0, 20)]);
      });
  }, [sessions, sessionsOffset, sessionsHasMore, project]);

  return { overview, series, sessions, sessionsOffset, sessionsHasMore, loading, error, loadMoreSessions };
}

const CHART_WIDTH = 640;
const CHART_HEIGHT = 130;
const PAD_L = 6;
const PAD_R = 36;
const PAD_T = 8;
const PAD_B = 16;
const TOOLTIP_HTML_HEIGHT = 68;

function useLineChart(
  series: StatsTimeSeriesRow[],
  selectedMetrics: Set<TrendMetric>,
  setSelectedMetrics: React.Dispatch<React.SetStateAction<Set<TrendMetric>>>
) {
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const maxVal = useMemo(() => {
    const keys = [...selectedMetrics];
    if (keys.length === 0) return 0;
    return Math.max(0, ...series.flatMap(r => keys.map(k => r[k] as number)));
  }, [series, selectedMetrics]);

  const linePathByMetric = useMemo(() => {
    const n = series.length;
    const plotW = CHART_WIDTH - PAD_L - PAD_R;
    const plotH = CHART_HEIGHT - PAD_T - PAD_B;
    const out: Record<string, string> = {};
    for (const m of METRICS) {
      const pts = series.map((r, i) => {
        const x = PAD_L + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
        const y = PAD_T + (maxVal > 0 ? plotH - (r[m.key] as number) / maxVal * plotH : plotH / 2);
        return [x, y];
      });
      out[m.key] = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    }
    return out;
  }, [series, maxVal]);

  const xForIdx = useMemo(() => {
    const n = series.length;
    const plotW = CHART_WIDTH - PAD_L - PAD_R;
    return (i: number) => PAD_L + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  }, [series]);

  const isTodayIdx = useMemo(
    () => series.findIndex(r => r.date === todayStr),
    [series, todayStr]
  );

  const [hoverIdx, setHoverIdx] = useState(-1);
  const [hoverPos, setHoverPos] = useState<[number, number] | null>(null);

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (CHART_WIDTH - PAD_L - PAD_R) / rect.width;
    const localX = (e.clientX - rect.left) * ratio + PAD_L;
    const n = series.length;
    if (n === 0) { setHoverIdx(-1); setHoverPos(null); return; }
    const xs = Array.from({ length: n }, (_, i) => xForIdx(i));
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < n; i++) { const d = Math.abs(xs[i] - localX); if (d < bd) { bd = d; best = i; } }
    setHoverIdx(best);
    setHoverPos([xForIdx(best), PAD_T]);
  }, [series, xForIdx]);

  const handleMouseOut = useCallback(() => { setHoverIdx(-1); setHoverPos(null); }, []);

  const activeSeriesFor = useCallback((m: TrendMetric) => {
    return [...selectedMetrics].includes(m) && hoverIdx >= 0 ? hoverIdx : -1;
  }, [selectedMetrics, hoverIdx]);

  const [activeMetricTooltip, setActiveMetricTooltip] = useState<TrendMetric | null>(null);
  const handleMetricClick = useCallback((m: TrendMetric) => {
    setActiveMetricTooltip(t => (t === m ? null : m));
  }, []);

  const toggleMetric = useCallback((m: TrendMetric) => {
    setSelectedMetrics(prev => {
      const next = new Set(prev);
      if (next.has(m)) {
        if (next.size > 1) next.delete(m);
      } else {
        next.add(m);
      }
      return next;
    });
  }, []);

  const metricMeta = METRICS.find(m => m.key === 'total_tokens') || METRICS[0];

  return {
    metricMeta, maxVal, linePathByMetric, activeSeriesFor,
    handleMetricClick, toggleMetric, handleMouseMove, handleMouseOut,
    activeMetricTooltip, xForIdx, series, isTodayIdx, hoverIdx, hoverPos,
    chartWidth: CHART_WIDTH, chartHeight: CHART_HEIGHT, padding: PAD_L,
    setHoverIdx, setActiveMetricTooltip,
  };
}

export function StatisticsPanel({ projects, currentProject }: StatisticsPanelProps) {
  // Panel-own project state. Initialized from header's filter when opening
  // the tab, but after that fully owned by the user's dropdown here so it
  // doesn't get clobbered by header-filter changes in the observations feed.
  const [selectedProject, setSelectedProject] = useState(
    currentProject || (projects.length > 0 ? projects[0] : '')
  );
  const [periodDays, setPeriodDays] = useState(7);
  const [selectedMetrics, setSelectedMetrics] = useState<Set<TrendMetric>>(
    () => new Set(['total_tokens', 'input_tokens', 'output_tokens'])
  );
  const [sessionSort, setSessionSort] = useState<SessionSort>('tokens');
  const [chartHover, setChartHover] = useState<{ idx: number; x: number; y: number } | null>(null);

  useEffect(() => {
    if (selectedProject && !projects.includes(selectedProject)) {
      setSelectedProject('');
    }
  }, [projects, selectedProject]);

  const {
    overview, series, sessions, sessionsOffset, sessionsHasMore, loading, error, loadMoreSessions
  } = useStats(periodDays, selectedProject);

  const {
    metricMeta, maxVal, linePathByMetric, activeSeriesFor,
    handleMetricClick, toggleMetric, handleMouseMove, handleMouseOut,
    activeMetricTooltip, xForIdx, isTodayIdx, hoverIdx,
    chartWidth, chartHeight
  } = useLineChart(series, selectedMetrics, setSelectedMetrics);

  const cards = useMemo(() => {
    if (!overview) return null;
    return [
      { label: '总 Token', value: fmt(overview.total_tokens), sub: `输入 ${fmt(overview.input_tokens)} · 输出 ${fmt(overview.output_tokens)}`, color: '#6366f1', icon: <TextIcon /> },
      { label: 'LLM 调用', value: fmt(overview.llm_calls), sub: `批 ${overview.batch_count} + 摘要 ${overview.summary_count}`, color: '#f59e0b', icon: <BotIcon /> },
      { label: 'Session 数', value: fmt(overview.session_count), sub: `摘要 ${overview.summary_count} · 观察 ${overview.observation_count}`, color: '#06b6d4', icon: <SessionIcon /> },
      { label: '平均每次调用', value: fmt(overview.avg_output_tokens_per_call), sub: `输出 ${fmt(overview.avg_output_tokens_per_call)} · 输入 ${fmt(overview.avg_input_tokens_per_call)}`, color: '#22c55e', icon: <AvgIcon /> },
    ];
  }, [overview]);

  // Client-side sort of already-loaded sessions list.
  const sessionsSorted = useMemo(() => {
    const arr = [...sessions];
    arr.sort((a, b) => {
      if (sessionSort === 'tokens') return b.total_tokens - a.total_tokens;
      if (sessionSort === 'calls') return b.llm_calls - a.llm_calls;
      const aT = typeof a.first_seen === 'number' ? a.first_seen
        : typeof a.first_seen === 'string' ? (a.first_seen ? a.first_seen : '') : '';
      const bT = typeof b.first_seen === 'number' ? b.first_seen
        : typeof b.first_seen === 'string' ? (b.first_seen ? b.first_seen : '') : '';
      return String(bT).localeCompare(String(aT));
    });
    return arr;
  }, [sessions, sessionSort]);

  if (loading) {
    return <EmptyState><span className="spinner" style={{ animation: 'spin 1s linear infinite' }}>●</span> 加载中...</EmptyState>;
  }
  if (error) {
    return <EmptyState><span style={{ color: '#ef4444' }}>⚠ {error}</span></EmptyState>;
  }
  if (!overview || series.length === 0) {
    return <EmptyState>暂无统计数据</EmptyState>;
  }

  return (
    <div className="stats-panel">
      <style>{`
        .stats-panel { padding: 0 0 24px; }
        .stats-header h2 {
          margin: 0 0 6px; font-size: 18px; font-weight: 600;
          display: flex; align-items: center; gap: 8px;
          color: var(--color-text-title, #222);
        }
        .stats-header h2 svg { opacity: 0.7; }
        .stats-description {
          margin: 0 0 18px; font-size: 13px; line-height: 1.6;
          color: var(--color-text-secondary, #555);
        }
        .stats-controls {
          display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-end;
          padding: 14px 16px; border: 1px solid var(--color-border-secondary, #ddd);
          border-radius: 8px; background: var(--color-bg-secondary, #fafafa);
          margin-bottom: 18px;
        }
        .stats-control-group { display: flex; flex-direction: column; gap: 6px; }
        .stats-control-group label {
          font-size: 12px; color: var(--color-text-secondary, #555);
          font-weight: 500;
        }
        .stats-select {
          padding: 6px 10px; border: 1px solid var(--color-border-primary, #ccc);
          border-radius: 6px; font-size: 13px;
          background: var(--color-bg-input, #fff);
          color: var(--color-text-primary, #222);
        }
        .stats-chip-row { display: flex; gap: 6px; }
        .stats-chip {
          padding: 5px 12px; font-size: 12px; border-radius: 999px;
          border: 1px solid var(--color-border-primary, #ccc);
          background: var(--color-bg-card, #fff);
          color: var(--color-text-primary, #222);
          cursor: pointer; transition: all 0.15s;
        }
        .stats-chip:hover { border-color: var(--color-accent-primary, #6366f1); }
        .stats-chip.active {
          background: var(--color-accent-primary, #6366f1);
          color: #fff; border-color: var(--color-accent-primary, #6366f1);
        }
        .stats-overview-cards {
          display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px;
          margin-bottom: 16px;
        }
        @media (max-width: 800px) {
          .stats-overview-cards { grid-template-columns: repeat(2, 1fr); }
        }
        .stats-overview-card {
          padding: 14px; border-radius: 8px;
          border: 1px solid; border-left-width: 3px;
          background: var(--color-bg-card, #fff);
          display: flex; flex-direction: column; gap: 4px;
        }
        .stats-card-icon { opacity: 0.85; }
        .stats-card-value {
          font-size: 22px; font-weight: 700; font-family: ui-monospace, SF Mono, Menlo, monospace;
        }
        .stats-card-label {
          font-size: 12px; color: var(--color-text-secondary, #555);
          font-weight: 500;
        }
        .stats-card-sub {
          font-size: 11px; color: var(--color-text-muted, #888);
        }
        .stats-date-range {
          font-size: 12px; color: var(--color-text-muted, #888);
          margin-bottom: 14px; padding-left: 2px;
        }
        .stats-trend-section {
          border: 1px solid var(--color-border-secondary, #ddd);
          border-radius: 8px; padding: 14px; margin-bottom: 18px;
          background: var(--color-bg-card, #fff);
        }
        .stats-trend-section h3 {
          margin: 0 0 10px; font-size: 15px; font-weight: 600;
          color: var(--color-text-title, #222);
        }
        .stats-trend-header {
          display: flex; align-items: center; justify-content: space-between;
          flex-wrap: wrap; gap: 10px; margin-bottom: 14px;
        }
        .stats-metric-tabs { display: flex; gap: 4px; flex-wrap: wrap; }
        .stats-metric-tab {
          padding: 4px 10px; font-size: 12px; border-radius: 6px;
          border: 1px solid transparent;
          background: transparent;
          color: var(--color-text-secondary, #555);
          cursor: pointer;
        }
        .stats-metric-tab:hover { background: var(--color-bg-secondary, #f3f3f3); }
        .stats-metric-tab.active {
          background: var(--color-bg-tertiary, #f0f0f0);
          font-weight: 600; border-color: currentColor;
        }
        .stats-chart {
          border-top: 1px solid var(--color-border-secondary, #eee);
          padding-top: 10px;
          position: relative;
          margin-top: 70px;
          margin-bottom: 0;
        }
        .stats-chart-anchor {
          position: relative;
          width: 100%;
        }
        .stats-chart-svg {
          width: 100%; height: auto; display: block;
          font-family: ui-monospace, SF Mono, Menlo, monospace;
        }
        .stats-chart-ytext, .stats-chart-xtext {
          font-size: 8px; fill: var(--color-text-muted, #999);
        }
        .stats-chart-tooltip-html {
          position: absolute;
          bottom: 100%;
          left: 0;
          margin-bottom: 4px;
          min-width: 240px;
          background: var(--color-bg-card, #fff);
          border: 1px solid var(--color-border-primary, #ccc);
          border-radius: 6px;
          padding: 8px 12px;
          box-shadow: 0 -2px 8px rgba(0,0,0,0.08);
          z-index: 10;
          display: flex; flex-direction: column; gap: 4px;
          pointer-events: auto;
        }
        .stats-chart-tooltip-html.left-edge {
          left: 0 !important; transform: none !important;
        }
        .stats-chart-tooltip-html.right-edge {
          right: 0 !important; left: auto !important; transform: none !important;
        }
        .stats-chart-tooltip-html .stats-chart-tooltip-date {
          font-size: 12px; font-weight: 600;
          color: var(--color-text-primary, #222);
          margin-bottom: 2px;
          padding-bottom: 4px;
          border-bottom: 1px solid var(--color-border-secondary, #eee);
        }
        .stats-chart-tooltip-html .stats-chart-tooltip-line {
          font-size: 12px; line-height: 18px; cursor: pointer;
          display: flex; justify-content: space-between; gap: 12px; align-items: baseline;
        }
        .stats-chart-tooltip-html .stats-chart-tooltip-line:hover { font-weight: 500; }
        .stats-chart-tooltip-html .stats-chart-tooltip-metric { opacity: 0.85; flex: 0 0 auto; }
        .stats-chart-tooltip-html .stats-chart-tooltip-value { font-weight: 500; font-variant-numeric: tabular-nums; }
        .stats-chart-tooltip-html .stats-chart-tooltip-sub {
          font-size: 11px; color: var(--color-text-secondary, #666);
          display: block; margin-top: 2px; padding-left: 6px;
          white-space: nowrap;
        }
        .stats-chart-tooltip-date {
          font-size: 10px; font-weight: 600; fill: var(--color-text-primary, #222);
        }
        .stats-chart-tooltip-line {
          font-size: 10px; cursor: pointer;
        }
        .stats-chart-tooltip-line:hover { font-weight: 600; }
        .stats-chart-tooltip-sub {
          font-size: 9px; fill: var(--color-text-secondary, #666);
        }
        .stats-chart-legend {
          display: flex; justify-content: space-between;
          font-size: 11px; color: var(--color-text-muted, #999);
          padding: 2px 2px 0;
        }
        .stats-metric-checks {
          display: flex; flex-wrap: wrap; gap: 4px;
          margin: 6px 0 8px;
        }
        .stats-metric-check {
          display: inline-flex; align-items: center; gap: 5px;
          padding: 4px 8px; border-radius: 5px;
          border: 1px solid var(--color-border-secondary, #ccc);
          background: transparent;
          color: var(--color-text-secondary, #555);
          cursor: pointer; font-size: 11px;
          transition: all 0.15s;
          user-select: none;
        }
        .stats-metric-check:hover {
          background: var(--color-bg-secondary, #f3f3f3);
        }
        .stats-metric-check.active {
          background: var(--color-bg-tertiary, #f0f0f0);
          font-weight: 500;
        }
        .stats-metric-dot {
          display: inline-block; width: 8px; height: 8px; border-radius: 50%;
        }
        .stats-metric-unit {
          font-size: 10px; color: var(--color-text-muted, #999);
        }
        .stats-sessions-section {
          border: 1px solid var(--color-border-secondary, #ddd);
          border-radius: 8px; padding: 14px;
          background: var(--color-bg-card, #fff);
        }
        .stats-sessions-section h3 {
          margin: 0 0 10px; font-size: 15px; font-weight: 600;
          color: var(--color-text-title, #222);
        }
        .stats-sessions-header {
          display: flex; align-items: center; justify-content: space-between;
          flex-wrap: wrap; gap: 10px; margin-bottom: 10px;
        }
        .stats-sort-tabs { display: flex; gap: 4px; }
        .stats-sort-tab {
          padding: 4px 10px; font-size: 12px; border-radius: 6px;
          border: 1px solid transparent;
          background: transparent;
          color: var(--color-text-secondary, #555);
          cursor: pointer;
        }
        .stats-sort-tab:hover { background: var(--color-bg-secondary, #f3f3f3); }
        .stats-sort-tab.active {
          background: var(--color-accent-primary, #6366f1);
          color: #fff; font-weight: 500;
        }
        .stats-sessions-table {
          width: 100%; border-collapse: collapse;
          font-size: 13px;
        }
        .stats-sessions-table th, .stats-sessions-table td {
          padding: 7px 10px; text-align: right;
          border-bottom: 1px solid var(--color-border-secondary, #eee);
          white-space: nowrap;
        }
        .stats-sessions-table th:first-child,
        .stats-sessions-table td:first-child { text-align: left; }
        .stats-sessions-table th {
          color: var(--color-text-secondary, #555); font-weight: 600;
          font-size: 12px; background: var(--color-bg-secondary, #fafafa);
          position: sticky; top: 0;
        }
        .stats-sessions-table td:first-child {
          color: var(--color-text-muted, #777); font-size: 12px;
        }
        .stats-sessions-table td:nth-child(2) {
          max-width: 200px; overflow: hidden; text-overflow: ellipsis;
          white-space: nowrap; font-size: 12px;
          color: var(--color-text-secondary, #555);
        }
        .stats-session-id {
          font-family: ui-monospace, SF Mono, Menlo, monospace;
          font-size: 11px; color: var(--color-text-muted, #888);
        }
        .stats-load-more {
          display: block; margin: 12px auto 0;
          padding: 6px 16px; border-radius: 6px;
          border: 1px solid var(--color-border-primary, #ccc);
          background: var(--color-bg-card, #fff);
          font-size: 12px; cursor: pointer;
          color: var(--color-text-primary, #222);
        }
        .stats-load-more:hover {
          background: var(--color-bg-secondary, #f0f0f0);
        }
        @media (prefers-color-scheme: dark) {
          .stats-select, .stats-overview-card, .stats-trend-section,
          .stats-sessions-section {
            background: var(--color-bg-card, #1e1e1e);
            border-color: var(--color-border-secondary, #333);
          }
        }
      `}</style>
      <div className="stats-header">
        <h2>
          <BarIcon /> 使用统计
        </h2>
        <p className="stats-description">
          按时间和 session 统计 LLM token 消耗与调用次数。
          输入 / 输出为真实归因；"总 Token" 含 discovery 处理开销；"LLM 调用" = 批次数 + 摘要数。
        </p>
      </div>

      <div className="stats-controls">
        <div className="stats-control-group">
          <label>项目</label>
          <select
            value={selectedProject}
            onChange={e => setSelectedProject(e.target.value)}
            className="stats-select"
          >
            {projects.length === 0 && <option value="">无项目</option>}
            {projects.map(p => (<option key={p} value={p}>{p}</option>))}
          </select>
        </div>
        <div className="stats-control-group">
          <label>时间范围</label>
          <div className="stats-chip-row">
            {PERIODS.map(p => (
              <button
                key={p.days}
                type="button"
                className={`stats-chip ${periodDays === p.days ? 'active' : ''}`}
                onClick={() => setPeriodDays(p.days)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="stats-overview-cards">
        {cards!.map((card, i) => (
          <div key={i} className="stats-overview-card" style={{ borderColor: card.color }}>
            <div className="stats-card-icon" style={{ color: card.color }}>{card.icon}</div>
            <div className="stats-card-value" style={{ color: card.color }}>{card.value}</div>
            <div className="stats-card-label">{card.label}</div>
            <div className="stats-card-sub">{card.sub}</div>
          </div>
        ))}
      </div>

      <div className="stats-date-range">
        {fmtDate(overview.first_seen) && fmtDate(overview.last_seen)
          ? <span>{fmtDate(overview.first_seen)} → {fmtDate(overview.last_seen)}</span>
          : <span>无数据</span>
        }
      </div>

      <div className="stats-trend-section">
        <div className="stats-trend-header">
          <h3>日趋势</h3>
        </div>
        <div className="stats-metric-checks">
          {METRICS.map(m => (
            <label
              key={m.key}
              className={`stats-metric-check ${selectedMetrics.has(m.key) ? 'active' : ''}`}
              style={selectedMetrics.has(m.key) ? { color: m.color, borderColor: m.color } : {}}
              onClick={() => toggleMetric(m.key)}
            >
              <span className="stats-metric-dot" style={{ background: m.color }} />
              <span className="stats-metric-name">{m.label}</span>
              <span className="stats-metric-unit">{m.unit}</span>
            </label>
          ))}
        </div>

        <div className="stats-chart-anchor">
          {hoverIdx >= 0 && series[hoverIdx] && (() => {
            const hoverX = xForIdx(hoverIdx);
            const leftPct = (hoverX / CHART_WIDTH) * 100;
            const tooltipHalfW = 120 / CHART_WIDTH * 100;
            let edgeClass: 'left-edge' | 'right-edge' | '' = '';
            let finalLeftPct = leftPct;
            if (leftPct < tooltipHalfW) { edgeClass = 'left-edge'; finalLeftPct = 0; }
            else if (leftPct > 100 - tooltipHalfW) { edgeClass = 'right-edge'; finalLeftPct = 100; }
            return (
              <div className={`stats-chart-tooltip-html ${edgeClass}`}
                style={{ left: `${finalLeftPct}%` }}
              >
                <div className="stats-chart-tooltip-date">{series[hoverIdx].date}</div>
                {[...selectedMetrics].map((m, i) => {
                  const row = series[hoverIdx];
                  const mMeta = METRICS.find(x => x.key === m)!;
                  const showDetail = activeMetricTooltip === m;
                  return (
                    <span key={m} className="stats-chart-tooltip-line"
                      style={{ color: mMeta.color }}
                      onClick={() => handleMetricClick(m)}
                    >
                      <span className="stats-chart-tooltip-metric">{mMeta.label}</span>
                      <span className="stats-chart-tooltip-value">{fmt(row[m] as number)} {mMeta.unit}</span>
                      {showDetail && (
                        <span className="stats-chart-tooltip-sub">
                          观察 {row.observations} · 批 {row.batches} · 摘要 {row.summaries} · 调用 {row.llm_calls}
                        </span>
                      )}
                    </span>
                  );
                })}
              </div>
            );
          })()}
          <svg
            viewBox={`0 0 ${chartWidth} ${chartHeight}`}
            preserveAspectRatio="none"
            className="stats-chart-svg"
            onMouseMove={handleMouseMove}
            onMouseOut={handleMouseOut}
            role="img"
            aria-label="日趋势折线图"
          >
            <defs>
              <linearGradient id="chart-grid-fade" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="transparent" />
                <stop offset="100%" stopColor="var(--color-border-secondary, #eee)" stopOpacity="0.4" />
              </linearGradient>
            </defs>

            {maxVal > 0 && (
              <g className="stats-chart-ylabels">
                {[0, 0.5, 1].map((ratio, i) => {
                  const y = PAD_T + (CHART_HEIGHT - PAD_T - PAD_B) * (1 - ratio);
                  return (
                    <g key={i}>
                      <line
                        x1={PAD_L}
                        x2={CHART_WIDTH - PAD_R}
                        y1={y}
                        y2={y}
                        stroke="var(--color-border-secondary, #eee)"
                        strokeDasharray="2 3"
                      />
                      <text x={CHART_WIDTH - PAD_R + 1} y={y + 3} className="stats-chart-ytext">
                        {fmt(maxVal * ratio)}
                      </text>
                    </g>
          );
                })}
              </g>
            )}

            <line
              x1={PAD_L}
              x2={CHART_WIDTH - PAD_R}
              y1={CHART_HEIGHT - PAD_B}
              y2={CHART_HEIGHT - PAD_B}
              stroke="var(--color-border-secondary, #ccc)"
            />

            {METRICS.filter(m => selectedMetrics.has(m.key)).map(m => {
              const active = activeSeriesFor(m.key);
              const pts = series.map((row, i) => {
                const x = xForIdx(i);
                const y = PAD_T + (maxVal > 0
                  ? (CHART_HEIGHT - PAD_T - PAD_B) * (1 - (row[m.key] as number) / maxVal)
                  : (CHART_HEIGHT - PAD_T - PAD_B) / 2);
                return [x, y];
              });
              const areaD = pts.length > 1
                ? linePathByMetric[m.key] + ` L${pts[pts.length-1][0].toFixed(1)},${(CHART_HEIGHT-PAD_B).toFixed(1)} L${pts[0][0].toFixed(1)},${(CHART_HEIGHT-PAD_B).toFixed(1)} Z`
                : '';
              return (
                <g key={m.key}>
                  {areaD && (
                    <path d={areaD} fill={m.color} opacity={active >= 0 ? 0.18 : 0.07} />
                  )}
                  <path
                    d={linePathByMetric[m.key]}
                    fill="none"
                    stroke={m.color}
                    strokeWidth={active >= 0 ? 1.5 : 1}
                    strokeOpacity={active >= 0 ? 1 : 0.92}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="stats-chart-line"
                  />
                  {series.map((row, i) => {
                    const [x, y] = pts[i] as [number, number];
                    const isActive = active === i;
                    const isToday = row.date === new Date().toISOString().slice(0, 10);
                    return (
                      <circle
                        key={i}
                        cx={x}
                        cy={y}
                        r={isActive ? 3.5 : 1.8}
                        fill={isActive ? m.color : 'var(--color-bg-card, #fff)'}
                        stroke={m.color}
                        strokeWidth={isActive ? 0 : 1.2}
                        style={isToday && !isActive ? { strokeDasharray: '2 2' } : {}}
                        onClick={() => handleMetricClick(m.key)}
                      />
                    );
                  })}
                </g>
              );
            })}

            {isTodayIdx >= 0 && (
              <line
                x1={xForIdx(isTodayIdx)}
                x2={xForIdx(isTodayIdx)}
                y1={PAD_T}
                y2={CHART_HEIGHT - PAD_B}
                stroke="var(--color-accent-primary, #6366f1)"
                strokeDasharray="4 2"
                strokeWidth="1"
                strokeOpacity="0.55"
              />
            )}

            {hoverIdx >= 0 && (
              <line
                x1={xForIdx(hoverIdx)}
                x2={xForIdx(hoverIdx)}
                y1={PAD_T}
                y2={CHART_HEIGHT - PAD_B}
                stroke="var(--color-border-primary, #999)"
                strokeDasharray="3 3"
                strokeWidth="1"
              />
            )}

            <g className="stats-chart-xlabels">
              {series.map((row, i) => {
                const isFirst = i === 0;
                const isLast = i === series.length - 1;
                const show = isFirst || isLast || i === isTodayIdx || (i % Math.ceil(series.length / 8)) === 0;
                if (!show) return null;
                const anchor = isFirst ? 'start' : isLast ? 'end' : 'middle';
                return (
                  <text
                    key={i}
                    x={xForIdx(i)}
                    y={CHART_HEIGHT - PAD_B + 12}
                    textAnchor={anchor}
                    className="stats-chart-xtext"
                  >
                    {row.date.slice(5)}
                  </text>
                );
              })}
            </g>
          </svg>

          {series.length > 0 && (
            <div className="stats-chart-legend">
              <span>今日</span>
              <span className="stats-chart-max" style={{ color: metricMeta.color }}>
                峰值 {fmt(maxVal)}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="stats-sessions-section">
        <div className="stats-sessions-header">
          <h3>Session 明细</h3>
          <div className="stats-sessions-controls">
            <div className="stats-sort-tabs">
              {(['tokens', 'calls', 'date'] as SessionSort []).map(s => (
                <button
                  key={s}
                  type="button"
                  className={`stats-sort-tab ${sessionSort === s ? 'active' : ''}`}
                  onClick={() => setSessionSort(s)}
                >
                  {s === 'tokens' ? '按总 Token' : s === 'calls' ? '按调用数' : '按日期'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {sessionsSorted.length === 0 ? (
          <EmptyState>当前范围内无 session 数据</EmptyState>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table className="stats-sessions-table">
                <thead>
                  <tr>
                    <th>日期</th>
                    <th>项目</th>
                    <th>输入</th>
                    <th>输出</th>
                    <th>总 Token</th>
                    <th>调用</th>
                    <th>批</th>
                    <th>观察</th>
                    <th>摘要</th>
                    <th>Session</th>
                  </tr>
                </thead>
                <tbody>
                  {sessionsSorted.map((r, i) => (
                    <tr key={i}>
                      <td>{r.date}</td>
                      <td title={r.project}>{r.project}</td>
                      <td>{fmt(r.input_tokens)}</td>
                      <td>{fmt(r.output_tokens)}</td>
                      <td style={{ fontWeight: 600 }}>{fmt(r.total_tokens)}</td>
                      <td>{fmt(r.llm_calls)}</td>
                      <td>{r.batches}</td>
                      <td>{r.observations}</td>
                      <td>{r.summaries}</td>
                      <td className="stats-session-id" title={r.session_id}>
                        {r.session_id.slice(0, 8)}…
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {sessionsHasMore && (
              <button
                type="button"
                className="stats-load-more"
                onClick={() => loadMoreSessions(sessionSort)}
              >
                加载更多
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      gap: 10, padding: 32, color: 'var(--text-secondary, #888)',
      background: 'var(--color-bg-secondary, #f8f9fa)',
      borderRadius: 8,
      fontSize: 14,
    }}>
      {children}
    </div>
  );
}

function TextIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>;
}
function BotIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="6" width="16" height="12" rx="2"/><line x1="9" y1="6" x2="9" y2="3"/><line x1="15" y1="6" x2="15" y2="3"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><line x1="10" y1="16" x2="14" y2="16"/></svg>;
}
function SessionIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="14" rx="1"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="20" x2="16" y2="20"/><line x1="12" y1="18" x2="12" y2="20"/></svg>;
}
function AvgIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 17 9 11 13 15 21 7"/><polyline points="14 7 21 7 21 14"/></svg>;
}
function BarIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="20" x2="4" y2="10"/><line x1="10" y1="20" x2="10" y2="4"/><line x1="16" y1="20" x2="16" y2="14"/><line x1="22" y1="20" x2="22" y2="2"/></svg>;
}
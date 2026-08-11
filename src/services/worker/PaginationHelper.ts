
import type { SQLQueryBindings } from 'bun:sqlite';
import { DatabaseManager } from './DatabaseManager.js';
import { logger } from '../../utils/logger.js';
import { OBSERVER_SESSIONS_PROJECT } from '../../shared/paths.js';
import { USER_PROMPT_DEDUPE_WINDOW_MS } from '../../shared/user-prompts.js';
import type { PaginatedResult, Observation, Summary, UserPrompt, StatsOverview, StatsTimeSeriesRow, StatsSessionRow } from '../worker-types.js';

export class PaginationHelper {
  private dbManager: DatabaseManager;

  constructor(dbManager: DatabaseManager) {
    this.dbManager = dbManager;
  }

  private stripProjectPath(filePath: string, projectName: string): string {
    const leaf = projectName.includes('/') ? projectName.split('/').pop()! : projectName;
    const marker = `/${leaf}/`;
    const index = filePath.indexOf(marker);

    if (index !== -1) {
      return filePath.substring(index + marker.length);
    }

    return filePath;
  }

  private stripProjectPaths(filePathsStr: string | null, projectName: string): string | null {
    if (!filePathsStr) return filePathsStr;

    try {
      const paths = JSON.parse(filePathsStr) as string[];

      const strippedPaths = paths.map(p => this.stripProjectPath(p, projectName));

      return JSON.stringify(strippedPaths);
    } catch (err) {
      if (err instanceof Error) {
        logger.debug('WORKER', 'File paths is plain string, using as-is', {}, err);
      } else {
        logger.debug('WORKER', 'File paths is plain string, using as-is', { rawError: String(err) });
      }
      return filePathsStr;
    }
  }

  private sanitizeObservation(obs: Observation): Observation {
    return {
      ...obs,
      files_read: this.stripProjectPaths(obs.files_read, obs.project),
      files_modified: this.stripProjectPaths(obs.files_modified, obs.project)
    };
  }

  getObservations(offset: number, limit: number, project?: string, platformSource?: string): PaginatedResult<Observation> {
    const db = this.dbManager.getSessionStore().db;
    let query = `
      SELECT
        o.id,
        o.memory_session_id,
        o.project,
        o.merged_into_project,
        COALESCE(s.platform_source, 'claude') as platform_source,
        o.type,
        o.title,
        o.subtitle,
        o.narrative,
        o.text,
        o.facts,
        o.concepts,
        o.files_read,
        o.files_modified,
        o.prompt_number,
        o.created_at,
        o.created_at_epoch,
        o.discovery_tokens,
        o.input_tokens,
        o.output_tokens,
        o.batch_size,
        o.batch_index
      FROM observations o
      LEFT JOIN sdk_sessions s ON o.memory_session_id = s.memory_session_id
    `;
    const params: SQLQueryBindings[] = [];
    const conditions: string[] = [];

    if (project) {
      conditions.push('(o.project = ? OR o.merged_into_project = ?)');
      params.push(project, project);
    } else {
      conditions.push('o.project != ?');
      params.push(OBSERVER_SESSIONS_PROJECT);
    }
    if (platformSource) {
      conditions.push(`COALESCE(s.platform_source, 'claude') = ?`);
      params.push(platformSource);
    }
    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ' ORDER BY o.created_at_epoch DESC LIMIT ? OFFSET ?';
    params.push(limit + 1, offset);

    const results = db.prepare(query).all(...params) as Observation[];
    const result: PaginatedResult<Observation> = {
      items: results.slice(0, limit),
      hasMore: results.length > limit,
      offset,
      limit
    };

    return {
      ...result,
      items: result.items.map(obs => this.sanitizeObservation(obs))
    };
  }

  getSummaries(offset: number, limit: number, project?: string, platformSource?: string): PaginatedResult<Summary> {
    const db = this.dbManager.getSessionStore().db;

    let query = `
      SELECT
        ss.id,
        s.content_session_id as session_id,
        COALESCE(s.platform_source, 'claude') as platform_source,
        ss.request,
        ss.investigated,
        ss.learned,
        ss.completed,
        ss.next_steps,
        ss.project,
        ss.created_at,
        ss.created_at_epoch,
        ss.discovery_tokens,
        ss.input_tokens,
        ss.output_tokens
      FROM session_summaries ss
      JOIN sdk_sessions s ON ss.memory_session_id = s.memory_session_id
    `;
    const params: any[] = [];

    const conditions: string[] = [];

    if (project) {
      conditions.push('(ss.project = ? OR ss.merged_into_project = ?)');
      params.push(project, project);
    } else {
      conditions.push('ss.project != ?');
      params.push(OBSERVER_SESSIONS_PROJECT);
    }

    if (platformSource) {
      conditions.push(`COALESCE(s.platform_source, 'claude') = ?`);
      params.push(platformSource);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ' ORDER BY ss.created_at_epoch DESC LIMIT ? OFFSET ?';
    params.push(limit + 1, offset);

    const stmt = db.prepare(query);
    const results = stmt.all(...params) as Summary[];

    return {
      items: results.slice(0, limit),
      hasMore: results.length > limit,
      offset,
      limit
    };
  }

  getPrompts(offset: number, limit: number, project?: string, platformSource?: string): PaginatedResult<UserPrompt> {
    const db = this.dbManager.getSessionStore().db;

    let query = `
      SELECT
        up.id,
        up.content_session_id,
        s.project,
        COALESCE(s.platform_source, 'claude') as platform_source,
        up.prompt_number,
        up.prompt_text,
        up.created_at,
        up.created_at_epoch
      FROM user_prompts up
      JOIN sdk_sessions s ON up.session_db_id = s.id
    `;
    const params: any[] = [];

    const conditions: string[] = [];

    if (project) {
      conditions.push('s.project = ?');
      params.push(project);
    } else {
      conditions.push('s.project != ?');
      params.push(OBSERVER_SESSIONS_PROJECT);
    }

    if (platformSource) {
      conditions.push(`COALESCE(s.platform_source, 'claude') = ?`);
      params.push(platformSource);
    }

    conditions.push(`
      NOT EXISTS (
        SELECT 1
        FROM user_prompts duplicate
        WHERE duplicate.session_db_id = up.session_db_id
          AND duplicate.prompt_text = up.prompt_text
          AND (
            duplicate.created_at_epoch > up.created_at_epoch
            OR (
              duplicate.created_at_epoch = up.created_at_epoch
              AND duplicate.id > up.id
            )
          )
          AND duplicate.created_at_epoch - up.created_at_epoch <= ?
      )
    `);
    params.push(USER_PROMPT_DEDUPE_WINDOW_MS);

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ' ORDER BY up.created_at_epoch DESC LIMIT ? OFFSET ?';
    params.push(limit + 1, offset);

    const stmt = db.prepare(query);
    const results = stmt.all(...params) as UserPrompt[];

    return {
      items: results.slice(0, limit),
      hasMore: results.length > limit,
      offset,
      limit
    };
  }

  /**
   * 1-dimensional aggregate roll-up across all observations + summaries in
   * scope. `llm_calls` counts one invocation per batch (batch_index=1 in
   * observations) plus one per session summary (each summary = one terminal
   * "summarize" call).
   */
  getStatisticsOverview(project?: string, platformSource?: string): StatsOverview {
    const db = this.dbManager.getSessionStore().db;

    const [obsWhere, obsParams] = this.buildStatsWhere('obs', project, platformSource);
    const [sumWhere, sumParams] = this.buildStatsWhere('sum', project, platformSource);

    // --- Observation aggregates --------------------------------------------
    const obsRow = db.prepare(`
      SELECT
        COUNT(*) as observation_count,
        SUM(CASE WHEN batch_index = 1 THEN 1 ELSE 0 END) as batch_count,
        COALESCE(SUM(discovery_tokens), 0) as discovery_tokens,
        COALESCE(SUM(input_tokens), 0) as input_tokens,
        COALESCE(SUM(output_tokens), 0) as output_tokens,
        MIN(created_at_epoch) as first_seen_epoch,
        MAX(created_at_epoch) as last_seen_epoch
      FROM observations o
      LEFT JOIN sdk_sessions s ON o.memory_session_id = s.memory_session_id
      ${obsWhere}
    `).get(...(obsParams as any)) as
      { observation_count: number; batch_count: number; discovery_tokens: number;
        input_tokens: number; output_tokens: number;
        first_seen_epoch: number | null; last_seen_epoch: number | null } | undefined;

    // --- Summary aggregates ----------------------------------------------
    const sumRow = db.prepare(`
      SELECT
        COUNT(*) as summary_count,
        COALESCE(SUM(discovery_tokens), 0) as discovery_tokens,
        COALESCE(SUM(input_tokens), 0) as input_tokens,
        COALESCE(SUM(output_tokens), 0) as output_tokens,
        MIN(created_at_epoch) as first_seen_epoch,
        MAX(created_at_epoch) as last_seen_epoch
      FROM session_summaries ss
      LEFT JOIN sdk_sessions s ON ss.memory_session_id = s.memory_session_id
      ${sumWhere}
    `).get(...(sumParams as any)) as
      { summary_count: number; discovery_tokens: number; input_tokens: number;
        output_tokens: number; first_seen_epoch: number | null; last_seen_epoch: number | null } | undefined;

    // --- Distinct sessions ----------------------------------------------
    const [sessWhere, sessParams] = this.buildSessionWhere(project, platformSource);
    const sessionCountRow = db.prepare(`
      SELECT COUNT(DISTINCT s.content_session_id) as sessions
      FROM sdk_sessions s
      ${sessWhere}
    `).get(...(sessParams as any)) as
      { sessions: number } | undefined;

    const obs = obsRow || ({ observation_count: 0, batch_count: 0, discovery_tokens: 0, input_tokens: 0, output_tokens: 0, first_seen_epoch: null, last_seen_epoch: null });
    const sum = sumRow || ({ summary_count: 0, discovery_tokens: 0, input_tokens: 0, output_tokens: 0, first_seen_epoch: null, last_seen_epoch: null });
    const observationCount = obs.observation_count || 0;
    const batchCount = obs.batch_count || 0;
    const summaryCount = sum.summary_count || 0;

    // input/output tokens attributed to the LLM: for observation rows the
    // "working" cost is (discovery + input + output); batch rows concentrate
    // input/output on the last entry, but the batch leader carries
    // discovery_tokens = total discovery spent on that batch.
    const inputTokens = (obs.input_tokens || 0) + (sum.input_tokens || 0);
    const outputTokens = (obs.output_tokens || 0) + (sum.output_tokens || 0);
    const discoveryTokens = (obs.discovery_tokens || 0) + (sum.discovery_tokens || 0);

    const llmCalls = batchCount + summaryCount;

    const minFirst = Math.min(
      obs.first_seen_epoch ?? Infinity,
      sum.first_seen_epoch ?? Infinity
    );
    const maxLast = Math.max(
      obs.last_seen_epoch ?? -Infinity,
      sum.last_seen_epoch ?? -Infinity
    );

    return {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens + discoveryTokens,
      llm_calls: llmCalls,
      observation_count: observationCount,
      batch_count: batchCount,
      session_count: sessionCountRow?.sessions || 0,
      summary_count: summaryCount,
      first_seen: isFinite(minFirst) ? new Date(minFirst).toISOString() : null,
      last_seen: isFinite(maxLast) ? new Date(maxLast).toISOString() : null,
      avg_input_tokens_per_call: llmCalls > 0 ? Math.round(inputTokens / llmCalls) : 0,
      avg_output_tokens_per_call: llmCalls > 0 ? Math.round(outputTokens / llmCalls) : 0,
    };
  }

  /**
   * Daily roll-up: one row per calendar day within the window.
   * `llm_calls = batches + summaries` per day. Default window = 90 days.
   */
  getStatisticsByTime(
    days: number = 90,
    project?: string,
    platformSource?: string
  ): StatsTimeSeriesRow[] {
    const db = this.dbManager.getSessionStore().db;
    const daysClause = `${days}`;

    const [obsWhere, obsParams] = this.buildStatsWhere('obs', project, platformSource);
    const [sumWhere, sumParams] = this.buildStatsWhere('sum', project, platformSource);
    const [sessWhere, sessParams] = this.buildSessionWhere(project, platformSource);

    const rows = db.prepare(`
      WITH RECURSIVE date_spine(d) AS (
        SELECT date('now', '-${daysClause} days')
        UNION ALL
        SELECT date(d, '+1 day')
        FROM date_spine
        WHERE d < date('now')
      ),
      obs_daily AS (
        SELECT
          strftime('%Y-%m-%d', datetime(o.created_at_epoch / 1000, 'unixepoch')) as d,
          COUNT(*) as observations,
          SUM(CASE WHEN o.batch_index = 1 THEN 1 ELSE 0 END) as batches,
          COALESCE(SUM(o.input_tokens), 0) as input_tokens,
          COALESCE(SUM(o.output_tokens), 0) as output_tokens,
          COALESCE(SUM(o.discovery_tokens), 0) as discovery_tokens
        FROM observations o
        LEFT JOIN sdk_sessions s ON o.memory_session_id = s.memory_session_id
        ${obsWhere}
        GROUP BY strftime('%Y-%m-%d', datetime(o.created_at_epoch / 1000, 'unixepoch'))
      ),
      sum_daily AS (
        SELECT
          strftime('%Y-%m-%d', datetime(ss.created_at_epoch / 1000, 'unixepoch')) as d,
          COUNT(*) as summaries,
          COALESCE(SUM(ss.input_tokens), 0) as input_tokens,
          COALESCE(SUM(ss.output_tokens), 0) as output_tokens,
          COALESCE(SUM(ss.discovery_tokens), 0) as discovery_tokens
        FROM session_summaries ss
        LEFT JOIN sdk_sessions s ON ss.memory_session_id = s.memory_session_id
        ${sumWhere}
        GROUP BY strftime('%Y-%m-%d', datetime(ss.created_at_epoch / 1000, 'unixepoch'))
      ),
      sessions_daily AS (
        SELECT
          strftime('%Y-%m-%d', datetime(s.started_at_epoch / 1000, 'unixepoch')) as d,
          COUNT(DISTINCT s.content_session_id) as sessions
        FROM sdk_sessions s
        ${sessWhere}
        GROUP BY strftime('%Y-%m-%d', datetime(s.started_at_epoch / 1000, 'unixepoch'))
      )
      SELECT
        ds.d as date,
        COALESCE(sd.sessions, 0) as sessions,
        COALESCE(od.observations, 0) as observations,
        COALESCE(od.batches, 0) as batches,
        COALESCE(sdd.summaries, 0) as summaries,
        COALESCE(od.input_tokens, 0) + COALESCE(sdd.input_tokens, 0) as input_tokens,
        COALESCE(od.output_tokens, 0) + COALESCE(sdd.output_tokens, 0) as output_tokens,
        COALESCE(od.input_tokens, 0) + COALESCE(od.output_tokens, 0)
          + COALESCE(od.discovery_tokens, 0)
          + COALESCE(sdd.input_tokens, 0) + COALESCE(sdd.output_tokens, 0)
          + COALESCE(sdd.discovery_tokens, 0) as total_tokens,
        COALESCE(od.batches, 0) + COALESCE(sdd.summaries, 0) as llm_calls
      FROM date_spine ds
      LEFT JOIN sessions_daily sd ON ds.d = sd.d
      LEFT JOIN obs_daily od ON ds.d = od.d
      LEFT JOIN sum_daily sdd ON ds.d = sdd.d
      ORDER BY ds.d
    `).all(...(obsParams as any), ...(sumParams as any), ...(sessParams as any)) as StatsTimeSeriesRow[];

    return rows;
  }

  /**
   * Per-session breakdown. Each row represents one distinct content_session_id.
   * Scope: sdk_sessions filtered by project/platform; observations/summaries
   * joined via memory_session_id (already scoped by parent session).
   */
  getStatisticsBySession(
    offset: number,
    limit: number,
    project?: string,
    platformSource?: string,
    sortBy: 'tokens' | 'calls' | 'date' = 'tokens'
  ): StatsSessionRow[] {
    const db = this.dbManager.getSessionStore().db;

    const [sessWhere, sessParams] = this.buildSessionWhere(project, platformSource);
    const sortCol = sortBy === 'tokens'
      ? '(COALESCE(od.input_tokens, 0) + COALESCE(od.output_tokens, 0) + COALESCE(od.discovery_tokens, 0) + COALESCE(sd.input_tokens, 0) + COALESCE(sd.output_tokens, 0) + COALESCE(sd.discovery_tokens, 0)) DESC'
      : sortBy === 'calls'
        ? '(COALESCE(od.batches, 0) + COALESCE(sd.summaries, 0)) DESC'
        : 's.started_at_epoch DESC';

    const rows = db.prepare(`
      SELECT
        s.content_session_id as session_id,
        s.project,
        COALESCE(s.platform_source, 'claude') as platform_source,
        strftime('%Y-%m-%d', datetime(s.started_at_epoch / 1000, 'unixepoch')) as date,
        MIN(o.created_at_epoch) as first_seen,
        MAX(o.created_at_epoch) as last_seen,
        COUNT(DISTINCT o.id) as observations,
        COALESCE(od.batches, 0) as batches,
        COALESCE(od.input_tokens, 0) + COALESCE(sd.input_tokens, 0) as input_tokens,
        COALESCE(od.output_tokens, 0) + COALESCE(sd.output_tokens, 0) as output_tokens,
        COALESCE(od.input_tokens, 0) + COALESCE(od.output_tokens, 0)
          + COALESCE(od.discovery_tokens, 0)
          + COALESCE(sd.input_tokens, 0) + COALESCE(sd.output_tokens, 0)
          + COALESCE(sd.discovery_tokens, 0) as total_tokens,
        COALESCE(od.batches, 0) + COALESCE(sd.summaries, 0) as llm_calls,
        COALESCE(sd.summaries, 0) as summaries
      FROM sdk_sessions s
      LEFT JOIN observations o ON s.memory_session_id = o.memory_session_id
      LEFT JOIN (
        SELECT
          memory_session_id,
          SUM(CASE WHEN batch_index = 1 THEN 1 ELSE 0 END) as batches,
          COALESCE(SUM(input_tokens), 0) as input_tokens,
          COALESCE(SUM(output_tokens), 0) as output_tokens,
          COALESCE(SUM(discovery_tokens), 0) as discovery_tokens
        FROM observations
        GROUP BY memory_session_id
      ) od ON s.memory_session_id = od.memory_session_id
      LEFT JOIN (
        SELECT
          memory_session_id,
          COUNT(*) as summaries,
          COALESCE(SUM(input_tokens), 0) as input_tokens,
          COALESCE(SUM(output_tokens), 0) as output_tokens,
          COALESCE(SUM(discovery_tokens), 0) as discovery_tokens
        FROM session_summaries
        GROUP BY memory_session_id
      ) sd ON s.memory_session_id = sd.memory_session_id
      ${sessWhere}
      GROUP BY s.content_session_id, s.project, s.platform_source, s.started_at_epoch
      ORDER BY ${sortCol}
      LIMIT ? OFFSET ?
    `).all(...(sessParams as any), limit + 1, offset) as StatsSessionRow[];

    return rows.slice(0, limit);
  }

  private buildStatsWhere(
    entityAlias: 'obs' | 'sum',
    project?: string,
    platformSource?: string
  ): [string, SQLQueryBindings[]] {
    const parts: string[] = ['1=1'];
    const params: SQLQueryBindings[] = [];

    const table = entityAlias === 'obs' ? 'o' : 'ss';
    if (project) {
      parts.push(`(${table}.project = ? OR ${table}.merged_into_project = ?)`);
      params.push(project, project);
    } else {
      parts.push(`${table}.project != ?`);
      params.push(OBSERVER_SESSIONS_PROJECT);
    }
    if (platformSource) {
      parts.push(`COALESCE(s.platform_source, 'claude') = ?`);
      params.push(platformSource);
    }

    return [`WHERE ${parts.join(' AND ')}`, params];
  }

  /** sdk_sessions has no merged_into_project; project filter is strict. */
  private buildSessionWhere(
    project?: string,
    platformSource?: string
  ): [string, SQLQueryBindings[]] {
    const parts: string[] = ['1=1'];
    const params: SQLQueryBindings[] = [];

    if (project) {
      parts.push(`s.project = ?`);
      params.push(project);
    } else {
      parts.push(`s.project != ?`);
      params.push(OBSERVER_SESSIONS_PROJECT);
    }
    if (platformSource) {
      parts.push(`COALESCE(s.platform_source, 'claude') = ?`);
      params.push(platformSource);
    }

    return [`WHERE ${parts.join(' AND ')}`, params];
  }
}

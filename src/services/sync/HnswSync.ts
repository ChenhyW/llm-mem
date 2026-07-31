import { spawnHnswHelper, getHnswDir } from './hnswlib-spawn.js';
import { logger } from '../../utils/logger.js';

export type ChromaDocType = 'observation' | 'session_summary' | 'user_prompt';

export interface ChromaMetadata {
  sqlite_id: number;
  doc_type: ChromaDocType;
  memory_session_id: string;
  project: string;
  platform_source?: string;
  created_at_epoch: number;
  type?: string;
  title?: string;
  subtitle?: string;
  concepts?: string;
  files_read?: string;
  files_modified?: string;
  field_type?: string;
  prompt_number?: number;
}

export interface ChromaQueryResult {
  ids: number[];
  distances: number[];
  metadatas: ChromaMetadata[];
}

/**
 * HnswSync replaces ChromaSync.  It delegates the heavy vector work to the
 * python helper (hnswlib + Ollama embeddings).  Its public surface is shaped
 * to match the old ChromaSync / ChromaSyncLike contracts so the search
 * orchestrator, routes, and sync-apply code keep working without change.
 */
export class HnswSync {
  private hnswDir: string;

  constructor() {
    this.hnswDir = getHnswDir();
  }

  /* ── public API ─────────────────────────────────────────────── */

  async ensureCollectionExists(): Promise<void> {
    // nothing to do — index is on disk
  }

  async queryChroma(
    query: string,
    limit: number,
    _whereFilter?: Record<string, any>
  ): Promise<ChromaQueryResult> {
    try {
      const result = await spawnHnswHelper(['search', this.hnswDir, query, '--k', String(limit)]);
      if (result.exitCode !== 0) {
        logger.warn('HNSW_SYNC', 'search helper non-zero exit', { stderr: result.stderr });
        return { ids: [], distances: [], metadatas: [] };
      }
      const json = JSON.parse(result.stdout.trim()) as { results: any[] };
      const rows = json.results || [];

      const ids: number[] = [];
      const distances: number[] = [];
      const metadatas: ChromaMetadata[] = [];

      for (const r of rows) {
        const sqliteId = Number(r.sqlite_id);
        const meta = r.meta || {};
        if (Number.isFinite(sqliteId)) {
          ids.push(sqliteId);
          distances.push(Number(1 - Number(r.score ?? 0)));
          metadatas.push({
            sqlite_id: sqliteId,
            doc_type: (meta.doc_type as ChromaDocType) ?? 'observation',
            memory_session_id: '',
            project: meta.project ?? '',
            platform_source: meta.platform_source,
            created_at_epoch: Number(meta.created_at_epoch ?? 0),
          });
        }
      }
      return { ids, distances, metadatas };
    } catch (err) {
      logger.error('HNSW_SYNC', 'search threw', {}, err instanceof Error ? err : new Error(String(err)));
      return { ids: [], distances: [], metadatas: [] };
    }
  }

  async syncObservation(
    observationId: number,
    memorySessionId: string,
    project: string,
    obs: {
      type: string;
      title: string | null;
      subtitle: string | null;
      facts: string[];
      narrative: string | null;
      concepts: string[];
      files_read: string[];
      files_modified: string[];
    },
    promptNumber: number,
    createdAtEpoch: number,
    platformSource?: string
  ): Promise<void> {
    const row = {
      sqlite_id: observationId,
      doc_type: 'observation',
      field_type: 'observation',
      document: this.buildObservationText(obs, memorySessionId),
      project,
      platform_source: platformSource,
      created_at_epoch: createdAtEpoch,
    };
    await this.writeToMetaObs(row);
  }

  async syncSummary(
    summaryId: number,
    memorySessionId: string,
    project: string,
    summary: {
      requested_action: string;
      investigated: string;
      learned: string;
      completed: string;
      next_steps: string;
      notes: string;
    },
    createdAtEpoch: number,
    platformSource?: string
  ): Promise<void> {
    const row = {
      sqlite_id: summaryId,
      doc_type: 'session_summary',
      field_type: 'session_summary',
      document: this.buildSummaryText(summary, memorySessionId),
      project,
      platform_source: platformSource,
      created_at_epoch: createdAtEpoch,
    };
    await this.writeToMetaObs(row);
  }

  async syncUserPrompt(
    promptId: number,
    memorySessionId: string,
    project: string,
    promptText: string,
    createdAtEpoch: number,
    promptNumber?: number,
    platformSource?: string
  ): Promise<void> {
    const row = {
      sqlite_id: promptId,
      doc_type: 'user_prompt',
      field_type: 'user_prompt',
      document: promptText,
      project,
      platform_source: platformSource,
      created_at_epoch: createdAtEpoch,
    };
    await this.writeToMetaObs(row);
  }

  static async backfillAllProjects(_store: unknown): Promise<void> {
    const { DB_PATH } = await import('../../shared/paths.js');
    const sqlite3 = await import('node:sqlite');
    const db = new sqlite3.DatabaseSync(DB_PATH);
    const { runMetadataObservationsMigration } = await import('./migration.js');
    const res = runMetadataObservationsMigration(db);
    logger.info('HNSW_SYNC', 'migration', { created: res.created });
    // rebuild the index after backfill
    await HnswSync.buildIndex();
    logger.info('HNSW_SYNC', 'backfill check complete for all projects');
  }

  static async buildIndex(): Promise<void> {
    try {
      const { DB_PATH } = await import('../../shared/paths.js');
      const result = await spawnHnswHelper(['build', DB_PATH, getHnswDir()]);
      if (result.exitCode !== 0) {
        logger.warn('HNSW_SYNC', 'index build failed', { stderr: result.stderr });
        return;
      }
      const out = JSON.parse(result.stdout.trim()) as { built: boolean; elements: number };
      logger.info('HNSW_SYNC', 'index built', { built: out.built, elements: out.elements });
    } catch (err) {
      logger.warn('HNSW_SYNC', 'index build threw', {}, err instanceof Error ? err : new Error(String(err)));
    }
  }

  /* ── helpers ────────────────────────────────────────────────── */

  private buildObservationText(
    obs: { title: string | null; subtitle: string | null; narrative: string | null; concepts: string[]; files_read: string[]; files_modified: string[]; facts: string[] },
    _session: string
  ): string {
    const parts: string[] = [];
    if (obs.title) parts.push(obs.title);
    if (obs.subtitle) parts.push(obs.subtitle);
    if (obs.narrative) parts.push(obs.narrative);
    if (obs.concepts.length) parts.push('concepts: ' + obs.concepts.join(', '));
    if (obs.facts.length) parts.push('facts: ' + obs.facts.join('. '));
    if (obs.files_read.length) parts.push('read: ' + obs.files_read.join(', '));
    if (obs.files_modified.length) parts.push('modified: ' + obs.files_modified.join(', '));
    return parts.join(' ');
  }

  private buildSummaryText(
    summary: { requested_action: string; investigated: string; learned: string; completed: string; next_steps: string; notes: string },
    _session: string
  ): string {
    const parts: string[] = [];
    if (summary.requested_action) parts.push(summary.requested_action);
    if (summary.investigated) parts.push(summary.investigated);
    if (summary.learned) parts.push(summary.learned);
    if (summary.completed) parts.push(summary.completed);
    if (summary.next_steps) parts.push(summary.next_steps);
    if (summary.notes) parts.push(summary.notes);
    return parts.join(' ');
  }

  private async writeToMetaObs(row: Record<string, unknown>): Promise<void> {
    try {
      const { DB_PATH } = await import('../../shared/paths.js');
      const r = await spawnHnswHelper(['sync', DB_PATH, '--row', JSON.stringify(row)]);
      if (r.exitCode !== 0) {
        logger.warn('HNSW_SYNC', 'sync row failed', { stderr: r.stderr });
      }
    } catch (err) {
      logger.warn('HNSW_SYNC', 'sync row threw', {}, err instanceof Error ? err : new Error(String(err)));
    }
  }
}

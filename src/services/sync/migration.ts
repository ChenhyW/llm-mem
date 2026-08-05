
/**
 * Create the `metadata_observations` table that maps sqlite row ids back to
 * searchable vector index entries. One row is kept per indexable document
 * (observation, session summary, user prompt).
 */
export function runMetadataObservationsMigration(
  db: any,  // bun:sqlite.Database / node:sqlite.DatabaseSync (runtime APIs are compatible)
): { created: boolean } {
  const existing = db
    .prepare(
      "SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='metadata_observations'",
    )
    .get() as { c: number };
  const created = existing.c === 0;

  db.exec(`
    CREATE TABLE IF NOT EXISTS metadata_observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sqlite_id INTEGER NOT NULL,
      doc_type TEXT,
      field_type TEXT,
      document TEXT,
      project TEXT,
      platform_source TEXT,
      created_at_epoch INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_meta_obs_sqlite_id
      ON metadata_observations(sqlite_id);
    CREATE INDEX IF NOT EXISTS idx_meta_obs_doc_type
      ON metadata_observations(doc_type);
  `);

  if (created) {
    // Backfill existing observations, session_summaries, user_prompts.
    backfillObservations(db);
    backfillSummaries(db);
    backfillPrompts(db);
  }

  return { created };
}

function backfillObservations(db: sqlite3.DatabaseSync) {
  db.exec(`
    INSERT OR REPLACE INTO metadata_observations
      (sqlite_id, doc_type, field_type, document, project, platform_source, created_at_epoch)
    SELECT
      o.id,
      'observation',
      COALESCE(o.type, 'unknown'),
      COALESCE(
        o.title ||
        CASE WHEN o.subtitle THEN ' ' || o.subtitle ELSE '' END ||
        CASE WHEN o.text THEN ' ' || o.text ELSE '' END,
        ''
      ),
      o.project,
      NULL,
      o.created_at_epoch
    FROM observations o
    WHERE o.id IS NOT NULL;
  `);
}

function backfillSummaries(db: sqlite3.DatabaseSync) {
  db.exec(`
    INSERT OR REPLACE INTO metadata_observations
      (sqlite_id, doc_type, field_type, document, project, platform_source, created_at_epoch)
    SELECT
      s.id,
      'session_summary',
      'session_summary',
      COALESCE(
        s.requested_action ||
        CASE WHEN s.investigated THEN ' ' || s.investigated ELSE '' END ||
        CASE WHEN s.learned THEN ' ' || s.learned ELSE '' END ||
        CASE WHEN s.completed THEN ' ' || s.completed ELSE '' END ||
        CASE WHEN s.next_steps THEN ' ' || s.next_steps ELSE '' END ||
        CASE WHEN s.notes THEN ' ' || s.notes ELSE '' END,
        ''
      ),
      s.project,
      NULL,
      s.created_at_epoch
    FROM session_summaries s
    WHERE s.id IS NOT NULL;
  `);
}

function backfillPrompts(db: sqlite3.DatabaseSync) {
  db.exec(`
    INSERT OR REPLACE INTO metadata_observations
      (sqlite_id, doc_type, field_type, document, project, platform_source, created_at_epoch)
    SELECT
      p.id,
      'user_prompt',
      'user_prompt',
      p.prompt_text,
      p.project,
      p.platform_source,
      p.created_at_epoch
    FROM user_prompts p
    WHERE p.id IS NOT NULL;
  `);
}

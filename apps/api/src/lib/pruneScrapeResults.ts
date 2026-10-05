import { pool } from '../db.js';

/**
 * How long a scrape_results row is kept once it's no longer the latest
 * for its (url_id, format) - long enough that a recent job's own "Pages"
 * detail view (routes/admin/jobs.ts, filtered by job_id) still has its
 * real data to show, short enough that the weeks of superseded hourly-
 * recheck history that actually filled the production disk don't pile
 * back up the same way.
 */
export const SCRAPE_RESULTS_RETENTION_DAYS = 14;

const BATCH_SIZE = 5000;

/**
 * Deletes scrape_results rows nothing in the app reads any more.
 *
 * Every read of this table (persistItemProfile's source queries, the
 * Items/Sales/PriceChanges previews, the player-name backfill, Kickio
 * listing sync) only ever wants the single latest row per
 * (url_id, format) - confirmed by grepping every "FROM scrape_results"
 * in the codebase. The one real exception is routes/admin/jobs.ts's
 * per-job "Pages" list, which filters on that job's own job_id - so a
 * blind "keep only the global latest" prune would blank out every past
 * job's page list, not just reclaim dead rows.
 *
 * This keeps both: every row from the last SCRAPE_RESULTS_RETENTION_DAYS
 * (so a recent job's own Pages view stays intact), AND the single latest
 * row per (url_id, format) regardless of age (so an item nobody has
 * rechecked in months - a quiet or deactivated site - never loses its
 * only known profile data). Everything else - a superseded row from an
 * hourly recheck weeks ago, exactly the pattern that filled the
 * production Postgres volume to its 5GB cap - is deleted.
 *
 * Deletes in batches rather than one statement: scrape_results is the
 * single largest table in the database by far, and a single DELETE
 * matching millions of rows would hold a long-running transaction and
 * lock against a table every crawl/recheck/admin page is also reading
 * and writing concurrently.
 */
export async function pruneScrapeResults(
  retentionDays: number = SCRAPE_RESULTS_RETENTION_DAYS,
  onProgress?: (deleted: number) => Promise<void> | void,
): Promise<number> {
  // A dedicated client (not the shared pool.query()) for the whole run -
  // the "keep" set below is a session-scoped temp table, so every
  // statement that reads it must run on this same connection. Computed
  // ONCE up front rather than per batch: it's a DISTINCT ON over the
  // whole table, and scrape_results is large enough that re-running it
  // on every one of a prune's many batches (rather than once) would cost
  // far more than the delete itself.
  const client = await pool.connect();
  try {
    await client.query(`DROP TABLE IF EXISTS scrape_results_keep`);
    await client.query(
      `CREATE TEMP TABLE scrape_results_keep AS
       SELECT DISTINCT ON (url_id, format) id FROM scrape_results
       ORDER BY url_id, format, fetched_at DESC`,
    );
    await client.query(`CREATE UNIQUE INDEX ON scrape_results_keep (id)`);

    let totalDeleted = 0;
    for (;;) {
      const { rowCount } = await client.query(
        `DELETE FROM scrape_results sr
         WHERE sr.id IN (
           SELECT sr2.id FROM scrape_results sr2
           LEFT JOIN scrape_results_keep k ON k.id = sr2.id
           WHERE sr2.fetched_at < now() - ($1 || ' days')::interval AND k.id IS NULL
           LIMIT ${BATCH_SIZE}
         )`,
        [retentionDays],
      );
      const deleted = rowCount ?? 0;
      totalDeleted += deleted;
      if (onProgress) await onProgress(totalDeleted);
      if (deleted < BATCH_SIZE) break;
    }
    return totalDeleted;
  } finally {
    await client.query(`DROP TABLE IF EXISTS scrape_results_keep`).catch(() => undefined);
    client.release();
  }
}

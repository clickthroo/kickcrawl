import { pool } from '../db.js';
import { crawlQueue } from '../queue.js';

export type JobType = 'scrape' | 'map' | 'crawl' | 'extract';
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export async function createJob(
  type: JobType,
  siteId: string | null,
  payload: unknown,
  status: JobStatus = 'queued',
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO jobs (type, site_id, payload, status, started_at)
     VALUES ($1, $2, $3, $4, CASE WHEN $4 IN ('running','completed') THEN now() ELSE NULL END)
     RETURNING id`,
    [type, siteId, JSON.stringify(payload), status],
  );
  return rows[0].id;
}

export async function completeJob(
  jobId: string,
  totalPages: number,
  completedPages: number,
): Promise<void> {
  await pool.query(
    `UPDATE jobs SET status = 'completed', total_pages = $2, completed_pages = $3, finished_at = now() WHERE id = $1`,
    [jobId, totalPages, completedPages],
  );
}

export async function failJob(jobId: string, error: string): Promise<void> {
  await pool.query(
    `UPDATE jobs SET status = 'failed', error_count = error_count + 1,
       errors = errors || $2::jsonb, finished_at = now() WHERE id = $1`,
    [jobId, JSON.stringify([{ message: error, at: new Date().toISOString() }])],
  );
}

/**
 * Marks any job still showing 'running' as 'failed', at server boot. A
 * freshly starting process hasn't touched any job's status itself yet, so
 * a row still 'running' at that point can only have been abandoned by a
 * previous process instance that's gone - a crash, or a redeploy that
 * killed it mid-job (this app runs as a single instance, so there's no
 * other live process it could belong to). Without this, an interrupted
 * job sits "Running" in the Jobs list forever: nothing else ever updates
 * it again, since the in-memory execution that was tracking its progress
 * no longer exists.
 */
export async function recoverOrphanedJobs(): Promise<number> {
  const { rowCount } = await pool.query(
    `UPDATE jobs SET status = 'failed', error_count = error_count + 1,
       errors = errors || '[{"message":"Job was interrupted by a server restart and could not resume"}]'::jsonb,
       finished_at = now()
     WHERE status = 'running'`,
  );
  return rowCount ?? 0;
}

/**
 * Keeps only the newest queued crawl per site, failing any older
 * duplicates - clicking "Run crawl"/"Crawl all sites" repeatedly before
 * an earlier crawl for the same site finished used to queue a fresh
 * duplicate every time. The per-domain rate limiter (services/
 * rateLimiter.ts) is shared across every job hitting that domain, not
 * per-job, so duplicates don't run any faster - they just take turns
 * sharing the same one-request-per-interval budget, making every one of
 * them look stuck. Run once at boot, after recoverOrphanedJobs() has
 * already cleared anything genuinely orphaned (leaving only real
 * 'queued' rows here); going forward, the crawl-start endpoints
 * (routes/admin/sites.ts) refuse to queue a new crawl while one is
 * already active for that site, so this is only needed to clean up
 * duplicates that already exist.
 *
 * Failing the row in Postgres alone isn't enough - the duplicate's
 * underlying BullMQ job is still sitting in Redis's queue and would
 * still get picked up and processed by the worker regardless of what
 * this row says, undoing the cleanup. Every crawlQueue.add() call passes
 * our own Postgres job id as BullMQ's own job id too, so it can be
 * looked up and removed from the queue directly.
 */
export async function deduplicateQueuedCrawls(): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM (
       SELECT id, row_number() OVER (
         PARTITION BY site_id ORDER BY created_at DESC, id DESC
       ) AS rn
       FROM jobs
       WHERE type = 'crawl' AND status = 'queued'
     ) ranked WHERE rn > 1`,
  );

  for (const { id } of rows) {
    const bullJob = await crawlQueue.getJob(id);
    await bullJob?.remove();
    await failJob(id, 'Superseded by a newer crawl queued for this site');
  }
  return rows.length;
}

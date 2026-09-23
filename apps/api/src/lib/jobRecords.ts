import { pool } from '../db.js';
import { crawlQueue, type CrawlJobData } from '../queue.js';

export type JobType = 'scrape' | 'map' | 'crawl' | 'extract' | 'recheck';
export type JobStatus = 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

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
 * Re-queues any 'crawl' job still showing 'running'/'paused' at server
 * boot so it resumes instead of being lost, then marks every OTHER job
 * still in either state as 'failed' the same way this function always
 * has. A freshly starting process hasn't touched any job's status itself
 * yet, so a row still 'running'/'paused' at this point can only have been
 * abandoned by a previous process instance that's gone - a crash, or a
 * redeploy that killed it mid-job (this app runs as a single instance, so
 * there's no other live process it could belong to). A 'paused' job is
 * included for the same reason as 'running': its in-process poll loop
 * (crawlWorker.ts, waiting to see the row flip back to 'running' or
 * 'cancelled') dies with the process exactly the same way an active fetch
 * would.
 *
 * A crawl job is no longer unrecoverable the way it used to be: its own
 * traversal queue now lives in crawl_frontier (migration 012), not just an
 * in-memory array/Set inside processCrawl - so re-enqueueing the same
 * jobId (reconstructing the original CrawlJobData from the row's own
 * `payload`, the same shape routes/admin/sites.ts originally built it
 * from) lets processCrawl's own resume logic pick the frontier back up
 * from wherever it was left, rather than starting over or giving up.
 * Every other job type (map/scrape/extract/recheck) has no comparable
 * persisted mid-run state, so those still fail exactly as before -
 * without this, an interrupted job would otherwise sit "Running"/"Paused"
 * in the Jobs list forever, since nothing else ever updates it again once
 * the in-memory execution that was tracking its progress is gone.
 */
export async function recoverOrphanedJobs(): Promise<number> {
  const { rows: resumableCrawls } = await pool.query<{
    id: string;
    site_id: string;
    payload: Omit<CrawlJobData, 'jobId' | 'siteId'>;
  }>(`SELECT id, site_id, payload FROM jobs WHERE type = 'crawl' AND status IN ('running', 'paused')`);

  for (const { id, site_id, payload } of resumableCrawls) {
    await pool.query(`UPDATE jobs SET status = 'queued' WHERE id = $1`, [id]);
    await crawlQueue.add('crawl', { jobId: id, siteId: site_id, ...payload }, { jobId: id });
    console.log(`[recovery] re-queued crawl job ${id} to resume from where it left off`);
  }

  const { rowCount } = await pool.query(
    `UPDATE jobs SET status = 'failed', error_count = error_count + 1,
       errors = errors || '[{"message":"Job was interrupted by a server restart and could not resume"}]'::jsonb,
       finished_at = now()
     WHERE status IN ('running', 'paused') AND type != 'crawl'`,
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

/**
 * Fails any 'queued' crawl job whose underlying BullMQ job no longer
 * exists in Redis - it can never actually run (the worker will never pick
 * it up), yet the Postgres row still counts as "active" to
 * hasActiveCrawl() (routes/admin/sites.ts), permanently blocking new
 * crawls for that site with a false "already queued or running" error.
 * This happens if a job's BullMQ entry gets separately removed/expired
 * out from under a still-'queued' row (or was queued before
 * crawlQueue.add() started passing { jobId }, giving it a different id
 * than this row expects). Run once at boot, after
 * deduplicateQueuedCrawls() has already thinned out same-site duplicates -
 * otherwise this would redo the same dead-job check on rows about to be
 * discarded anyway.
 */
export async function recoverStaleQueuedJobs(): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM jobs WHERE type = 'crawl' AND status = 'queued'`,
  );

  let recovered = 0;
  for (const { id } of rows) {
    const bullJob = await crawlQueue.getJob(id);
    if (!bullJob) {
      await failJob(id, 'Queued crawl was lost from the job queue and could never run');
      recovered += 1;
    }
  }
  return recovered;
}

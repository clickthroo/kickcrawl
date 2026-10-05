import { Worker } from 'bullmq';
import { redisConnection, scrapeResultsPruneQueue } from '../queue.js';
import { pool } from '../db.js';
import { createJob, failJob } from '../lib/jobRecords.js';
import { pruneScrapeResults } from '../lib/pruneScrapeResults.js';

export const SCRAPE_RESULTS_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Runs the scrape_results retention prune (lib/pruneScrapeResults.ts) as a
 * real BullMQ job, tracked on the Jobs page the same way every other
 * admin/scheduled sweep is - not inline in an HTTP request, since a full
 * prune over a multi-million-row table can run far longer than any
 * request should block for (the same reason the player-name backfill
 * moved off the request path after it caused a "Network error" on the
 * admin UI).
 */
export async function processScrapeResultsPrune(): Promise<void> {
  const jobId = await createJob('scrape_results_prune', null, {}, 'running');

  try {
    const deleted = await pruneScrapeResults(undefined, async (deletedSoFar) => {
      await pool.query(`UPDATE jobs SET completed_pages = $2 WHERE id = $1`, [jobId, deletedSoFar]);
    });

    await pool.query(`UPDATE jobs SET status = 'completed', finished_at = now() WHERE id = $1`, [jobId]);
    console.log(`[scrapeResultsPruneWorker] job ${jobId} deleted ${deleted} row(s)`);
  } catch (err) {
    await failJob(jobId, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

export function startScrapeResultsPruneWorker(): Worker {
  const worker = new Worker(
    'scrape_results_prune',
    async () => {
      await processScrapeResultsPrune();
    },
    {
      connection: redisConnection,
      concurrency: 1,
      // Same rationale as every other sweep in this file's family: a
      // single-instance app has no live process to resume a stalled job,
      // so don't let BullMQ retry one on its own.
      maxStalledCount: 0,
      // Generous relative to how long a full prune can run on a large,
      // long-neglected table (this is exactly the job that cleans that
      // backlog up) - BullMQ's 30s default stall watchdog would otherwise
      // kill a real run partway through.
      lockDuration: 30 * 60_000,
    },
  );
  worker.on('failed', (job, err) => {
    console.error(`[scrapeResultsPruneWorker] job ${job?.id} failed:`, err);
  });
  return worker;
}

/**
 * Registers the daily repeatable prune - same dedup-by-removing-and-
 * re-adding pattern as recheckWorker.ts's scheduleRecheck, so changing
 * SCRAPE_RESULTS_PRUNE_INTERVAL_MS and redeploying replaces the schedule
 * instead of stacking a second one alongside it.
 */
export async function scheduleScrapeResultsPrune(): Promise<void> {
  const existing = await scrapeResultsPruneQueue.getRepeatableJobs();
  for (const job of existing) {
    if (job.name === 'scrape_results_prune') {
      await scrapeResultsPruneQueue.removeRepeatableByKey(job.key);
    }
  }
  await scrapeResultsPruneQueue.add('scrape_results_prune', {}, { repeat: { every: SCRAPE_RESULTS_PRUNE_INTERVAL_MS } });
}

/**
 * A one-off, admin-triggered run - the target of
 * POST /api/admin/jobs/prune-scrape-results (routes/admin/jobs.ts), for
 * immediate relief rather than waiting for the next scheduled tick (e.g.
 * right after a disk-full incident).
 */
export async function enqueueScrapeResultsPruneNow(): Promise<void> {
  await scrapeResultsPruneQueue.add('scrape_results_prune', {});
}

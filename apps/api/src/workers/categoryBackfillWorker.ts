import { Worker } from 'bullmq';
import { redisConnection, categoryBackfillQueue } from '../queue.js';
import { pool } from '../db.js';
import { createJob, failJob } from '../lib/jobRecords.js';
import { backfillItemCategories } from '../lib/backfillCategories.js';

/**
 * Runs the category backfill (lib/backfillCategories.ts) as a real BullMQ
 * job rather than inline in the triggering HTTP request - same "admin
 * button enqueues, a Worker does the actual work, progress shows on the
 * Jobs page" shape as workers/playerNameBackfillWorker.ts, for the same
 * reason: a full-catalog sweep can run well past the admin UI's own fetch
 * timeout.
 */
export async function processCategoryBackfill(): Promise<void> {
  const jobId = await createJob('category_backfill', null, {}, 'running');

  try {
    const updated = await backfillItemCategories(async (done, total) => {
      await pool.query(`UPDATE jobs SET total_pages = $2, completed_pages = $3 WHERE id = $1`, [
        jobId,
        total,
        done,
      ]);
    });

    await pool.query(`UPDATE jobs SET status = 'completed', finished_at = now() WHERE id = $1`, [jobId]);
    console.log(`[categoryBackfillWorker] job ${jobId} updated ${updated} row(s)`);
  } catch (err) {
    await failJob(jobId, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

export function startCategoryBackfillWorker(): Worker {
  const worker = new Worker(
    'category_backfill',
    async () => {
      await processCategoryBackfill();
    },
    {
      connection: redisConnection,
      concurrency: 1,
      // Same rationale as the other admin-triggered sweeps: a single-
      // instance app has no live process to resume a stalled job, so
      // don't let BullMQ retry one on its own.
      maxStalledCount: 0,
      // Generous relative to a full catalog sweep (each matching row is a
      // handful of sequential DB round trips) - BullMQ's 30s default stall
      // watchdog would otherwise kill a real run processing more than a
      // couple hundred rows.
      lockDuration: 30 * 60_000,
    },
  );
  worker.on('failed', (job, err) => {
    console.error(`[categoryBackfillWorker] job ${job?.id} failed:`, err);
  });
  return worker;
}

/**
 * Enqueues the one-off sweep - the real target of
 * POST /api/admin/urls/backfill-categories (routes/admin/urls.ts). Never
 * scheduled/repeatable: migration 030's new column is a fixed, one-time
 * backlog, not something that recurs on its own.
 */
export async function enqueueCategoryBackfill(): Promise<void> {
  await categoryBackfillQueue.add('category_backfill', {});
}

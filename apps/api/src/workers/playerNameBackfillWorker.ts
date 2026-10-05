import { Worker } from 'bullmq';
import { redisConnection, playerNameBackfillQueue } from '../queue.js';
import { pool } from '../db.js';
import { createJob, failJob } from '../lib/jobRecords.js';
import { backfillBareInitialPlayerNames } from '../lib/backfillPlayerNames.js';

/**
 * Runs the bare-initial player-name backfill (lib/backfillPlayerNames.ts)
 * as a real BullMQ job rather than inline in the triggering HTTP request -
 * confirmed in production that running it synchronously inside
 * POST /api/admin/urls/backfill-player-names left the request hanging past
 * both the admin UI's own fetch timeout and Railway's proxy timeout on a
 * catalog with thousands of matching rows, surfacing as a bare "Network
 * error" with no useful progress. Same "admin button enqueues, a Worker
 * does the actual work, progress shows on the Jobs page" shape as
 * kickioSyncWorker.ts's own recovery-sweep path.
 */
export async function processPlayerNameBackfill(): Promise<void> {
  const jobId = await createJob('player_name_backfill', null, {}, 'running');

  try {
    const updated = await backfillBareInitialPlayerNames(async (done, total) => {
      await pool.query(`UPDATE jobs SET total_pages = $2, completed_pages = $3 WHERE id = $1`, [
        jobId,
        total,
        done,
      ]);
    });

    await pool.query(`UPDATE jobs SET status = 'completed', finished_at = now() WHERE id = $1`, [jobId]);
    console.log(`[playerNameBackfillWorker] job ${jobId} updated ${updated} row(s)`);
  } catch (err) {
    await failJob(jobId, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

export function startPlayerNameBackfillWorker(): Worker {
  const worker = new Worker(
    'player_name_backfill',
    async () => {
      await processPlayerNameBackfill();
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
    console.error(`[playerNameBackfillWorker] job ${job?.id} failed:`, err);
  });
  return worker;
}

/**
 * Enqueues the one-off sweep - the real target of
 * POST /api/admin/urls/backfill-player-names (routes/admin/urls.ts). Never
 * scheduled/repeatable: this bug's existing rows are a fixed, one-time
 * backlog, not something that recurs on its own the way a crawl or a
 * Kickio sync does.
 */
export async function enqueuePlayerNameBackfill(): Promise<void> {
  await playerNameBackfillQueue.add('player_name_backfill', {});
}

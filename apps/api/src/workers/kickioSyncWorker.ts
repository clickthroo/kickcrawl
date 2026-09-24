import { Worker } from 'bullmq';
import { redisConnection, kickioSyncQueue } from '../queue.js';
import { pool } from '../db.js';
import { createJob, failJob } from '../lib/jobRecords.js';
import { isKickioSyncConfigured, syncSaleToKickio, type SaleForSync } from '../lib/kickioSync.js';

export const KICKIO_SYNC_INTERVAL_MS = 60 * 60 * 1000;

// A row that keeps failing (Kickio down, or a permanent hold like "no
// team match") stops being retried after this many attempts rather than
// being hammered every hour forever - same shape as crawl_frontier's own
// MAX_FRONTIER_ATTEMPTS. Left in place (kickio_synced_at stays null) for
// manual follow-up rather than silently dropped.
const MAX_SYNC_ATTEMPTS = 5;

interface Progress {
  checked: number;
  synced: number;
  held: number;
  errors: string[];
}

async function recordOutcome(sale: SaleForSync, progress: Progress): Promise<void> {
  try {
    const outcome = await syncSaleToKickio(sale);
    if (outcome.success) {
      await pool.query(
        `UPDATE sales SET kickio_synced_at = now(), kickio_product_id = $2, kickio_sale_id = $3,
           kickio_sync_action = $4, kickio_sync_error = NULL WHERE id = $1`,
        [sale.id, outcome.productId ?? null, outcome.saleId ?? null, outcome.action ?? null],
      );
      progress.synced += 1;
    } else {
      await pool.query(
        `UPDATE sales SET kickio_sync_attempts = kickio_sync_attempts + 1, kickio_sync_error = $2 WHERE id = $1`,
        [sale.id, outcome.error ?? 'unknown error'],
      );
      progress.held += 1;
      progress.errors.push(`${sale.id}: ${outcome.error ?? 'unknown error'}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await pool.query(
      `UPDATE sales SET kickio_sync_attempts = kickio_sync_attempts + 1, kickio_sync_error = $2 WHERE id = $1`,
      [sale.id, message],
    );
    progress.errors.push(`${sale.id}: ${message}`);
  }
}

async function processKickioSync(): Promise<void> {
  const jobId = await createJob('kickio_sync', null, {}, 'running');
  const progress: Progress = { checked: 0, synced: 0, held: 0, errors: [] };

  try {
    // Not configured in this deployment is a no-op, not a failure - same
    // "optional convenience, not a dependency" pattern as kickioTeams.ts.
    // Checked once up front rather than per-row, so an unconfigured
    // deployment doesn't even query the sales table every hour for nothing.
    if (!isKickioSyncConfigured()) {
      await pool.query(`UPDATE jobs SET status = 'completed', finished_at = now() WHERE id = $1`, [jobId]);
      return;
    }

    const { rows } = await pool.query<SaleForSync & { kickio_sync_attempts: number }>(
      `SELECT id, url_id, price, currency, detected_at, profile, kickio_sync_attempts
       FROM sales
       WHERE kickio_synced_at IS NULL AND kickio_sync_attempts < $1
       ORDER BY detected_at ASC`,
      [MAX_SYNC_ATTEMPTS],
    );

    await pool.query(`UPDATE jobs SET total_pages = $2 WHERE id = $1`, [jobId, rows.length]);

    for (const sale of rows) {
      await recordOutcome(sale, progress);
      progress.checked += 1;
      await pool.query(`UPDATE jobs SET completed_pages = $2 WHERE id = $1`, [jobId, progress.checked]);
    }

    await pool.query(
      `UPDATE jobs SET status = 'completed', completed_pages = $2,
         error_count = $3, errors = $4::jsonb, finished_at = now() WHERE id = $1`,
      [jobId, progress.checked, progress.errors.length, JSON.stringify(progress.errors.map((e) => ({ message: e })))],
    );
    console.log(
      `[kickioSyncWorker] job ${jobId} checked ${progress.checked} sale(s), synced ${progress.synced}, held ${progress.held}`,
    );
  } catch (err) {
    await failJob(jobId, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

export function startKickioSyncWorker(): Worker {
  const worker = new Worker(
    'kickio_sync',
    async () => {
      await processKickioSync();
    },
    {
      connection: redisConnection,
      concurrency: 1,
      // Same rationale as crawlWorker.ts/recheckWorker.ts: a single-instance
      // app has no live process to resume a stalled job, so don't let
      // BullMQ retry one on its own - fail it and let the next scheduled
      // tick start clean instead.
      maxStalledCount: 0,
      // Generous relative to how long a full sweep can realistically take
      // (each row is two sequential Kickio RPC calls) - sales volume is
      // small, but BullMQ's 30s default stall watchdog would otherwise be
      // tight against a run processing more than a handful of rows.
      lockDuration: 5 * 60_000,
    },
  );
  worker.on('failed', (job, err) => {
    console.error(`[kickioSyncWorker] job ${job?.id} failed:`, err);
  });
  return worker;
}

/**
 * Registers the repeatable job that drives the sync cycle - same
 * dedup-by-removing-and-re-adding pattern as recheckWorker.ts's
 * scheduleRecheck, so changing KICKIO_SYNC_INTERVAL_MS and redeploying
 * replaces the schedule instead of stacking a second one alongside it.
 */
export async function scheduleKickioSync(): Promise<void> {
  const existing = await kickioSyncQueue.getRepeatableJobs();
  for (const job of existing) {
    if (job.name === 'kickio_sync') {
      await kickioSyncQueue.removeRepeatableByKey(job.key);
    }
  }
  await kickioSyncQueue.add('kickio_sync', {}, { repeat: { every: KICKIO_SYNC_INTERVAL_MS } });
}

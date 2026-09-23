import { config } from './config.js';
import { pool } from './db.js';
import { runMigrations } from './lib/migrate.js';
import { deduplicateQueuedCrawls, recoverOrphanedJobs, recoverStaleQueuedJobs } from './lib/jobRecords.js';
import { backfillItemProfiles } from './lib/backfillItemProfiles.js';
import { buildApp } from './app.js';
import { startCrawlWorker } from './workers/crawlWorker.js';
import { scheduleRecheck, startRecheckWorker } from './workers/recheckWorker.js';
import { crawlQueue } from './queue.js';

async function bootstrapAdminUser(): Promise<void> {
  if (!config.adminEmail || !config.adminPasswordHash) return;
  const { rows } = await pool.query('SELECT id FROM admin_users LIMIT 1');
  if (rows.length > 0) return;

  await pool.query(
    'INSERT INTO admin_users (email, password_hash) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING',
    [config.adminEmail, config.adminPasswordHash],
  );
  console.log(`[bootstrap] admin user ready: ${config.adminEmail}`);
}

async function main(): Promise<void> {
  await runMigrations(pool);
  await bootstrapAdminUser();

  const recovered = await recoverOrphanedJobs();
  if (recovered > 0) {
    console.log(`[recovery] marked ${recovered} orphaned job(s) as failed`);
  }

  const deduplicated = await deduplicateQueuedCrawls();
  if (deduplicated > 0) {
    console.log(`[recovery] marked ${deduplicated} duplicate queued crawl(s) as failed`);
  }

  const stale = await recoverStaleQueuedJobs();
  if (stale > 0) {
    console.log(`[recovery] marked ${stale} stale queued crawl(s) as failed`);
  }

  const worker = startCrawlWorker();
  const recheckWorker = startRecheckWorker();
  await scheduleRecheck();

  const app = await buildApp();

  await app.listen({ host: '0.0.0.0', port: config.port });
  console.log(`[kickcrawl] listening on :${config.port}`);

  // Fire-and-forget, not awaited - migration 010 added the profile columns
  // (team, season, colour, ...) the admin Items list now filters in SQL,
  // but only rows fetched from here on get them written automatically
  // (crawl/recheck workers, above); this fills in whatever already
  // existed before that started. Runs after the server is already
  // listening so it never delays startup/health checks, and is a cheap
  // no-op on every later boot once nothing is left to backfill.
  backfillItemProfiles(pool)
    .then((total) => {
      if (total > 0) console.log(`[backfillItemProfiles] updated ${total} row(s)`);
    })
    .catch((err) => console.error('[backfillItemProfiles] failed:', err));

  // TEMP diagnostic - remove once reviewed. sales/price_changes audit
  // already answered (real rows confirmed for both). Checking the actual
  // crawl job's real state directly - both Postgres and BullMQ's own view
  // of it - to find out why it's shown no crawlWorker activity for
  // several minutes despite the new stall-reaction fix.
  pool
    .query(`SELECT id, status, completed_pages, total_pages, started_at, finished_at FROM jobs WHERE type = 'crawl' ORDER BY created_at DESC LIMIT 3`)
    .then(async (res) => {
      console.log('[crawl-job-audit] postgres rows', JSON.stringify(res.rows));
      for (const row of res.rows) {
        const bullJob = await crawlQueue.getJob(row.id);
        if (!bullJob) {
          console.log('[crawl-job-audit] bullmq', row.id, 'no job found in redis');
          continue;
        }
        const state = await bullJob.getState();
        console.log(
          '[crawl-job-audit] bullmq',
          row.id,
          JSON.stringify({ state, attemptsMade: bullJob.attemptsMade, timestamp: bullJob.timestamp, processedOn: bullJob.processedOn, finishedOn: bullJob.finishedOn }),
        );
      }
    })
    .catch((err) => console.error('[crawl-job-audit] failed:', err));

  const shutdown = async (): Promise<void> => {
    await app.close();
    await worker.close();
    await recheckWorker.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

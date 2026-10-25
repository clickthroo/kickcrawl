import { config } from './config.js';
import { pool } from './db.js';
import { runMigrations } from './lib/migrate.js';
import { deduplicateQueuedCrawls, recoverOrphanedJobs, recoverStaleQueuedJobs } from './lib/jobRecords.js';
import { backfillItemProfiles } from './lib/backfillItemProfiles.js';
import { buildApp } from './app.js';
import { startCrawlWorker } from './workers/crawlWorker.js';
import { scheduleRecheck, startRecheckWorker } from './workers/recheckWorker.js';
import { scheduleKickioSync, startKickioSyncWorker } from './workers/kickioSyncWorker.js';
import { scheduleKickioListingSync, startKickioListingSyncWorker } from './workers/kickioListingSyncWorker.js';
import { scheduleCrawlAll, startCrawlAllWorker } from './workers/crawlAllWorker.js';
import { startPlayerNameBackfillWorker } from './workers/playerNameBackfillWorker.js';
import { scheduleScrapeResultsPrune, startScrapeResultsPruneWorker } from './workers/scrapeResultsPruneWorker.js';
import { startCategoryBackfillWorker } from './workers/categoryBackfillWorker.js';

// Last-resort safety net, installed before anything else runs. Confirmed
// in production as the second of two distinct crash classes behind a
// real outage (the first, an idle Postgres client's unhandled 'error'
// event, is fixed at its real source in db.ts): a Playwright/Chromium
// internal CDP event handler (FrameSession.dispose, reached from
// CRBrowser's own _onDetachedFromTarget when a browser/context is torn
// down mid-operation) threw from deep inside playwright-core's own event
// dispatch - entirely outside any promise chain this app's own code
// awaits, so no try/catch anywhere in fetcher.ts/browser.ts could ever
// have caught it, and Node treated it as an uncaught exception and
// killed the whole process: every in-flight request, every worker, not
// just the one crawl. This app already treats a Playwright/Chromium
// crash as a routine, recoverable event everywhere else (see
// BROWSER_FATAL_PATTERN's whole recycling/backoff design in
// services/browser.ts and services/fetcher.ts) - this is the same
// philosophy applied to the one class of crash that happens where no
// in-process catch is structurally possible. Deliberately scoped to
// logging and continuing, not exiting: Node's own docs caution that
// resuming after an uncaughtException is generally unsafe because the
// process's state may be corrupted, but the one confirmed real-world
// case behind this was a single Playwright page's internal teardown with
// no relation whatsoever to Fastify's request handling, the DB pool, or
// any other worker's state - crashing the entire app over it is a far
// worse outcome than logging it and carrying on.
process.on('uncaughtException', (err) => {
  console.error('[fatal-safety-net] uncaughtException (process kept alive):', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[fatal-safety-net] unhandledRejection (process kept alive):', reason);
});

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
  const kickioSyncWorker = startKickioSyncWorker();
  await scheduleKickioSync();
  const kickioListingSyncWorker = startKickioListingSyncWorker();
  await scheduleKickioListingSync();
  const crawlAllWorker = startCrawlAllWorker();
  await scheduleCrawlAll();
  const playerNameBackfillWorker = startPlayerNameBackfillWorker();
  const scrapeResultsPruneWorker = startScrapeResultsPruneWorker();
  await scheduleScrapeResultsPrune();
  const categoryBackfillWorker = startCategoryBackfillWorker();

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

  const shutdown = async (): Promise<void> => {
    await app.close();
    await worker.close();
    await recheckWorker.close();
    await kickioSyncWorker.close();
    await kickioListingSyncWorker.close();
    await crawlAllWorker.close();
    await playerNameBackfillWorker.close();
    await scrapeResultsPruneWorker.close();
    await categoryBackfillWorker.close();
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

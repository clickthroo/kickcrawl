import { config } from './config.js';
import { pool } from './db.js';
import { runMigrations } from './lib/migrate.js';
import { deduplicateQueuedCrawls, recoverOrphanedJobs, recoverStaleQueuedJobs } from './lib/jobRecords.js';
import { backfillItemProfiles } from './lib/backfillItemProfiles.js';
import { buildApp } from './app.js';
import { startCrawlWorker } from './workers/crawlWorker.js';
import { scheduleRecheck, startRecheckWorker } from './workers/recheckWorker.js';

// TEMP DIAGNOSTIC - see session notes. Auditing why there are 6000+ items
// but ~0 recorded sales sitewide - real counts, not a guess: how many
// items are even eligible for recheck's sale-detection query (status=
// 'fetched' AND stock_status IS DISTINCT FROM 'Out of Stock'), how many
// have ever actually been processed by a recheck job at all vs only ever
// touched by crawl/rescrape (neither of which run isNewSale), and how
// many urls have been fetched by more than one crawl job (each overwrite
// bypassing sale detection independently of recheck).
async function runAuditQuery(label: string, sql: string): Promise<void> {
  try {
    const { rows } = await pool.query(sql);
    console.log(`[sales-gap] ${label}`, JSON.stringify(rows));
  } catch (err) {
    console.error(`[sales-gap] ${label} failed:`, err instanceof Error ? err.message : String(err));
  }
}

async function auditSalesGap(): Promise<void> {
  await runAuditQuery('total urls', `SELECT count(*)::text AS n FROM urls`);

  await runAuditQuery(
    'status x stock_status breakdown',
    `SELECT status, stock_status, count(*)::text AS n FROM urls GROUP BY status, stock_status ORDER BY count(*) DESC`,
  );

  await runAuditQuery(
    'recheck-eligible right now (status=fetched, not already Out of Stock)',
    `SELECT count(*)::text AS n FROM urls WHERE status = 'fetched' AND stock_status IS DISTINCT FROM 'Out of Stock'`,
  );

  await runAuditQuery(
    'last 10 recheck jobs',
    `SELECT id, status, total_pages, completed_pages, created_at, finished_at FROM jobs WHERE type = 'recheck' ORDER BY created_at DESC LIMIT 10`,
  );

  await runAuditQuery(
    'distinct urls ever touched by a recheck job (all time)',
    `SELECT count(DISTINCT sr.url_id)::text AS n FROM scrape_results sr JOIN jobs j ON j.id = sr.job_id WHERE j.type = 'recheck'`,
  );

  await runAuditQuery(
    'distinct urls fetched by MORE THAN ONE crawl job (each overwrite bypasses sale detection)',
    `SELECT count(*)::text AS n FROM (
       SELECT sr.url_id FROM scrape_results sr JOIN jobs j ON j.id = sr.job_id
       WHERE j.type = 'crawl' GROUP BY sr.url_id HAVING count(DISTINCT sr.job_id) > 1
     ) x`,
  );

  await runAuditQuery('total sales rows (all time, all sites)', `SELECT count(*)::text AS n FROM sales`);
  await runAuditQuery('total price_changes rows (all time, all sites)', `SELECT count(*)::text AS n FROM price_changes`);
}

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

  auditSalesGap().catch((err) => console.error('[sales-gap] failed:', err));

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

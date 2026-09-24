import { config } from './config.js';
import { pool } from './db.js';
import { runMigrations } from './lib/migrate.js';
import { deduplicateQueuedCrawls, recoverOrphanedJobs, recoverStaleQueuedJobs } from './lib/jobRecords.js';
import { backfillItemProfiles } from './lib/backfillItemProfiles.js';
import { buildApp } from './app.js';
import { startCrawlWorker } from './workers/crawlWorker.js';
import { scheduleRecheck, startRecheckWorker } from './workers/recheckWorker.js';

// TEMP DIAGNOSTIC - see session notes. Confirming why the first real sale
// this fix caught (AC Milan 2024-25 home shirt) shows no price - checking
// the actual sales.price column, the profile snapshot's own listing.price,
// and the item's now-current urls.price (post-overwrite) directly, rather
// than guessing that the source page simply stops showing a price once
// marked sold out.
async function auditNullPriceSale(): Promise<void> {
  try {
    const { rows } = await pool.query(
      `SELECT s.id, s.url_id, s.title, s.price, s.currency, s.detected_at,
              s.profile->'listing'->>'price' AS profile_price,
              s.profile->'listing'->>'stock_status' AS profile_stock_status,
              u.price AS current_url_price, u.currency AS current_url_currency, u.stock_status AS current_url_stock_status
       FROM sales s JOIN urls u ON u.id = s.url_id
       WHERE s.title ILIKE '%AC Milan%' ORDER BY s.detected_at DESC LIMIT 5`,
    );
    console.log('[null-price-audit] sales rows', JSON.stringify(rows));
  } catch (err) {
    console.error('[null-price-audit] failed:', err instanceof Error ? err.message : String(err));
  }
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

  auditNullPriceSale().catch((err) => console.error('[null-price-audit] failed:', err));

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

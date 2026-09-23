import { config } from './config.js';
import { pool } from './db.js';
import { runMigrations } from './lib/migrate.js';
import { deduplicateQueuedCrawls, recoverOrphanedJobs, recoverStaleQueuedJobs } from './lib/jobRecords.js';
import { backfillItemProfiles } from './lib/backfillItemProfiles.js';
import { buildApp } from './app.js';
import { startCrawlWorker } from './workers/crawlWorker.js';
import { scheduleRecheck, startRecheckWorker } from './workers/recheckWorker.js';
import { fetchPage } from './services/fetcher.js';

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

  // TEMP diagnostic - remove once reviewed. Same check recheckWorker.ts's
  // own variant-diag already does (Shopify's standard <product>.json
  // endpoint), but on a single known URL directly at boot instead of
  // waiting for the next hourly recheck cycle to reach it.
  (async () => {
    const jsonUrl =
      'https://www.vintagefootballshirts.com/collections/german-clubs/products/2009-10-fc-koln-reebok-away-shirt-l-s-bnib-xs.json';
    try {
      const res = await fetchPage(jsonUrl, { useBrowser: false, respectRobots: false });
      let firstVariantRaw: unknown = null;
      let variantCount: number | null = null;
      if (res.html) {
        try {
          const parsed = JSON.parse(res.html);
          const variants = Array.isArray(parsed?.product?.variants) ? parsed.product.variants : null;
          variantCount = variants?.length ?? null;
          firstVariantRaw = variants?.[0] ?? null;
        } catch {
          firstVariantRaw = 'unparseable';
        }
      }
      console.log('[boot-variant-diag]', JSON.stringify({ statusCode: res.statusCode, variantCount, firstVariantRaw }));
    } catch (err) {
      console.error('[boot-variant-diag] failed:', err);
    }
  })();

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

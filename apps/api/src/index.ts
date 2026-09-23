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

  // TEMP diagnostic - remove once reviewed. discovery-audit's first pass
  // already found: 7200 product URLs discovered but 5384 (75%) sit
  // status='failed' and, per crawl_frontier's own design, are never
  // retried within the same crawl job once marked - a far higher rate
  // than the known intermittent browser-crash storm alone would explain.
  // Reading the ACTUAL error text for a sample, and counting by pattern,
  // before guessing at a cause. Also getting a real total product count
  // from the site's own sitemap (extrapolated from real sub-sitemap
  // sizes, not a guessed URL) to know the true target.
  pool
    .query(
      `SELECT u.last_error, count(*) FROM urls u
       JOIN sites s ON s.id = u.site_id
       WHERE s.base_url ILIKE '%vintagefootballshirts%' AND u.status = 'failed' AND u.path LIKE '%/products/%'
       GROUP BY u.last_error ORDER BY count(*) DESC LIMIT 15`,
    )
    .then((res) => console.log('[discovery-audit] failed product urls by error', JSON.stringify(res.rows)))
    .catch((err) => console.error('[discovery-audit] failed:', err));
  (async () => {
    try {
      const indexRes = await fetchPage('https://www.vintagefootballshirts.com/sitemap.xml', {
        useBrowser: false,
        respectRobots: false,
      });
      const locs = [...(indexRes.html?.matchAll(/<loc>(.*?)<\/loc>/g) ?? [])].map((m) => m[1].replace(/&amp;/g, '&'));
      const productSitemaps = locs.filter((l) => l.includes('sitemap_products_'));
      console.log(
        '[discovery-audit] sitemap index',
        JSON.stringify({ statusCode: indexRes.statusCode, totalLocs: locs.length, productSitemapCount: productSitemaps.length }),
      );
      if (productSitemaps.length > 0) {
        const firstRes = await fetchPage(productSitemaps[0], { useBrowser: false, respectRobots: false });
        const firstCount = firstRes.html ? (firstRes.html.match(/<loc>/g) ?? []).length : 0;
        console.log(
          '[discovery-audit] first product sitemap',
          JSON.stringify({
            url: productSitemaps[0],
            statusCode: firstRes.statusCode,
            productUrlCount: firstCount,
            estimatedTotal: firstCount * productSitemaps.length,
            sample: firstRes.html?.slice(0, 500) ?? null,
          }),
        );
      }
    } catch (err) {
      console.error('[discovery-audit] sitemap failed:', err);
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

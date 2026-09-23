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

  // TEMP diagnostic - remove once reviewed. Two things confirmed by the
  // last pass: (1) the failed-product-url error text is overwhelmingly
  // "browser has been closed"/launch-failure variants, fragmented into
  // many near-unique messages (embedded launch command/context ids) so a
  // plain GROUP BY undercounted how dominant this one cause really is -
  // the browser is crashing far more persistently than a one-off storm.
  // (2) extrapolating from a single sub-sitemap's count (612 x 1001 =
  // 612,000) is obviously wrong for a shop this size - Shopify's
  // GID-range-based sitemap sharding doesn't mean every shard is equally
  // full. Sampling more shards (first/middle/last) for a real total, and
  // checking whether VFS's own site config already has
  // skip_browser_for_items on - if item pages render fine without a
  // browser (plausible, Shopify product pages are server-rendered), that
  // setting alone would remove most fetches from the crash-prone
  // Playwright path entirely, without any code change.
  pool
    .query(`SELECT skip_browser_for_items, use_browser_default, rate_limit_rps FROM sites WHERE base_url ILIKE '%vintagefootballshirts%'`)
    .then((res) => console.log('[discovery-audit] browser config', JSON.stringify(res.rows[0])))
    .catch((err) => console.error('[discovery-audit] failed:', err));
  (async () => {
    try {
      const indexRes = await fetchPage('https://www.vintagefootballshirts.com/sitemap.xml', {
        useBrowser: false,
        respectRobots: false,
      });
      const locs = [...(indexRes.html?.matchAll(/<loc>(.*?)<\/loc>/g) ?? [])].map((m) => m[1].replace(/&amp;/g, '&'));
      const productSitemaps = locs.filter((l) => l.includes('sitemap_products_'));
      const sampleIndexes = [0, Math.floor(productSitemaps.length / 2), productSitemaps.length - 1];
      let sampledTotal = 0;
      for (const i of sampleIndexes) {
        const url = productSitemaps[i];
        if (!url) continue;
        const res = await fetchPage(url, { useBrowser: false, respectRobots: false });
        const count = res.html ? (res.html.match(/<loc>/g) ?? []).length : 0;
        sampledTotal += count;
        console.log('[discovery-audit] sitemap sample', JSON.stringify({ index: i, url, statusCode: res.statusCode, productUrlCount: count }));
      }
      console.log(
        '[discovery-audit] sitemap totals',
        JSON.stringify({
          productSitemapCount: productSitemaps.length,
          avgOfSamples: Math.round(sampledTotal / sampleIndexes.filter((i) => productSitemaps[i]).length),
          roughEstimatedTotal: Math.round((sampledTotal / sampleIndexes.length) * productSitemaps.length),
        }),
      );
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

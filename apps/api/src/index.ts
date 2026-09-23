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

  // TEMP diagnostic - remove once reviewed. crawl-job-audit already
  // answered (root cause found and fixed - terminal BullMQ record).
  // Auditing why VFS discovery (~1200 items so far) is far short of the
  // ~10,000+ items the site is believed to actually have: real site
  // config (max_depth/allowed_paths/denied_paths), real urls-table
  // counts by status, and whether the site exposes a sitemap that would
  // give a direct, complete product-URL count to compare against.
  pool
    .query(`SELECT id, name, base_url, max_depth, allowed_paths, denied_paths FROM sites WHERE base_url ILIKE '%vintagefootballshirts%'`)
    .then((res) => console.log('[discovery-audit] site config', JSON.stringify(res.rows)))
    .catch((err) => console.error('[discovery-audit] failed:', err));
  pool
    .query(
      `SELECT u.status, count(*) FROM urls u
       JOIN sites s ON s.id = u.site_id
       WHERE s.base_url ILIKE '%vintagefootballshirts%'
       GROUP BY u.status ORDER BY count(*) DESC`,
    )
    .then((res) => console.log('[discovery-audit] urls by status', JSON.stringify(res.rows)))
    .catch((err) => console.error('[discovery-audit] failed:', err));
  pool
    .query(
      `SELECT count(*) FROM urls u
       JOIN sites s ON s.id = u.site_id
       WHERE s.base_url ILIKE '%vintagefootballshirts%' AND u.path LIKE '%/products/%'`,
    )
    .then((res) => console.log('[discovery-audit] urls matching /products/', JSON.stringify(res.rows[0])))
    .catch((err) => console.error('[discovery-audit] failed:', err));
  (async () => {
    for (const sitemapUrl of [
      'https://www.vintagefootballshirts.com/sitemap.xml',
      'https://www.vintagefootballshirts.com/sitemap_products_1.xml',
    ]) {
      try {
        const res = await fetchPage(sitemapUrl, { useBrowser: false, respectRobots: false });
        const urlCount = res.html ? (res.html.match(/<loc>/g) ?? []).length : 0;
        console.log(
          '[discovery-audit] sitemap',
          sitemapUrl,
          JSON.stringify({ statusCode: res.statusCode, bytes: res.html?.length ?? 0, locCount: urlCount, sample: res.html?.slice(0, 800) ?? null }),
        );
      } catch (err) {
        console.error('[discovery-audit] sitemap failed:', sitemapUrl, err);
      }
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

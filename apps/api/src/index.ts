import { config } from './config.js';
import { pool } from './db.js';
import { runMigrations } from './lib/migrate.js';
import { deduplicateQueuedCrawls, recoverOrphanedJobs, recoverStaleQueuedJobs } from './lib/jobRecords.js';
import { backfillItemProfiles } from './lib/backfillItemProfiles.js';
import { buildApp } from './app.js';
import { startCrawlWorker } from './workers/crawlWorker.js';
import { scheduleRecheck, startRecheckWorker } from './workers/recheckWorker.js';

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

  // TEMP diagnostic - remove once reviewed.
  pool
    .query(`SELECT stock_status, count(*) FROM urls WHERE status = 'fetched' GROUP BY stock_status ORDER BY count(*) DESC`)
    .then((res) => console.log('[stock-breakdown]', JSON.stringify(res.rows)))
    .catch((err) => console.error('[stock-breakdown] failed:', err));

  // TEMP diagnostic - remove once reviewed. No structured 'extracted' data
  // exists for VFS at all (previous diagnostic came back empty), so the
  // schema.org availability path isn't the cause. Testing the next
  // hypothesis instead: a static "Add to Cart/Bag" button label that's
  // present in the HTML regardless of real stock state could be winning
  // IN_STOCK_PHRASES inside the price-proximity window before the
  // standalone-line "Sold out" fallback (built for exactly this shape,
  // e.g. a sticky mobile widget far from the price) ever gets checked -
  // counting how many 'In Stock' VFS items' own markdown also contains
  // "sold" anywhere would be strong evidence either way.
  pool
    .query(
      `SELECT count(*) FILTER (WHERE sr.content::text ILIKE '%sold%') AS contains_sold, count(*) AS total
       FROM urls u
       JOIN scrape_results sr ON sr.url_id = u.id AND sr.format = 'markdown'
       WHERE u.stock_status = 'In Stock' AND u.url LIKE '%vintagefootballshirts.com%'`,
    )
    .then((res) => console.log('[sold-word-check]', JSON.stringify(res.rows)))
    .catch((err) => console.error('[sold-word-check] failed:', err));

  pool
    .query(
      `SELECT u.url, sr.content
       FROM urls u
       JOIN scrape_results sr ON sr.url_id = u.id AND sr.format = 'markdown'
       WHERE u.stock_status = 'In Stock' AND u.url LIKE '%vintagefootballshirts.com%' AND sr.content::text ILIKE '%sold%'
       LIMIT 3`,
    )
    .then((res) =>
      console.log(
        '[sold-word-sample]',
        JSON.stringify(
          res.rows.map((r) => ({
            url: r.url,
            markdownLength: String(r.content).length,
            soldContext: (() => {
              const text = String(r.content);
              const i = text.toLowerCase().indexOf('sold');
              return text.slice(Math.max(0, i - 150), i + 150);
            })(),
          })),
        ),
      ),
    )
    .catch((err) => console.error('[sold-word-sample] failed:', err));

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

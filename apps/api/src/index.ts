import { config } from './config.js';
import { pool } from './db.js';
import { runMigrations } from './lib/migrate.js';
import { deduplicateQueuedCrawls, recoverOrphanedJobs, recoverStaleQueuedJobs } from './lib/jobRecords.js';
import { backfillItemProfiles } from './lib/backfillItemProfiles.js';
import { buildApp } from './app.js';
import { startCrawlWorker } from './workers/crawlWorker.js';
import { scheduleRecheck, startRecheckWorker } from './workers/recheckWorker.js';
import { buildKickioProfile } from './services/kickioProfile.js';
import { getCurrencyRates } from './lib/currencyRates.js';

// TEMP DIAGNOSTIC - see session notes. Auditing whether a specific real
// item ("Club Almirante Brown 'Pope Francis'", currently reading Out of
// Stock) should have produced a sales row - reconstructing its real fetch
// history (every scrape_results row, which job/path touched it, whether
// any past fetch actually read In Stock) directly, rather than guessing
// from the single "last known" stock_status column urls stores.
async function auditSaleCandidate(): Promise<void> {
  const { rows: matches } = await pool.query<{
    id: string;
    url: string;
    path: string;
    status: string;
    discovered_at: string;
    last_fetched_at: string | null;
    stock_status: string | null;
    price: number | null;
    currency: string | null;
  }>(
    `SELECT u.id, u.url, u.path, u.status, u.discovered_at, u.last_fetched_at, u.stock_status, u.price, u.currency
     FROM urls u JOIN sites s ON s.id = u.site_id
     WHERE s.base_url ILIKE '%vintagefootballshirts%' AND u.path ILIKE '%almirante-brown%'`,
  );
  if (matches.length === 0) {
    console.log('[sale-audit] no matching url found');
    return;
  }
  for (const row of matches) {
    console.log('[sale-audit] url row', JSON.stringify(row));

    const { rows: fetches } = await pool.query<{
      job_id: string | null;
      job_type: string | null;
      fetched_at: string;
    }>(
      `SELECT sr.job_id, j.type AS job_type, sr.fetched_at
       FROM scrape_results sr LEFT JOIN jobs j ON j.id = sr.job_id
       WHERE sr.url_id = $1 AND sr.format = 'metadata'
       ORDER BY sr.fetched_at ASC`,
      [row.id],
    );
    console.log('[sale-audit] fetch history', JSON.stringify(fetches));

    const { rows: sales } = await pool.query(`SELECT id, title, price, currency, detected_at FROM sales WHERE url_id = $1`, [row.id]);
    console.log('[sale-audit] sales rows', JSON.stringify(sales));

    const { rows: priceChanges } = await pool.query(
      `SELECT id, old_price, new_price, currency, detected_at FROM price_changes WHERE url_id = $1`,
      [row.id],
    );
    console.log('[sale-audit] price_change rows', JSON.stringify(priceChanges));

    // Reconstruct the stock_status this app would actually have computed
    // at each past fetch, from the real markdown/extracted content saved
    // at the time - not assumed.
    const { rows: markdownRows } = await pool.query<{ content: string; fetched_at: string; job_id: string | null }>(
      `SELECT content, fetched_at, job_id FROM scrape_results WHERE url_id = $1 AND format = 'markdown' ORDER BY fetched_at ASC`,
      [row.id],
    );
    const { rows: extractedRows } = await pool.query<{ content: Record<string, string>; fetched_at: string }>(
      `SELECT content, fetched_at FROM scrape_results WHERE url_id = $1 AND format = 'extracted' ORDER BY fetched_at ASC`,
      [row.id],
    );
    const { rows: metaRows } = await pool.query<{ content: { title?: string; image?: string }; fetched_at: string }>(
      `SELECT content, fetched_at FROM scrape_results WHERE url_id = $1 AND format = 'metadata' ORDER BY fetched_at ASC`,
      [row.id],
    );
    const currencyRates = await getCurrencyRates();
    for (let i = 0; i < markdownRows.length; i++) {
      const md = markdownRows[i];
      const extracted = extractedRows[i]?.content ?? {};
      const meta = metaRows[i]?.content ?? {};
      try {
        const profile = buildKickioProfile({
          url: row.url,
          title: meta.title ?? null,
          description: typeof md.content === 'string' ? md.content.slice(0, 4000) : null,
          images: meta.image ? [meta.image] : [],
          extracted,
          currencyRates,
          kickioTeams: null,
        });
        console.log(
          '[sale-audit] reconstructed stock at fetch',
          JSON.stringify({ fetched_at: md.fetched_at, stock_status: profile.listing.stock_status, price: profile.listing.price }),
        );
      } catch (err) {
        console.log('[sale-audit] reconstruction failed', md.fetched_at, err instanceof Error ? err.message : String(err));
      }
    }
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

  auditSaleCandidate().catch((err) => console.error('[sale-audit] failed:', err));

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

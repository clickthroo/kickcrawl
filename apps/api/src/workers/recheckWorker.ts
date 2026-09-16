import { Worker } from 'bullmq';
import { redisConnection, recheckQueue } from '../queue.js';
import { pool } from '../db.js';
import { scrapePage } from '../lib/scrapeCore.js';
import { markUrlFetched } from '../lib/urlStore.js';
import { persistScrapeResult } from '../lib/persistResult.js';
import { createJob, failJob } from '../lib/jobRecords.js';
import { getCurrencyRates } from '../lib/currencyRates.js';
import { buildKickioProfile } from '../services/kickioProfile.js';
import { isPathAllowed } from '../services/links.js';
import type { SiteConfig } from '../lib/siteResolver.js';

export const RECHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

/**
 * A sale is recorded exactly on the In Stock -> Out of Stock transition,
 * not on every recheck that happens to read "Out of Stock" - a page that's
 * already out of stock (or was never confidently in stock, or is
 * "Unknown") isn't a new sale, it's just still out of stock.
 */
export function isNewSale(previousStatus: string | null, newStatus: string | null): boolean {
  return previousStatus === 'In Stock' && newStatus === 'Out of Stock';
}

interface RecheckableUrl {
  id: string;
  url: string;
  path: string;
  stock_status: string | null;
}

async function recheckSite(
  site: SiteConfig,
  jobId: string,
  currencyRates: Record<string, number>,
  progress: { checked: number; total: number; sales: number; errors: string[] },
): Promise<void> {
  const { rows: urls } = await pool.query<RecheckableUrl>(
    `SELECT id, url, path, stock_status FROM urls WHERE site_id = $1 AND status = 'fetched'`,
    [site.id],
  );
  // Only items (allowed_paths-matched), not the stepping-stone category/
  // listing pages a crawl also fetches along the way - those never carry
  // real stock info, so rechecking them would just burn rate-limit budget.
  const items = urls.filter((u) => isPathAllowed(u.path, site.allowed_paths, site.denied_paths));

  progress.total += items.length;
  await pool.query(`UPDATE jobs SET total_pages = $2 WHERE id = $1`, [jobId, progress.total]);

  for (const item of items) {
    try {
      const result = await scrapePage(item.url, { formats: ['markdown'], onlyMainContent: true }, site);
      const urlId = await markUrlFetched(site.id, item.url, result.metadata.statusCode, result.error);
      await persistScrapeResult(urlId, jobId, result);

      if (result.success) {
        const profile = buildKickioProfile({
          url: item.url,
          title: result.metadata.title,
          description: result.markdown?.slice(0, 4000) ?? null,
          images: [result.metadata.image],
          extracted: result.extracted,
          currencyRates,
        });
        const newStatus = profile.listing.stock_status;

        if (isNewSale(item.stock_status, newStatus)) {
          await pool.query(
            `INSERT INTO sales (url_id, site_id, title, price, currency) VALUES ($1, $2, $3, $4, $5)`,
            [urlId, site.id, result.metadata.title, profile.listing.price, profile.listing.currency],
          );
          progress.sales += 1;
        }

        await pool.query(`UPDATE urls SET stock_status = $2 WHERE id = $1`, [urlId, newStatus]);
      }
    } catch (err) {
      progress.errors.push(`${item.url}: ${err instanceof Error ? err.message : String(err)}`);
    }

    progress.checked += 1;
    await pool.query(`UPDATE jobs SET completed_pages = $2 WHERE id = $1`, [jobId, progress.checked]);
  }
}

async function processRecheck(): Promise<void> {
  const jobId = await createJob('recheck', null, {}, 'running');
  const progress = { checked: 0, total: 0, sales: 0, errors: [] as string[] };

  try {
    const { rows: sites } = await pool.query<SiteConfig>('SELECT * FROM sites WHERE is_active = true');
    const currencyRates = await getCurrencyRates();

    for (const site of sites) {
      await recheckSite(site, jobId, currencyRates, progress);
    }

    await pool.query(
      `UPDATE jobs SET status = 'completed', total_pages = $2, completed_pages = $3,
         error_count = $4, errors = $5::jsonb, finished_at = now() WHERE id = $1`,
      [
        jobId,
        progress.total,
        progress.checked,
        progress.errors.length,
        JSON.stringify(progress.errors.map((e) => ({ message: e }))),
      ],
    );
    console.log(`[recheckWorker] job ${jobId} checked ${progress.checked} item(s), found ${progress.sales} sale(s)`);
  } catch (err) {
    await failJob(jobId, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

export function startRecheckWorker(): Worker {
  const worker = new Worker(
    'recheck',
    async () => {
      await processRecheck();
    },
    {
      connection: redisConnection,
      concurrency: 1,
      // Same rationale as crawlWorker.ts: a single-instance app never has
      // a live process to resume a stalled job, so don't let BullMQ retry
      // one on its own - fail it and let the next scheduled tick start
      // clean instead.
      maxStalledCount: 0,
    },
  );
  worker.on('failed', (job, err) => {
    console.error(`[recheckWorker] job ${job?.id} failed:`, err);
  });
  return worker;
}

/**
 * Registers the repeatable job that drives the 4-hourly recheck. Safe to
 * call on every boot - BullMQ keys a repeatable job by its name + repeat
 * options, so calling this again with the same interval reuses the
 * existing schedule rather than stacking a duplicate one.
 */
export async function scheduleRecheck(): Promise<void> {
  await recheckQueue.add('recheck', {}, { repeat: { every: RECHECK_INTERVAL_MS } });
}

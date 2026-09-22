import { Worker } from 'bullmq';
import { redisConnection, recheckQueue } from '../queue.js';
import { pool } from '../db.js';
import { scrapePage } from '../lib/scrapeCore.js';
import { fetchPage } from '../services/fetcher.js';
import { markUrlFetched } from '../lib/urlStore.js';
import { persistScrapeResult } from '../lib/persistResult.js';
import { createJob, failJob } from '../lib/jobRecords.js';
import { getCurrencyRates } from '../lib/currencyRates.js';
import { getKickioTeamsForMatching } from '../lib/kickioTeams.js';
import { buildKickioProfile, type KickioTeamRef } from '../services/kickioProfile.js';
import { isPathAllowed } from '../services/links.js';
import type { SiteConfig } from '../lib/siteResolver.js';
import { PAGE_TIMEOUT_MS, passesSellerFilter, resolveUseBrowser } from './crawlWorker.js';

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

export async function recheckSite(
  site: SiteConfig,
  jobId: string,
  currencyRates: Record<string, number>,
  progress: { checked: number; total: number; sales: number; errors: string[] },
  kickioTeams: readonly KickioTeamRef[] | null = null,
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
      // Every url here already matched allowed_paths (the filter just
      // above), so this is always the matchesAllowedPaths=true case of
      // crawlWorker.ts's own per-page useBrowser decision - reused here
      // rather than duplicating that same rule.
      const useBrowser = resolveUseBrowser(true, undefined, site);
      const result = await scrapePage(item.url, { formats: ['markdown'], onlyMainContent: true, useBrowser }, site);

      // A site's seller filters (require_pro_seller, min_seller_feedback)
      // can be turned on, or tightened, after an item was already
      // recorded - confirmed in production: a non-Pro seller's item kept
      // being refreshed by every recheck indefinitely even with "Pro
      // only" selected, because a recheck only ever updated stock/price,
      // never re-validated the seller. Drop it here instead, the same
      // way a fresh crawl would never have recorded it in the first
      // place - cascades to its scrape_results/sales rows too.
      if (result.success && !passesSellerFilter(result.markdown, site)) {
        await pool.query(`DELETE FROM urls WHERE id = $1`, [item.id]);
        progress.checked += 1;
        await pool.query(`UPDATE jobs SET completed_pages = $2 WHERE id = $1`, [jobId, progress.checked]);
        continue;
      }

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
          kickioTeams,
        });
        const newStatus = profile.listing.stock_status;

        if (isNewSale(item.stock_status, newStatus)) {
          // The full profile - not just title/price/currency - so the Sales
          // page can show every feature we knew about the item (team,
          // season, condition, images, ...) exactly as it was at the moment
          // it sold, the same way the Items list shows it for an active one.
          await pool.query(
            `INSERT INTO sales (url_id, site_id, title, price, currency, profile) VALUES ($1, $2, $3, $4, $5, $6)`,
            [urlId, site.id, result.metadata.title, profile.listing.price, profile.listing.currency, JSON.stringify(profile)],
          );
          progress.sales += 1;
        }

        await pool.query(`UPDATE urls SET stock_status = $2 WHERE id = $1`, [urlId, newStatus]);

        // TEMP DIAGNOSTIC - see session notes. Verifying, against a real
        // production request rather than guessing, whether Shopify's
        // standard <product-url>.json endpoint (present by default on every
        // Shopify store unless explicitly disabled) exposes per-size
        // variant availability for this retailer - the data source the
        // "one card per size" feature needs, before building on top of it.
        if (item.url.includes('vintagefootballshirts.com') && item.url.includes('/products/')) {
          try {
            const jsonUrl = `${item.url.replace(/\/+$/, '')}.json`;
            const jsonRes = await fetchPage(jsonUrl, { useBrowser: false, respectRobots: false });
            let variantsSummary: unknown = null;
            if (jsonRes.html) {
              try {
                const parsed = JSON.parse(jsonRes.html);
                variantsSummary = Array.isArray(parsed?.product?.variants)
                  ? parsed.product.variants.map((v: Record<string, unknown>) => ({
                      title: v.title,
                      available: v.available,
                      price: v.price,
                      sku: v.sku,
                    }))
                  : null;
              } catch {
                variantsSummary = 'unparseable';
              }
            }
            console.log(
              '[variant-diag]',
              JSON.stringify({ url: item.url, statusCode: jsonRes.statusCode, variantsSummary }),
            );
          } catch (err) {
            console.log(
              '[variant-diag] error',
              item.url,
              err instanceof Error ? err.message : String(err),
            );
          }
        }
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
    const kickioTeams = await getKickioTeamsForMatching();

    for (const site of sites) {
      await recheckSite(site, jobId, currencyRates, progress, kickioTeams);
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
      // Same rationale as crawlWorker.ts: BullMQ's default lockDuration
      // (30s) is shorter than a single slow-but-legitimate browser-
      // rendered page can take, so without this a real fetch gets killed
      // by BullMQ's own stall watchdog well before it's actually hung.
      // processRecheck() calls scrapePage() directly (no PAGE_TIMEOUT_MS
      // race of its own), so this constant is reused here as the same
      // generous ceiling, not because this file shares that timeout.
      lockDuration: PAGE_TIMEOUT_MS + 30_000,
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

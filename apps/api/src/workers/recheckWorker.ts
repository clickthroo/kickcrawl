import { Worker } from 'bullmq';
import { redisConnection, recheckQueue } from '../queue.js';
import { pool } from '../db.js';
import { scrapePage } from '../lib/scrapeCore.js';
import { markUrlFetched } from '../lib/urlStore.js';
import { persistScrapeResult } from '../lib/persistResult.js';
import { createJob, failJob } from '../lib/jobRecords.js';
import { getCurrencyRates } from '../lib/currencyRates.js';
import { getKickioTeamsForMatching } from '../lib/kickioTeams.js';
import { buildKickioProfile, type KickioTeamRef } from '../services/kickioProfile.js';
import { persistItemProfileColumns } from '../lib/persistItemProfile.js';
import { isPathAllowed } from '../services/links.js';
import type { SiteConfig } from '../lib/siteResolver.js';
import { PAGE_TIMEOUT_MS, passesSellerFilter, resolveUseBrowser } from './crawlWorker.js';
import { detectAndRecordTransition, isNewSale, isPriceChange } from '../lib/saleDetection.js';

// Re-exported so existing imports (this file's own tests included) keep
// working - the real definitions moved to lib/saleDetection.ts so
// crawlWorker.ts's own recordItemProfile can share them too, without a
// circular import (crawlWorker already exports things this file imports).
export { isNewSale, isPriceChange };

export const RECHECK_INTERVAL_MS = 60 * 60 * 1000;

// How long a status='failed' row sits out before it's eligible for another
// recheck attempt. Confirmed in production: including all 4,943 'failed'
// rows unconditionally on every cycle (see the query below) grew a single
// recheck pass from comfortably under an hour to over 5 hours - BullMQ's
// repeatable job doesn't start a new run while the previous one is still
// executing, so the real recheck cadence collapsed from hourly to roughly
// once every 5-6 hours, and "no sales or price changes detected for most
// of the day" was that reduced cadence, not a detection-logic bug (the
// comparison logic itself - detectAndRecordTransition - was unaffected).
// Most of that backlog is the same browser-crash pattern that clears up on
// its own; retrying it every single hour was mostly the same URLs failing
// again for the same reason, at the cost of the whole catalog's recheck
// frequency. A few hours' backoff still gets every failed row retried
// several times a day, just not at the expense of the 'fetched' majority.
const RECHECK_FAILED_BACKOFF_HOURS = 4;

// How many sites' recheckSite() calls run at once. Confirmed in production:
// processRecheck() used to await each site's ENTIRE recheckSite() call in a
// plain sequential for-loop, so one large, browser-heavy site (every item
// needing Playwright, serialized through the single global browser slot -
// services/browser.ts) could occupy the whole cycle by itself for hours,
// leaving every other site completely unchecked for that entire stretch -
// not slower, literally zero progress - and blowing the whole job well past
// RECHECK_INTERVAL_MS in the process. Running sites concurrently doesn't
// remove the shared browser-slot bottleneck (browser-driven fetches across
// ALL of them still serialize through it, one at a time, exactly as before),
// but it does mean a fast, plain-HTTP site's items get their fair share of
// that slot's time and their own rate-limit budget instead of queuing
// behind one slow site's entire backlog. 3 mirrors crawlWorker.ts's own
// Worker concurrency for consistency, not a resource limit of its own - the
// real ceilings (browser slot, per-domain rate limit) are enforced further
// down the call stack regardless of how many sites are "concurrent" here.
const RECHECK_SITE_CONCURRENCY = 3;

/**
 * Runs `fn` over `items` with at most `concurrency` in flight at once,
 * waiting for the whole batch to finish before returning - a minimal
 * worker-pool, not a full queue, since recheck's own site list is small
 * (a handful of sites) and doesn't need anything fancier.
 */
export async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

interface RecheckableUrl {
  id: string;
  url: string;
  path: string;
  stock_status: string | null;
  price: number | null;
  currency: string | null;
}

export async function recheckSite(
  site: SiteConfig,
  jobId: string,
  currencyRates: Record<string, number>,
  progress: { checked: number; total: number; sales: number; priceChanges: number; errors: string[] },
  kickioTeams: readonly KickioTeamRef[] | null = null,
): Promise<void> {
  const { rows: urls } = await pool.query<RecheckableUrl>(
    `SELECT id, url, path, stock_status, price, currency FROM urls
     WHERE site_id = $1 AND stock_status IS NOT NULL AND stock_status != 'Out of Stock'
       AND (status = 'fetched' OR (status = 'failed' AND last_fetched_at < now() - interval '${RECHECK_FAILED_BACKOFF_HOURS} hours'))`,
    [site.id],
  );
  // Only items (allowed_paths-matched), not the stepping-stone category/
  // listing pages a crawl also fetches along the way - those never carry
  // real stock info, so rechecking them would just burn rate-limit budget.
  // An item already known Out of Stock is excluded at the query itself
  // (not filtered here) - once sold, it stays sold, so there's nothing
  // left for a recheck to catch by revisiting it every hour forever.
  //
  // status='failed' is included alongside 'fetched' - confirmed in
  // production that 78% of everything with a known non-Out-of-Stock
  // stock_status (4943 of 6378 rows) sits in status='failed' (its most
  // recent fetch attempt errored, overwhelmingly the same browser-crash
  // pattern crawlWorker.ts's retry logic already handles within a single
  // job). The OLD 'fetched'-only filter permanently excluded every one of
  // those rows from ever being re-verified again the moment a fetch
  // happened to fail once - meaning a genuine sale on any of them could
  // never be detected. markUrlFetched (already called below on every
  // outcome) naturally heals a row's status back to 'fetched' on a
  // successful retry, or leaves it 'failed' again to be retried next
  // eligible cycle - no separate recovery path needed. stock_status IS NOT
  // NULL excludes urls.status='failed' rows that have NEVER been
  // successfully fetched at all (nothing to diff against, and no price to
  // recheck the seller/currency for) - that backlog belongs to crawl's own
  // retry logic, not this one.
  //
  // RECHECK_FAILED_BACKOFF_HOURS gates the 'failed' half: unconditionally
  // re-attempting all ~5000 of them every single hourly cycle (as the first
  // version of this fix did) grew one recheck pass past 5 hours, which cut
  // the real detection cadence for the ENTIRE catalog - 'fetched' rows
  // included - from hourly to roughly once every 5-6 hours. A row that
  // failed recently sits out until it's stale enough to be worth another
  // try, keeping each cycle's working set close to what actually finishes
  // inside RECHECK_INTERVAL_MS.
  const items = urls.filter((u) => isPathAllowed(u.path, site.allowed_paths, site.denied_paths));

  progress.total += items.length;
  await pool.query(`UPDATE jobs SET total_pages = $2 WHERE id = $1`, [jobId, progress.total]);

  // recheckSite() has no per-item log line (unlike crawlWorker.ts's own
  // "fetching ..." line) - fine for a single fast site, but with
  // RECHECK_SITE_CONCURRENCY now running several sites in parallel and a
  // large plain-HTTP site legitimately taking over an hour at its
  // per-domain rate limit, that silence is indistinguishable from actually
  // being stuck. Confirmed the gap in production: a genuinely healthy,
  // still-in-progress cycle and a truly wedged one looked identical in
  // Railway's logs - nothing to check but the raw jobs.completed_pages
  // column. A start line plus a periodic heartbeat closes that blind spot
  // without adding a line per item (which, at thousands of items across 5
  // sites, would just be noise).
  console.log(`[recheckWorker] job ${jobId} checking ${site.name}: ${items.length} item(s) eligible`);
  const HEARTBEAT_EVERY = 100;
  let checkedHere = 0;
  function heartbeat(): void {
    checkedHere += 1;
    if (checkedHere % HEARTBEAT_EVERY === 0 || checkedHere === items.length) {
      console.log(`[recheckWorker] job ${jobId} ${site.name}: ${checkedHere}/${items.length} checked so far`);
    }
  }

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
        heartbeat();
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

        // The full profile - not just title/price/currency - is snapshotted
        // on a sale/price change so the Sales/Price Changes pages can show
        // every feature we knew about the item (team, season, condition,
        // images, ...) exactly as it was at the moment of detection, the
        // same way the Items list shows it for an active one, and stays
        // accurate even if the source page later changes or 404s.
        const { sale, priceChange } = await detectAndRecordTransition(
          urlId,
          site.id,
          result.metadata.title,
          { stock_status: item.stock_status, price: item.price, currency: item.currency },
          profile,
        );
        if (sale) progress.sales += 1;
        if (priceChange) progress.priceChanges += 1;

        // Persists every commonly-filtered profile field (team, season,
        // colour, size, ...), not just stock_status - the admin Items list
        // now filters these in SQL (routes/admin/urls.ts) instead of
        // building a profile for every row in the table on every request.
        await persistItemProfileColumns(urlId, profile);
      }
    } catch (err) {
      progress.errors.push(`${item.url}: ${err instanceof Error ? err.message : String(err)}`);
    }

    progress.checked += 1;
    heartbeat();
    await pool.query(`UPDATE jobs SET completed_pages = $2 WHERE id = $1`, [jobId, progress.checked]);
  }
}

async function processRecheck(): Promise<void> {
  const jobId = await createJob('recheck', null, {}, 'running');
  const progress = { checked: 0, total: 0, sales: 0, priceChanges: 0, errors: [] as string[] };

  try {
    const { rows: sites } = await pool.query<SiteConfig>('SELECT * FROM sites WHERE is_active = true');
    const currencyRates = await getCurrencyRates();
    const kickioTeams = await getKickioTeamsForMatching();

    console.log(`[recheckWorker] job ${jobId} starting: ${sites.length} active site(s), concurrency ${RECHECK_SITE_CONCURRENCY}`);

    await runWithConcurrency(sites, RECHECK_SITE_CONCURRENCY, (site) =>
      recheckSite(site, jobId, currencyRates, progress, kickioTeams),
    );

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
    console.log(
      `[recheckWorker] job ${jobId} checked ${progress.checked} item(s), found ${progress.sales} sale(s), ${progress.priceChanges} price change(s)`,
    );
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
 * Registers the repeatable job that drives the recheck cycle. Safe to call
 * on every boot - BullMQ keys a repeatable job by its name + repeat
 * options (including the interval itself), so calling this again with the
 * SAME interval reuses the existing schedule rather than stacking a
 * duplicate one. But that also means simply changing RECHECK_INTERVAL_MS
 * and redeploying would otherwise leave whatever schedule a previous
 * deploy registered running forever alongside the new one - two
 * overlapping recheck cycles, not one replaced by the other. Removing
 * every existing 'recheck' repeatable job first, unconditionally, before
 * re-adding the current one guarantees exactly one active schedule after
 * every boot, regardless of what interval any earlier deploy used.
 */
export async function scheduleRecheck(): Promise<void> {
  const existing = await recheckQueue.getRepeatableJobs();
  for (const job of existing) {
    if (job.name === 'recheck') {
      await recheckQueue.removeRepeatableByKey(job.key);
    }
  }
  await recheckQueue.add('recheck', {}, { repeat: { every: RECHECK_INTERVAL_MS } });
}

import { Worker, type Job } from 'bullmq';
import * as cheerio from 'cheerio';
import { redisConnection, type CrawlJobData } from '../queue.js';
import { pool } from '../db.js';
import { scrapePage, type ScrapeCoreResult } from '../lib/scrapeCore.js';
import { resolveSiteForUrl } from '../lib/siteResolver.js';
import { markUrlFetched, markUrlQueued, upsertDiscoveredUrls } from '../lib/urlStore.js';
import { persistScrapeResult } from '../lib/persistResult.js';
import { extractLinks, isPathAllowed, isSameSite, matchesPathPattern } from '../services/links.js';
import { detectSellerSignals } from '../services/sellerSignals.js';
import { config } from '../config.js';
import type { SiteConfig } from '../lib/siteResolver.js';

/**
 * Which of a page's outbound same-site links the crawl should follow next.
 * denied_paths is a hard stop - dropped here so a denied page is never even
 * visited, not just never recorded. allowed_paths is deliberately NOT
 * applied here: a page outside it (e.g. a category/collection listing) is
 * often the only way to *reach* pages that are inside it (e.g. individual
 * product pages), so it still needs to be visited and have its own links
 * followed - see isCrawlItem() for the allow-list check that decides
 * whether a visited page gets recorded as an Item.
 */
export function filterTraversableLinks(
  links: string[],
  visited: Set<string>,
  excludePaths: string[],
): string[] {
  return links.filter((l) => !visited.has(l)).filter((l) => isPathAllowed(new URL(l).pathname, [], excludePaths));
}

/**
 * Whether a visited page counts as a real Item - gets its content
 * persisted and shown in the Items list - rather than just a stepping
 * stone the crawl passed through to discover further links. An empty
 * allowed_paths means everything visited (that isn't denied) is an item.
 */
export function isCrawlItem(path: string, includePaths: string[]): boolean {
  if (includePaths.length === 0) return true;
  return includePaths.some((p) => matchesPathPattern(path, p));
}

async function updateJobProgress(jobId: string, total: number, completed: number): Promise<void> {
  await pool.query(
    `UPDATE jobs SET status = 'running', total_pages = $2, completed_pages = $3 WHERE id = $1`,
    [jobId, total, completed],
  );
}

/**
 * Whether a fetched item passes the site's seller-trust filters (Vinted's
 * Pro badge + feedback count, services/sellerSignals.ts) - checked once
 * the page's own content is available, since these signals are read from
 * the page's rendered text, not looked up separately. A site with
 * neither filter configured always passes (most sites have no concept of
 * a "seller" at all). When a filter IS configured but its signal can't
 * be found on the page, the item fails closed - a page we can't confirm
 * passes shouldn't be kept just because we couldn't check it.
 */
export function passesSellerFilter(
  markdown: string | undefined,
  site: Pick<SiteConfig, 'require_pro_seller' | 'min_seller_feedback'>,
): boolean {
  if (!site.require_pro_seller && site.min_seller_feedback == null) return true;
  if (!markdown) return false;

  const { feedbackCount, isPro } = detectSellerSignals(markdown);
  if (site.require_pro_seller && !isPro) return false;
  if (site.min_seller_feedback != null && (feedbackCount == null || feedbackCount < site.min_seller_feedback)) {
    return false;
  }
  return true;
}

async function recordPageResult(
  siteId: string,
  jobId: string,
  url: string,
  result: ScrapeCoreResult,
): Promise<void> {
  const urlId = await markUrlFetched(siteId, url, result.metadata.statusCode, result.error);
  await persistScrapeResult(urlId, jobId, result);
}

// A catch-all safety net around the per-page fetch. Every individual I/O
// call inside scrapePage() (DNS, robots.txt, the HTTP fetch, the browser
// navigation) already has its own timeout, but that only helps if every
// future code path in there remembers to add one too - a single page
// hanging on some untimed corner (e.g. browser.newContext(),
// context.close()) would otherwise freeze the whole job forever, since
// the crawl loop is strictly sequential. 90s is generous enough to cover
// the slowest legitimate case (a near-max robots Crawl-delay plus a
// blocked-page browser retry) without masking a real hang for long.
export const PAGE_TIMEOUT_MS = 90_000;

export async function scrapePageWithTimeout(
  url: string,
  opts: Parameters<typeof scrapePage>[1],
  site: Parameters<typeof scrapePage>[2],
): Promise<ScrapeCoreResult> {
  return await Promise.race([
    scrapePage(url, opts, site),
    new Promise<ScrapeCoreResult>((resolve) =>
      setTimeout(
        () =>
          resolve({
            success: false,
            error: `Timed out after ${PAGE_TIMEOUT_MS}ms fetching this page`,
            metadata: { sourceURL: url, statusCode: 0 },
          }),
        PAGE_TIMEOUT_MS,
      ),
    ),
  ]);
}

async function fireWebhook(jobId: string, status: string): Promise<void> {
  if (!config.webhookUrl) return;
  try {
    await fetch(config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId, status, event: 'crawl.completed' }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // webhook delivery is best-effort
  }
}

async function processCrawl(job: Job<CrawlJobData>): Promise<void> {
  const { jobId, siteId, url, limit, maxDepth, includePaths, excludePaths, scrapeOptions } =
    job.data;
  const origin = new URL(url).origin;
  const site = await resolveSiteForUrl(url);

  const visited = new Set<string>();
  const queue: { url: string; depth: number }[] = [{ url: new URL(url).toString(), depth: 0 }];
  let completed = 0;
  const errors: string[] = [];

  await updateJobProgress(jobId, Math.min(limit, 1), 0);

  while (queue.length > 0 && visited.size < limit) {
    const next = queue.shift()!;
    if (visited.has(next.url)) continue;
    visited.add(next.url);

    // The seed (depth 0) is always an item, same as before. Anything else
    // is an item only if it matches allowed_paths - a page that doesn't
    // (e.g. a category/collection listing) still gets fetched below and
    // has its links followed, it just isn't recorded as an Item itself.
    const path = new URL(next.url).pathname;
    const matchesAllowedPaths = isCrawlItem(path, includePaths);
    const isItem = next.depth === 0 || matchesAllowedPaths;

    if (isItem) await markUrlQueued(siteId, next.url);

    console.log(
      `[crawlWorker] job ${jobId} fetching ${next.url} (depth ${next.depth}, ${completed}/${limit} done, ${queue.length} queued)`,
    );
    const result = await scrapePageWithTimeout(
      next.url,
      { formats: scrapeOptions.formats ?? ['markdown'], onlyMainContent: scrapeOptions.onlyMainContent ?? true, useBrowser: scrapeOptions.useBrowser },
      site,
    );
    if (!result.success) {
      console.log(`[crawlWorker] job ${jobId} failed ${next.url}: ${result.error}`);
      if (isItem) {
        errors.push(`${next.url}: ${result.error}`);
        await recordPageResult(siteId, jobId, next.url, result);
      }
    } else {
      if (isItem) {
        // The seller filter only makes sense for a page that's genuinely
        // an item by its own path - a catalog/search seed forced into
        // isItem purely by being depth 0 has no single seller to check
        // at all (it's a listing of many items, each with their own),
        // so scanning its whole page would just catch whichever
        // unrelated item happens to appear first, not a real signal.
        const passesFilter =
          !matchesAllowedPaths ||
          passesSellerFilter(result.markdown, site ?? { require_pro_seller: false, min_seller_feedback: null });
        if (passesFilter) {
          await recordPageResult(siteId, jobId, next.url, result);
          completed += 1;
        } else {
          // Fetched, but doesn't meet the site's seller filter - keep
          // the url row's own status accurate (it really was fetched)
          // without persisting content for an item we're deliberately
          // not keeping.
          await markUrlFetched(siteId, next.url, result.metadata.statusCode, result.error);
        }
      }

      if (next.depth < maxDepth && result.rawHtml) {
        const $ = cheerio.load(result.rawHtml);
        const links = extractLinks($, next.url).filter((l) => isSameSite(l, origin, false));
        const newLinks = filterTraversableLinks(links, visited, excludePaths);
        // Only the links that will themselves be items get recorded into
        // the Items list - stepping-stone links (e.g. more category
        // pages) still get queued and traversed below, just not shown.
        const itemLinks = newLinks.filter((l) => isCrawlItem(new URL(l).pathname, includePaths));
        await upsertDiscoveredUrls(siteId, itemLinks);
        for (const link of newLinks) {
          queue.push({ url: link, depth: next.depth + 1 });
        }
      }
    }

    await updateJobProgress(jobId, Math.min(limit, visited.size + queue.length), completed);
  }

  await pool.query(
    `UPDATE jobs SET status = 'completed', total_pages = $2, completed_pages = $3,
       error_count = $4, errors = $5::jsonb, finished_at = now() WHERE id = $1`,
    [jobId, visited.size, completed, errors.length, JSON.stringify(errors.map((e) => ({ message: e })))],
  );

  await fireWebhook(jobId, 'completed');
}

export function startCrawlWorker(): Worker<CrawlJobData> {
  const worker = new Worker<CrawlJobData>(
    'crawl',
    async (job) => {
      try {
        await processCrawl(job);
      } catch (err) {
        await pool.query(
          `UPDATE jobs SET status = 'failed', error_count = error_count + 1,
             errors = errors || $2::jsonb, finished_at = now() WHERE id = $1`,
          [
            job.data.jobId,
            JSON.stringify([{ message: err instanceof Error ? err.message : String(err) }]),
          ],
        );
        throw err;
      }
    },
    {
      connection: redisConnection,
      concurrency: 3,
      // recoverOrphanedJobs() (lib/jobRecords.ts) marks any job still
      // 'running' at boot as 'failed', on the assumption that a
      // single-instance app never has a live process to resume it. But
      // BullMQ has its own, independent stalled-job recovery: by default
      // (maxStalledCount: 1) it silently retries a job whose worker died
      // without renewing its lock, re-invoking this same processor from
      // scratch and flipping status back to 'running' underneath our
      // sweep - so a job we'd already declared dead keeps coming back,
      // each restart appending another "interrupted" error while it's
      // actually still executing. maxStalledCount: 0 makes BullMQ treat a
      // stalled job as failed immediately instead of retrying it, so
      // there's nothing left to resurrect a job our own sweep already
      // buried.
      maxStalledCount: 0,
      // BullMQ's own default lockDuration (30s) is shorter than
      // PAGE_TIMEOUT_MS (90s) - the deliberately generous ceiling this file
      // already gives a single slow-but-legitimate page fetch. Confirmed in
      // production: a real Vinted catalog fetch got killed by BullMQ's
      // stall watchdog ("job stalled more than allowable limit") after
      // ~70s, well short of PAGE_TIMEOUT_MS ever getting a chance to
      // apply - maxStalledCount: 0 then made that premature kill
      // permanent instead of retried. Set comfortably above
      // PAGE_TIMEOUT_MS so BullMQ's own stall detection can never preempt
      // the timeout this file was already designed around.
      lockDuration: PAGE_TIMEOUT_MS + 30_000,
    },
  );
  worker.on('failed', (job, err) => {
    console.error(`[crawlWorker] job ${job?.id} failed:`, err);
  });
  return worker;
}
